/**
 * Multi-currency Exchange Rate Cache
 *
 * Provides a TTL-based in-memory cache for Stellar path-payment exchange rate
 * quotes keyed by (sourceAsset, destAsset, destAmount). Cache entries expire
 * after EXCHANGE_RATE_CACHE_TTL_MS (default 30 s) so stale quotes are never
 * served for more than one polling interval.
 *
 * Features:
 * - LRU eviction when the cache exceeds MAX_ENTRIES
 * - Prometheus metrics for hit/miss/eviction counts
 * - Stale-while-revalidate tolerance (separate staleness window)
 * - Thread-safe via synchronous Map operations (Node.js single-threaded)
 *
 * Concurrency control (issue #1445):
 * - getOrLoad() coalesces concurrent misses for the same key into ONE loader
 *   call (single-flight), so a burst of identical quote requests produces a
 *   single Horizon query per process.
 * - delete()/clear() mark any in-flight load for the key as invalidated and
 *   detach it. That load still resolves its own callers, but it can never
 *   write its (possibly outdated) result back into the cache. Tracking this on
 *   the in-flight entry keeps memory bounded by the number of active loads.
 * - Loads are bounded by a timeout so a hung loader cannot pin waiters forever.
 * Cross-process coordination lives in exchange-rate-coordinator.js.
 */

import { createHash } from 'node:crypto';
import { logger } from './logger.js';
import {
  pathPaymentQuoteCacheHits,
  pathPaymentQuoteCacheMisses,
  pathPaymentQuoteCacheEvictions,
  pathPaymentQuoteCacheSize,
  exchangeRateCacheCoalescedRequests,
  exchangeRateCacheInflightLoads,
  exchangeRateCacheLoadTimeouts,
  exchangeRateCacheStaleWritesPrevented,
} from './path-payment-metrics.js';

/**
 * Default cache metrics wired to the granular path-payment series (issue #1048)
 * plus the concurrency-control series (issue #1445).
 */
const DEFAULT_METRICS = {
  hit: pathPaymentQuoteCacheHits,
  miss: pathPaymentQuoteCacheMisses,
  eviction: pathPaymentQuoteCacheEvictions,
  size: pathPaymentQuoteCacheSize,
  coalesced: exchangeRateCacheCoalescedRequests,
  inflight: exchangeRateCacheInflightLoads,
  loadTimeout: exchangeRateCacheLoadTimeouts,
  staleWritePrevented: exchangeRateCacheStaleWritesPrevented,
};

export class CacheLoadTimeoutError extends Error {
  constructor(timeoutMs) {
    super(`Exchange rate load timed out after ${timeoutMs}ms`);
    this.name = 'CacheLoadTimeoutError';
    this.statusCode = 504;
  }
}

const DEFAULT_TTL_MS = Number.parseInt(
  process.env.EXCHANGE_RATE_CACHE_TTL_MS || '30000',
  10,
);

const DEFAULT_MAX_ENTRIES = Number.parseInt(
  process.env.EXCHANGE_RATE_CACHE_MAX_ENTRIES || '500',
  10,
);

const DEFAULT_STALE_TOLERANCE_MS = Number.parseInt(
  process.env.EXCHANGE_RATE_STALE_TOLERANCE_MS || '60000',
  10,
);

/**
 * Generate a deterministic cache key from rate quote parameters.
 */
export function generateRateCacheKey(sourceAsset, destAsset, destAmount, sourceAssetIssuer = null, destAssetIssuer = null) {
  const payload = JSON.stringify({
    src: sourceAsset?.toUpperCase(),
    dst: destAsset?.toUpperCase(),
    amt: destAmount,
    sri: sourceAssetIssuer,
    dri: destAssetIssuer,
  });
  return createHash('sha256').update(payload).digest('hex');
}

export class ExchangeRateCache {
  /**
   * @param {object} opts
   * @param {number} [opts.ttlMs]
   * @param {number} [opts.maxEntries]
   * @param {number} [opts.staleToleranceMs]
   * @param {object} [opts.metrics] - optional Prometheus counter/gauge objects
   */
  constructor({
    ttlMs = DEFAULT_TTL_MS,
    maxEntries = DEFAULT_MAX_ENTRIES,
    staleToleranceMs = DEFAULT_STALE_TOLERANCE_MS,
    metrics = null,
  } = {}) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.staleToleranceMs = staleToleranceMs;
    this.metrics = metrics;
    /** @type {Map<string, {data: unknown, insertedAt: number}>} */
    this.cache = new Map();
    /**
     * In-flight loads (single-flight).
     * @type {Map<string, {promise: Promise<unknown>, invalidated: boolean}>}
     */
    this.inflight = new Map();
  }

  /** Detach the in-flight load for `key` (if any) and forbid its write-back. */
  _invalidateInflight(key) {
    const entry = this.inflight.get(key);
    if (!entry) return;
    entry.invalidated = true;
    this.inflight.delete(key);
    this._updateInflightGauge();
  }

  _updateInflightGauge() {
    this.metrics?.inflight?.set?.({ cache: 'exchange_rate' }, this.inflight.size);
  }

  /**
   * Returns {hit, data, stale} for the given key.
   * hit=true + stale=false → fresh cache hit
   * hit=true + stale=true  → stale-but-tolerable hit (caller may revalidate async)
   * hit=false              → cache miss
   */
  get(key) {
    const entry = this.cache.get(key);
    if (!entry) {
      this.metrics?.miss?.inc?.({ cache: 'exchange_rate' });
      return { hit: false, data: null, stale: false };
    }

    const age = Date.now() - entry.insertedAt;

    if (age > this.staleToleranceMs) {
      this.cache.delete(key);
      this.metrics?.miss?.inc?.({ cache: 'exchange_rate' });
      return { hit: false, data: null, stale: false };
    }

    const stale = age > this.ttlMs;
    this.metrics?.hit?.inc?.({ cache: 'exchange_rate', stale: stale ? '1' : '0' });

    // Refresh recency in LRU order
    this.cache.delete(key);
    this.cache.set(key, entry);

    return { hit: true, data: entry.data, stale };
  }

  /**
   * Insert or update a cache entry. Evicts the oldest entry if maxEntries exceeded.
   */
  set(key, data) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
      this.metrics?.eviction?.inc?.({ cache: 'exchange_rate' });
      logger.debug(`ExchangeRateCache: evicted oldest entry (key prefix: ${oldestKey?.slice(0, 8)})`);
    }
    this.cache.set(key, { data, insertedAt: Date.now() });
    this.metrics?.size?.set?.({ cache: 'exchange_rate' }, this.cache.size);
  }

  /**
   * Return a fresh cached value, or run `loader` exactly once per key no
   * matter how many callers ask concurrently.
   *
   * @template T
   * @param {string} key
   * @param {() => Promise<T>} loader
   * @param {object} [opts]
   * @param {number} [opts.timeoutMs] reject waiters if the load exceeds this
   * @returns {Promise<{data: T, source: 'cache'|'loader'|'coalesced'}>}
   */
  async getOrLoad(key, loader, { timeoutMs = 0 } = {}) {
    const cached = this.get(key);
    if (cached.hit && !cached.stale) {
      return { data: cached.data, source: 'cache' };
    }

    const existing = this.inflight.get(key);
    if (existing) {
      this.metrics?.coalesced?.inc?.({ cache: 'exchange_rate' });
      return { data: await existing.promise, source: 'coalesced' };
    }

    const entry = { promise: null, invalidated: false };
    entry.promise = (async () => {
      try {
        // Invoke the loader on a later microtask so the entry is registered
        // in `inflight` first — even a synchronously throwing loader then
        // goes through the cleanup in `finally`.
        const data = await withTimeout(Promise.resolve().then(loader), timeoutMs, () => {
          this.metrics?.loadTimeout?.inc?.({ cache: 'exchange_rate' });
        });
        if (entry.invalidated) {
          this.metrics?.staleWritePrevented?.inc?.({ cache: 'exchange_rate' });
          logger.debug(`ExchangeRateCache: dropped write for invalidated key (prefix: ${key?.slice(0, 8)})`);
        } else {
          this.set(key, data);
        }
        return data;
      } finally {
        // Only remove our own entry; an invalidation may already have
        // detached it and a newer load may occupy the slot.
        if (this.inflight.get(key) === entry) {
          this.inflight.delete(key);
          this._updateInflightGauge();
        }
      }
    })();
    this.inflight.set(key, entry);
    this._updateInflightGauge();

    return { data: await entry.promise, source: 'loader' };
  }

  /** Number of keys currently being loaded. */
  get inflightCount() {
    return this.inflight.size;
  }

  /**
   * Remove a specific entry (e.g. after a payment status change makes its
   * quote stale). Also detaches any in-flight load so the next caller starts
   * a fresh one; the detached load cannot write its result back.
   */
  delete(key) {
    this._invalidateInflight(key);
    const removed = this.cache.delete(key);
    this.metrics?.size?.set?.({ cache: 'exchange_rate' }, this.cache.size);
    return removed;
  }

  /** Evict all entries older than ttlMs. Returns the number of evicted entries. */
  prune() {
    const now = Date.now();
    let pruned = 0;
    for (const [key, entry] of this.cache) {
      if (now - entry.insertedAt > this.staleToleranceMs) {
        this.cache.delete(key);
        pruned++;
      }
    }
    if (pruned > 0) {
      logger.debug(`ExchangeRateCache: pruned ${pruned} expired entries`);
    }
    this.metrics?.size?.set?.({ cache: 'exchange_rate' }, this.cache.size);
    return pruned;
  }

  get size() {
    return this.cache.size;
  }

  /** Clear all entries and invalidate every in-flight load. */
  clear() {
    for (const key of [...this.inflight.keys()]) {
      this._invalidateInflight(key);
    }
    this.cache.clear();
    this.metrics?.size?.set?.({ cache: 'exchange_rate' }, 0);
  }
}

/**
 * Race `promise` against a timer. `timeoutMs <= 0` disables the timeout.
 * The timer is always cleared so it never keeps the event loop alive.
 */
function withTimeout(promise, timeoutMs, onTimeout) {
  if (!timeoutMs || timeoutMs <= 0) {
    return promise;
  }
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      onTimeout?.();
      reject(new CacheLoadTimeoutError(timeoutMs));
    }, timeoutMs);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

let defaultInstance = null;

export function getExchangeRateCache() {
  if (!defaultInstance) {
    defaultInstance = new ExchangeRateCache({ metrics: DEFAULT_METRICS });
  }
  return defaultInstance;
}

/** Reset the singleton — test use only. */
export function resetExchangeRateCache() {
  defaultInstance = null;
}
