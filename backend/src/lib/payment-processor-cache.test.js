import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  generatePaymentCacheKey,
  PaymentProcessorCache,
  PaymentSessionCache,
  PaymentVerificationCache,
  MerchantConfigCache,
} from "./payment-processor-cache.js";

describe("Payment Processor Cache", () => {
  describe("Cache key generation", () => {
    it("generates consistent keys", () => {
      const key1 = generatePaymentCacheKey("payment123");
      const key2 = generatePaymentCacheKey("payment123");
      expect(key1).toBe(key2);
    });

    it("generates different keys for different payments", () => {
      const key1 = generatePaymentCacheKey("payment1");
      const key2 = generatePaymentCacheKey("payment2");
      expect(key1).not.toBe(key2);
    });

    it("includes context in key generation", () => {
      const key1 = generatePaymentCacheKey("p1", "session");
      const key2 = generatePaymentCacheKey("p1", "verification");
      expect(key1).not.toBe(key2);
    });

    it("produces SHA-256 hash format", () => {
      const key = generatePaymentCacheKey("test");
      expect(key).toHaveLength(64); // SHA-256 hex is 64 chars
      expect(/^[a-f0-9]{64}$/.test(key)).toBe(true);
    });
  });

  describe("Basic cache operations", () => {
    let cache;

    beforeEach(() => {
      cache = new PaymentProcessorCache({ ttlMs: 60000 });
    });

    it("sets and retrieves data", async () => {
      const key = generatePaymentCacheKey("p1");
      const data = { amount: 100, asset: "USD" };

      await cache.set(key, data);
      const retrieved = await cache.get(key);

      expect(retrieved).toEqual(data);
    });

    it("returns null for missing keys", async () => {
      const key = generatePaymentCacheKey("missing");
      const retrieved = await cache.get(key);
      expect(retrieved).toBeNull();
    });

    it("invalidates cache entries", async () => {
      const key = generatePaymentCacheKey("p1");
      const data = { amount: 100 };

      await cache.set(key, data);
      let retrieved = await cache.get(key);
      expect(retrieved).not.toBeNull();

      const existed = await cache.invalidate(key);
      expect(existed).toBe(true);

      retrieved = await cache.get(key);
      expect(retrieved).toBeNull();
    });

    it("invalidates nonexistent entries without error", async () => {
      const key = generatePaymentCacheKey("nonexistent");
      const existed = await cache.invalidate(key);
      expect(existed).toBe(false);
    });
  });

  describe("TTL expiration", () => {
    let cache;

    beforeEach(() => {
      cache = new PaymentProcessorCache({ ttlMs: 100 });
    });

    it("expires entries after TTL", async () => {
      const key = generatePaymentCacheKey("p1");
      await cache.set(key, { amount: 100 });

      let retrieved = await cache.get(key);
      expect(retrieved).not.toBeNull();

      await new Promise((resolve) => setTimeout(resolve, 150));

      retrieved = await cache.get(key);
      expect(retrieved).toBeNull();
    });

    it("removes expired entries on access", async () => {
      const key = generatePaymentCacheKey("p1");
      await cache.set(key, { amount: 100 });

      expect(cache.memoryCache.size).toBe(1);

      await new Promise((resolve) => setTimeout(resolve, 150));
      await cache.get(key);

      expect(cache.memoryCache.size).toBe(0);
    });
  });

  describe("Memory eviction", () => {
    it("evicts oldest entries when max capacity reached", async () => {
      const cache = new PaymentProcessorCache({
        ttlMs: 60000,
        maxMemoryEntries: 3,
      });

      for (let i = 0; i < 5; i++) {
        const key = generatePaymentCacheKey(`p${i}`);
        await cache.set(key, { id: i });
      }

      expect(cache.memoryCache.size).toBeLessThanOrEqual(3);
    });
  });

  describe("Batch operations", () => {
    let cache;

    beforeEach(() => {
      cache = new PaymentProcessorCache({ ttlMs: 60000 });
    });

    it("batch gets multiple keys", async () => {
      const entries = new Map([
        [generatePaymentCacheKey("p1"), { id: 1 }],
        [generatePaymentCacheKey("p2"), { id: 2 }],
        [generatePaymentCacheKey("p3"), { id: 3 }],
      ]);

      await cache.mset(entries);

      const keys = Array.from(entries.keys());
      const retrieved = await cache.mget(keys);

      expect(retrieved.size).toBe(3);
    });

    it("batch sets multiple keys", async () => {
      const entries = new Map([
        [generatePaymentCacheKey("p1"), { amount: 100 }],
        [generatePaymentCacheKey("p2"), { amount: 200 }],
      ]);

      await cache.mset(entries);

      for (const [key, data] of entries) {
        const retrieved = await cache.get(key);
        expect(retrieved).toEqual(data);
      }
    });

    it("handles partial batch hits", async () => {
      const key1 = generatePaymentCacheKey("p1");
      const key2 = generatePaymentCacheKey("p2");

      await cache.set(key1, { id: 1 });

      const retrieved = await cache.mget([key1, key2]);

      expect(retrieved.size).toBe(1);
      expect(retrieved.has(key1)).toBe(true);
      expect(retrieved.has(key2)).toBe(false);
    });
  });

  describe("Pattern-based invalidation", () => {
    let cache;

    beforeEach(() => {
      cache = new PaymentProcessorCache({ ttlMs: 60000 });
    });

    it("invalidates payment-related entries by pattern", async () => {
      const paymentId = "payment123";
      const key1 = generatePaymentCacheKey(paymentId, "session");
      const key2 = generatePaymentCacheKey(paymentId, "verification");
      const key3 = generatePaymentCacheKey("other456", "session");

      await cache.set(key1, { data: 1 });
      await cache.set(key2, { data: 2 });
      await cache.set(key3, { data: 3 });

      const invalidatedCount = await cache.invalidatePaymentRelated(paymentId);

      expect(invalidatedCount).toBe(2);
      expect(await cache.get(key1)).toBeNull();
      expect(await cache.get(key2)).toBeNull();
      expect(await cache.get(key3)).not.toBeNull();
    });
  });

  describe("Cache statistics", () => {
    let cache;

    beforeEach(() => {
      cache = new PaymentProcessorCache({ ttlMs: 60000 });
    });

    it("reports cache statistics", async () => {
      const key1 = generatePaymentCacheKey("p1");
      const key2 = generatePaymentCacheKey("p2");

      await cache.set(key1, { data: 1 });
      await cache.set(key2, { data: 2 });

      const stats = await cache.getStats();

      expect(stats.memory.entries).toBe(2);
      expect(stats.memory.valid).toBe(2);
      expect(stats.memory.expired).toBe(0);
      expect(stats.total).toBeGreaterThanOrEqual(2);
    });

    it("tracks expired entries in stats", async () => {
      const cache2 = new PaymentProcessorCache({ ttlMs: 100 });
      const key = generatePaymentCacheKey("p1");

      await cache2.set(key, { data: 1 });

      await new Promise((resolve) => setTimeout(resolve, 150));

      const stats = await cache2.getStats();
      expect(stats.memory.expired).toBe(1);
    });
  });

  describe("Cache warming", () => {
    let cache;

    beforeEach(() => {
      cache = new PaymentProcessorCache({ ttlMs: 60000 });
    });

    it("warms cache with bulk data", async () => {
      const warmData = new Map([
        [generatePaymentCacheKey("p1"), { id: 1 }],
        [generatePaymentCacheKey("p2"), { id: 2 }],
        [generatePaymentCacheKey("p3"), { id: 3 }],
      ]);

      await cache.warmCache(warmData);

      const stats = await cache.getStats();
      expect(stats.memory.entries).toBe(3);
    });
  });

  describe("Clear operations", () => {
    let cache;

    beforeEach(() => {
      cache = new PaymentProcessorCache({ ttlMs: 60000 });
    });

    it("clears all cache entries", async () => {
      const key1 = generatePaymentCacheKey("p1");
      const key2 = generatePaymentCacheKey("p2");

      await cache.set(key1, { data: 1 });
      await cache.set(key2, { data: 2 });

      expect(cache.memoryCache.size).toBe(2);

      await cache.clear();

      expect(cache.memoryCache.size).toBe(0);
    });
  });

  describe("PaymentSessionCache", () => {
    let cache;

    beforeEach(() => {
      cache = new PaymentSessionCache({ ttlMs: 60000 });
    });

    it("manages session-specific caching", async () => {
      const sessionId = "session123";
      const sessionData = { user: "alice", amount: 100 };

      await cache.setSession(sessionId, sessionData);
      const retrieved = await cache.getSession(sessionId);

      expect(retrieved).toEqual(sessionData);
    });

    it("invalidates sessions", async () => {
      const sessionId = "session123";
      await cache.setSession(sessionId, { data: 1 });

      await cache.invalidateSession(sessionId);
      const retrieved = await cache.getSession(sessionId);

      expect(retrieved).toBeNull();
    });
  });

  describe("PaymentVerificationCache", () => {
    let cache;

    beforeEach(() => {
      cache = new PaymentVerificationCache({ ttlMs: 60000 });
    });

    it("caches verification results", async () => {
      const paymentId = "payment123";
      const result = { verified: true, timestamp: Date.now() };

      await cache.setVerification(paymentId, result);
      const retrieved = await cache.getVerification(paymentId);

      expect(retrieved).toEqual(result);
    });
  });

  describe("MerchantConfigCache", () => {
    let cache;

    beforeEach(() => {
      cache = new MerchantConfigCache({ ttlMs: 60000 });
    });

    it("caches merchant configurations", async () => {
      const merchantId = "merchant123";
      const config = { name: "Test Merchant", fee: 0.01 };

      await cache.setConfig(merchantId, config);
      const retrieved = await cache.getConfig(merchantId);

      expect(retrieved).toEqual(config);
    });
  });

  describe("Error handling", () => {
    let cache;

    beforeEach(() => {
      cache = new PaymentProcessorCache({ ttlMs: 60000 });
    });

    it("handles errors gracefully without throwing", async () => {
      const key = generatePaymentCacheKey("p1");
      const circularData = {};
      circularData.self = circularData;

      expect(async () => {
        await cache.set(key, circularData);
      }).not.toThrow();
    });

    it("returns null on retrieval errors", async () => {
      const cache2 = new PaymentProcessorCache({ ttlMs: 60000 });
      cache2.memoryCache.set("corrupt", null);

      const result = await cache2.get("corrupt");
      expect(result).toBeNull();
    });
  });

  describe("Metrics reporting", () => {
    let cache;
    let metricsReporter;

    beforeEach(() => {
      metricsReporter = {
        recordMemoryCacheHit: vi.fn(),
        recordRedisCacheHit: vi.fn(),
        recordCacheMiss: vi.fn(),
        recordCacheError: vi.fn(),
      };

      cache = new PaymentProcessorCache({
        ttlMs: 60000,
        metricsReporter,
      });
    });

    it("reports cache hits", async () => {
      const key = generatePaymentCacheKey("p1");
      await cache.set(key, { data: 1 });
      await cache.get(key);

      expect(metricsReporter.recordMemoryCacheHit).toHaveBeenCalled();
    });

    it("reports cache misses", async () => {
      const key = generatePaymentCacheKey("missing");
      await cache.get(key);

      expect(metricsReporter.recordCacheMiss).toHaveBeenCalled();
    });
  });
});
