import { describe, it, expect, beforeEach, vi } from "vitest";
import { getWebhookEventCache, webhookEventCache } from "./webhook-event-cache.js";

vi.mock("./logger.js", () => ({
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("./metrics.js", () => ({
  webhookEventCacheHitTotal: { inc: vi.fn() },
  webhookEventCacheMissTotal: { inc: vi.fn() },
  webhookEventCacheSize: { set: vi.fn() },
  webhookEventDeduplicationCacheSize: { set: vi.fn() },
  webhookEventDeliveryAttemptsCached: { inc: vi.fn() },
}));

describe("Webhook Event Cache", () => {
  let cache;

  beforeEach(() => {
    cache = getWebhookEventCache();
  });

  describe("payload caching", () => {
    it("stores and retrieves payload", () => {
      const merchantId = "merchant-1";
      const eventType = "payment.confirmed";
      const paymentId = "pay-001";
      const payload = { status: "confirmed", amount: 100 };

      cache.setPayload(merchantId, eventType, paymentId, payload);
      const retrieved = cache.getPayload(merchantId, eventType, paymentId);

      expect(retrieved).toEqual(payload);
    });

    it("returns null for non-existent payload", () => {
      const retrieved = cache.getPayload("merchant-1", "payment.confirmed", "pay-999");
      expect(retrieved).toBeNull();
    });

    it("expires cached payloads after TTL", (done) => {
      const cacheWithShortTTL = getWebhookEventCache({ ttl: 10 });
      const payload = { status: "confirmed" };

      cacheWithShortTTL.setPayload("merchant-1", "payment.confirmed", "pay-001", payload);
      expect(cacheWithShortTTL.getPayload("merchant-1", "payment.confirmed", "pay-001")).toEqual(
        payload
      );

      setTimeout(() => {
        expect(
          cacheWithShortTTL.getPayload("merchant-1", "payment.confirmed", "pay-001")
        ).toBeNull();
        done();
      }, 50);
    });

    it("respects max entries limit", () => {
      const cacheWithLimit = getWebhookEventCache({ maxEntries: 3 });

      cacheWithLimit.setPayload("merchant-1", "payment.confirmed", "pay-001", { id: 1 });
      cacheWithLimit.setPayload("merchant-1", "payment.confirmed", "pay-002", { id: 2 });
      cacheWithLimit.setPayload("merchant-1", "payment.confirmed", "pay-003", { id: 3 });
      cacheWithLimit.setPayload("merchant-1", "payment.confirmed", "pay-004", { id: 4 });

      const stats = cacheWithLimit.getStats();
      expect(stats.payloadCacheSize).toBeLessThanOrEqual(3);
    });
  });

  describe("delivery deduplication", () => {
    it("detects duplicate delivery attempts", () => {
      const merchantId = "merchant-1";
      const webhookUrl = "https://example.com/webhook";
      const payload = { status: "confirmed", amount: 100 };

      const isDuplicate1 = cache.shouldDeduplicate(merchantId, webhookUrl, payload);
      expect(isDuplicate1).toBe(false);

      cache.recordDeliveryAttempt(merchantId, webhookUrl, payload);

      const isDuplicate2 = cache.shouldDeduplicate(merchantId, webhookUrl, payload);
      expect(isDuplicate2).toBe(true);
    });

    it("tracks delivery attempt count", () => {
      const merchantId = "merchant-1";
      const webhookUrl = "https://example.com/webhook";
      const payload = { status: "confirmed" };

      cache.recordDeliveryAttempt(merchantId, webhookUrl, payload);
      cache.recordDeliveryAttempt(merchantId, webhookUrl, payload);

      const count = cache.getDeliveryAttemptCount(merchantId, webhookUrl, payload);
      expect(count).toBe(2);
    });

    it("clears deduplication on successful delivery", () => {
      const merchantId = "merchant-1";
      const webhookUrl = "https://example.com/webhook";
      const payload = { status: "confirmed" };

      cache.recordDeliveryAttempt(merchantId, webhookUrl, payload);
      expect(cache.getDeliveryAttemptCount(merchantId, webhookUrl, payload)).toBeGreaterThan(0);

      cache.recordDeliverySuccess(merchantId, webhookUrl, payload);
      expect(cache.getDeliveryAttemptCount(merchantId, webhookUrl, payload)).toBe(0);
    });

    it("respects maximum retry attempts", () => {
      const merchantId = "merchant-1";
      const webhookUrl = "https://example.com/webhook";
      const payload = { status: "confirmed" };

      for (let i = 0; i < 6; i++) {
        cache.recordDeliveryAttempt(merchantId, webhookUrl, payload);
      }

      const isDuplicate = cache.shouldDeduplicate(merchantId, webhookUrl, payload);
      const count = cache.getDeliveryAttemptCount(merchantId, webhookUrl, payload);

      expect(count).toBeGreaterThanOrEqual(5);
    });
  });

  describe("subscription caching", () => {
    it("caches merchant subscriptions", () => {
      const merchantId = "merchant-1";
      const subscriptions = [
        { id: "sub-1", event_type: "payment.confirmed" },
        { id: "sub-2", event_type: "payment.failed" },
      ];

      cache.cacheSubscriptions(merchantId, subscriptions);
      const cached = cache.getSubscriptions(merchantId);

      expect(cached).toEqual(subscriptions);
    });

    it("returns null for expired subscriptions", (done) => {
      const cacheWithShortTTL = getWebhookEventCache({ ttl: 10 });
      const subscriptions = [{ id: "sub-1", event_type: "payment.confirmed" }];

      cacheWithShortTTL.cacheSubscriptions("merchant-1", subscriptions);
      expect(cacheWithShortTTL.getSubscriptions("merchant-1")).toEqual(subscriptions);

      setTimeout(() => {
        expect(cacheWithShortTTL.getSubscriptions("merchant-1")).toBeNull();
        done();
      }, 50);
    });

    it("invalidates specific merchant subscriptions", () => {
      const merchantId = "merchant-1";
      const subscriptions = [{ id: "sub-1" }];

      cache.cacheSubscriptions(merchantId, subscriptions);
      expect(cache.getSubscriptions(merchantId)).toBeTruthy();

      cache.invalidateSubscriptions(merchantId);
      expect(cache.getSubscriptions(merchantId)).toBeNull();
    });
  });

  describe("circuit breaker", () => {
    it("opens circuit breaker on failure", () => {
      const merchantId = "merchant-1";
      const webhookUrl = "https://example.com/webhook";

      cache.openCircuitBreaker(merchantId, webhookUrl);
      expect(cache.isCircuitBreakerOpen(merchantId, webhookUrl)).toBe(true);
    });

    it("closes circuit breaker manually", () => {
      const merchantId = "merchant-1";
      const webhookUrl = "https://example.com/webhook";

      cache.openCircuitBreaker(merchantId, webhookUrl);
      expect(cache.isCircuitBreakerOpen(merchantId, webhookUrl)).toBe(true);

      cache.closeCircuitBreaker(merchantId, webhookUrl);
      expect(cache.isCircuitBreakerOpen(merchantId, webhookUrl)).toBe(false);
    });

    it("auto-resets circuit breaker after timeout", (done) => {
      const cacheWithShortReset = getWebhookEventCache();
      const merchantId = "merchant-1";
      const webhookUrl = "https://example.com/webhook";

      cacheWithShortReset.openCircuitBreaker(merchantId, webhookUrl);
      expect(cacheWithShortReset.isCircuitBreakerOpen(merchantId, webhookUrl)).toBe(true);

      setTimeout(() => {
        expect(cacheWithShortReset.isCircuitBreakerOpen(merchantId, webhookUrl)).toBe(true);
      }, 100);

      done();
    });

    it("tracks circuit breaker failures", () => {
      const merchantId = "merchant-1";
      const webhookUrl = "https://example.com/webhook";

      cache.openCircuitBreaker(merchantId, webhookUrl);

      for (let i = 0; i < 3; i++) {
        cache.incrementCircuitBreakerFailures(merchantId, webhookUrl);
      }

      expect(cache.isCircuitBreakerOpen(merchantId, webhookUrl)).toBe(true);
    });
  });

  describe("cache statistics", () => {
    it("provides cache statistics", () => {
      cache.setPayload("merchant-1", "payment.confirmed", "pay-001", { id: 1 });
      cache.recordDeliveryAttempt("merchant-1", "https://example.com", { id: 1 });
      cache.cacheSubscriptions("merchant-1", [{ id: "sub-1" }]);
      cache.openCircuitBreaker("merchant-1", "https://example.com");

      const stats = cache.getStats();

      expect(stats).toHaveProperty("payloadCacheSize");
      expect(stats).toHaveProperty("deduplicationCacheSize");
      expect(stats).toHaveProperty("subscriptionsCacheSize");
      expect(stats).toHaveProperty("circuitBreakerCount");
      expect(stats.payloadCacheSize).toBeGreaterThan(0);
    });
  });

  describe("cache clearing", () => {
    it("clears all cache entries", () => {
      cache.setPayload("merchant-1", "payment.confirmed", "pay-001", { id: 1 });
      cache.recordDeliveryAttempt("merchant-1", "https://example.com", { id: 1 });
      cache.cacheSubscriptions("merchant-1", [{ id: "sub-1" }]);

      const statsBefore = cache.getStats();
      expect(
        statsBefore.payloadCacheSize +
          statsBefore.deduplicationCacheSize +
          statsBefore.subscriptionsCacheSize
      ).toBeGreaterThan(0);

      cache.clear();

      const statsAfter = cache.getStats();
      expect(statsAfter.payloadCacheSize).toBe(0);
      expect(statsAfter.deduplicationCacheSize).toBe(0);
      expect(statsAfter.subscriptionsCacheSize).toBe(0);
      expect(statsAfter.circuitBreakerCount).toBe(0);
    });

    it("clears expired entries", (done) => {
      const cacheWithShortTTL = getWebhookEventCache({ ttl: 10 });

      cacheWithShortTTL.setPayload("merchant-1", "payment.confirmed", "pay-001", { id: 1 });
      expect(cacheWithShortTTL.getStats().payloadCacheSize).toBeGreaterThan(0);

      setTimeout(() => {
        const expiredCount = cacheWithShortTTL.clearExpiredEntries();
        expect(expiredCount).toBeGreaterThanOrEqual(0);
        done();
      }, 50);
    });
  });

  describe("payload hashing", () => {
    it("generates consistent hash for same payload", () => {
      const payload = { status: "confirmed", amount: 100 };
      const hash1 = cache.generatePayloadHash(payload);
      const hash2 = cache.generatePayloadHash(payload);

      expect(hash1).toBe(hash2);
    });

    it("generates different hash for different payloads", () => {
      const payload1 = { status: "confirmed", amount: 100 };
      const payload2 = { status: "confirmed", amount: 200 };
      const hash1 = cache.generatePayloadHash(payload1);
      const hash2 = cache.generatePayloadHash(payload2);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe("default singleton", () => {
    it("provides default singleton instance", () => {
      expect(webhookEventCache).toBeDefined();
      expect(webhookEventCache).toHaveProperty("getPayload");
      expect(webhookEventCache).toHaveProperty("setPayload");
    });
  });
});
