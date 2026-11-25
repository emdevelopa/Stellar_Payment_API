import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEnrichmentLimiter,
  createSingleFlight,
  enrichStellarTx,
  isConsistentStellarTx,
  paymentDetailsFlightKey,
  resolveEnrichmentOptions,
} from "./payment-details-concurrency.js";
import { paymentDetailsRegister, resetPaymentDetailsMetrics } from "./payment-details-metrics.js";

const TX = "ab".repeat(32);

async function enrichmentCount(outcome) {
  const m = await paymentDetailsRegister.getSingleMetric("payment_details_enrichment_total").get();
  return m.values.find((v) => v.labels.outcome === outcome)?.value ?? 0;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => resetPaymentDetailsMetrics());

describe("createSingleFlight", () => {
  it("runs once for concurrent identical keys and gives followers their own copy", async () => {
    const sf = createSingleFlight();
    const gate = deferred();
    const fn = vi.fn(async () => {
      await gate.promise;
      return { payment: { status: "pending" } };
    });

    const calls = Array.from({ length: 5 }, () => sf.run("k", fn));
    expect(sf.size).toBe(1);
    gate.resolve();
    const results = await Promise.all(calls);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(results.filter((r) => !r.shared)).toHaveLength(1);
    expect(results.filter((r) => r.shared)).toHaveLength(4);
    results[1].value.payment.status = "tampered";
    expect(results[0].value.payment.status).toBe("pending");
    expect(results[2].value.payment.status).toBe("pending");
    expect(sf.size).toBe(0);

    const m = await paymentDetailsRegister.getSingleMetric("payment_details_coalesced_total").get();
    expect(m.values[0].value).toBe(4);
  });

  it("does not share across different keys", async () => {
    const sf = createSingleFlight();
    const fn = vi.fn(async (v) => v);
    const [a, b] = await Promise.all([sf.run("a", () => fn(1)), sf.run("b", () => fn(2))]);
    expect(a.value).toBe(1);
    expect(b.value).toBe(2);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("propagates a failure to everyone in flight but never replays it", async () => {
    const sf = createSingleFlight();
    const gate = deferred();
    const boom = new Error("db down");
    const p1 = sf.run("k", () => gate.promise);
    const p2 = sf.run("k", () => gate.promise);
    gate.reject(boom);
    await expect(p1).rejects.toBe(boom);
    await expect(p2).rejects.toBe(boom);
    expect(sf.size).toBe(0);

    const next = await sf.run("k", async () => "recovered");
    expect(next).toEqual({ value: "recovered", shared: false });
  });

  it("stops coalescing past maxKeys instead of growing without bound", async () => {
    const sf = createSingleFlight({ maxKeys: 1 });
    const gate = deferred();
    const first = sf.run("a", () => gate.promise);
    const second = await sf.run("b", async () => "direct");
    expect(second).toEqual({ value: "direct", shared: false });
    expect(sf.size).toBe(1);
    gate.resolve("x");
    await first;
  });

  it("passes null results through without cloning", async () => {
    const sf = createSingleFlight();
    const gate = deferred();
    const a = sf.run("k", () => gate.promise);
    const b = sf.run("k", () => gate.promise);
    gate.resolve(null);
    expect((await a).value).toBeNull();
    expect((await b).value).toBeNull();
  });

  it("scopes flight keys by merchant", () => {
    expect(paymentDetailsFlightKey("m1", "p")).not.toBe(paymentDetailsFlightKey("m2", "p"));
  });
});

describe("isConsistentStellarTx", () => {
  it("accepts only the snapshot's transaction (case-insensitive)", () => {
    expect(isConsistentStellarTx(TX, { tx_hash: TX.toUpperCase() })).toBe(true);
    expect(isConsistentStellarTx(TX, { tx_hash: "cd".repeat(32) })).toBe(false);
    expect(isConsistentStellarTx(TX, null)).toBe(false);
    expect(isConsistentStellarTx(null, { tx_hash: TX })).toBe(false);
    expect(isConsistentStellarTx(TX, { tx_hash: 1 })).toBe(false);
  });
});

describe("enrichStellarTx", () => {
  const limiter = () => createEnrichmentLimiter({ maxConcurrent: 1, maxQueue: 0, queueTimeoutMs: 50 });

  it("returns matching metadata", async () => {
    const meta = { tx_hash: TX, ledger: 7, timestamp: "t" };
    const r = await enrichStellarTx(TX, async () => meta, { limiter: limiter(), timeoutMs: 500 });
    expect(r).toEqual({ stellarTx: meta, outcome: "ok" });
    expect(await enrichmentCount("ok")).toBe(1);
  });

  it("skips without a tx id", async () => {
    const fetch = vi.fn();
    const r = await enrichStellarTx(null, fetch, { limiter: limiter(), timeoutMs: 500 });
    expect(r.outcome).toBe("skipped");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("drops metadata for a different transaction", async () => {
    const r = await enrichStellarTx(TX, async () => ({ tx_hash: "cd".repeat(32) }), { limiter: limiter(), timeoutMs: 500 });
    expect(r).toEqual({ stellarTx: null, outcome: "mismatch" });
  });

  it("treats a null or throwing fetch as unavailable", async () => {
    expect((await enrichStellarTx(TX, async () => null, { limiter: limiter(), timeoutMs: 500 })).outcome).toBe("unavailable");
    expect((await enrichStellarTx(TX, async () => { throw new Error("x"); }, { limiter: limiter(), timeoutMs: 500 })).outcome).toBe("unavailable");
  });

  it("abandons a slow lookup at the deadline but keeps its slot until Horizon answers", async () => {
    const lim = limiter();
    const slow = deferred();
    const r = await enrichStellarTx(TX, () => slow.promise, { limiter: lim, timeoutMs: 20 });
    expect(r).toEqual({ stellarTx: null, outcome: "timeout" });
    expect(lim.active).toBe(1);

    // While the abandoned call is still outstanding, new work is shed.
    const shed = await enrichStellarTx(TX, async () => ({ tx_hash: TX }), { limiter: lim, timeoutMs: 20 });
    expect(shed.outcome).toBe("shed");

    slow.resolve({ tx_hash: TX });
    await new Promise((res) => setTimeout(res, 0));
    expect(lim.active).toBe(0);
  });

  it("sheds instead of queueing without bound", async () => {
    const lim = limiter();
    const hold = deferred();
    const first = enrichStellarTx(TX, () => hold.promise, { limiter: lim, timeoutMs: 1_000 });
    const second = await enrichStellarTx(TX, async () => ({ tx_hash: TX }), { limiter: lim, timeoutMs: 1_000 });
    expect(second).toEqual({ stellarTx: null, outcome: "shed" });
    hold.resolve({ tx_hash: TX });
    expect((await first).outcome).toBe("ok");
    expect(await enrichmentCount("shed")).toBe(1);
  });

  it("bounds how many Horizon calls run at once under a burst", async () => {
    const lim = createEnrichmentLimiter({ maxConcurrent: 2, maxQueue: 100, queueTimeoutMs: 5_000 });
    let running = 0;
    let peak = 0;
    const fetch = async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((res) => setTimeout(res, 5));
      running -= 1;
      return { tx_hash: TX };
    };
    const results = await Promise.all(
      Array.from({ length: 10 }, () => enrichStellarTx(TX, fetch, { limiter: lim, timeoutMs: 5_000 })),
    );
    expect(peak).toBe(2);
    expect(results.every((r) => r.outcome === "ok")).toBe(true);
  });
});

describe("resolveEnrichmentOptions", () => {
  it("uses safe defaults and clamps env values", () => {
    expect(resolveEnrichmentOptions({})).toEqual({ maxConcurrent: 8, maxQueue: 32, queueTimeoutMs: 1000, timeoutMs: 4000 });
    expect(resolveEnrichmentOptions({ PAYMENT_DETAILS_HORIZON_MAX_CONCURRENCY: "0", PAYMENT_DETAILS_HORIZON_TIMEOUT_MS: "1" }))
      .toMatchObject({ maxConcurrent: 1, timeoutMs: 50 });
  });
});
