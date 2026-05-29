/**
 * Query Result Cache for Database Pooler
 * Issue #760: Optimize SQL queries in Database Pooler
 *
 * Provides in-memory LRU caching for frequently-executed read queries
 * to reduce database load and improve response times.
 *
 * Features:
 * - LRU eviction policy
 * - TTL-based expiration
 * - Cache key generation from query text + parameters
 * - Prometheus metrics for cache hit/miss tracking
 * - Configurable max entries and TTL
 */

import { createHash } from "node:crypto";
import { logger } from "./logger.js";
import {
  queryCacheHitTotal,
  queryCacheMissTotal,
  queryCacheSize,
} from "./metrics.js";

const DEFAULT_MAX_ENTRIES = Number.parseInt(
  process.env.DB_QUERY_CACHE_MAX_ENTRIES || "500",
  10,
);
const DEFAULT_TTL_MS = Number.parseInt(
  process.env.DB_QUERY_CACHE_TTL_MS || "30000",
  10,
);

/**
 * Generate a deterministic cache key from query text and parameter values.
 * Uses SHA-256 to produce a fixed-length key regardless of input size.
 */
export function generateCacheKey(text, values = []) {
  const normalized = text.replace(/\s+/g, " ").trim();
  const payload = JSON.stringify({ q: normalized, v: values });
  return createHash("sha256").update(payload).digest("hex");
}

/**
 * LRU Query Cache with TTL expiration.
 */
export class QueryCache {
  constructor({
    maxEntries = DEFAULT_MAX_ENTRIES,
    ttlMs = DEFAULT_TTL_MS,
  } = {}) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
    this.cache = new Map(); // insertion-order for LRU
  }

  /**
   * Retrieve a cached result if present and not expired.
   * Moves the entry to the most-recently-used position on hit.
   */
  get(key) {
    if (!this.cache.has(key)) {
      queryCacheMissTotal.inc();
      return null;
    }

    const entry = this.cache.get(key);

    // Check TTL expiration
    if (Date.now() - entry.insertedAt > this.ttlMs) {
      this.cache.delete(key);
      queryCacheMissTotal.inc();
      queryCacheSize.set(this.cache.size);
      return null;
    }

    // LRU: delete and re-insert to move to end
    this.cache.delete(key);
    this.cache.set(key, entry);
    queryCacheHitTotal.inc();

    return entry.result;
  }

  /**
   * Store a query result in the cache.
   * Evicts the oldest entry when capacity is reached.
   */
  set(key, result) {
    // If already present, delete first to update position
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // Evict oldest if at capacity
    if (this.cache.size >= this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
      logger.debug({ evictedKey: oldestKey }, "Query cache evicted oldest entry");
    }

    this.cache.set(key, {
      result,
      insertedAt: Date.now(),
    });

    queryCacheSize.set(this.cache.size);
  }

  /**
   * Invalidate all cache entries whose key matches a prefix or pattern.
   * Useful after writes that affect a table.
   */
  invalidateByPrefix(prefix) {
    let invalidated = 0;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
        invalidated++;
      }
    }
    if (invalidated > 0) {
      queryCacheSize.set(this.cache.size);
      logger.debug({ invalidated, prefix }, "Query cache invalidated entries by prefix");
    }
    return invalidated;
  }

  /**
   * Clear all cached entries.
   */
  clear() {
    const size = this.cache.size;
    this.cache.clear();
    queryCacheSize.set(0);
    logger.debug({ clearedEntries: size }, "Query cache cleared");
    return size;
  }

  /**
   * Return current cache statistics.
   */
  getStats() {
    return {
      size: this.cache.size,
      maxEntries: this.maxEntries,
      ttlMs: this.ttlMs,
    };
  }
}

// Singleton cache instance
export const queryCache = new QueryCache();

/**
 * Cacheable query wrapper.
 * Executes the query and caches the result if the query is a SELECT.
 *
 * @param {string} text - SQL query text
 * @param {Array} values - Query parameter values
 * @param {Object} options - Query options (same as queryWithRetry)
 * @param {Function} queryFn - The underlying query function to call
 * @param {Object} cacheOptions - Cache configuration overrides
 * @returns {Promise<Object>} Query result
 */
export async function cachedQuery(
  text,
  values,
  options,
  queryFn,
  { useCache = true, ttlMs } = {},
) {
  // Only cache SELECT queries
  if (!useCache || !text.trimStart().toUpperCase().startsWith("SELECT")) {
    return queryFn(text, values, options);
  }

  const cacheKey = generateCacheKey(text, values);
  const cached = queryCache.get(cacheKey);

  if (cached) {
    logger.debug({ label: options.label, cacheKey }, "Query cache hit");
    return cached;
  }

  const result = await queryFn(text, values, options);
  queryCache.set(cacheKey, result);

  return result;
}

/**
 * Invalidate cache entries related to a specific table after a write operation.
 * Call this after INSERT, UPDATE, or DELETE on a cached table.
 */
export function invalidateTableCache(tableName) {
  // We can't know the exact keys, so clear all when a write happens.
  // A more sophisticated approach would track table→key mappings.
  const cleared = queryCache.clear();
  logger.debug({ tableName, clearedEntries: cleared }, "Invalidated query cache after write");
}
