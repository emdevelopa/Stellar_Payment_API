/**
 * Trustline Manager - Enhanced cryptographic verification, rate limiting, error recovery, and optimized queries
 *
 * This module provides comprehensive trustline management functionality with:
 * - Task #595: Cryptographic signature verification for trustline operations
 * - Task #594: Rate limiting for trustline operations
 * - Task #746: Enhanced error recovery mechanisms
 * - Task #596: Optimized SQL queries for trustline data
 */

import { createHash, timingSafeEqual } from "node:crypto";
import * as StellarSdk from "stellar-sdk";
import { queryWithRetry } from "./db.js";
import {
  isValidStellarAccountId,
  verifyTransactionSignature,
  withHorizonRetry,
  isValidAssetCode,
} from "./stellar.js";
import {
  createRedisRateLimitStore,
  RATE_LIMIT_REDIS_PREFIX,
} from "./rate-limit.js";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";

// Rate limiting constants for trustline operations
export const TRUSTLINE_RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
export const TRUSTLINE_RATE_LIMIT_MAX = 20; // 20 operations per window
export const TRUSTLINE_VERIFICATION_RATE_LIMIT_MAX = 50; // 50 verifications per window
export const TRUSTLINE_BURST_WINDOW_MS = 10 * 1000; // 10 seconds burst window
export const TRUSTLINE_BURST_MAX = 5; // 5 requests per burst window
const TRUSTLINE_STATS_TIMEFRAMES = new Set([
  "1 hour",
  "24 hours",
  "7 days",
  "30 days",
]);

// Error recovery constants
// Enhanced error recovery constants (Task #880)
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY_BASE_MS = 1000;
const CIRCUIT_BREAKER_THRESHOLD = 5;
const CIRCUIT_BREAKER_TIMEOUT_MS = 30 * 1000;
const CIRCUIT_BREAKER_HALF_OPEN_PROBE_MS = 5 * 1000; // time before allowing probe in half-open
const OPERATION_TIMEOUT_MS = 15 * 1000; // default per-operation timeout
const DLQ_MAX_SIZE = 100; // maximum dead-letter queue entries
const ERROR_RECOVERY_METRICS_WINDOW_MS = 60 * 1000; // 1 minute window for recovery metrics

// Bounds for in-memory stores keyed by caller-influenced values (tx hashes, IPs)
const VERIFICATION_CACHE_MAX_ENTRIES = 1000;
const RATE_LIMIT_VIOLATIONS_MAX_KEYS = 10000;

/**
 * Per-key rate limit violation tracking.
 * Provides metrics for security monitoring and alerting on abusive actors.
 */
const rateLimitViolations = new Map();

/**
 * Per-context circuit breaker states.
 * Key: context string (or 'default'). Value: CircuitBreakerState.
 *
 * Using a Map keeps failure domains isolated so a surge in one operation
 * (e.g. Horizon calls) does not block unrelated DB queries.
 */
const circuitBreakerRegistry = new Map();

/**
 * In-memory dead-letter queue for failed operations that exhausted retries.
 * Entries are available for inspection, replay, or external alerting.
 * Enhanced with categorization and priority levels (Task #880)
 */
const deadLetterQueue = [];

/**
 * Enhanced recovery metrics tracking per context
 * Tracks success rates, average recovery times, and error patterns
 */
const recoveryMetrics = new Map();

/**
 * Task #595: Enhanced cryptographic signature verification for trustline operations
 *
 * Verifies trustline transaction signatures with additional security checks:
 * - Multi-signature account support
 * - Threshold verification
 * - Signature replay protection
 * - Enhanced error reporting
 */
export class TrustlineSignatureVerifier {
  constructor() {
    this.verificationCache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Verify trustline operation signature with enhanced security
   */
  async verifyTrustlineSignature(txHash, options = {}) {
    try {
      if (!txHash || typeof txHash !== "string") {
        throw new Error(
          "Invalid transaction hash provided for trustline verification",
        );
      }

      const normalizedOptions =
        typeof options === "string"
          ? { expectedOperation: options }
          : options || {};
      const { expectedOperation = "changeTrust", skipCache = false } =
        normalizedOptions;

      // Check cache first
      const cacheKey = `${txHash}:${expectedOperation}`;
      if (!skipCache) {
        const cached = this.verificationCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
          return cached.result;
        }
        if (cached) this.verificationCache.delete(cacheKey);
      }

      // Step 1: Basic signature verification
      const basicVerification = await verifyTransactionSignature(txHash);

      if (!basicVerification.valid) {
        return {
          ...basicVerification,
          valid: false,
          reason: `Basic signature verification failed: ${basicVerification.reason}`,
          trustlineSpecific: false,
        };
      }

      // Step 2: Trustline-specific verification
      const trustlineVerification = await this.verifyTrustlineOperation(
        txHash,
        expectedOperation,
      );

      const result = {
        ...basicVerification,
        valid: basicVerification.valid && trustlineVerification.valid,
        reason: trustlineVerification.valid
          ? `Trustline signature verification passed: ${basicVerification.reason}`
          : `Trustline verification failed: ${trustlineVerification.reason}`,
        trustlineSpecific: true,
        operationType: trustlineVerification.operationType,
        assetCode: trustlineVerification.assetCode,
        assetIssuer: trustlineVerification.assetIssuer,
        limit: trustlineVerification.limit,
      };

      // Cache the result
      if (!skipCache) {
        this._pruneCache();
        this.verificationCache.set(cacheKey, {
          result,
          timestamp: Date.now(),
        });
      }

      return result;
    } catch (error) {
      return {
        valid: false,
        reason: `Trustline signature verification error: ${error.message}`,
        trustlineSpecific: true,
        isMultiSig: false,
        signatureCount: 0,
        thresholdMet: false,
      };
    }
  }

  /**
   * Verify that the transaction contains valid trustline operations
   */
  async verifyTrustlineOperation(txHash, expectedOperation) {
    const NETWORK = (process.env.STELLAR_NETWORK || "testnet").toLowerCase();
    const server = new StellarSdk.Horizon.Server(
      process.env.STELLAR_HORIZON_URL ||
        (NETWORK === "public"
          ? "https://horizon.stellar.org"
          : "https://horizon-testnet.stellar.org"),
    );

    try {
      const tx = await withHorizonRetry(
        () => server.transactions().transaction(txHash).call(),
        `trustline transaction ${txHash}`,
      );

      const passphrase =
        NETWORK === "public"
          ? StellarSdk.Networks.PUBLIC
          : StellarSdk.Networks.TESTNET;

      const transaction = new StellarSdk.Transaction(
        tx.envelope_xdr,
        passphrase,
      );

      // Find trustline operations
      const trustlineOps = transaction.operations.filter(
        (op) => op.type === "changeTrust" || op.type === "allowTrust",
      );

      if (trustlineOps.length === 0) {
        return {
          valid: false,
          reason: `No trustline operations found in transaction. Expected: ${expectedOperation}`,
        };
      }

      // Verify the first trustline operation matches expectations
      const op = trustlineOps[0];

      if (expectedOperation && op.type !== expectedOperation) {
        return {
          valid: false,
          reason: `Operation type mismatch. Expected: ${expectedOperation}, Found: ${op.type}`,
        };
      }

      // Extract and validate asset information
      let assetCode, assetIssuer, limit;

      if (op.type === "changeTrust") {
        const asset = op.asset;
        if (asset.isNative()) {
          return {
            valid: false,
            reason: "Native asset trustlines are not allowed",
          };
        }

        assetCode = asset.getCode();
        assetIssuer = asset.getIssuer();
        limit = op.limit;

        // Validate asset code and issuer
        if (!isValidAssetCode(assetCode)) {
          return {
            valid: false,
            reason: `Invalid asset code in trustline operation: ${assetCode}`,
          };
        }

        if (!isValidStellarAccountId(assetIssuer)) {
          return {
            valid: false,
            reason: `Invalid asset issuer in trustline operation: ${assetIssuer}`,
          };
        }
      } else if (op.type === "allowTrust") {
        assetCode = op.assetCode;
        assetIssuer =
          op.source || transaction.source || tx.source_account || null;

        if (!isValidAssetCode(assetCode)) {
          return {
            valid: false,
            reason: `Invalid asset code in trustline operation: ${assetCode}`,
          };
        }

        if (assetIssuer && !isValidStellarAccountId(assetIssuer)) {
          return {
            valid: false,
            reason: `Invalid asset issuer in trustline operation: ${assetIssuer}`,
          };
        }

        if (!isValidStellarAccountId(op.trustor)) {
          return {
            valid: false,
            reason: `Invalid trustor in trustline operation: ${op.trustor}`,
          };
        }
      }

      return {
        valid: true,
        reason: `Valid ${op.type} operation found`,
        operationType: op.type,
        assetCode,
        assetIssuer,
        limit,
      };
    } catch (error) {
      return {
        valid: false,
        reason: `Failed to verify trustline operation: ${error.message}`,
      };
    }
  }

  /**
   * Drop expired entries and evict the oldest ones so the cache stays bounded.
   */
  _pruneCache() {
    const now = Date.now();
    for (const [key, entry] of this.verificationCache) {
      if (now - entry.timestamp >= this.cacheTimeout) {
        this.verificationCache.delete(key);
      }
    }
    while (this.verificationCache.size >= VERIFICATION_CACHE_MAX_ENTRIES) {
      const oldest = this.verificationCache.keys().next().value;
      this.verificationCache.delete(oldest);
    }
  }

  /**
   * Clear verification cache
   */
  clearCache() {
    this.verificationCache.clear();
  }
}

/**
 * Task #594: Rate limiting for trustline operations
 *
 * Implements comprehensive rate limiting for trustline management:
 * - Per-merchant trustline operation limits
 * - Per-IP verification limits
 * - Adaptive rate limiting based on account type
 * - Burst protection (secondary tight window)
 * - Internal service bypass via trusted header
 * - Violation metrics for security monitoring
 */
export class TrustlineRateLimiter {
  /**
   * Generate rate limit key for trustline operations.
   * Priority: merchant ID > hashed API key > IP address.
   */
  static getTrustlineOperationKey(req) {
    const merchantId = req?.merchant?.id;
    const apiKey = req?.headers?.["x-api-key"];
    const ipKey = ipKeyGenerator(
      req?.ip ?? req?.socket?.remoteAddress ?? "unknown-ip",
    );

    const hashedApiKey = apiKey
      ? createHash("sha256").update(apiKey).digest("hex").substring(0, 16)
      : null;

    const actor = merchantId
      ? `merchant:${merchantId}`
      : hashedApiKey
        ? `api:${hashedApiKey}`
        : `ip:${ipKey}`;

    return `trustline:ops:${actor}`;
  }

  /**
   * Generate rate limit key for trustline verifications.
   * Priority: merchant ID > IP address.
   */
  static getTrustlineVerificationKey(req) {
    const merchantId = req?.merchant?.id;
    const ipKey = ipKeyGenerator(
      req?.ip ?? req?.socket?.remoteAddress ?? "unknown-ip",
    );

    const actor = merchantId ? `merchant:${merchantId}` : `ip:${ipKey}`;
    return `trustline:verify:${actor}`;
  }

  /**
   * Check whether the request comes from a trusted internal service.
   * Internal services present a shared secret via x-internal-service-token.
   * The server-side secret is configured via the INTERNAL_SERVICE_TOKEN env var.
   */
  static isInternalService(req) {
    const internalToken = req?.headers?.["x-internal-service-token"];
    const configuredToken = process.env.INTERNAL_SERVICE_TOKEN;
    if (
      !configuredToken ||
      typeof internalToken !== "string" ||
      internalToken.length === 0
    ) {
      return false;
    }
    // Compare fixed-length digests in constant time to avoid timing leaks.
    const provided = createHash("sha256").update(internalToken).digest();
    const expected = createHash("sha256").update(configuredToken).digest();
    return timingSafeEqual(provided, expected);
  }

  /**
   * Record a rate limit violation for a given key.
   * Call this from rate limiter handlers to build abuse metrics.
   */
  static recordViolation(key) {
    const current = rateLimitViolations.get(key) || {
      count: 0,
      lastSeen: null,
    };
    if (
      !rateLimitViolations.has(key) &&
      rateLimitViolations.size >= RATE_LIMIT_VIOLATIONS_MAX_KEYS
    ) {
      // Evict the oldest tracked key so attacker-controlled keys cannot grow the map unbounded.
      rateLimitViolations.delete(rateLimitViolations.keys().next().value);
    }
    rateLimitViolations.set(key, {
      count: current.count + 1,
      lastSeen: new Date().toISOString(),
    });
  }

  /**
   * Return a snapshot of all recorded rate limit violations.
   * Useful for security dashboards and alerting pipelines.
   */
  static getRateLimitViolationMetrics() {
    const snapshot = {};
    for (const [key, data] of rateLimitViolations.entries()) {
      snapshot[key] = { ...data };
    }
    return snapshot;
  }

  /**
   * Clear all recorded violation metrics.
   * Used in tests and administrative reset endpoints.
   */
  static resetViolationMetrics() {
    rateLimitViolations.clear();
  }

  /**
   * Create burst protection rate limiter.
   * Enforces a tight secondary window (default 5 req / 10 s) to stop
   * rapid-fire bursts that stay under the primary per-window quota.
   */
  static createTrustlineBurstRateLimit({
    store,
    rateLimitFactory = rateLimit,
  } = {}) {
    return rateLimitFactory({
      windowMs: TRUSTLINE_BURST_WINDOW_MS,
      max: TRUSTLINE_BURST_MAX,
      message: {
        error: "Burst limit exceeded. Slow down your trustline requests.",
        code: "TRUSTLINE_BURST_LIMIT",
        retryAfter: Math.ceil(TRUSTLINE_BURST_WINDOW_MS / 1000),
      },
      standardHeaders: true,
      legacyHeaders: false,
      validate: { ip: false },
      keyGenerator: this.getTrustlineOperationKey,
      handler: (req, res, _next, options) => {
        const key = this.getTrustlineOperationKey(req);
        this.recordViolation(key);
        res.status(options.statusCode).json(options.message);
      },
      store,
      passOnStoreError: true,
      skip: (req) => this.isInternalService(req),
    });
  }

  /**
   * Create rate limiter for trustline operations.
   * Skips enterprise/premium merchants and trusted internal services.
   */
  static createTrustlineOperationRateLimit({
    store,
    rateLimitFactory = rateLimit,
  } = {}) {
    return rateLimitFactory({
      windowMs: TRUSTLINE_RATE_LIMIT_WINDOW_MS,
      max: TRUSTLINE_RATE_LIMIT_MAX,
      message: {
        error:
          "Too many trustline operations. Please wait before creating more trustlines.",
        code: "TRUSTLINE_RATE_LIMIT",
        retryAfter: Math.ceil(TRUSTLINE_RATE_LIMIT_WINDOW_MS / 1000),
      },
      standardHeaders: true,
      legacyHeaders: false,
      validate: { ip: false },
      keyGenerator: this.getTrustlineOperationKey,
      handler: (req, res, _next, options) => {
        const key = this.getTrustlineOperationKey(req);
        this.recordViolation(key);
        res.status(options.statusCode).json(options.message);
      },
      requestWasSuccessful: (_req, res) => res.statusCode < 400,
      store,
      passOnStoreError: true,
      skip: (req) => {
        if (this.isInternalService(req)) return true;
        const merchantTier = req?.merchant?.metadata?.tier;
        return merchantTier === "enterprise" || merchantTier === "premium";
      },
    });
  }

  /**
   * Create rate limiter for trustline verifications.
   * Higher quota than operations since verification is read-only.
   * Skips trusted internal services.
   */
  static createTrustlineVerificationRateLimit({
    store,
    rateLimitFactory = rateLimit,
  } = {}) {
    return rateLimitFactory({
      windowMs: TRUSTLINE_RATE_LIMIT_WINDOW_MS,
      max: TRUSTLINE_VERIFICATION_RATE_LIMIT_MAX,
      message: {
        error: "Too many trustline verification requests. Please slow down.",
        code: "TRUSTLINE_VERIFY_RATE_LIMIT",
        retryAfter: Math.ceil(TRUSTLINE_RATE_LIMIT_WINDOW_MS / 1000),
      },
      standardHeaders: true,
      legacyHeaders: false,
      validate: { ip: false },
      keyGenerator: this.getTrustlineVerificationKey,
      handler: (req, res, _next, options) => {
        const key = this.getTrustlineVerificationKey(req);
        this.recordViolation(key);
        res.status(options.statusCode).json(options.message);
      },
      requestWasSuccessful: (_req, res) => res.statusCode < 400,
      store,
      passOnStoreError: true,
      skip: (req) => this.isInternalService(req),
    });
  }
}

/**
 * Task #746: Enhanced error recovery for trustline operations
 *
 * Improvements over the previous implementation:
 * - Per-context circuit breakers (failure domains are isolated)
 * - Half-open state: one probe attempt before fully closing the breaker
 * - Operation timeout wrapper (prevents runaway async calls)
 * - Dead-letter queue for unrecoverable failures (replay / alerting)
 * - Error metrics per context (failure counts, last error, recovery counts)
 * - Pluggable fallback handlers so callers can return cached/degraded data
 * - Comprehensive error classification unchanged but extended for auth errors
 */
export class TrustlineErrorRecovery {
  // ─── Circuit Breaker Helpers ────────────────────────────────────────────────

  static _getState(context) {
    if (!circuitBreakerRegistry.has(context)) {
      circuitBreakerRegistry.set(context, {
        failures: 0,
        lastFailureTime: null,
        // States: 'closed' | 'open' | 'half-open'
        state: "closed",
        successAfterHalfOpen: 0,
        // True while a half-open probe is running; prevents concurrent probes
        probeInFlight: false,
        metrics: {
          totalFailures: 0,
          totalRecoveries: 0,
          lastErrorMessage: null,
          lastErrorTime: null,
        },
      });
    }
    return circuitBreakerRegistry.get(context);
  }

  /**
   * Returns the circuit breaker disposition for a given context.
   * 'allow'     – proceed normally
   * 'probe'     – one probe allowed (half-open state)
   * 'reject'    – circuit open, reject immediately
   */
  static _circuitBreakerDisposition(context) {
    const s = this._getState(context);
    const now = Date.now();

    if (s.state === "closed") return "allow";

    if (s.state === "open") {
      const elapsed = now - s.lastFailureTime;
      if (elapsed >= CIRCUIT_BREAKER_TIMEOUT_MS) {
        // Transition to half-open: allow a single probe
        s.state = "half-open";
        s.successAfterHalfOpen = 0;
        s.probeInFlight = false;
        return "probe";
      }
      // Still within the open window
      if (elapsed >= CIRCUIT_BREAKER_HALF_OPEN_PROBE_MS && s.state === "open") {
        return "reject";
      }
      return "reject";
    }

    // half-open: allow probe only once
    if (s.state === "half-open") return "probe";

    return "allow";
  }

  static _recordFailure(context, error) {
    const s = this._getState(context);
    s.failures++;
    s.probeInFlight = false;
    s.lastFailureTime = Date.now();
    s.metrics.totalFailures++;
    s.metrics.lastErrorMessage = error?.message ?? String(error);
    s.metrics.lastErrorTime = new Date().toISOString();

    if (s.state === "half-open") {
      // Probe failed – reopen the circuit
      s.state = "open";
    } else if (s.failures >= CIRCUIT_BREAKER_THRESHOLD) {
      s.state = "open";
    }

    // Update recovery metrics (Task #880 - Enhanced monitoring)
    this._updateRecoveryMetrics(context, false);
  }

  static _recordSuccess(context) {
    const s = this._getState(context);
    s.probeInFlight = false;
    if (s.state === "half-open") {
      // Probe succeeded – close the circuit
      s.state = "closed";
      s.failures = 0;
      s.metrics.totalRecoveries++;
    } else {
      // Only a success after prior failures counts as a recovery
      if (s.failures > 0) s.metrics.totalRecoveries++;
      s.failures = 0;
    }

    // Update recovery metrics (Task #880 - Enhanced monitoring)
    this._updateRecoveryMetrics(context, true);
  }

  /**
   * Update recovery metrics for monitoring and alerting
   * Tracks success rates and recovery patterns (Task #880)
   */
  static _updateRecoveryMetrics(context, success) {
    if (!recoveryMetrics.has(context)) {
      recoveryMetrics.set(context, {
        successCount: 0,
        failureCount: 0,
        lastUpdated: Date.now(),
        recentOutcomes: [],
      });
    }

    const metrics = recoveryMetrics.get(context);
    const now = Date.now();

    // Update counts
    if (success) {
      metrics.successCount++;
    } else {
      metrics.failureCount++;
    }

    // Track recent outcomes (last 100)
    metrics.recentOutcomes.push({ success, timestamp: now });
    if (metrics.recentOutcomes.length > 100) {
      metrics.recentOutcomes.shift();
    }

    // Clean old entries outside the metrics window
    metrics.recentOutcomes = metrics.recentOutcomes.filter(
      (outcome) => now - outcome.timestamp < ERROR_RECOVERY_METRICS_WINDOW_MS,
    );

    metrics.lastUpdated = now;
  }

  /**
   * Get recovery success rate for a context
   */
  static getRecoverySuccessRate(context) {
    const metrics = recoveryMetrics.get(context);
    if (!metrics || metrics.recentOutcomes.length === 0) {
      return null;
    }

    const successCount = metrics.recentOutcomes.filter((o) => o.success).length;
    return (successCount / metrics.recentOutcomes.length) * 100;
  }

  /**
   * Get all recovery metrics for monitoring dashboards
   */
  static getAllRecoveryMetrics() {
    const snapshot = {};
    for (const [context, metrics] of recoveryMetrics.entries()) {
      const successRate = this.getRecoverySuccessRate(context);
      snapshot[context] = {
        successCount: metrics.successCount,
        failureCount: metrics.failureCount,
        successRate:
          successRate !== null ? successRate.toFixed(2) + "%" : "N/A",
        recentOperations: metrics.recentOutcomes.length,
        lastUpdated: new Date(metrics.lastUpdated).toISOString(),
      };
    }
    return snapshot;
  }

  // ─── Dead-Letter Queue ───────────────────────────────────────────────────────

  static _pushToDeadLetterQueue(entry) {
    if (deadLetterQueue.length >= DLQ_MAX_SIZE) {
      deadLetterQueue.shift(); // evict oldest
    }

    // Enhanced DLQ entry with priority classification (Task #880)
    const enhancedEntry = {
      ...entry,
      enqueuedAt: new Date().toISOString(),
      priority: this._classifyErrorPriority(entry.errorType),
      retryable: this._isRetryableError(entry.errorType),
      recommendedAction: this._getRecommendedAction(entry.errorType),
    };

    deadLetterQueue.push(enhancedEntry);
  }

  /**
   * Classify error priority for DLQ entries
   */
  static _classifyErrorPriority(errorType) {
    const highPriority = [
      "auth_error",
      "db_schema_conflict",
      "insufficient_balance",
    ];
    const mediumPriority = ["asset_not_found", "client_error"];

    if (highPriority.includes(errorType)) return "high";
    if (mediumPriority.includes(errorType)) return "medium";
    return "low";
  }

  /**
   * Determine if error type is retryable
   */
  static _isRetryableError(errorType) {
    const nonRetryable = [
      "auth_error",
      "client_error",
      "asset_not_found",
      "insufficient_balance",
      "db_schema_conflict",
    ];
    return !nonRetryable.includes(errorType);
  }

  /**
   * Get recommended action for error type
   */
  static _getRecommendedAction(errorType) {
    const actions = {
      auth_error: "Verify authentication credentials and permissions",
      asset_not_found: "Verify asset code and issuer address",
      insufficient_balance: "Check account balance and required reserves",
      network: "Retry operation - transient network issue",
      rate_limit: "Wait and retry with exponential backoff",
      timeout: "Operation may have succeeded - verify state before retry",
      db_schema_conflict: "Database migration required - contact administrator",
    };
    return actions[errorType] || "Review error details and context";
  }

  /** Returns a shallow copy of the dead-letter queue for inspection. */
  static getDeadLetterQueue() {
    return [...deadLetterQueue];
  }

  /** Drain (clear) the dead-letter queue and return its contents. */
  static drainDeadLetterQueue() {
    return deadLetterQueue.splice(0, deadLetterQueue.length);
  }

  // ─── Timeout Wrapper ─────────────────────────────────────────────────────────

  /**
   * Wraps a promise with a hard timeout.
   * Rejects with a timeout error if the operation takes longer than `ms`.
   */
  static withTimeout(promise, ms = OPERATION_TIMEOUT_MS, label = "operation") {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error(`${label} timed out after ${ms}ms`);
        err.isTimeout = true;
        reject(err);
      }, ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  // ─── Core Execution ──────────────────────────────────────────────────────────

  /**
   * Execute operation with enhanced error recovery.
   *
   * Options:
   *   timeoutMs    – hard timeout per attempt (default: OPERATION_TIMEOUT_MS)
   *   fallback     – async fn() called when all attempts fail; its return value
   *                  is returned instead of throwing (graceful degradation)
   *   maxAttempts  – override MAX_RETRY_ATTEMPTS for this call
   */
  static async executeWithRecovery(
    operation,
    context = "trustline operation",
    {
      timeoutMs = OPERATION_TIMEOUT_MS,
      fallback = null,
      maxAttempts = MAX_RETRY_ATTEMPTS,
    } = {},
  ) {
    let disposition = this._circuitBreakerDisposition(context);

    if (disposition === "probe") {
      // Half-open allows a single in-flight probe; concurrent callers are rejected
      const breaker = this._getState(context);
      if (breaker.probeInFlight) {
        disposition = "reject";
      } else {
        breaker.probeInFlight = true;
      }
    }

    if (disposition === "reject") {
      const cbError = new Error(
        `Circuit breaker is open for "${context}". Service temporarily unavailable.`,
      );
      cbError.isCircuitBreakerOpen = true;
      cbError.status = 503;

      if (fallback) {
        try {
          return await fallback(cbError);
        } catch (_) {
          /* fall through to throw */
        }
      }
      throw cbError;
    }

    // Half-open probes run exactly once (maxAttempts=1, no retry)
    const effectiveMaxAttempts = disposition === "probe" ? 1 : maxAttempts;

    let lastError = null;

    for (let attempt = 1; attempt <= effectiveMaxAttempts; attempt++) {
      try {
        const result = await this.withTimeout(
          Promise.resolve().then(() => operation()),
          timeoutMs,
          context,
        );

        this._recordSuccess(context);
        return result;
      } catch (error) {
        lastError = error;

        const errorClass = this.classifyError(error);

        if (!errorClass.retryable || attempt === effectiveMaxAttempts) {
          this._recordFailure(context, error);
          const enhanced = this.enhanceError(
            error,
            context,
            attempt,
            errorClass,
          );

          // Push to dead-letter queue for non-retryable terminal failures
          if (!errorClass.retryable) {
            this._pushToDeadLetterQueue({
              context,
              errorType: errorClass.type,
              errorMessage: error?.message,
              attempts: attempt,
            });
          }

          if (fallback) {
            try {
              return await fallback(enhanced);
            } catch (_) {
              /* fall through to throw */
            }
          }
          throw enhanced;
        }

        const delay = this.calculateRetryDelay(attempt, errorClass.priority);
        await this.sleep(delay);
      }
    }

    this._recordFailure(context, lastError);
    const finalEnhanced = this.enhanceError(
      lastError,
      context,
      effectiveMaxAttempts,
      this.classifyError(lastError),
    );

    this._pushToDeadLetterQueue({
      context,
      errorType: this.classifyError(lastError).type,
      errorMessage: lastError?.message,
      attempts: effectiveMaxAttempts,
    });

    if (fallback) {
      try {
        return await fallback(finalEnhanced);
      } catch (_) {
        /* fall through to throw */
      }
    }
    throw finalEnhanced;
  }

  // ─── Error Classification ─────────────────────────────────────────────────

  /**
   * Classify errors for appropriate recovery strategy.
   */
  static classifyError(error) {
    const message = error?.message?.toLowerCase() || "";
    const status = error?.status || error?.response?.status;

    // Timeout errors - retryable
    if (error?.isTimeout || message.includes("timed out")) {
      return {
        type: "timeout",
        retryable: true,
        priority: "high",
        reason: "Operation timed out",
      };
    }

    // Database schema errors - not retryable
    if (
      message.includes("index already exists") ||
      message.includes("relation already exists")
    ) {
      return {
        type: "db_schema_conflict",
        retryable: false,
        priority: "none",
        reason: "Database schema conflict, such as an index already existing.",
      };
    }

    // Network/connection errors - highly retryable
    if (
      message.includes("network") ||
      message.includes("timeout") ||
      message.includes("connection") ||
      message.includes("econnrefused") ||
      status === 502 ||
      status === 503 ||
      status === 504
    ) {
      return {
        type: "network",
        retryable: true,
        priority: "high",
        reason: "Network connectivity issue",
      };
    }

    // Rate limiting - retryable with longer delay
    if (status === 429 || message.includes("rate limit")) {
      return {
        type: "rate_limit",
        retryable: true,
        priority: "low",
        reason: "Rate limit exceeded",
      };
    }

    // Authentication/authorization errors - not retryable
    if (status === 401 || status === 403) {
      return {
        type: "auth_error",
        retryable: false,
        priority: "none",
        reason: "Authentication or authorization failure",
      };
    }

    // Horizon server errors - retryable
    if (typeof status === "number" && status >= 500 && status < 600) {
      return {
        type: "server_error",
        retryable: true,
        priority: "medium",
        reason: "Server error",
      };
    }

    // Trustline-specific errors
    if (message.includes("trustline") || message.includes("asset")) {
      // Asset not found - not retryable
      if (message.includes("not found") || status === 404) {
        return {
          type: "asset_not_found",
          retryable: false,
          priority: "none",
          reason: "Asset or account not found",
        };
      }

      // Insufficient balance - not retryable
      if (message.includes("insufficient") || message.includes("balance")) {
        return {
          type: "insufficient_balance",
          retryable: false,
          priority: "none",
          reason: "Insufficient balance for operation",
        };
      }
    }

    // Client errors (4xx) - generally not retryable
    if (typeof status === "number" && status >= 400 && status < 500) {
      return {
        type: "client_error",
        retryable: false,
        priority: "none",
        reason: "Client error - check request parameters",
      };
    }

    // Unknown errors - cautiously retryable
    return {
      type: "unknown",
      retryable: true,
      priority: "low",
      reason: "Unknown error type",
    };
  }

  // ─── Retry Delay ─────────────────────────────────────────────────────────────

  /**
   * Calculate retry delay with exponential backoff and ±25 % jitter.
   */
  static calculateRetryDelay(attempt, priority = "medium") {
    const multiplier = priority === "high" ? 1 : priority === "low" ? 3 : 2;
    const exponentialDelay =
      RETRY_DELAY_BASE_MS * Math.pow(2, attempt - 1) * multiplier;
    const jitter = exponentialDelay * 0.25 * (Math.random() - 0.5);
    return Math.min(exponentialDelay + jitter, 30000); // cap at 30 s
  }

  // ─── Error Enhancement ────────────────────────────────────────────────────────

  static enhanceError(originalError, context, attempts, errorClass) {
    const enhanced = new Error(
      `${context} failed after ${attempts} attempt${attempts !== 1 ? "s" : ""}: ${originalError?.message ?? String(originalError)} (${errorClass.reason})`,
    );
    enhanced.originalError = originalError;
    enhanced.context = context;
    enhanced.attempts = attempts;
    enhanced.errorClass = errorClass;
    enhanced.status = originalError?.status || 500;
    enhanced.recoverable = errorClass.retryable;
    return enhanced;
  }

  // ─── Public Circuit-Breaker API ───────────────────────────────────────────────

  /**
   * Returns true when the circuit breaker for `context` is open (backwards compat).
   * Pass no argument to check the legacy global context ('default').
   */
  static isCircuitBreakerOpen(context = "default") {
    return this._circuitBreakerDisposition(context) === "reject";
  }

  /**
   * Manually reset the circuit breaker for a given context.
   * Useful in tests and administrative endpoints.
   */
  static resetCircuitBreaker(context = null) {
    if (context) {
      circuitBreakerRegistry.delete(context);
    } else {
      // Legacy behaviour: reset all breakers
      circuitBreakerRegistry.clear();
    }
  }

  /** Return a snapshot of all circuit breaker states (for health endpoints). */
  static getCircuitBreakerMetrics() {
    const snapshot = {};
    for (const [ctx, state] of circuitBreakerRegistry.entries()) {
      snapshot[ctx] = {
        state: state.state,
        failures: state.failures,
        lastFailureTime: state.lastFailureTime,
        metrics: { ...state.metrics },
      };
    }
    return snapshot;
  }

  // ─── Compat / Helpers ─────────────────────────────────────────────────────────

  /** Legacy compatibility: record a failure on the default context. */
  static recordFailure() {
    this._recordFailure("default", null);
  }

  static async sleep(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Task #596: Optimized SQL queries for trustline data
 *
 * Provides optimized database queries for trustline-related operations:
 * - Efficient asset and issuer lookups
 * - Indexed payment queries by asset
 * - Merchant trustline statistics
 * - Performance monitoring
 */
export class TrustlineQueryOptimizer {
  /**
   * Get merchant's allowed assets with optimized query
   */
  static async getMerchantAllowedAssets(merchantId) {
    const query = `
      SELECT 
        m.id,
        m.allowed_issuers,
        m.payment_limits,
        COALESCE(
          jsonb_array_length(m.allowed_issuers), 
          0
        ) as issuer_count
      FROM merchants m 
      WHERE m.id = $1 
        AND m.deleted_at IS NULL
    `;

    return TrustlineErrorRecovery.executeWithRecovery(
      () => queryWithRetry(query, [merchantId]),
      `get merchant allowed assets for ${merchantId}`,
    );
  }

  /**
   * Get payment statistics by asset with optimized aggregation
   */
  static async getPaymentStatsByAsset(merchantId, timeframe = "24 hours") {
    const safeTimeframe = TRUSTLINE_STATS_TIMEFRAMES.has(timeframe)
      ? timeframe
      : "24 hours";
    const query = `
      SELECT 
        p.asset,
        p.asset_issuer,
        COUNT(*) as payment_count,
        SUM(p.amount) as total_volume,
        AVG(p.amount) as avg_amount,
        COUNT(CASE WHEN p.status = 'confirmed' THEN 1 END) as confirmed_count,
        COUNT(CASE WHEN p.status = 'pending' THEN 1 END) as pending_count,
        COUNT(CASE WHEN p.status = 'failed' THEN 1 END) as failed_count,
        MIN(p.created_at) as first_payment,
        MAX(p.created_at) as last_payment
      FROM payments p
      WHERE p.merchant_id = $1
        AND p.deleted_at IS NULL
        AND p.created_at >= NOW() - $2::interval
      GROUP BY p.asset, p.asset_issuer
      ORDER BY total_volume DESC, payment_count DESC
    `;

    return TrustlineErrorRecovery.executeWithRecovery(
      () => queryWithRetry(query, [merchantId, safeTimeframe]),
      `get payment stats by asset for merchant ${merchantId}`,
    );
  }

  /**
   * Find payments by asset with optimized filtering
   */
  static async findPaymentsByAsset(
    merchantId,
    assetCode,
    assetIssuer = null,
    options = {},
  ) {
    const {
      status = null,
      limit = 100,
      offset = 0,
      dateFrom = null,
      dateTo = null,
    } = options;

    let whereConditions = [
      "p.merchant_id = $1",
      "p.asset = $2",
      "p.deleted_at IS NULL",
    ];

    let params = [merchantId, assetCode];
    let paramIndex = 3;

    // Asset issuer filter
    if (assetIssuer !== null) {
      if (assetIssuer === "") {
        whereConditions.push("p.asset_issuer IS NULL");
      } else {
        whereConditions.push(`p.asset_issuer = $${paramIndex}`);
        params.push(assetIssuer);
        paramIndex++;
      }
    }

    // Status filter
    if (status) {
      whereConditions.push(`p.status = $${paramIndex}`);
      params.push(status);
      paramIndex++;
    }

    // Date range filters
    if (dateFrom) {
      whereConditions.push(`p.created_at >= $${paramIndex}`);
      params.push(dateFrom);
      paramIndex++;
    }

    if (dateTo) {
      whereConditions.push(`p.created_at <= $${paramIndex}`);
      params.push(dateTo);
      paramIndex++;
    }

    const query = `
      SELECT 
        p.id,
        p.client_id,
        p.amount,
        p.asset,
        p.asset_issuer,
        p.recipient,
        p.status,
        p.tx_id,
        p.created_at,
        p.completion_duration_seconds,
        p.metadata
      FROM payments p
      WHERE ${whereConditions.join(" AND ")}
      ORDER BY p.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    params.push(limit, offset);

    return TrustlineErrorRecovery.executeWithRecovery(
      () => queryWithRetry(query, params),
      `find payments by asset ${assetCode} for merchant ${merchantId}`,
    );
  }

  /**
   * Get trustline health metrics for monitoring
   */
  static async getTrustlineHealthMetrics(merchantId) {
    const query = `
      WITH asset_stats AS (
        SELECT 
          p.asset,
          p.asset_issuer,
          COUNT(*) as total_payments,
          COUNT(CASE WHEN p.status = 'failed' THEN 1 END) as failed_payments,
          AVG(CASE WHEN p.completion_duration_seconds IS NOT NULL 
              THEN p.completion_duration_seconds END) as avg_completion_time
        FROM payments p
        WHERE p.merchant_id = $1
          AND p.deleted_at IS NULL
          AND p.created_at >= NOW() - INTERVAL '7 days'
        GROUP BY p.asset, p.asset_issuer
      ),
      merchant_limits AS (
        SELECT 
          m.payment_limits,
          m.allowed_issuers,
          jsonb_array_length(COALESCE(m.allowed_issuers, '[]'::jsonb)) as issuer_count
        FROM merchants m
        WHERE m.id = $1
      )
      SELECT 
        a.*,
        CASE 
          WHEN a.total_payments > 0 
          THEN ROUND((a.failed_payments::numeric / a.total_payments::numeric) * 100, 2)
          ELSE 0 
        END as failure_rate_percent,
        m.issuer_count,
        CASE 
          WHEN m.allowed_issuers IS NULL OR jsonb_array_length(m.allowed_issuers) = 0 
          THEN true 
          ELSE (m.allowed_issuers ? a.asset_issuer OR a.asset = 'XLM')
        END as issuer_allowed
      FROM asset_stats a
      CROSS JOIN merchant_limits m
      ORDER BY a.total_payments DESC
    `;

    return TrustlineErrorRecovery.executeWithRecovery(
      () => queryWithRetry(query, [merchantId]),
      `get trustline health metrics for merchant ${merchantId}`,
    );
  }

  /**
   * Log trustline verification for audit trail
   */
  static async logTrustlineVerification({ merchantId, txHash, verification }) {
    const query = `
      INSERT INTO trustline_verifications (
        merchant_id,
        tx_hash,
        operation_type,
        asset_code,
        asset_issuer,
        signature_valid,
        is_multisig,
        signature_count,
        threshold_met,
        verification_reason,
        verification_metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id, created_at
    `;

    const params = [
      merchantId,
      txHash,
      verification.operationType || "unknown",
      verification.assetCode || null,
      verification.assetIssuer || null,
      verification.valid,
      verification.isMultiSig || false,
      verification.signatureCount || 0,
      verification.thresholdMet || false,
      verification.reason || null,
      JSON.stringify({
        trustlineSpecific: verification.trustlineSpecific,
        limit: verification.limit,
        timestamp: new Date().toISOString(),
      }),
    ];

    return TrustlineErrorRecovery.executeWithRecovery(
      () => queryWithRetry(query, params),
      `log trustline verification for merchant ${merchantId}`,
    );
  }

  /**
   * Optimize database indexes for trustline queries
   * Enhanced with additional performance indexes (Task #879)
   */
  static async createOptimizedIndexes() {
    const indexes = [
      // Composite index for asset-based payment queries
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_merchant_asset_status_created 
       ON payments(merchant_id, asset, status, created_at DESC) 
       WHERE deleted_at IS NULL`,

      // Index for asset issuer lookups
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_asset_issuer_created 
       ON payments(asset_issuer, created_at DESC) 
       WHERE deleted_at IS NULL AND asset_issuer IS NOT NULL`,

      // Index for merchant allowed issuers (GIN for JSONB)
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_merchants_allowed_issuers 
       ON merchants USING GIN(allowed_issuers) 
       WHERE deleted_at IS NULL`,

      // Partial index for pending payments monitoring
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_pending_created 
       ON payments(created_at DESC) 
       WHERE status = 'pending' AND deleted_at IS NULL`,

      // Task #879: Additional optimization indexes
      // Composite index for trustline health metrics queries
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_merchant_created_status_asset
       ON payments(merchant_id, created_at DESC, status, asset)
       WHERE deleted_at IS NULL`,

      // Index for failed payment analysis
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_failed_analysis
       ON payments(merchant_id, asset, asset_issuer, created_at DESC)
       WHERE status = 'failed' AND deleted_at IS NULL`,

      // Index for completion duration analysis
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_completion_duration
       ON payments(merchant_id, completion_duration_seconds, created_at DESC)
       WHERE completion_duration_seconds IS NOT NULL AND deleted_at IS NULL`,
    ];

    const results = [];
    for (const indexQuery of indexes) {
      try {
        await TrustlineErrorRecovery.executeWithRecovery(
          () => queryWithRetry(indexQuery, []),
          `create index: ${indexQuery.split(" ")[5]}`,
        );
        results.push({ success: true, query: indexQuery });
      } catch (error) {
        // If the error is a connection failure, we should not continue.
        if (error.errorClass?.type === "network") {
          throw error;
        }
        results.push({
          success: false,
          query: indexQuery,
          error: error.message,
        });
      }
    }

    return results;
  }

  /**
   * Analyze query performance for trustline operations (Task #879)
   */
  static async analyzeQueryPerformance(merchantId) {
    const query = `
      WITH query_stats AS (
        SELECT 
          'merchant_assets' as query_type,
          COUNT(*) FILTER (WHERE allowed_issuers IS NOT NULL) as indexed_count,
          AVG(pg_table_size('merchants')::bigint) as avg_table_size
        FROM merchants
        WHERE id = $1
        UNION ALL
        SELECT 
          'payment_by_asset' as query_type,
          COUNT(*) as indexed_count,
          AVG(pg_relation_size('payments')::bigint) as avg_table_size
        FROM payments
        WHERE merchant_id = $1 AND deleted_at IS NULL
      )
      SELECT 
        query_type,
        indexed_count,
        pg_size_pretty(avg_table_size::bigint) as table_size,
        CASE 
          WHEN indexed_count > 10000 THEN 'Consider partitioning'
          WHEN indexed_count > 1000 THEN 'Monitor performance'
          ELSE 'Optimal'
        END as recommendation
      FROM query_stats
    `;

    return TrustlineErrorRecovery.executeWithRecovery(
      () => queryWithRetry(query, [merchantId]),
      `analyze query performance for merchant ${merchantId}`,
    );
  }
}

/**
 * Main Trustline Manager class that orchestrates all components
 */
export class TrustlineManager {
  constructor() {
    this.signatureVerifier = new TrustlineSignatureVerifier();
    this.rateLimiter = TrustlineRateLimiter;
    this.errorRecovery = TrustlineErrorRecovery;
    this.queryOptimizer = TrustlineQueryOptimizer;
  }

  /**
   * Comprehensive trustline verification with all enhancements
   */
  async verifyTrustlineTransaction(txHash, options = {}) {
    const { expectedOperation = "changeTrust", skipCache = false } = options;

    return this.errorRecovery.executeWithRecovery(
      () =>
        this.signatureVerifier.verifyTrustlineSignature(txHash, {
          expectedOperation,
          skipCache,
        }),
      `verify trustline transaction ${txHash}`,
    );
  }

  /**
   * Get merchant trustline configuration with optimization
   */
  async getMerchantTrustlineConfig(merchantId) {
    const [allowedAssets, healthMetrics] = await Promise.all([
      this.queryOptimizer.getMerchantAllowedAssets(merchantId),
      this.queryOptimizer.getTrustlineHealthMetrics(merchantId),
    ]);

    return {
      merchant: allowedAssets.rows[0] || null,
      healthMetrics: healthMetrics.rows || [],
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Initialize trustline manager with database optimizations
   */
  async initialize() {
    try {
      const indexResults = await this.queryOptimizer.createOptimizedIndexes();
      console.log(
        "Trustline Manager initialized with database optimizations:",
        indexResults,
      );
      return { success: true, indexResults };
    } catch (error) {
      console.error("Failed to initialize Trustline Manager:", error);
      return { success: false, error: error.message };
    }
  }
}

// Export singleton instance
export const trustlineManager = new TrustlineManager();

// Export rate limiting middleware factories
export const createTrustlineRateLimits = (redisClient) => {
  const store = createRedisRateLimitStore({
    client: redisClient,
    prefix: `${RATE_LIMIT_REDIS_PREFIX}trustline:`,
  });

  return {
    operations: TrustlineRateLimiter.createTrustlineOperationRateLimit({
      store,
    }),
    verifications: TrustlineRateLimiter.createTrustlineVerificationRateLimit({
      store,
    }),
    burst: TrustlineRateLimiter.createTrustlineBurstRateLimit({ store }),
  };
};
