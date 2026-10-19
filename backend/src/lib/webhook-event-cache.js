/**
 * Webhook Event Dispatcher Cache — Issue #1100
 *
 * Implements robust caching mechanism for webhook event dispatching
 * to reduce redundant processing and improve performance.
 *
 * Features:
 * - Event payload caching with TTL
 * - Delivery attempt tracking and deduplication
 * - Merchant subscription caching
 * - Circuit breaker for failed deliveries
 * - Metrics integration
 */

import { createHash } from "crypto";
import { logger } from "./logger.js";
import {
  webhookEventCacheHitTotal,
  webhookEventCacheMissTotal,
  webhookEventCacheSize,
  webhookEventDeduplicationCacheSize,
  webhookEventDeliveryAttemptsCached,
} from "./metrics.js";

const DEFAULT_CACHE_TTL = 300000;
const DEFAULT_MAX_ENTRIES = 10000;
const DEDUPLICATION_WINDOW = 86400000;
const MAX_RETRY_ATTEMPTS = 5;

class WebhookEventCache {
  constructor(options = {}) {
    this.ttl = options.ttl || DEFAULT_CACHE_TTL;
    this.maxEntries = options.maxEntries || DEFAULT_MAX_ENTRIES;
    this.payloadCache = new Map();
    this.deliveryAttempts = new Map();
    this.merchantSubscriptions = new Map();
    this.circuitBreakers = new Map();
  }

  generateEventKey(merchantId, eventType, paymentId) {
    return `${merchantId}:${eventType}:${paymentId}`;
  }

  generatePayloadHash(payload) {
    return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  }

  generateDeduplicationKey(merchantId, webhookUrl, payloadHash) {
    return `${merchantId}:${webhookUrl}:${payloadHash}`;
  }

  getPayload(merchantId, eventType, paymentId) {
    const key = this.generateEventKey(merchantId, eventType, paymentId);
    const cached = this.payloadCache.get(key);

    if (cached && Date.now() - cached.timestamp < this.ttl) {
      webhookEventCacheHitTotal.inc({ event_type: eventType });
      logger.debug({ key }, "Webhook payload cache hit");
      return cached.payload;
    }

    if (cached) {
      this.payloadCache.delete(key);
    }

    webhookEventCacheMissTotal.inc({ event_type: eventType });
    return null;
  }

  setPayload(merchantId, eventType, paymentId, payload) {
    const key = this.generateEventKey(merchantId, eventType, paymentId);

    if (this.payloadCache.size >= this.maxEntries) {
      const firstKey = this.payloadCache.keys().next().value;
      this.payloadCache.delete(firstKey);
    }

    this.payloadCache.set(key, {
      payload,
      timestamp: Date.now(),
    });

    webhookEventCacheSize.set(this.payloadCache.size);
    logger.debug({ key, eventType }, "Webhook payload cached");
  }

  shouldDeduplicate(merchantId, webhookUrl, payload) {
    const payloadHash = this.generatePayloadHash(payload);
    const dedupeKey = this.generateDeduplicationKey(merchantId, webhookUrl, payloadHash);
    const cached = this.deliveryAttempts.get(dedupeKey);

    if (cached) {
      const timeSinceLastAttempt = Date.now() - cached.lastAttempt;
      const withinWindow = timeSinceLastAttempt < DEDUPLICATION_WINDOW;
      const withinRetryLimit = cached.attempts < MAX_RETRY_ATTEMPTS;

      if (withinWindow && withinRetryLimit) {
        webhookEventDeliveryAttemptsCached.inc({ action: "deduplicated" });
        return true;
      }

      if (!withinWindow) {
        this.deliveryAttempts.delete(dedupeKey);
      }
    }

    return false;
  }

  recordDeliveryAttempt(merchantId, webhookUrl, payload) {
    const payloadHash = this.generatePayloadHash(payload);
    const dedupeKey = this.generateDeduplicationKey(merchantId, webhookUrl, payloadHash);
    const cached = this.deliveryAttempts.get(dedupeKey);

    if (cached) {
      cached.attempts++;
      cached.lastAttempt = Date.now();
      cached.failureReasons.push({
        timestamp: Date.now(),
        reason: "delivery_failed",
      });
    } else {
      this.deliveryAttempts.set(dedupeKey, {
        attempts: 1,
        lastAttempt: Date.now(),
        failureReasons: [],
        payloadHash,
      });
    }

    if (this.deliveryAttempts.size >= this.maxEntries) {
      const oldestKey = this.deliveryAttempts.keys().next().value;
      this.deliveryAttempts.delete(oldestKey);
    }

    webhookEventDeduplicationCacheSize.set(this.deliveryAttempts.size);
  }

  recordDeliverySuccess(merchantId, webhookUrl, payload) {
    const payloadHash = this.generatePayloadHash(payload);
    const dedupeKey = this.generateDeduplicationKey(merchantId, webhookUrl, payloadHash);
    this.deliveryAttempts.delete(dedupeKey);
    webhookEventDeduplicationCacheSize.set(this.deliveryAttempts.size);
    webhookEventDeliveryAttemptsCached.inc({ action: "success" });
  }

  getDeliveryAttemptCount(merchantId, webhookUrl, payload) {
    const payloadHash = this.generatePayloadHash(payload);
    const dedupeKey = this.generateDeduplicationKey(merchantId, webhookUrl, payloadHash);
    const cached = this.deliveryAttempts.get(dedupeKey);
    return cached ? cached.attempts : 0;
  }

  cacheSubscriptions(merchantId, subscriptions) {
    const key = `subscriptions:${merchantId}`;
    this.merchantSubscriptions.set(key, {
      subscriptions,
      timestamp: Date.now(),
    });

    logger.debug(
      { merchantId, count: subscriptions.length },
      "Webhook subscriptions cached"
    );
  }

  getSubscriptions(merchantId) {
    const key = `subscriptions:${merchantId}`;
    const cached = this.merchantSubscriptions.get(key);

    if (cached && Date.now() - cached.timestamp < this.ttl) {
      return cached.subscriptions;
    }

    if (cached) {
      this.merchantSubscriptions.delete(key);
    }

    return null;
  }

  invalidateSubscriptions(merchantId) {
    const key = `subscriptions:${merchantId}`;
    this.merchantSubscriptions.delete(key);
    logger.debug({ merchantId }, "Webhook subscriptions cache invalidated");
  }

  openCircuitBreaker(merchantId, webhookUrl, reason = "max_failures") {
    const key = `cb:${merchantId}:${webhookUrl}`;
    this.circuitBreakers.set(key, {
      opened: true,
      reason,
      timestamp: Date.now(),
      failureCount: 0,
    });

    logger.warn(
      { merchantId, webhookUrl, reason },
      "Circuit breaker opened for webhook"
    );
  }

  closeCircuitBreaker(merchantId, webhookUrl) {
    const key = `cb:${merchantId}:${webhookUrl}`;
    this.circuitBreakers.delete(key);
    logger.info(
      { merchantId, webhookUrl },
      "Circuit breaker closed for webhook"
    );
  }

  isCircuitBreakerOpen(merchantId, webhookUrl) {
    const key = `cb:${merchantId}:${webhookUrl}`;
    const cb = this.circuitBreakers.get(key);

    if (!cb) return false;

    const timeSinceFail = Date.now() - cb.timestamp;
    const resetThreshold = 300000;

    if (timeSinceFail > resetThreshold) {
      this.closeCircuitBreaker(merchantId, webhookUrl);
      return false;
    }

    return cb.opened;
  }

  incrementCircuitBreakerFailures(merchantId, webhookUrl) {
    const key = `cb:${merchantId}:${webhookUrl}`;
    const cb = this.circuitBreakers.get(key);

    if (cb) {
      cb.failureCount++;
      if (cb.failureCount >= 5) {
        this.openCircuitBreaker(merchantId, webhookUrl, "failure_threshold_exceeded");
      }
    }
  }

  getStats() {
    return {
      payloadCacheSize: this.payloadCache.size,
      deduplicationCacheSize: this.deliveryAttempts.size,
      subscriptionsCacheSize: this.merchantSubscriptions.size,
      circuitBreakerCount: this.circuitBreakers.size,
    };
  }

  clear() {
    this.payloadCache.clear();
    this.deliveryAttempts.clear();
    this.merchantSubscriptions.clear();
    this.circuitBreakers.clear();
    webhookEventCacheSize.set(0);
    webhookEventDeduplicationCacheSize.set(0);

    logger.info("Webhook event cache cleared");
  }

  clearExpiredEntries() {
    const now = Date.now();
    let expiredCount = 0;

    for (const [key, entry] of this.payloadCache.entries()) {
      if (now - entry.timestamp > this.ttl) {
        this.payloadCache.delete(key);
        expiredCount++;
      }
    }

    for (const [key, entry] of this.deliveryAttempts.entries()) {
      if (now - entry.lastAttempt > DEDUPLICATION_WINDOW) {
        this.deliveryAttempts.delete(key);
        expiredCount++;
      }
    }

    for (const [key, entry] of this.merchantSubscriptions.entries()) {
      if (now - entry.timestamp > this.ttl) {
        this.merchantSubscriptions.delete(key);
        expiredCount++;
      }
    }

    webhookEventCacheSize.set(this.payloadCache.size);
    webhookEventDeduplicationCacheSize.set(this.deliveryAttempts.size);

    if (expiredCount > 0) {
      logger.debug({ expiredCount }, "Expired webhook cache entries cleaned");
    }

    return expiredCount;
  }
}

export const webhookEventCache = new WebhookEventCache();

export function getWebhookEventCache(options) {
  return new WebhookEventCache(options);
}
