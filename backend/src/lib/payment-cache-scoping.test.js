import { describe, it, expect, vi } from "vitest";
import {
  paymentCacheKey,
  getCachedPayment,
  setCachedPayment,
  invalidatePaymentCache,
} from "./redis.js";

/**
 * Payment status cache scoping (issue #1311).
 *
 * getPaymentStatus() is called both without a merchant scope (a customer
 * following their public payment_link) and with one (an authenticated
 * merchant lookup) for the same payment id. Before this fix, the cache key
 * was keyed on `id` alone, so a cache hit returned whichever caller's
 * result was cached first — completely bypassing the merchant_id filter
 * the uncached query path enforces. These tests pin down that the cache
 * key, and every function built on it, carries the merchant scope as part
 * of its identity.
 */
describe("paymentCacheKey (issue #1311)", () => {
  it("produces different keys for different merchant scopes on the same payment id", () => {
    const publicKey = paymentCacheKey("pay_1", null);
    const merchantAKey = paymentCacheKey("pay_1", "merchant-a");
    const merchantBKey = paymentCacheKey("pay_1", "merchant-b");

    expect(new Set([publicKey, merchantAKey, merchantBKey]).size).toBe(3);
  });

  it("defaults to a stable public scope when no merchantId is given", () => {
    expect(paymentCacheKey("pay_1")).toBe(paymentCacheKey("pay_1", null));
  });

  it("produces the same key for the same (id, merchantId) pair", () => {
    expect(paymentCacheKey("pay_1", "merchant-a")).toBe(
      paymentCacheKey("pay_1", "merchant-a"),
    );
  });
});

function makeFakeRedisClient() {
  const store = new Map();
  return {
    store,
    get: vi.fn(async (key) => store.get(key) ?? null),
    set: vi.fn(async (key, value) => {
      store.set(key, value);
    }),
    del: vi.fn(async (key) => {
      store.delete(key);
    }),
  };
}

describe("getCachedPayment / setCachedPayment scoping (issue #1311)", () => {
  it("a payment cached under one merchant's scope is not visible to a different merchant's lookup", async () => {
    const client = makeFakeRedisClient();
    const merchantAsPayment = { id: "pay_1", merchant_id: "merchant-a", amount: "10" };

    await setCachedPayment(client, "pay_1", merchantAsPayment, "merchant-a");

    const seenByMerchantB = await getCachedPayment(client, "pay_1", "merchant-b");
    expect(seenByMerchantB).toBeNull();

    const seenByMerchantA = await getCachedPayment(client, "pay_1", "merchant-a");
    expect(seenByMerchantA).toEqual(merchantAsPayment);
  });

  it("a payment cached under the public (unscoped) lookup is not returned for a merchant-scoped lookup", async () => {
    const client = makeFakeRedisClient();
    const publicPayment = { id: "pay_1", merchant_id: "merchant-a", amount: "10" };

    await setCachedPayment(client, "pay_1", publicPayment, null);

    const seenByMerchantA = await getCachedPayment(client, "pay_1", "merchant-a");
    expect(seenByMerchantA).toBeNull();

    const seenPublicly = await getCachedPayment(client, "pay_1", null);
    expect(seenPublicly).toEqual(publicPayment);
  });
});

describe("invalidatePaymentCache scoping (issue #1311)", () => {
  it("invalidates both the public and the given merchant-scoped entry", async () => {
    const client = makeFakeRedisClient();
    const payment = { id: "pay_1", amount: "10" };

    await setCachedPayment(client, "pay_1", payment, null);
    await setCachedPayment(client, "pay_1", payment, "merchant-a");

    await invalidatePaymentCache(client, "pay_1", "merchant-a");

    expect(await getCachedPayment(client, "pay_1", null)).toBeNull();
    expect(await getCachedPayment(client, "pay_1", "merchant-a")).toBeNull();
  });

  it("does not touch a different merchant's cached entry it was not asked to invalidate", async () => {
    const client = makeFakeRedisClient();
    const payment = { id: "pay_1", amount: "10" };

    await setCachedPayment(client, "pay_1", payment, "merchant-a");
    await setCachedPayment(client, "pay_1", payment, "merchant-b");

    await invalidatePaymentCache(client, "pay_1", "merchant-a");

    expect(await getCachedPayment(client, "pay_1", "merchant-a")).toBeNull();
    expect(await getCachedPayment(client, "pay_1", "merchant-b")).toEqual(payment);
  });
});
