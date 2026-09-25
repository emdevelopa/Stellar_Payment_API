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
 */

import { createHash } from 'node:crypto';
import { logger } from './logger.js';

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
  }

  /** Remove a specific entry (e.g. after a payment status change makes its quote stale). */
  delete(key) {
    return this.cache.delete(key);
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

  /** Clear all entries — intended for test isolation. */
  clear() {
    this.cache.clear();
  }
}

let defaultInstance = null;

export function getExchangeRateCache() {
  if (!defaultInstance) {
    defaultInstance = new ExchangeRateCache();
  }
  return defaultInstance;
}

/** Reset the singleton — test use only. */
export function resetExchangeRateCache() {
  defaultInstance = null;
}
