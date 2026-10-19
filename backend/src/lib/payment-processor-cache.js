/**
 * payment-processor-cache.js
 *
 * Robust caching mechanism for Payment Processor (Issue #1085).
 *
 * Provides:
 *   - Multi-tier caching (memory + Redis)
 *   - Cache invalidation strategies
 *   - TTL-based expiration
 *   - Cache warming
 *   - Metrics integration
 *   - Thread-safe operations
 *
 * Caches:
 *   - Payment session data
 *   - Merchant configurations
 *   - Exchange rate data
 *   - Verification results
 *   - Asset issuer data
 */

import { createHash } from "node:crypto";
import { logger } from "./logger.js";

/**
 * Generate deterministic cache key from payment ID and context.
 * @param {string} paymentId - Payment identifier
 * @param {string} [context] - Additional context for key generation
 * @returns {string} SHA-256 hash of payment data
 */
export function generatePaymentCacheKey(paymentId, context = "") {
  const payload = JSON.stringify({ id: paymentId, ctx: context });
  return createHash("sha256").update(payload).digest("hex");
}

/**
 * Robust multi-tier payment cache with TTL and invalidation.
 */
export class PaymentProcessorCache {
  constructor(options = {}) {
    this.memoryCache = new Map();
    this.ttlMs = options.ttlMs || 300000; // 5 minutes default
    this.maxMemoryEntries = options.maxMemoryEntries || 1000;
    this.redisClient = options.redisClient || null;
    this.metricsReporter = options.metricsReporter || null;
  }

  /**
   * Get cached payment data with fallback to Redis.
   * @param {string} cacheKey - Cache key
   * @returns {Promise<any|null>} Cached data or null
   */
  async get(cacheKey) {
    try {
      // Check memory cache first
      const memoryEntry = this.memoryCache.get(cacheKey);
      if (memoryEntry && !this._isExpired(memoryEntry)) {
        this._recordMetric("hit");
        return memoryEntry.data;
      }

      // Check Redis fallback
      if (this.redisClient) {
        const redisData = await this.redisClient.get(cacheKey);
        if (redisData) {
          this._recordMetric("hit", "redis");
          this.memoryCache.set(cacheKey, {
            data: JSON.parse(redisData),
            expiresAt: Date.now() + this.ttlMs,
          });
          return JSON.parse(redisData);
        }
      }

      this._recordMetric("miss");
      return null;
    } catch (err) {
      logger.error({ err, cacheKey }, "Cache retrieval error");
      this._recordMetric("error");
      return null;
    }
  }

  /**
   * Set cached payment data with TTL.
   * @param {string} cacheKey - Cache key
   * @param {any} data - Data to cache
   * @returns {Promise<void>}
   */
  async set(cacheKey, data) {
    try {
      const expiresAt = Date.now() + this.ttlMs;

      // Store in memory cache
      if (this.memoryCache.size >= this.maxMemoryEntries) {
        this._evictOldest();
      }
      this.memoryCache.set(cacheKey, { data, expiresAt });

      // Store in Redis if available
      if (this.redisClient) {
        await this.redisClient.setex(
          cacheKey,
          Math.ceil(this.ttlMs / 1000),
          JSON.stringify(data),
        );
      }
    } catch (err) {
      logger.error({ err, cacheKey }, "Cache write error");
      this._recordMetric("error");
    }
  }

  /**
   * Invalidate cache entry.
   * @param {string} cacheKey - Cache key
   * @returns {Promise<boolean>} True if entry existed
   */
  async invalidate(cacheKey) {
    try {
      const existed = this.memoryCache.has(cacheKey);
      this.memoryCache.delete(cacheKey);

      if (this.redisClient) {
        await this.redisClient.del(cacheKey);
      }

      this._recordMetric("invalidate");
      return existed;
    } catch (err) {
      logger.error({ err, cacheKey }, "Cache invalidation error");
      return false;
    }
  }

  /**
   * Invalidate payment-related caches by pattern.
   * @param {string} paymentId - Payment ID to invalidate
   * @returns {Promise<number>} Number of entries invalidated
   */
  async invalidatePaymentRelated(paymentId) {
    try {
      let count = 0;

      // Invalidate memory cache entries
      for (const key of this.memoryCache.keys()) {
        if (key.includes(paymentId)) {
          this.memoryCache.delete(key);
          count += 1;
        }
      }

      // Invalidate Redis entries
      if (this.redisClient) {
        const pattern = `*${paymentId}*`;
        const keys = await this.redisClient.keys(pattern);
        for (const key of keys) {
          await this.redisClient.del(key);
          count += 1;
        }
      }

      logger.debug({ paymentId, count }, "Invalidated payment-related cache entries");
      return count;
    } catch (err) {
      logger.error({ err, paymentId }, "Pattern invalidation error");
      return 0;
    }
  }

  /**
   * Batch get multiple cached entries.
   * @param {string[]} cacheKeys - Array of cache keys
   * @returns {Promise<Map<string, any>>} Map of key -> data
   */
  async mget(cacheKeys) {
    const result = new Map();

    try {
      for (const key of cacheKeys) {
        const data = await this.get(key);
        if (data !== null) {
          result.set(key, data);
        }
      }
      return result;
    } catch (err) {
      logger.error({ err, count: cacheKeys.length }, "Batch cache retrieval error");
      return result;
    }
  }

  /**
   * Batch set multiple cache entries.
   * @param {Map<string, any>} entries - Map of key -> data
   * @returns {Promise<void>}
   */
  async mset(entries) {
    try {
      const promises = [];
      for (const [key, data] of entries) {
        promises.push(this.set(key, data));
      }
      await Promise.all(promises);
    } catch (err) {
      logger.error({ err, count: entries.size }, "Batch cache write error");
    }
  }

  /**
   * Clear all cache entries (memory and Redis).
   * @returns {Promise<void>}
   */
  async clear() {
    try {
      this.memoryCache.clear();
      if (this.redisClient) {
        await this.redisClient.flushdb();
      }
      logger.info("Cache cleared");
    } catch (err) {
      logger.error({ err }, "Cache clear error");
    }
  }

  /**
   * Get cache statistics.
   * @returns {Promise<object>} Cache stats
   */
  async getStats() {
    try {
      const memorySize = this.memoryCache.size;
      const memoryValid = Array.from(this.memoryCache.values()).filter(
        (entry) => !this._isExpired(entry),
      ).length;

      let redisSize = 0;
      if (this.redisClient) {
        const dbSize = await this.redisClient.dbsize();
        redisSize = dbSize || 0;
      }

      return {
        memory: {
          entries: memorySize,
          valid: memoryValid,
          expired: memorySize - memoryValid,
        },
        redis: {
          entries: redisSize,
        },
        total: memorySize + redisSize,
      };
    } catch (err) {
      logger.error({ err }, "Cache stats error");
      return { memory: { entries: 0 }, redis: { entries: 0 }, total: 0 };
    }
  }

  /**
   * Warm cache with precomputed data.
   * @param {Map<string, any>} data - Key -> data map
   * @returns {Promise<void>}
   */
  async warmCache(data) {
    try {
      await this.mset(data);
      logger.info({ count: data.size }, "Cache warming completed");
    } catch (err) {
      logger.error({ err }, "Cache warming error");
    }
  }

  // ─── Private helpers ──────────────────────────────────────────────────

  _isExpired(entry) {
    return Date.now() > entry.expiresAt;
  }

  _evictOldest() {
    let oldestKey = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.memoryCache) {
      if (entry.expiresAt < oldestTime) {
        oldestTime = entry.expiresAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.memoryCache.delete(oldestKey);
    }
  }

  _recordMetric(operation, tier = "memory") {
    if (!this.metricsReporter) return;

    try {
      if (operation === "hit") {
        if (tier === "memory") {
          this.metricsReporter.recordMemoryCacheHit?.();
        } else if (tier === "redis") {
          this.metricsReporter.recordRedisCacheHit?.();
        }
      } else if (operation === "miss") {
        this.metricsReporter.recordCacheMiss?.();
      } else if (operation === "error") {
        this.metricsReporter.recordCacheError?.();
      }
    } catch (err) {
      logger.error({ err }, "Metric reporting error");
    }
  }
}

/**
 * Session-specific payment cache.
 */
export class PaymentSessionCache extends PaymentProcessorCache {
  async getSession(sessionId) {
    const key = generatePaymentCacheKey(sessionId, "session");
    return this.get(key);
  }

  async setSession(sessionId, sessionData) {
    const key = generatePaymentCacheKey(sessionId, "session");
    return this.set(key, sessionData);
  }

  async invalidateSession(sessionId) {
    const key = generatePaymentCacheKey(sessionId, "session");
    return this.invalidate(key);
  }
}

/**
 * Verification result cache.
 */
export class PaymentVerificationCache extends PaymentProcessorCache {
  async getVerification(paymentId) {
    const key = generatePaymentCacheKey(paymentId, "verification");
    return this.get(key);
  }

  async setVerification(paymentId, result) {
    const key = generatePaymentCacheKey(paymentId, "verification");
    return this.set(key, result);
  }

  async invalidateVerification(paymentId) {
    const key = generatePaymentCacheKey(paymentId, "verification");
    return this.invalidate(key);
  }
}

/**
 * Merchant configuration cache.
 */
export class MerchantConfigCache extends PaymentProcessorCache {
  async getConfig(merchantId) {
    const key = generatePaymentCacheKey(merchantId, "config");
    return this.get(key);
  }

  async setConfig(merchantId, config) {
    const key = generatePaymentCacheKey(merchantId, "config");
    return this.set(key, config);
  }

  async invalidateConfig(merchantId) {
    const key = generatePaymentCacheKey(merchantId, "config");
    return this.invalidate(key);
  }
}
