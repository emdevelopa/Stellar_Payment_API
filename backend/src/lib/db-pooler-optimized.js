/**
 * Optimized Database Pooler Module
 * Issues #758, #759, #760
 *
 * Integrates:
 * - Query result caching (Issue #760)
 * - Query rate limiting (Issue #758)
 * - Query signature verification (Issue #759)
 *
 * This module wraps the base db.js pool with additional layers
 * of optimization, protection, and integrity verification.
 *
 * Issue #1057: the open-circuit path degrades straight to the raw pool
 * instead of re-entering optimizedQuery.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { pool, queryWithRetry, isRetryablePoolError, getPoolStats } from "./db.js";
import { queryCache, generateCacheKey, cachedQuery, invalidateTableCache } from "./db-query-cache.js";
import { logger } from "./logger.js";
import {
  dbPoolerRateLimitExceeded,
  dbPoolerQueryTotal,
  dbPoolerSignatureVerified,
  dbPoolerQueryDuration,
  dbPoolerCircuitBreakerState,
  dbPoolerFallbackModeActive,
  dbPoolerActiveMerchantWindows,
  dbPoolerRateLimitUtilizationPercent,
  dbPoolerStatsCacheHits,
  dbPoolerStatsCacheMisses,
  dbPoolerStatsCacheSize,
  dbPoolerStatsCacheEvictions,
} from "./metrics.js";

// Error recovery #895: Circuit breaker for database pool failures
const DB_POOLER_CIRCUIT_BREAKER_THRESHOLD = 30;
const DB_POOLER_CIRCUIT_BREAKER_RESET_MS = 120000;
let _dbPoolerCircuitBreakerFailures = 0;
let _dbPoolerCircuitBreakerLastFailureTime = 0;
let _dbPoolerCircuitBreakerOpen = false;

// Error recovery #895: Fallback to direct pool query when optimized path fails
let _useFallbackMode = false;
let _fallbackModeExpiry = 0;

// ── Configuration ──────────────────────────────────────────────────────────────

const SIGNING_SECRET = process.env.DB_POOLER_SIGNING_SECRET || null;
const RATE_LIMIT_WINDOW_MS = Number.parseInt(
  process.env.DB_POOLER_RATE_LIMIT_WINDOW_MS || "60000",
  10,
);
const RATE_LIMIT_MAX_QUERIES = Number.parseInt(
  process.env.DB_POOLER_RATE_LIMIT_MAX_QUERIES || "100",
  10,
);
const RATE_LIMIT_MAX_MERCHANT_QUERIES = Number.parseInt(
  process.env.DB_POOLER_RATE_LIMIT_MAX_MERCHANT_QUERIES || "50",
  10,
);
// Issue #1317: hard upper bound on tracked merchant windows.
const MAX_MERCHANT_WINDOWS = 10000;

// Issue #1055: bounds and TTL for the pooler stats snapshot cache.
const STATS_CACHE_TTL_MS = Number.parseInt(
  process.env.DB_POOLER_STATS_CACHE_TTL_MS || "1000",
  10,
);
const STATS_CACHE_MAX_ENTRIES = 4;

// ── Query Rate Limiting (Issue #758) ───────────────────────────────────────────

/**
 * Sliding window rate limiter for database queries.
 * Tracks query counts per window and rejects excess requests.
 */
class QueryRateLimiter {
  constructor({
    windowMs = RATE_LIMIT_WINDOW_MS,
    maxQueries = RATE_LIMIT_MAX_QUERIES,
    maxMerchantQueries = RATE_LIMIT_MAX_MERCHANT_QUERIES,
  } = {}) {
    this.windowMs = windowMs;
    this.maxQueries = maxQueries;
    this.maxMerchantQueries = maxMerchantQueries;

    // Global query counter
    this.globalWindowStart = Date.now();
    this.globalCount = 0;

    // Per-merchant counters
    this.merchantWindows = new Map();
  }

  /**
   * Reset the global window if it has expired.
   */
  _resetGlobalWindowIfNeeded() {
    const now = Date.now();
    if (now - this.globalWindowStart >= this.windowMs) {
      this.globalWindowStart = now;
      this.globalCount = 0;
    }
  }

  /**
   * Get or create a merchant-specific window.
   * Includes cleanup of expired windows to prevent memory exhaustion (security audit #896).
   */
  _getMerchantWindow(merchantId) {
    if (!this.merchantWindows.has(merchantId)) {
      this.merchantWindows.set(merchantId, {
        windowStart: Date.now(),
        count: 0,
      });
    }

    const window = this.merchantWindows.get(merchantId);
    const now = Date.now();

    // Reset if window expired
    if (now - window.windowStart >= this.windowMs) {
      window.windowStart = now;
      window.count = 0;
    }

    // Periodic cleanup of stale windows to prevent memory exhaustion
    if (this.merchantWindows.size > MAX_MERCHANT_WINDOWS) {
      this._cleanupStaleWindows(now, merchantId);
    }

    return window;
  }

  /**
   * Cleanup stale merchant windows to prevent memory exhaustion attacks.
   * Removes windows that haven't been accessed within 2x the rate limit window.
   */
  _cleanupStaleWindows(now, keepId = null) {
    const staleThreshold = this.windowMs * 2;
    for (const [id, window] of this.merchantWindows.entries()) {
      if (now - window.windowStart > staleThreshold) {
        this.merchantWindows.delete(id);
      }
    }
    // Issue #1317: stale-window cleanup alone never bounds the map when many
    // distinct merchant IDs are seen within the retention period, so evict
    // the oldest entries (Map insertion order) until back under the cap.
    for (const id of this.merchantWindows.keys()) {
      if (this.merchantWindows.size <= MAX_MERCHANT_WINDOWS) {
        break;
      }
      if (id !== keepId) {
        this.merchantWindows.delete(id);
      }
    }
    dbPoolerActiveMerchantWindows.set(this.merchantWindows.size);
  }

  /**
   * Publish granular gauges for the current rate-limiter state (Issue #1058).
   * Cardinality-safe: aggregates across merchants rather than labeling by
   * merchant ID, which would be unbounded.
   */
  _publishGauges() {
    dbPoolerRateLimitUtilizationPercent.set(
      this.maxQueries > 0 ? (this.globalCount / this.maxQueries) * 100 : 0,
    );
    dbPoolerActiveMerchantWindows.set(this.merchantWindows.size);
  }

  /**
   * Check if a query is allowed under the rate limits.
   *
   * @param {string|null} merchantId - Merchant ID for per-merchant limiting
   * @returns {{ allowed: boolean, reason?: string }}
   */
  checkLimit(merchantId = null) {
    this._resetGlobalWindowIfNeeded();
    this._publishGauges();

    // Check global limit
    if (this.globalCount >= this.maxQueries) {
      dbPoolerRateLimitExceeded.inc({ type: "global" });
      return {
        allowed: false,
        reason: `Global query rate limit exceeded (${this.maxQueries} per ${this.windowMs / 1000}s)`,
      };
    }

    // Check per-merchant limit if merchant context exists
    if (merchantId) {
      const merchantWindow = this._getMerchantWindow(merchantId);
      if (merchantWindow.count >= this.maxMerchantQueries) {
        dbPoolerRateLimitExceeded.inc({ type: "merchant" });
        return {
          allowed: false,
          reason: `Merchant query rate limit exceeded (${this.maxMerchantQueries} per ${this.windowMs / 1000}s)`,
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Record a query execution (call after successful execution).
   */
  recordQuery(merchantId = null) {
    this.globalCount++;

    if (merchantId) {
      const merchantWindow = this._getMerchantWindow(merchantId);
      merchantWindow.count++;
    }

    this._publishGauges();
  }

  /**
   * Get current rate limiter statistics.
   */
  getStats() {
    this._resetGlobalWindowIfNeeded();
    return {
      globalCount: this.globalCount,
      maxQueries: this.maxQueries,
      windowMs: this.windowMs,
      merchantWindows: this.merchantWindows.size,
    };
  }
}

// Singleton rate limiter
const queryRateLimiter = new QueryRateLimiter();

// Error recovery #895: Circuit breaker management
export function _resetDbPoolerCircuitBreakerForTests() {
  _dbPoolerCircuitBreakerFailures = 0;
  _dbPoolerCircuitBreakerLastFailureTime = 0;
  _dbPoolerCircuitBreakerOpen = false;
  _useFallbackMode = false;
  _fallbackModeExpiry = 0;
  dbPoolerCircuitBreakerState.set(0);
  dbPoolerFallbackModeActive.set(0);
}

function _isDbPoolerCircuitBreakerOpen(now = Date.now()) {
  if (!_dbPoolerCircuitBreakerOpen) {
    return false;
  }

  // Attempt to reset circuit breaker after cooldown period
  if (now - _dbPoolerCircuitBreakerLastFailureTime > DB_POOLER_CIRCUIT_BREAKER_RESET_MS) {
    _dbPoolerCircuitBreakerOpen = false;
    _dbPoolerCircuitBreakerFailures = 0;
    dbPoolerCircuitBreakerState.set(0);
    logger.info("Database pooler circuit breaker reset");
    return false;
  }

  return true;
}

function _recordDbPoolerCircuitBreakerFailure(now = Date.now()) {
  _dbPoolerCircuitBreakerFailures++;
  _dbPoolerCircuitBreakerLastFailureTime = now;

  if (_dbPoolerCircuitBreakerFailures >= DB_POOLER_CIRCUIT_BREAKER_THRESHOLD) {
    _dbPoolerCircuitBreakerOpen = true;
    dbPoolerCircuitBreakerState.set(1);
    logger.error(
      { failures: _dbPoolerCircuitBreakerFailures },
      "Database pooler circuit breaker opened due to repeated failures"
    );
  }
}

function _recordDbPoolerCircuitBreakerSuccess() {
  if (_dbPoolerCircuitBreakerFailures > 0) {
    _dbPoolerCircuitBreakerFailures = Math.max(0, _dbPoolerCircuitBreakerFailures - 1);
  }
}

function _enableFallbackMode(durationMs = 300000, now = Date.now()) {
  _useFallbackMode = true;
  _fallbackModeExpiry = now + durationMs;
  dbPoolerFallbackModeActive.set(1);
  logger.warn({ durationMs }, "Database pooler fallback mode enabled");
}

function _isFallbackModeActive(now = Date.now()) {
  if (!_useFallbackMode) {
    return false;
  }

  if (now > _fallbackModeExpiry) {
    _useFallbackMode = false;
    _fallbackModeExpiry = 0;
    dbPoolerFallbackModeActive.set(0);
    logger.info("Database pooler fallback mode expired");
    return false;
  }

  return true;
}

// ── Query Signature Verification (Issue #759) ──────────────────────────────────

/**
 * Generate an HMAC signature for a query to verify its integrity.
 * Used to detect tampering with query text or parameters in transit.
 *
 * @param {string} text - SQL query text
 * @param {Array} values - Query parameter values
 * @returns {string|null} HMAC-SHA256 signature hex string, or null if signing is disabled
 */
export function signQuery(text, values = []) {
  if (!SIGNING_SECRET) {
    return null;
  }

  const payload = JSON.stringify({ text, values });
  return createHmac("sha256", SIGNING_SECRET).update(payload).digest("hex");
}

/**
 * Verify an HMAC signature for a query.
 * Uses constant-time comparison to prevent timing attacks.
 * Enhanced with additional security checks (security audit #896).
 * Error recovery #895: Graceful handling of verification failures.
 *
 * @param {string} text - SQL query text
 * @param {Array} values - Query parameter values
 * @param {string} signature - The signature to verify
 * @returns {boolean} True if the signature is valid or signing is disabled
 */
export function verifyQuerySignature(text, values, signature) {
  try {
    if (!SIGNING_SECRET) {
      // Signature verification is disabled
      return true;
    }

    if (!signature || typeof signature !== "string") {
      logger.warn({ hasSignature: !!signature, signatureType: typeof signature }, "Invalid signature provided");
      return false;
    }

    // Additional security: validate signature format before processing
    if (!/^[a-f0-9]{64}$/i.test(signature)) {
      logger.warn({ signature: signature.substring(0, 8) }, "Invalid signature format detected");
      return false;
    }

    const expected = signQuery(text, values);
    if (!expected) {
      logger.warn("Failed to generate expected signature for verification");
      return false;
    }

    try {
      const expectedBuf = Buffer.from(expected, "hex");
      const actualBuf = Buffer.from(signature, "hex");

      if (expectedBuf.length !== actualBuf.length) {
        logger.warn({ expectedLength: expectedBuf.length, actualLength: actualBuf.length }, "Signature length mismatch");
        return false;
      }

      return timingSafeEqual(expectedBuf, actualBuf);
    } catch (timingError) {
      logger.warn({ err: timingError }, "Timing-safe comparison failed");
      return false;
    }
  } catch (err) {
    // Error recovery #895: Log but don't crash on signature verification errors
    logger.error({ err }, "Unexpected error during query signature verification");
    return false;
  }
}

/**
 * Generate an integrity hash for query results.
 * Used to verify that results haven't been tampered with after retrieval.
 *
 * @param {Object} result - Query result object
 * @returns {string} SHA-256 hash of the serialized result
 */
export function hashQueryResult(result) {
  // Recursively sort object keys before serialising so the hash is
  // deterministic regardless of insertion order, while still capturing
  // all nested values (using an array replacer would strip keys at depth > 1).
  const sortedReplacer = (_, value) => {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      return Object.fromEntries(
        Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
      );
    }
    return value;
  };
  const serialized = JSON.stringify(result, sortedReplacer);
  return createHash("sha256").update(serialized).digest("hex");
}

// ── Optimized Query Execution ──────────────────────────────────────────────────

/**
 * Execute a query through the optimized pooler with all protections.
 *
 * Features:
 * - Rate limiting (Issue #758)
 * - Query signature verification (Issue #759)
 * - Result caching for SELECT queries (Issue #760)
 * - Performance metrics and logging
 * - Error recovery with circuit breaker and fallback mode (#895)
 *
 * @param {string} text - SQL query text
 * @param {Array} values - Query parameter values
 * @param {Object} options - Query options
 * @param {string} options.label - Query label for metrics
 * @param {number} options.retryAttempts - Maximum retry attempts
 * @param {number} options.retryDelayMs - Retry delay in ms
 * @param {string|null} options.merchantId - Merchant ID for per-merchant rate limiting
 * @param {boolean} options.useCache - Whether to use result caching (default: true for SELECT)
 * @param {string|null} options.signature - Query signature for integrity verification
 * @returns {Promise<Object>} Query result
 */
export async function optimizedQuery(
  text,
  values = [],
  {
    label = "query",
    retryAttempts,
    retryDelayMs,
    merchantId = null,
    useCache = true,
    signature = null,
  } = {},
) {
  // Issue #1318: fail fast with a clear validation error instead of letting
  // a null/undefined query text propagate into generateCacheKey()/
  // cachedQuery(), where it previously surfaced as an unguarded null
  // pointer exception several stack frames away from the actual mistake.
  if (typeof text !== "string" || text.length === 0) {
    const error = new Error("optimizedQuery requires a non-empty query string");
    error.status = 400;
    error.code = "DB_POOLER_INVALID_QUERY";
    throw error;
  }

  const now = Date.now();
  const startedAt = process.hrtime.bigint();
  const observeDuration = (status) => {
    const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
    dbPoolerQueryDuration.observe({ label, status }, seconds);
  };

  // Issue #1319: verify the signature before any execution path, including
  // fallback mode, which previously ran the query without verification and
  // let a tampered query through.
  if (signature) {
    const isValid = verifyQuerySignature(text, values, signature);
    dbPoolerSignatureVerified.inc({ result: isValid ? "valid" : "invalid" });

    if (!isValid) {
      observeDuration("signature_invalid");
      const error = new Error("Query signature verification failed - possible tampering detected");
      error.status = 400;
      error.code = "DB_POOLER_SIGNATURE_INVALID";
      logger.warn({ label }, "Query signature verification failed");
      throw error;
    }
  } else if (SIGNING_SECRET) {
    // Signature is expected but not provided
    dbPoolerSignatureVerified.inc({ result: "skipped" });
  }

  // Error recovery #895: Check if fallback mode is active
  if (_isFallbackModeActive(now)) {
    logger.debug({ label }, "Using fallback mode for query execution");
    try {
      const result = await pool.query(text, values);
      dbPoolerQueryTotal.inc({ label, status: "fallback_success" });
      observeDuration("fallback_success");
      return result;
    } catch (fallbackErr) {
      dbPoolerQueryTotal.inc({ label, status: "fallback_error" });
      observeDuration("fallback_error");
      logger.error({ err: fallbackErr, label }, "Fallback mode query execution failed");
      throw fallbackErr;
    }
  }

  // Error recovery #895: Check circuit breaker
  if (_isDbPoolerCircuitBreakerOpen(now)) {
    logger.warn("Database pooler circuit breaker is open, enabling fallback mode");
    _enableFallbackMode();

    // Issue #1057: this used to re-enter `optimizedQuery` recursively. If
    // fallback mode expired between the enable and the re-entry, the retry
    // hit the open circuit again and recursed once more — unbounded stack
    // growth for as long as the database stayed down. Fall back directly to
    // the raw pool instead, which is exactly what fallback mode does.
    try {
      const result = await pool.query(text, values);
      dbPoolerQueryTotal.inc({ label, status: "fallback_success" });
      observeDuration("fallback_success");
      return result;
    } catch (fallbackErr) {
      dbPoolerQueryTotal.inc({ label, status: "fallback_error" });
      observeDuration("fallback_error");
      logger.error({ err: fallbackErr, label }, "Fallback mode query execution failed");
      throw fallbackErr;
    }
  }

  // ── Step 1: Rate limiting check (Issue #758) ─────────────────────────────
  // Reserve the slot synchronously, in the same tick as the check (issue
  // #1059 load testing): recording only after the DB call resolved left a
  // check-then-act race where a concurrent burst could see the pre-query
  // count for every request and blow straight through the limit before any
  // of them had a chance to record. Counting the attempt at admission time
  // (rather than at completion) closes that gap and matches how the
  // per-request rate limit is meant to behave under concurrency.
  const rateLimitResult = queryRateLimiter.checkLimit(merchantId);
  if (!rateLimitResult.allowed) {
    dbPoolerQueryTotal.inc({ label, status: "rate_limited" });
    observeDuration("rate_limited");
    const error = new Error(rateLimitResult.reason);
    error.status = 429;
    error.code = "DB_POOLER_RATE_LIMITED";
    throw error;
  }
  queryRateLimiter.recordQuery(merchantId);

  // ── Step 2: Execute with caching (Issue #760) ────────────────────────────
  try {
    const result = await cachedQuery(
      text,
      values,
      { label, retryAttempts, retryDelayMs },
      queryWithRetry,
      { useCache },
    );

    dbPoolerQueryTotal.inc({ label, status: "success" });
    observeDuration("success");
    _recordDbPoolerCircuitBreakerSuccess();

    return result;
  } catch (err) {
    dbPoolerQueryTotal.inc({ label, status: "error" });
    observeDuration("error");
    _recordDbPoolerCircuitBreakerFailure(now);

    // Error recovery #895: Enable fallback mode on repeated failures
    if (_dbPoolerCircuitBreakerFailures >= DB_POOLER_CIRCUIT_BREAKER_THRESHOLD / 2) {
      logger.warn({ err, label, failures: _dbPoolerCircuitBreakerFailures }, "Enabling fallback mode due to repeated failures");
      _enableFallbackMode();
    }

    throw err;
  }
}

/**
 * Execute a write query (INSERT, UPDATE, DELETE) through the optimized pooler.
 * Write queries bypass caching but still enforce rate limiting and signature verification.
 * Error recovery #895: Enhanced with fallback mode support.
 *
 * @param {string} text - SQL query text
 * @param {Array} values - Query parameter values
 * @param {Object} options - Query options (same as optimizedQuery)
 * @returns {Promise<Object>} Query result
 */
export async function optimizedWrite(text, values = [], options = {}) {
  try {
    const result = await optimizedQuery(text, values, { ...options, useCache: false });

    // Invalidate cache after writes
    const tableName = extractTableName(text);
    if (tableName) {
      try {
        invalidateTableCache(tableName);
      } catch (cacheErr) {
        // Error recovery #895: Don't fail the write if cache invalidation fails
        logger.warn({ err: cacheErr, tableName }, "Failed to invalidate cache after write");
      }
    }

    return result;
  } catch (err) {
    // Issue #1319: rate-limit, signature and validation rejections are
    // deliberate; retrying them through the raw pool would bypass those
    // protections entirely.
    if (typeof err?.code === "string" && err.code.startsWith("DB_POOLER_")) {
      throw err;
    }
    // Error recovery #895: Attempt fallback mode on write failures
    if (!_isFallbackModeActive()) {
      logger.warn({ err, label: options.label }, "Write query failed, attempting fallback mode");
      _enableFallbackMode();
      try {
        const result = await pool.query(text, values);
        dbPoolerQueryTotal.inc({ label: options.label || "write", status: "fallback_success" });
        return result;
      } catch (fallbackErr) {
        logger.error({ err: fallbackErr }, "Fallback mode write query failed");
        throw fallbackErr;
      }
    }
    throw err;
  }
}

/**
 * Extract the primary table name from a SQL query for cache invalidation.
 */
function extractTableName(sql) {
  // Issue #1318: a falsy/non-string `sql` (e.g. a write helper called with
  // no query text) used to throw a null pointer exception on `.trim()`
  // instead of simply reporting "no table name found".
  if (typeof sql !== "string" || sql.length === 0) {
    return null;
  }
  const normalized = sql.trim().toUpperCase();

  // Match INSERT INTO, UPDATE, DELETE FROM patterns
  const patterns = [
    /INSERT\s+INTO\s+(?:"?(\w+)"?\.)?\"?(\w+)\"?/i,
    /UPDATE\s+(?:"?(\w+)"?\.)?\"?(\w+)\"?/i,
    /DELETE\s+FROM\s+(?:"?(\w+)"?\.)?\"?(\w+)\"?/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) {
      return (match[1] || match[2]).toLowerCase();
    }
  }

  return null;
}

// ── Exported Utilities ──────────────────────────────────────────────────────────

/**
 * Get comprehensive pooler statistics.
 * Error recovery #895: Added circuit breaker and fallback mode status.
 */
export function getPoolerStats() {
  return {
    pool: getPoolStats(),
    cache: queryCache.getStats(),
    rateLimiter: queryRateLimiter.getStats(),
    signingEnabled: Boolean(SIGNING_SECRET),
    circuitBreaker: {
      open: _dbPoolerCircuitBreakerOpen,
      failures: _dbPoolerCircuitBreakerFailures,
      lastFailureTime: _dbPoolerCircuitBreakerLastFailureTime,
    },
    fallbackMode: {
      active: _useFallbackMode,
      expiresAt: _fallbackModeExpiry,
    },
  };
}

/**
 * Clear the query cache. Useful after bulk operations or migrations.
 */
export function clearQueryCache() {
  return queryCache.clear();
}

// ── Stats Cache (Issue #1055) ────────────────────────────────────────────────

/**
 * Bounded TTL cache for the pooler stats snapshot.
 *
 * `getPoolerStats()` walks the pg pool, the query cache and the rate-limiter
 * window map on every call, so a metrics scrape hitting it at the standard
 * interval turns one cheap read into a full state walk per scrape. This is a
 * plain Map with a short TTL rather than an LRU: the key space is fixed (a
 * handful of scopes), and entries are single snapshots, so ordering buys
 * nothing here. The cap is still enforced so a future caller passing
 * unbounded scope keys cannot grow it without limit.
 */
class StatsCache {
  constructor({ ttlMs = STATS_CACHE_TTL_MS, maxEntries = STATS_CACHE_MAX_ENTRIES } = {}) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.entries = new Map();
    this.stats = { hits: 0, misses: 0, evictions: 0, expirations: 0, invalidations: 0 };
  }

  get(key) {
    const entry = this.entries.get(key);
    if (!entry) {
      this.stats.misses++;
      dbPoolerStatsCacheMisses.inc();
      return undefined;
    }
    if (Date.now() - entry.timestamp >= this.ttlMs) {
      this.entries.delete(key);
      this.stats.expirations++;
      this.stats.misses++;
      dbPoolerStatsCacheEvictions.inc();
      dbPoolerStatsCacheMisses.inc();
      this._publishSize();
      return undefined;
    }
    this.stats.hits++;
    dbPoolerStatsCacheHits.inc();
    return entry.value;
  }

  set(key, value) {
    if (this.entries.has(key)) {
      this.entries.delete(key);
    }
    while (this.entries.size >= this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value);
      this.stats.evictions++;
      dbPoolerStatsCacheEvictions.inc();
    }
    this.entries.set(key, { value, timestamp: Date.now() });
    this._publishSize();
  }

  delete(key) {
    const removed = this.entries.delete(key);
    if (removed) {
      this.stats.invalidations++;
      this._publishSize();
    }
    return removed;
  }

  clear() {
    this.entries.clear();
    this._publishSize();
  }

  _publishSize() {
    dbPoolerStatsCacheSize.set(this.entries.size);
  }

  getStats() {
    return {
      size: this.entries.size,
      ttlMs: this.ttlMs,
      maxEntries: this.maxEntries,
      ...this.stats,
    };
  }
}

const statsCache = new StatsCache();

/**
 * Get pooler statistics through a short-lived cache.
 *
 * Use this for high-frequency callers (metrics scrapes, health probes).
 * `getPoolerStats()` remains the uncached accessor for callers that need a
 * value guaranteed to reflect the current instant, such as a test or a
 * circuit-breaker decision.
 *
 * @param {Object} options - Cache options
 * @param {string} options.scope - Cache scope; distinct scopes are cached independently
 * @param {boolean} options.skipCache - Bypass the cache and recompute
 * @returns {Object} Pooler statistics
 */
export function getCachedPoolerStats({ scope = "default", skipCache = false } = {}) {
  if (!skipCache) {
    const cached = statsCache.get(scope);
    if (cached !== undefined) {
      return cached;
    }
  }

  const snapshot = getPoolerStats();

  if (!skipCache) {
    statsCache.set(scope, snapshot);
  }

  return snapshot;
}

/** Drop a cached stats snapshot, or the whole cache when called with no scope. */
export function invalidatePoolerStatsCache(scope) {
  if (scope === undefined) {
    statsCache.clear();
    return;
  }
  statsCache.delete(scope);
}

/** Cache bookkeeping for tests and diagnostics. */
export function getPoolerStatsCacheStats() {
  return statsCache.getStats();
}

export {
  queryRateLimiter,
  queryCache,
  statsCache,
};
