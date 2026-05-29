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
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { pool, queryWithRetry, isRetryablePoolError, getPoolStats } from "./db.js";
import { queryCache, generateCacheKey, cachedQuery, invalidateTableCache } from "./db-query-cache.js";
import { logger } from "./logger.js";
import {
  dbPoolerRateLimitExceeded,
  dbPoolerQueryTotal,
  dbPoolerSignatureVerified,
} from "./metrics.js";

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

    return window;
  }

  /**
   * Check if a query is allowed under the rate limits.
   *
   * @param {string|null} merchantId - Merchant ID for per-merchant limiting
   * @returns {{ allowed: boolean, reason?: string }}
   */
  checkLimit(merchantId = null) {
    this._resetGlobalWindowIfNeeded();

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
 *
 * @param {string} text - SQL query text
 * @param {Array} values - Query parameter values
 * @param {string} signature - The signature to verify
 * @returns {boolean} True if the signature is valid or signing is disabled
 */
export function verifyQuerySignature(text, values, signature) {
  if (!SIGNING_SECRET) {
    // Signature verification is disabled
    return true;
  }

  if (!signature || typeof signature !== "string") {
    return false;
  }

  const expected = signQuery(text, values);
  if (!expected) {
    return false;
  }

  try {
    const expectedBuf = Buffer.from(expected, "hex");
    const actualBuf = Buffer.from(signature, "hex");

    if (expectedBuf.length !== actualBuf.length) {
      return false;
    }

    return timingSafeEqual(expectedBuf, actualBuf);
  } catch {
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
  const serialized = JSON.stringify(result, Object.keys(result).sort());
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
  // ── Step 1: Rate limiting check (Issue #758) ─────────────────────────────
  const rateLimitResult = queryRateLimiter.checkLimit(merchantId);
  if (!rateLimitResult.allowed) {
    dbPoolerQueryTotal.inc({ label, status: "rate_limited" });
    const error = new Error(rateLimitResult.reason);
    error.status = 429;
    error.code = "DB_POOLER_RATE_LIMITED";
    throw error;
  }

  // ── Step 2: Signature verification (Issue #759) ──────────────────────────
  if (signature) {
    const isValid = verifyQuerySignature(text, values, signature);
    dbPoolerSignatureVerified.inc({ result: isValid ? "valid" : "invalid" });

    if (!isValid) {
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

  // ── Step 3: Execute with caching (Issue #760) ────────────────────────────
  try {
    const result = await cachedQuery(
      text,
      values,
      { label, retryAttempts, retryDelayMs },
      queryWithRetry,
      { useCache },
    );

    // Record successful query
    queryRateLimiter.recordQuery(merchantId);
    dbPoolerQueryTotal.inc({ label, status: "success" });

    return result;
  } catch (err) {
    dbPoolerQueryTotal.inc({ label, status: "error" });
    throw err;
  }
}

/**
 * Execute a write query (INSERT, UPDATE, DELETE) through the optimized pooler.
 * Write queries bypass caching but still enforce rate limiting and signature verification.
 *
 * @param {string} text - SQL query text
 * @param {Array} values - Query parameter values
 * @param {Object} options - Query options (same as optimizedQuery)
 * @returns {Promise<Object>} Query result
 */
export async function optimizedWrite(text, values = [], options = {}) {
  const result = await optimizedQuery(text, values, { ...options, useCache: false });

  // Invalidate cache after writes
  const tableName = extractTableName(text);
  if (tableName) {
    invalidateTableCache(tableName);
  }

  return result;
}

/**
 * Extract the primary table name from a SQL query for cache invalidation.
 */
function extractTableName(sql) {
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
 */
export function getPoolerStats() {
  return {
    pool: getPoolStats(),
    cache: queryCache.getStats(),
    rateLimiter: queryRateLimiter.getStats(),
    signingEnabled: Boolean(SIGNING_SECRET),
  };
}

/**
 * Clear the query cache. Useful after bulk operations or migrations.
 */
export function clearQueryCache() {
  return queryCache.clear();
}

export {
  queryRateLimiter,
  queryCache,
};
