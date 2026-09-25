/**
 * Transaction Signer Verification Cache — Issue #1075
 *
 * Provides a robust, two-tier (in-memory LRU + optional Redis) cache for
 * Stellar transaction signature verification results.
 *
 * Design goals:
 *  - Reduce redundant Horizon API calls by caching verification outcomes.
 *  - Support both valid and invalid results (negative caching) with different TTLs.
 *  - Graceful degradation: if Redis is unavailable, fall back to in-memory only.
 *  - Observability: Prometheus metrics for hit/miss/fallback/eviction.
 *  - Configurable TTL and capacity to tune for production workloads.
 */

import { logger } from "./logger.js";
import {
  txSignatureCacheHits,
  txSignatureCacheMisses,
  txSignatureCacheSize,
} from "./metrics.js";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Default TTL for valid verification results (5 minutes). */
const DEFAULT_VALID_TTL_MS = 5 * 60 * 1000;

/** Default TTL for invalid/negative verification results (60 seconds). */
const DEFAULT_INVALID_TTL_MS = 60 * 1000;

/** Maximum number of entries in the in-memory LRU cache. */
const DEFAULT_MAX_ENTRIES = 5_000;

/** Redis key prefix for verification cache entries. */
const REDIS_KEY_PREFIX = "ts_vcache:";

// ── Cache Entry ───────────────────────────────────────────────────────────────

/**
 * @typedef {Object} VerificationCacheEntry
 * @property {*} result - The cached verification result.
 * @property {number} insertedAt - Timestamp (ms) when this entry was created.
 * @property {boolean} valid - Whether the cached result was valid.
 */

// ── In-Memory LRU Cache ──────────────────────────────────────────────────────

class VerificationMemoryCache {
  /**
   * @param {number} maxEntries
   * @param {number} validTtlMs
   * @param {number} invalidTtlMs
   */
  constructor(maxEntries = DEFAULT_MAX_ENTRIES, validTtlMs = DEFAULT_VALID_TTL_MS, invalidTtlMs = DEFAULT_INVALID_TTL_MS) {
    this.maxEntries = maxEntries;
    this.validTtlMs = validTtlMs;
    this.invalidTtlMs = invalidTtlMs;
    /** @type {Map<string, VerificationCacheEntry>} */
    this.cache = new Map();
  }

  /**
   * Retrieve a cached entry if present and not expired.
   * Performs LRU touch on hit.
   * @param {string} txHash
   * @returns {VerificationCacheEntry|null}
   */
  get(txHash) {
    const entry = this.cache.get(txHash);
    if (!entry) return null;

    const ttlMs = entry.valid ? this.validTtlMs : this.invalidTtlMs;
    if (Date.now() - entry.insertedAt > ttlMs) {
      this.cache.delete(txHash);
      return null;
    }

    // LRU touch: move to end (most recently used)
    this.cache.delete(txHash);
    this.cache.set(txHash, entry);
    return entry;
  }

  /**
   * Store a verification result in the cache.
   * Evicts the oldest entry when capacity is reached.
   * @param {string} txHash
   * @param {*} result
   * @param {boolean} valid
   */
  set(txHash, result, valid) {
    if (this.cache.has(txHash)) {
      this.cache.delete(txHash);
    }
    if (this.cache.size >= this.maxEntries) {
      // NPE-07: Map.keys().next().value is undefined when the Map is empty
      // (maxEntries=0 or a race where the map was cleared between the size
      // check and the eviction).  Guard so we never call cache.delete(undefined).
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) {
        this.cache.delete(oldest);
      }
    }
    this.cache.set(txHash, { result, insertedAt: Date.now(), valid });
  }

  /** Prune all expired entries. Returns the number of entries removed. */
  prune() {
    const now = Date.now();
    let pruned = 0;
    for (const [hash, entry] of this.cache) {
      const ttlMs = entry.valid ? this.validTtlMs : this.invalidTtlMs;
      if (now - entry.insertedAt > ttlMs) {
        this.cache.delete(hash);
        pruned += 1;
      }
    }
    return pruned;
  }

  invalidate(txHash) {
    if (txHash) {
      this.cache.delete(txHash);
    } else {
      this.cache.clear();
    }
  }

  get size() {
    return this.cache.size;
  }

  getStats() {
    return {
      size: this.cache.size,
      maxEntries: this.maxEntries,
      validTtlMs: this.validTtlMs,
      invalidTtlMs: this.invalidTtlMs,
    };
  }
}

// ── Main Cache Class ──────────────────────────────────────────────────────────

export class TransactionSignerCache {
  /**
   * @param {Object} [options]
   * @param {number} [options.maxEntries] - Max in-memory entries.
   * @param {number} [options.validTtlMs] - TTL for valid results.
   * @param {number} [options.invalidTtlMs] - TTL for invalid results.
   * @param {import('redis').RedisClientType} [options.redisClient] - Optional Redis client.
   * @param {number} [options.redisTtlSeconds] - TTL for Redis entries (seconds).
   */
  constructor({
    maxEntries = DEFAULT_MAX_ENTRIES,
    validTtlMs = DEFAULT_VALID_TTL_MS,
    invalidTtlMs = DEFAULT_INVALID_TTL_MS,
    redisClient = null,
    redisTtlSeconds = 300,
  } = {}) {
    this.memory = new VerificationMemoryCache(maxEntries, validTtlMs, invalidTtlMs);
    this.redisClient = redisClient;
    this.redisTtlSeconds = redisTtlSeconds;

    this.hits = 0;
    this.misses = 0;
    this.fallbacks = 0;
  }

  /**
   * Retrieve a cached verification result.
   * Checks memory first, then Redis (if available).
   * @param {string} txHash - Normalized (lowercase) transaction hash.
   * @returns {Promise<{ result: *|null, hit: boolean }>}
   */
  async get(txHash) {
    // 1. Memory tier
    const memEntry = this.memory.get(txHash);
    if (memEntry) {
      this.hits += 1;
      txSignatureCacheHits?.inc();
      return { result: memEntry.result, hit: true };
    }

    // 2. Redis tier (if available)
    if (this.redisClient) {
      try {
        const raw = await this.redisClient.get(`${REDIS_KEY_PREFIX}${txHash}`);
        if (raw) {
          // NPE-08: JSON.parse can return null (when raw === "null"), a
          // primitive, or any non-object value.  Any of these would cause
          // `parsed.result` or `parsed.valid` to throw a TypeError.
          // Validate the parsed value is a non-null object before trusting it.
          let parsed;
          try {
            parsed = JSON.parse(raw);
          } catch (jsonErr) {
            logger.warn(
              { err: jsonErr, txHash },
              "TransactionSignerCache: Redis value is not valid JSON — ignoring",
            );
            parsed = null;
          }

          if (parsed !== null && typeof parsed === "object" && "result" in parsed) {
            // Rehydrate into memory cache
            this.memory.set(txHash, parsed.result, !!parsed.valid);
            this.hits += 1;
            txSignatureCacheHits?.inc();
            return { result: parsed.result, hit: true };
          } else {
            logger.warn(
              { txHash, parsedType: typeof parsed },
              "TransactionSignerCache: Redis value has unexpected shape — ignoring",
            );
          }
        }
      } catch (err) {
        this.fallbacks += 1;
        logger.warn(
          { err, txHash },
          "TransactionSignerCache: Redis GET failed — falling back to memory",
        );
      }
    }

    this.misses += 1;
    txSignatureCacheMisses?.inc();
    return { result: null, hit: false };
  }

  /**
   * Store a verification result in both cache tiers.
   * @param {string} txHash - Normalized (lowercase) transaction hash.
   * @param {*} result - The verification result to cache.
   * @param {boolean} valid - Whether the result indicates a valid signature.
   */
  async set(txHash, result, valid) {
    this.memory.set(txHash, result, valid);

    if (this.redisClient) {
      try {
        const ttlSeconds = valid ? this.redisTtlSeconds : Math.min(60, this.redisTtlSeconds);
        await this.redisClient.set(
          `${REDIS_KEY_PREFIX}${txHash}`,
          JSON.stringify({ result, valid }),
          { EX: ttlSeconds },
        );
      } catch (err) {
        this.fallbacks += 1;
        logger.warn(
          { err, txHash },
          "TransactionSignerCache: Redis SET failed — memory cache only",
        );
      }
    }
  }

  /**
   * Invalidate a specific cached entry.
   * @param {string} txHash
   */
  async invalidate(txHash) {
    this.memory.invalidate(txHash);
    if (this.redisClient) {
      try {
        await this.redisClient.del(`${REDIS_KEY_PREFIX}${txHash}`);
      } catch (err) {
        logger.warn({ err, txHash }, "TransactionSignerCache: Redis DEL failed");
      }
    }
  }

  /** Prune expired memory entries and update the cache-size metric. */
  prune() {
    const pruned = this.memory.prune();
    txSignatureCacheSize?.set(this.memory.size);
    return pruned;
  }

  /** Clear all cached entries. */
  async clear() {
    this.memory.invalidate(null);
    this.hits = 0;
    this.misses = 0;
    this.fallbacks = 0;
    txSignatureCacheSize?.set(0);
  }

  getStats() {
    const total = this.hits + this.misses;
    return {
      ...this.memory.getStats(),
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? (this.hits / total * 100).toFixed(1) + "%" : "0%",
      fallbacks: this.fallbacks,
      redisConnected: !!this.redisClient,
    };
  }

  /**
   * Destroy this cache instance: clear all in-memory entries and release the
   * singleton reference so the Map and all cached objects become eligible for
   * garbage collection.
   *
   * Memory leak fix (ML-04): the module-level singleton was never released on
   * process exit, keeping all cached verification results alive until the OS
   * reclaimed the process heap.  Call this during graceful shutdown via
   * `stopTransactionSignerTimers()`.
   */
  async destroy() {
    await this.clear();
    // Null the singleton if this is the current instance so the next call to
    // getTransactionSignerCache() creates a fresh one (useful in tests).
    if (_cacheInstance === this) {
      _cacheInstance = null;
    }
    logger.debug("TransactionSignerCache: instance destroyed and singleton reference released");
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _cacheInstance = null;

/**
 * Get or create the singleton TransactionSignerCache.
 * @param {Object} [options] - Passed to constructor on first call.
 * @returns {TransactionSignerCache}
 */
export function getTransactionSignerCache(options = {}) {
  if (!_cacheInstance) {
    _cacheInstance = new TransactionSignerCache(options);
  }
  return _cacheInstance;
}

/** Reset the singleton (for testing). */
export function resetTransactionSignerCacheForTest() {
  if (_cacheInstance) {
    _cacheInstance.clear();
    _cacheInstance = null;
  }
}

// ── Prune Timer ───────────────────────────────────────────────────────────────

/**
 * How often (ms) the background prune interval sweeps expired entries from the
 * in-memory verification cache.  Defaults to 60 seconds — short enough to
 * reclaim stale memory promptly, long enough to have negligible CPU impact.
 */
const DEFAULT_PRUNE_INTERVAL_MS = 60 * 1000;

/** Handle returned by setInterval so it can be cleared on shutdown. */
let _pruneTimer = null;

/**
 * Start a periodic background interval that evicts expired entries from the
 * singleton VerificationMemoryCache.
 *
 * Memory leak fix (ML-01/02): without this interval, expired entries are only
 * reclaimed on the next request that touches the same txHash.  Under low
 * traffic the Map grows to its LRU capacity and stays there, holding
 * verification result objects in memory long past their TTL.
 *
 * The timer is created with `unref()` so it does not keep the Node.js event
 * loop alive after the HTTP server closes.
 *
 * @param {number} [intervalMs] - Sweep frequency in milliseconds.
 * @returns {NodeJS.Timeout} The interval handle (also stored internally).
 */
export function startCachePruneTimer(intervalMs = DEFAULT_PRUNE_INTERVAL_MS) {
  if (_pruneTimer) {
    // Idempotent — calling start twice resets to the new interval.
    clearInterval(_pruneTimer);
  }

  _pruneTimer = setInterval(() => {
    const instance = getTransactionSignerCache();
    const pruned = instance.prune();
    if (pruned > 0) {
      logger.debug(
        { pruned, size: instance.memory.size },
        "TransactionSignerCache: background prune removed expired entries",
      );
    }
  }, intervalMs);

  // unref() so the timer does not prevent the process from exiting cleanly
  // when the server has already been closed (ML-03).
  if (typeof _pruneTimer.unref === "function") {
    _pruneTimer.unref();
  }

  logger.debug(
    { intervalMs },
    "TransactionSignerCache: background prune timer started",
  );

  return _pruneTimer;
}

/**
 * Stop the background prune interval and release the timer handle.
 *
 * Must be called during graceful shutdown to ensure the interval does not
 * keep a reference to stale cache objects after the singleton is destroyed.
 */
export function stopCachePruneTimer() {
  if (_pruneTimer) {
    clearInterval(_pruneTimer);
    _pruneTimer = null;
    logger.debug("TransactionSignerCache: background prune timer stopped");
  }
}
