import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fetchTxMetaWithRecovery,
  recoverPaymentDetailsDlq,
  scheduleRecovery,
  isHorizonRetryable,
  isHorizonNotFound,
  paymentDetailsDlq,
  resetPaymentDetailsRecoveryForTests,
} from "./payment-details-recovery.js";
import {
  paymentDetailsRegister,
  resetPaymentDetailsMetrics,
} from "./payment-details-metrics.js";

const TX = "a".repeat(64);
const META = { tx_hash: TX, ledger: 123, timestamp: "2026-01-01T00:00:00Z" };
const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const noSleep = async () => {};

function httpError(status, message = `HTTP ${status}`) {
  const err = new Error(message);
  err.response = { status };
  return err;
}

async function counter(name, labels = {}) {
  const metric = await paymentDetailsRegister.getSingleMetric(name).get();
  const match = metric.values.find((v) =>
    Object.entries(labels).every(([k, val]) => v.labels[k] === val),
  );
  return match ? match.value : 0;
}

function lookup(fetchTx, extra = {}) {
  return fetchTxMetaWithRecovery(TX, {
    fetchTx,
    sleep: noSleep,
    random: () => 0,
    logger: silentLogger,
    scheduleRecovery: false,
    ...extra,
  });
}

describe("error classification", () => {
  it("retries network errors, 408, 429 and 5xx", () => {
    expect(isHorizonRetryable(httpError(503))).toBe(true);
    expect(isHorizonRetryable(httpError(500))).toBe(true);
    expect(isHorizonRetryable(httpError(429))).toBe(true);
    expect(isHorizonRetryable(httpError(408))).toBe(true);
    expect(isHorizonRetryable(Object.assign(new Error("x"), { code: "ECONNRESET" }))).toBe(true);
    expect(isHorizonRetryable(new Error("fetch failed"))).toBe(true);
  });

  it("does not retry 404, other 4xx, 501 or explicit opt-outs", () => {
    expect(isHorizonRetryable(httpError(404))).toBe(false);
    expect(isHorizonRetryable(httpError(400))).toBe(false);
    expect(isHorizonRetryable(httpError(501))).toBe(false);
    expect(isHorizonRetryable(Object.assign(httpError(503), { retryable: false }))).toBe(false);
    expect(isHorizonRetryable(null)).toBe(false);
    expect(isHorizonRetryable("boom")).toBe(false);
  });

  it("recognizes a 404", () => {
    expect(isHorizonNotFound(httpError(404))).toBe(true);
    expect(isHorizonNotFound(httpError(500))).toBe(false);
  });
});

describe("fetchTxMetaWithRecovery", () => {
  beforeEach(() => {
    resetPaymentDetailsRecoveryForTests();
    resetPaymentDetailsMetrics();
    vi.clearAllMocks();
  });

  it("returns metadata on the first success", async () => {
    const fetchTx = vi.fn().mockResolvedValue(META);

    expect(await lookup(fetchTx)).toEqual(META);
    expect(fetchTx).toHaveBeenCalledTimes(1);
    expect(await counter("payment_details_horizon_fetch_total", { outcome: "success" })).toBe(1);
  });

  it("serves a repeat lookup from the cache without calling Horizon", async () => {
    const fetchTx = vi.fn().mockResolvedValue(META);
    await lookup(fetchTx);
    await lookup(fetchTx);

    expect(fetchTx).toHaveBeenCalledTimes(1);
    expect(await counter("payment_details_horizon_fetch_total", { outcome: "cache_hit" })).toBe(1);
  });

  it("expires cached entries after the TTL", async () => {
    let now = 1_000;
    const fetchTx = vi.fn().mockResolvedValue(META);
    await lookup(fetchTx, { now: () => now });
    now += 11 * 60 * 1000;
    await lookup(fetchTx, { now: () => now });

    expect(fetchTx).toHaveBeenCalledTimes(2);
  });

  it("retries transient failures and then succeeds", async () => {
    const fetchTx = vi
      .fn()
      .mockRejectedValueOnce(httpError(503))
      .mockRejectedValueOnce(Object.assign(new Error("reset"), { code: "ECONNRESET" }))
      .mockResolvedValue(META);

    expect(await lookup(fetchTx)).toEqual(META);
    expect(fetchTx).toHaveBeenCalledTimes(3);
    expect(await counter("payment_details_horizon_retries_total")).toBe(2);
    expect(paymentDetailsDlq.size).toBe(0);
  });

  it("returns null for 404 without retrying or dead-lettering", async () => {
    const fetchTx = vi.fn().mockRejectedValue(httpError(404));

    expect(await lookup(fetchTx)).toBeNull();
    expect(fetchTx).toHaveBeenCalledTimes(1);
    expect(paymentDetailsDlq.size).toBe(0);
    expect(await counter("payment_details_horizon_fetch_total", { outcome: "not_found" })).toBe(1);
  });

  it("returns null for a non-retryable error without dead-lettering", async () => {
    const fetchTx = vi.fn().mockRejectedValue(httpError(400));

    expect(await lookup(fetchTx)).toBeNull();
    expect(fetchTx).toHaveBeenCalledTimes(1);
    expect(paymentDetailsDlq.size).toBe(0);
    expect(await counter("payment_details_horizon_fetch_total", { outcome: "error" })).toBe(1);
  });

  it("dead-letters a lookup that keeps failing transiently, keyed by tx id only", async () => {
    const fetchTx = vi.fn().mockRejectedValue(httpError(503));

    expect(await lookup(fetchTx)).toBeNull();
    expect(fetchTx).toHaveBeenCalledTimes(3);
    expect(paymentDetailsDlq.size).toBe(1);
    expect(paymentDetailsDlq.has(TX)).toBe(true);
    expect(await counter("payment_details_horizon_fetch_total", { outcome: "dead_lettered" })).toBe(1);
    expect(paymentDetailsDlq.list()[0]).not.toHaveProperty("payload");
  });

  it("coalesces repeated failures for one transaction into one entry", async () => {
    const fetchTx = vi.fn().mockRejectedValue(httpError(503));
    await lookup(fetchTx);
    await lookup(fetchTx);

    expect(paymentDetailsDlq.size).toBe(1);
  });

  it("rejects ids that are not 64-hex transaction hashes without calling Horizon", async () => {
    const fetchTx = vi.fn().mockResolvedValue(META);
    for (const bad of ["", null, undefined, "short", "../../etc/passwd", `${"a".repeat(63)}z`]) {
      expect(await fetchTxMetaWithRecovery(bad, { fetchTx, logger: silentLogger })).toBeNull();
    }
    expect(fetchTx).not.toHaveBeenCalled();
  });
});

describe("recoverPaymentDetailsDlq", () => {
  beforeEach(() => {
    resetPaymentDetailsRecoveryForTests();
    resetPaymentDetailsMetrics();
    vi.clearAllMocks();
  });

  async function deadLetter() {
    await lookup(vi.fn().mockRejectedValue(httpError(503)));
    // Make the entry due immediately.
    paymentDetailsDlq._entries.get(TX).nextRetryAt = 0;
  }

  it("requires a fetchTx function", async () => {
    await expect(recoverPaymentDetailsDlq({})).rejects.toThrow(TypeError);
  });

  it("recovers a dead-lettered lookup, caches it and empties the queue", async () => {
    await deadLetter();
    const fetchTx = vi.fn().mockResolvedValue(META);

    const result = await recoverPaymentDetailsDlq({ fetchTx });

    expect(result).toMatchObject({ recovered: 1, failed: 0, exhausted: 0 });
    expect(paymentDetailsDlq.size).toBe(0);

    // The recovered metadata now serves requests without hitting Horizon.
    const guard = vi.fn();
    expect(await fetchTxMetaWithRecovery(TX, { fetchTx: guard, logger: silentLogger })).toEqual(META);
    expect(guard).not.toHaveBeenCalled();
  });

  it("keeps the entry and backs off when recovery fails again", async () => {
    await deadLetter();
    const fetchTx = vi.fn().mockRejectedValue(httpError(503));

    const result = await recoverPaymentDetailsDlq({ fetchTx });

    expect(result).toMatchObject({ recovered: 0, failed: 1 });
    expect(paymentDetailsDlq.size).toBe(1);
    expect(paymentDetailsDlq.list()[0].attempts).toBe(1);
  });

  it("runs the background recovery once per throttle window", async () => {
    vi.useFakeTimers();
    try {
      await deadLetter();
      const fetchTx = vi.fn().mockResolvedValue(META);

      let now = 1_000_000;
      expect(scheduleRecovery({ fetchTx, now: () => now, logger: silentLogger })).toBe(true);
      expect(scheduleRecovery({ fetchTx, now: () => now + 1_000, logger: silentLogger })).toBe(false);

      await vi.runAllTimersAsync();
      expect(fetchTx).toHaveBeenCalledTimes(1);

      now += 16_000;
      expect(scheduleRecovery({ fetchTx, now: () => now, logger: silentLogger })).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

afterEach(() => {
  vi.useRealTimers();
});
