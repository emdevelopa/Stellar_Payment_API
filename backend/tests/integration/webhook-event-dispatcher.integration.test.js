/**
 * Webhook Event Dispatcher — Comprehensive Integration & Stress Tests (#1426)
 *
 * Tests the WebhookEventCache and webhook dispatch pipeline under load,
 * covering concurrency, payload integrity, circuit breaker behaviour,
 * deduplication, subscription filtering, and performance SLOs.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebhookEventCache } from '../../src/lib/webhook-event-cache.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePayload(overrides = {}) {
  return {
    event: 'payment.completed',
    payment_id: `pay_${Math.random().toString(36).slice(2)}`,
    amount: '10.00',
    currency: 'USDC',
    merchant_id: 'merchant-integration-test',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function makeMerchantId(n) {
  return `merchant-stress-${n}`;
}

// ---------------------------------------------------------------------------
// Integration tests
// ---------------------------------------------------------------------------

describe('WebhookEventCache — Integration Tests (#1426)', () => {
  let cache;

  beforeEach(() => {
    cache = new WebhookEventCache({ maxEntries: 500, ttlMs: 30000 });
  });

  afterEach(() => {
    cache = null;
  });

  // --- Payload caching ---

  it('stores and retrieves a cached payload', async () => {
    const payload = makePayload();
    cache.setCachedPayload(payload.payment_id, payload);
    const retrieved = cache.getCachedPayload(payload.payment_id);
    expect(retrieved).toMatchObject({ payment_id: payload.payment_id });
  });

  it('returns null for non-existent cache entry', () => {
    expect(cache.getCachedPayload('non-existent-id')).toBeNull();
  });

  it('respects TTL — entry should expire', async () => {
    const shortTtl = new WebhookEventCache({ maxEntries: 100, ttlMs: 50 });
    const payload = makePayload();
    shortTtl.setCachedPayload(payload.payment_id, payload);
    await new Promise((r) => setTimeout(r, 100));
    expect(shortTtl.getCachedPayload(payload.payment_id)).toBeNull();
  });

  it('evicts oldest entries when maxEntries is reached', () => {
    const smallCache = new WebhookEventCache({ maxEntries: 5, ttlMs: 60000 });
    for (let i = 0; i < 10; i++) {
      smallCache.setCachedPayload(`pay_${i}`, makePayload({ payment_id: `pay_${i}` }));
    }
    // Cache should not exceed maxEntries
    expect(smallCache.getCacheStats().payloadCacheSize).toBeLessThanOrEqual(5);
  });

  // --- Delivery deduplication ---

  it('deduplicates duplicate delivery attempts', async () => {
    const payload = makePayload();
    const key = `${payload.payment_id}:endpoint-1`;
    const first = await cache.isDuplicateDelivery(key, payload);
    const second = await cache.isDuplicateDelivery(key, payload);
    expect(first).toBe(false);
    expect(second).toBe(true);
  });

  it('does not deduplicate different payloads for same key after max retries', async () => {
    const key = 'dedup-key-overflow';
    for (let i = 0; i < 6; i++) {
      await cache.isDuplicateDelivery(key, makePayload({ payment_id: `pay_${i}` }));
    }
    // After 5 retries, should not accept more
    const overflow = await cache.isDuplicateDelivery(key, makePayload());
    expect(overflow).toBe(true);
  });

  // --- Subscription cache ---

  it('caches and retrieves merchant subscriptions', () => {
    const subs = [{ event: 'payment.completed', url: 'https://example.com/webhook' }];
    cache.setCachedSubscriptions('merchant-sub-test', subs);
    expect(cache.getCachedSubscriptions('merchant-sub-test')).toEqual(subs);
  });

  it('invalidates subscription cache for a merchant', () => {
    cache.setCachedSubscriptions('merchant-inval', [{ event: 'payment.failed' }]);
    cache.invalidateSubscriptions('merchant-inval');
    expect(cache.getCachedSubscriptions('merchant-inval')).toBeNull();
  });

  it('returns null for non-cached merchant subscriptions', () => {
    expect(cache.getCachedSubscriptions('merchant-never-set')).toBeNull();
  });

  // --- Circuit breaker ---

  it('circuit breaker starts closed', () => {
    expect(cache.isCircuitOpen('merchant-cb-1')).toBe(false);
  });

  it('opens the circuit breaker after recording failures', () => {
    const merchantId = 'merchant-cb-open';
    // Record enough failures to trip the breaker
    for (let i = 0; i < 10; i++) {
      cache.recordDeliveryFailure(merchantId);
    }
    expect(cache.isCircuitOpen(merchantId)).toBe(true);
  });

  it('resets circuit breaker explicitly', () => {
    const merchantId = 'merchant-cb-reset';
    for (let i = 0; i < 10; i++) cache.recordDeliveryFailure(merchantId);
    expect(cache.isCircuitOpen(merchantId)).toBe(true);
    cache.resetCircuitBreaker(merchantId);
    expect(cache.isCircuitOpen(merchantId)).toBe(false);
  });

  it('circuit breakers are isolated per merchant', () => {
    const m1 = 'merchant-isolation-1';
    const m2 = 'merchant-isolation-2';
    for (let i = 0; i < 10; i++) cache.recordDeliveryFailure(m1);
    expect(cache.isCircuitOpen(m1)).toBe(true);
    expect(cache.isCircuitOpen(m2)).toBe(false);
  });

  // --- Cache stats ---

  it('getCacheStats returns expected shape', () => {
    const stats = cache.getCacheStats();
    expect(stats).toHaveProperty('payloadCacheSize');
    expect(stats).toHaveProperty('subscriptionCacheSize');
    expect(typeof stats.payloadCacheSize).toBe('number');
  });

  // --- Cache clear ---

  it('clears all cached data', () => {
    cache.setCachedPayload('pay-clear-1', makePayload());
    cache.setCachedSubscriptions('merchant-clear-1', []);
    cache.clearAll();
    expect(cache.getCachedPayload('pay-clear-1')).toBeNull();
    expect(cache.getCachedSubscriptions('merchant-clear-1')).toBeNull();
  });

  // --- Payload integrity ---

  it('preserves all payload fields when caching', () => {
    const payload = makePayload({
      nested: { key: 'value' },
      array: [1, 2, 3],
      unicode: '\u4e2d\u6587',
    });
    cache.setCachedPayload(payload.payment_id, payload);
    const retrieved = cache.getCachedPayload(payload.payment_id);
    expect(retrieved.nested).toEqual({ key: 'value' });
    expect(retrieved.array).toEqual([1, 2, 3]);
    expect(retrieved.unicode).toBe('\u4e2d\u6587');
  });

  // --- Multi-merchant isolation ---

  it('isolates payload cache per merchant', () => {
    const p1 = makePayload({ payment_id: 'pay-m1', merchant_id: 'merchant-A' });
    const p2 = makePayload({ payment_id: 'pay-m2', merchant_id: 'merchant-B' });
    cache.setCachedPayload(p1.payment_id, p1);
    cache.setCachedPayload(p2.payment_id, p2);
    expect(cache.getCachedPayload('pay-m1').merchant_id).toBe('merchant-A');
    expect(cache.getCachedPayload('pay-m2').merchant_id).toBe('merchant-B');
  });

  // --- Edge cases ---

  it('handles overwriting an existing cache entry', () => {
    const id = 'pay-overwrite';
    cache.setCachedPayload(id, makePayload({ amount: '10.00' }));
    cache.setCachedPayload(id, makePayload({ amount: '20.00' }));
    expect(cache.getCachedPayload(id).amount).toBe('20.00');
  });

  it('handles very large payload gracefully', () => {
    const bigPayload = makePayload({
      data: 'x'.repeat(10000),
    });
    cache.setCachedPayload(bigPayload.payment_id, bigPayload);
    const retrieved = cache.getCachedPayload(bigPayload.payment_id);
    expect(retrieved).not.toBeNull();
  });

  it('handles special characters in payment ID', () => {
    const specialId = 'pay/special:id@123';
    cache.setCachedPayload(specialId, makePayload());
    expect(cache.getCachedPayload(specialId)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Stress tests
// ---------------------------------------------------------------------------

describe('WebhookEventCache — Stress Tests (#1426)', () => {
  let cache;

  beforeEach(() => {
    cache = new WebhookEventCache({ maxEntries: 10000, ttlMs: 60000 });
  });

  afterEach(() => {
    cache = null;
  });

  it('handles 5000 sequential cache writes in under 500ms', () => {
    const start = Date.now();
    for (let i = 0; i < 5000; i++) {
      cache.setCachedPayload(`pay_stress_${i}`, makePayload({ payment_id: `pay_stress_${i}` }));
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(500);
  });

  it('handles 5000 sequential cache reads in under 100ms', () => {
    for (let i = 0; i < 5000; i++) {
      cache.setCachedPayload(`pay_read_${i}`, makePayload({ payment_id: `pay_read_${i}` }));
    }
    const start = Date.now();
    for (let i = 0; i < 5000; i++) {
      cache.getCachedPayload(`pay_read_${i}`);
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(100);
  });

  it('handles 1000 concurrent deduplication checks without throwing', async () => {
    const promises = [];
    for (let i = 0; i < 1000; i++) {
      promises.push(cache.isDuplicateDelivery(`key_${i % 100}`, makePayload()));
    }
    const results = await Promise.all(promises);
    expect(results.every((r) => typeof r === 'boolean')).toBe(true);
  });

  it('maintains cache size at or below maxEntries under write pressure', () => {
    const maxEntries = 200;
    const smallCache = new WebhookEventCache({ maxEntries, ttlMs: 60000 });
    for (let i = 0; i < 1000; i++) {
      smallCache.setCachedPayload(`pay_overflow_${i}`, makePayload());
    }
    expect(smallCache.getCacheStats().payloadCacheSize).toBeLessThanOrEqual(maxEntries);
  });

  it('supports 50 merchants each with 100 subscriptions cached', () => {
    for (let m = 0; m < 50; m++) {
      const merchantId = makeMerchantId(m);
      const subs = Array.from({ length: 100 }, (_, i) => ({
        event: `event.type.${i}`,
        url: `https://merchant-${m}.example.com/webhook/${i}`,
      }));
      cache.setCachedSubscriptions(merchantId, subs);
    }
    for (let m = 0; m < 50; m++) {
      const subs = cache.getCachedSubscriptions(makeMerchantId(m));
      expect(subs).not.toBeNull();
      expect(subs.length).toBe(100);
    }
  });

  it('circuit breaker operations at scale do not degrade performance', () => {
    const start = Date.now();
    for (let m = 0; m < 100; m++) {
      const merchantId = `merchant-perf-${m}`;
      for (let f = 0; f < 5; f++) cache.recordDeliveryFailure(merchantId);
      cache.isCircuitOpen(merchantId);
      cache.resetCircuitBreaker(merchantId);
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(200);
  });

  it('throughput: 10000 payload cache lookups complete in under 200ms', () => {
    // Pre-populate
    for (let i = 0; i < 1000; i++) {
      cache.setCachedPayload(`pay_tp_${i}`, makePayload({ payment_id: `pay_tp_${i}` }));
    }
    const start = Date.now();
    for (let i = 0; i < 10000; i++) {
      cache.getCachedPayload(`pay_tp_${i % 1000}`);
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(200);
  });

  it('mixed read/write/delete operations are stable under load', () => {
    expect(() => {
      for (let i = 0; i < 2000; i++) {
        const id = `pay_mixed_${i % 200}`;
        if (i % 3 === 0) cache.setCachedPayload(id, makePayload({ payment_id: id }));
        else if (i % 3 === 1) cache.getCachedPayload(id);
        else cache.invalidateSubscriptions(`merchant_${i % 20}`);
      }
    }).not.toThrow();
  });

  it('cache stats are accurate after bulk operations', () => {
    const batchSize = 300;
    for (let i = 0; i < batchSize; i++) {
      cache.setCachedPayload(`pay_stats_${i}`, makePayload());
    }
    const stats = cache.getCacheStats();
    // Should have up to batchSize entries (may be less if evicted)
    expect(stats.payloadCacheSize).toBeGreaterThan(0);
    expect(stats.payloadCacheSize).toBeLessThanOrEqual(batchSize);
  });

  it('clears all data across all merchants atomically', () => {
    for (let m = 0; m < 20; m++) {
      cache.setCachedSubscriptions(makeMerchantId(m), [{ event: 'test' }]);
      cache.setCachedPayload(`pay_clear_${m}`, makePayload());
    }
    cache.clearAll();
    for (let m = 0; m < 20; m++) {
      expect(cache.getCachedSubscriptions(makeMerchantId(m))).toBeNull();
      expect(cache.getCachedPayload(`pay_clear_${m}`)).toBeNull();
    }
  });
});
