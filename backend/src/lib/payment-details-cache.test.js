import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeRedis } from "../../tests/helpers/fake-redis.js";
import { invalidatePaymentCache, paymentDetailsGenerationKey } from "./redis.js";
import {
  paymentDetailsCacheKey,
  readThroughPaymentDetails,
  resolvePaymentDetailsTtlSeconds,
} from "./payment-details-cache.js";
import { paymentDetailsRegister, resetPaymentDetailsMetrics } from "./payment-details-metrics.js";

const M = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const OTHER = "9b2c0b8e-0000-4000-8000-000000000000";
const P = "6fa459ea-ee8a-4ca4-894e-db77e160355e";
const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() };

const body = (status, stellar_tx = null) => ({ payment: { id: P, status }, stellar_tx });

async function count(result) {
  const metric = await paymentDetailsRegister.getSingleMetric("payment_details_cache_operations_total").get();
  return metric.values.find((v) => v.labels.result === result)?.value ?? 0;
}

let redis;
let opts;

beforeEach(() => {
  vi.clearAllMocks();
  resetPaymentDetailsMetrics();
  redis = createFakeRedis();
  opts = { getClient: async () => redis, env: {}, logger };
});

describe("resolvePaymentDetailsTtlSeconds", () => {
  it.each([
    ["failed", null, 300],
    ["expired", null, 300],
    ["refunded", null, 300],
    ["completed", { tx_hash: "a" }, 300],
    ["completed", null, 2],
    ["confirmed", null, 2],
    ["pending", null, 2],
    [undefined, null, 2],
  ])("%s (stellar_tx=%j) → %ds", (status, tx, ttl) => {
    expect(resolvePaymentDetailsTtlSeconds(body(status, tx), {})).toBe(ttl);
  });

  it("honours and clamps env overrides", () => {
    const env = {
      PAYMENT_DETAILS_CACHE_TERMINAL_TTL_SECONDS: "99999",
      PAYMENT_DETAILS_CACHE_ACTIVE_TTL_SECONDS: "0",
    };
    expect(resolvePaymentDetailsTtlSeconds(body("failed"), env)).toBe(3600);
    expect(resolvePaymentDetailsTtlSeconds(body("pending"), env)).toBe(0);
  });
});

describe("readThroughPaymentDetails", () => {
  it("serves repeat lookups of a terminal payment from Redis", async () => {
    const loader = vi.fn(async () => body("completed", { tx_hash: "abc", ledger: 1 }));
    const a = await readThroughPaymentDetails(M, P, loader, opts);
    const b = await readThroughPaymentDetails(M, P, loader, opts);
    expect(a.cache).toBe("miss");
    expect(b).toEqual({ value: a.value, cache: "hit" });
    expect(loader).toHaveBeenCalledTimes(1);
    const entry = redis.store.get(paymentDetailsCacheKey(M, P, "0"));
    expect(entry.expiresAt - Date.now()).toBeGreaterThan(200_000);
  });

  it("caches in-progress payments only briefly", async () => {
    await readThroughPaymentDetails(M, P, async () => body("pending"), opts);
    const entry = redis.store.get(paymentDetailsCacheKey(M, P, "0"));
    expect(entry.expiresAt - Date.now()).toBeLessThanOrEqual(2_000);
  });

  it("does not store when the active TTL is 0", async () => {
    await readThroughPaymentDetails(M, P, async () => body("pending"), {
      ...opts,
      env: { PAYMENT_DETAILS_CACHE_ACTIVE_TTL_SECONDS: "0" },
    });
    expect(redis.keys("payment:details:v1:")).toHaveLength(0);
    expect(await count("skip_store")).toBe(1);
  });

  it("scopes entries by merchant: another merchant never gets a hit", async () => {
    await readThroughPaymentDetails(M, P, async () => body("failed"), opts);
    const loader = vi.fn(async () => null);
    const other = await readThroughPaymentDetails(OTHER, P, loader, opts);
    expect(other).toEqual({ value: null, cache: "miss" });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("never caches a 404 or a loader error", async () => {
    await readThroughPaymentDetails(M, P, async () => null, opts);
    await expect(
      readThroughPaymentDetails(M, P, async () => { throw new Error("db"); }, opts),
    ).rejects.toThrow("db");
    expect(redis.keys("payment:details:v1:")).toHaveLength(0);
  });

  it("invalidatePaymentCache() — called by every payment writer — retires the entry", async () => {
    let status = "pending";
    const loader = vi.fn(async () => body(status));
    await readThroughPaymentDetails(M, P, loader, {
      ...opts,
      env: { PAYMENT_DETAILS_CACHE_ACTIVE_TTL_SECONDS: "30" },
    });

    status = "completed";
    // The Horizon poller invalidates without a merchant id.
    await invalidatePaymentCache(redis, P);
    expect(await redis.get(paymentDetailsGenerationKey(P))).toBe("1");

    const after = await readThroughPaymentDetails(M, P, loader, opts);
    expect(after.cache).toBe("miss");
    expect(after.value.payment.status).toBe("completed");
  });

  it("a reader racing a writer stores under the retired generation", async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const slow = readThroughPaymentDetails(M, P, async () => {
      await gate;
      return body("completed", { tx_hash: "old" });
    }, opts);
    await new Promise((r) => setTimeout(r, 5));
    await invalidatePaymentCache(redis, P, M);
    release();
    await slow;

    const next = await readThroughPaymentDetails(M, P, async () => body("refunded"), opts);
    expect(next).toEqual({ value: body("refunded"), cache: "miss" });
  });

  it("fails open to the database when Redis errors or is down", async () => {
    redis.setFailure(new Error("ECONNRESET"));
    const a = await readThroughPaymentDetails(M, P, async () => body("failed"), opts);
    expect(a.cache).toBe("bypass");
    const b = await readThroughPaymentDetails(M, P, async () => body("failed"), {
      ...opts,
      getClient: async () => ({ isOpen: false }),
    });
    expect(b.cache).toBe("bypass");
  });

  it("bypasses when disabled or when ids are not key-safe", async () => {
    const disabled = await readThroughPaymentDetails(M, P, async () => 1, {
      ...opts,
      env: { PAYMENT_DETAILS_CACHE_ENABLED: "false" },
    });
    const unsafe = await readThroughPaymentDetails("a:*", P, async () => 1, opts);
    expect(disabled.cache).toBe("bypass");
    expect(unsafe.cache).toBe("bypass");
    expect(redis.calls).toHaveLength(0);
  });

  it("treats a corrupt entry as a miss", async () => {
    await redis.set(paymentDetailsCacheKey(M, P, "0"), "{bad");
    const result = await readThroughPaymentDetails(M, P, async () => body("failed"), opts);
    expect(result.cache).toBe("miss");
    expect(await count("error")).toBe(1);
    expect(logger.warn).toHaveBeenCalled();
  });
});
