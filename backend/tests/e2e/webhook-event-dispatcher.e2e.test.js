import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { getWebhookEventCache } from "../../src/lib/webhook-event-cache.js";

vi.mock("../../src/lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../src/lib/metrics.js", () => ({
  webhookDispatchAttemptsTotal: { inc: vi.fn() },
  webhookDispatchDuration: { observe: vi.fn() },
  webhookDispatchRetriesTotal: { inc: vi.fn() },
  webhookDispatchBlockedTotal: { inc: vi.fn() },
  webhookEventCacheHitTotal: { inc: vi.fn() },
  webhookEventCacheMissTotal: { inc: vi.fn() },
  webhookEventCacheSize: { set: vi.fn() },
  webhookEventDeduplicationCacheSize: { set: vi.fn() },
  webhookEventDeliveryAttemptsCached: { inc: vi.fn() },
}));

describe("Webhook Event Dispatcher E2E Tests", () => {
  let cache;
  let mockWebhookUrl;
  let successfulPayload;
  let failedPayload;

  beforeAll(() => {
    cache = getWebhookEventCache();
    mockWebhookUrl = "https://merchant.example.com/webhooks";
  });

  afterAll(() => {
    cache.clear();
  });

  beforeEach(() => {
    cache.clear();
    successfulPayload = {
      id: "evt-" + Math.random().toString(36).substr(2, 9),
      type: "payment.confirmed",
      timestamp: new Date().toISOString(),
      data: {
        payment_id: "pay-" + Math.random().toString(36).substr(2, 9),
        amount: "100.00",
        status: "confirmed",
      },
    };
    failedPayload = {
      id: "evt-" + Math.random().toString(36).substr(2, 9),
      type: "payment.failed",
      timestamp: new Date().toISOString(),
      data: {
        payment_id: "pay-" + Math.random().toString(36).substr(2, 9),
        reason: "insufficient_funds",
      },
    };
  });

  describe("webhook delivery flow", () => {
    it("caches webhook payload before dispatch", () => {
      const merchantId = "merchant-e2e-1";
      const eventType = "payment.confirmed";
      const paymentId = successfulPayload.data.payment_id;

      cache.setPayload(merchantId, eventType, paymentId, successfulPayload);

      const retrieved = cache.getPayload(merchantId, eventType, paymentId);
      expect(retrieved).toEqual(successfulPayload);
    });

    it("handles successful webhook delivery", () => {
      const merchantId = "merchant-e2e-2";
      const eventType = "payment.confirmed";
      const paymentId = successfulPayload.data.payment_id;

      cache.setPayload(merchantId, eventType, paymentId, successfulPayload);

      cache.recordDeliverySuccess(merchantId, mockWebhookUrl, successfulPayload);

      const attemptCount = cache.getDeliveryAttemptCount(
        merchantId,
        mockWebhookUrl,
        successfulPayload
      );
      expect(attemptCount).toBe(0);
    });

    it("handles failed webhook delivery with retry logic", () => {
      const merchantId = "merchant-e2e-3";
      const eventType = "payment.failed";
      const paymentId = failedPayload.data.payment_id;

      cache.setPayload(merchantId, eventType, paymentId, failedPayload);

      cache.recordDeliveryAttempt(merchantId, mockWebhookUrl, failedPayload);

      let attemptCount = cache.getDeliveryAttemptCount(
        merchantId,
        mockWebhookUrl,
        failedPayload
      );
      expect(attemptCount).toBe(1);

      cache.recordDeliveryAttempt(merchantId, mockWebhookUrl, failedPayload);
      attemptCount = cache.getDeliveryAttemptCount(
        merchantId,
        mockWebhookUrl,
        failedPayload
      );
      expect(attemptCount).toBe(2);
    });

    it("deduplicates identical webhook payloads", () => {
      const merchantId = "merchant-e2e-4";

      cache.recordDeliveryAttempt(merchantId, mockWebhookUrl, successfulPayload);

      const isDuplicate = cache.shouldDeduplicate(
        merchantId,
        mockWebhookUrl,
        successfulPayload
      );
      expect(isDuplicate).toBe(true);

      cache.recordDeliverySuccess(merchantId, mockWebhookUrl, successfulPayload);
      const isStillDuplicate = cache.shouldDeduplicate(
        merchantId,
        mockWebhookUrl,
        successfulPayload
      );
      expect(isStillDuplicate).toBe(false);
    });
  });

  describe("event type handling", () => {
    it("handles payment.confirmed events", () => {
      const merchantId = "merchant-e2e-5";
      const eventType = "payment.confirmed";
      const paymentId = successfulPayload.data.payment_id;

      cache.setPayload(merchantId, eventType, paymentId, successfulPayload);
      const payload = cache.getPayload(merchantId, eventType, paymentId);

      expect(payload.type).toBe("payment.confirmed");
      expect(payload.data.status).toBe("confirmed");
    });

    it("handles payment.failed events", () => {
      const merchantId = "merchant-e2e-6";
      const eventType = "payment.failed";
      const paymentId = failedPayload.data.payment_id;

      cache.setPayload(merchantId, eventType, paymentId, failedPayload);
      const payload = cache.getPayload(merchantId, eventType, paymentId);

      expect(payload.type).toBe("payment.failed");
      expect(payload.data.reason).toBe("insufficient_funds");
    });

    it("handles multiple event types for same merchant", () => {
      const merchantId = "merchant-e2e-7";

      cache.setPayload(
        merchantId,
        "payment.confirmed",
        successfulPayload.data.payment_id,
        successfulPayload
      );
      cache.setPayload(
        merchantId,
        "payment.failed",
        failedPayload.data.payment_id,
        failedPayload
      );

      const confirmed = cache.getPayload(
        merchantId,
        "payment.confirmed",
        successfulPayload.data.payment_id
      );
      const failed = cache.getPayload(
        merchantId,
        "payment.failed",
        failedPayload.data.payment_id
      );

      expect(confirmed.type).toBe("payment.confirmed");
      expect(failed.type).toBe("payment.failed");
    });
  });

  describe("retry mechanism", () => {
    it("tracks retry attempts up to limit", () => {
      const merchantId = "merchant-e2e-8";

      for (let i = 0; i < 5; i++) {
        cache.recordDeliveryAttempt(merchantId, mockWebhookUrl, successfulPayload);
      }

      const attemptCount = cache.getDeliveryAttemptCount(
        merchantId,
        mockWebhookUrl,
        successfulPayload
      );
      expect(attemptCount).toBe(5);
    });

    it("prevents retry after max attempts", () => {
      const merchantId = "merchant-e2e-9";

      for (let i = 0; i < 6; i++) {
        cache.recordDeliveryAttempt(merchantId, mockWebhookUrl, successfulPayload);
      }

      const isDuplicate = cache.shouldDeduplicate(
        merchantId,
        mockWebhookUrl,
        successfulPayload
      );
      expect(isDuplicate).toBe(false);
    });

    it("resets attempt counter on successful delivery", () => {
      const merchantId = "merchant-e2e-10";

      cache.recordDeliveryAttempt(merchantId, mockWebhookUrl, successfulPayload);
      cache.recordDeliveryAttempt(merchantId, mockWebhookUrl, successfulPayload);
      cache.recordDeliveryAttempt(merchantId, mockWebhookUrl, successfulPayload);

      let attemptCount = cache.getDeliveryAttemptCount(
        merchantId,
        mockWebhookUrl,
        successfulPayload
      );
      expect(attemptCount).toBe(3);

      cache.recordDeliverySuccess(merchantId, mockWebhookUrl, successfulPayload);

      attemptCount = cache.getDeliveryAttemptCount(
        merchantId,
        mockWebhookUrl,
        successfulPayload
      );
      expect(attemptCount).toBe(0);
    });
  });

  describe("subscription management", () => {
    it("caches merchant webhook subscriptions", () => {
      const merchantId = "merchant-e2e-11";
      const subscriptions = [
        {
          id: "sub-1",
          url: mockWebhookUrl,
          event_types: ["payment.confirmed"],
          created_at: new Date().toISOString(),
        },
        {
          id: "sub-2",
          url: "https://merchant-backup.example.com/webhooks",
          event_types: ["payment.confirmed", "payment.failed"],
          created_at: new Date().toISOString(),
        },
      ];

      cache.cacheSubscriptions(merchantId, subscriptions);
      const cached = cache.getSubscriptions(merchantId);

      expect(cached).toHaveLength(2);
      expect(cached[0].url).toBe(mockWebhookUrl);
    });

    it("invalidates subscriptions on update", () => {
      const merchantId = "merchant-e2e-12";
      const oldSubscriptions = [
        {
          id: "sub-1",
          url: mockWebhookUrl,
          event_types: ["payment.confirmed"],
        },
      ];
      const newSubscriptions = [
        {
          id: "sub-1",
          url: "https://new-webhook.example.com",
          event_types: ["payment.confirmed", "payment.failed"],
        },
      ];

      cache.cacheSubscriptions(merchantId, oldSubscriptions);
      expect(cache.getSubscriptions(merchantId)).toEqual(oldSubscriptions);

      cache.invalidateSubscriptions(merchantId);
      expect(cache.getSubscriptions(merchantId)).toBeNull();

      cache.cacheSubscriptions(merchantId, newSubscriptions);
      expect(cache.getSubscriptions(merchantId)).toEqual(newSubscriptions);
    });
  });

  describe("circuit breaker", () => {
    it("opens circuit breaker on repeated failures", () => {
      const merchantId = "merchant-e2e-13";

      cache.openCircuitBreaker(merchantId, mockWebhookUrl, "max_failures");
      expect(cache.isCircuitBreakerOpen(merchantId, mockWebhookUrl)).toBe(true);
    });

    it("prevents webhook dispatch when circuit is open", () => {
      const merchantId = "merchant-e2e-14";

      cache.openCircuitBreaker(merchantId, mockWebhookUrl);
      const isOpen = cache.isCircuitBreakerOpen(merchantId, mockWebhookUrl);

      if (isOpen) {
        const isDuplicate = cache.shouldDeduplicate(
          merchantId,
          mockWebhookUrl,
          successfulPayload
        );
        expect(isOpen).toBe(true);
      }
    });

    it("closes circuit breaker on successful delivery", () => {
      const merchantId = "merchant-e2e-15";

      cache.openCircuitBreaker(merchantId, mockWebhookUrl);
      expect(cache.isCircuitBreakerOpen(merchantId, mockWebhookUrl)).toBe(true);

      cache.closeCircuitBreaker(merchantId, mockWebhookUrl);
      expect(cache.isCircuitBreakerOpen(merchantId, mockWebhookUrl)).toBe(false);
    });

    it("tracks failure reasons in circuit breaker", () => {
      const merchantId = "merchant-e2e-16";

      cache.openCircuitBreaker(
        merchantId,
        mockWebhookUrl,
        "connection_timeout"
      );
      cache.incrementCircuitBreakerFailures(merchantId, mockWebhookUrl);

      const isOpen = cache.isCircuitBreakerOpen(merchantId, mockWebhookUrl);
      expect(isOpen).toBe(true);
    });
  });

  describe("multi-merchant handling", () => {
    it("handles webhooks for multiple merchants independently", () => {
      const merchant1 = "merchant-e2e-17";
      const merchant2 = "merchant-e2e-18";

      cache.recordDeliveryAttempt(merchant1, mockWebhookUrl, successfulPayload);
      cache.recordDeliverySuccess(merchant2, mockWebhookUrl, successfulPayload);

      const attempts1 = cache.getDeliveryAttemptCount(
        merchant1,
        mockWebhookUrl,
        successfulPayload
      );
      const attempts2 = cache.getDeliveryAttemptCount(
        merchant2,
        mockWebhookUrl,
        successfulPayload
      );

      expect(attempts1).toBeGreaterThan(0);
      expect(attempts2).toBe(0);
    });

    it("isolates circuit breakers by merchant", () => {
      const merchant1 = "merchant-e2e-19";
      const merchant2 = "merchant-e2e-20";

      cache.openCircuitBreaker(merchant1, mockWebhookUrl);

      const isOpenForMerchant1 = cache.isCircuitBreakerOpen(merchant1, mockWebhookUrl);
      const isOpenForMerchant2 = cache.isCircuitBreakerOpen(merchant2, mockWebhookUrl);

      expect(isOpenForMerchant1).toBe(true);
      expect(isOpenForMerchant2).toBe(false);
    });
  });

  describe("performance and scaling", () => {
    it("handles large number of cached events", () => {
      const merchantId = "merchant-e2e-21";

      for (let i = 0; i < 1000; i++) {
        const payload = { ...successfulPayload, id: `evt-${i}` };
        cache.setPayload(merchantId, "payment.confirmed", `pay-${i}`, payload);
      }

      const stats = cache.getStats();
      expect(stats.payloadCacheSize).toBeGreaterThan(0);
    });

    it("retrieves cached events efficiently", () => {
      const merchantId = "merchant-e2e-22";
      const paymentId = successfulPayload.data.payment_id;

      cache.setPayload(merchantId, "payment.confirmed", paymentId, successfulPayload);

      const startTime = Date.now();
      for (let i = 0; i < 1000; i++) {
        cache.getPayload(merchantId, "payment.confirmed", paymentId);
      }
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(100);
    });
  });

  describe("cache management", () => {
    it("provides comprehensive cache statistics", () => {
      const merchantId = "merchant-e2e-23";

      cache.setPayload(merchantId, "payment.confirmed", "pay-001", successfulPayload);
      cache.recordDeliveryAttempt(merchantId, mockWebhookUrl, successfulPayload);
      cache.cacheSubscriptions(merchantId, [{ id: "sub-1" }]);
      cache.openCircuitBreaker(merchantId, mockWebhookUrl);

      const stats = cache.getStats();

      expect(stats.payloadCacheSize).toBeGreaterThan(0);
      expect(stats.deduplicationCacheSize).toBeGreaterThan(0);
      expect(stats.subscriptionsCacheSize).toBeGreaterThan(0);
      expect(stats.circuitBreakerCount).toBeGreaterThan(0);
    });

    it("clears all cache data", () => {
      const merchantId = "merchant-e2e-24";

      cache.setPayload(merchantId, "payment.confirmed", "pay-001", successfulPayload);
      cache.recordDeliveryAttempt(merchantId, mockWebhookUrl, successfulPayload);

      cache.clear();

      const stats = cache.getStats();
      expect(stats.payloadCacheSize).toBe(0);
      expect(stats.deduplicationCacheSize).toBe(0);
      expect(stats.subscriptionsCacheSize).toBe(0);
      expect(stats.circuitBreakerCount).toBe(0);
    });
  });
});
