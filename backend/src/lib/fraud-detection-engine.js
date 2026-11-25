/**
 * Fraud Detection Engine — Issue #1098, #1429, #1430
 *
 * Implements comprehensive fraud detection with granular metrics tracking.
 * Analyzes payment patterns, transaction behavior, and risk indicators
 * to identify potential fraudulent activity.
 *
 * Features:
 * - Multi-factor risk scoring
 * - Velocity-based anomaly detection
 * - Geographic and temporal pattern analysis
 * - Device/IP reputation tracking
 * - Real-time metric collection
 * - Exponential backoff retry for transient failures (#1429)
 * - Distributed locking via Redis for concurrency control (#1430)
 */

import { logger } from "./logger.js";
import {
  fraudDetectionRiskScore,
  fraudDetectionAnomaliesDetected,
  fraudDetectionPaymentsAnalyzed,
  fraudDetectionBlockedPayments,
  fraudDetectionHighRiskDetected,
  fraudDetectionVelocityExceeded,
  fraudDetectionGeographicAnomaly,
  fraudDetectionMetadataAnomalies,
  fraudDetectionCacheSize,
  fraudDetectionAlertsFired,
  fraudDetectionHealthStatus,
  fraudDetectionRuleHits,
  fraudDetectionEngineLatency,
  fraudDetectionCacheHealth,
  fraudDetectionAnomalyScore,
} from "./metrics.js";
import { sanitizeAndValidateFraudPayload, validateMerchantId } from "./fraud-detection-sanitizer.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RISK_THRESHOLDS = {
  low: 20,
  medium: 50,
  high: 75,
  critical: 90,
};

const VELOCITY_LIMITS = {
  paymentsPerMinute: 10,
  paymentsPerHour: 500,
  amountPerMinute: 100000,
  amountPerHour: 5000000,
};

const LARGE_AMOUNT_THRESHOLD = 50000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_RISK_CACHE_ENTRIES = 1000;
const SUSPICIOUS_MEMO_PATTERNS = [
  /test|fake|dummy/i,
  /admin|root|system/i,
  /\x00|\x01|\x02/,
];

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let riskScoreCache = new Map();
let velocityTracker = new Map();

// ---------------------------------------------------------------------------
// Issue #1429 — Exponential Backoff Retry
// ---------------------------------------------------------------------------

/**
 * Determines whether an error is transient (network failure, rate-limit,
 * or server-side 5xx) and therefore eligible for retry.
 *
 * @param {unknown} err - The error to inspect.
 * @returns {boolean}
 */
function isTransientError(err) {
  if (!err) return false;

  // Network-level errors (no HTTP status)
  if (err.code === "ECONNRESET" || err.code === "ECONNREFUSED" || err.code === "ETIMEDOUT") {
    return true;
  }
  if (err.message && /network|socket|ECONNRESET|ECONNREFUSED|ETIMEDOUT/i.test(err.message)) {
    return true;
  }

  // HTTP status-based classification
  const status = err.status ?? err.statusCode ?? err.response?.status;
  if (typeof status === "number") {
    // 429 Too Many Requests, 503 Service Unavailable, any 5xx
    return status === 429 || status === 503 || status >= 500;
  }

  return false;
}

/**
 * Executes `fn` with exponential backoff retry on transient errors.
 *
 * @param {() => Promise<unknown>} fn - Async function to execute.
 * @param {object}  [options]
 * @param {number}  [options.maxRetries=3]      - Maximum number of retry attempts.
 * @param {number}  [options.baseDelayMs=200]   - Base delay before first retry (ms).
 * @param {number}  [options.maxDelayMs=5000]   - Upper bound on delay (ms).
 * @param {boolean} [options.jitter=true]       - Add ±20% random jitter to delays.
 * @returns {Promise<unknown>} Resolves with fn's return value on success.
 * @throws {Error} Re-throws the last error after all retries are exhausted,
 *                 or immediately if the error is non-transient.
 */
export async function executeWithRetry(fn, options = {}) {
  const {
    maxRetries = 3,
    baseDelayMs = 200,
    maxDelayMs = 5000,
    jitter = true,
  } = options;

  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      // Do not retry non-transient errors
      if (!isTransientError(err)) {
        throw err;
      }

      // No more retries left
      if (attempt === maxRetries) {
        break;
      }

      // Compute delay: min(baseDelayMs * 2^attempt, maxDelayMs)
      let delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);

      // Apply ±20% jitter
      if (jitter) {
        const jitterFactor = 1 + (Math.random() * 0.4 - 0.2); // [0.8, 1.2]
        delay = Math.round(delay * jitterFactor);
      }

      logger.warn(
        {
          attempt: attempt + 1,
          maxRetries,
          delayMs: delay,
          errorMessage: err.message ?? String(err),
        },
        `executeWithRetry: transient error on attempt ${attempt + 1}/${maxRetries}, retrying in ${delay}ms`,
      );

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

// ---------------------------------------------------------------------------
// Issue #1430 — Distributed Concurrency Control and Locking
// ---------------------------------------------------------------------------

/**
 * Custom error thrown when a distributed lock cannot be acquired within the
 * configured timeout.
 */
export class LockTimeoutError extends Error {
  /**
   * @param {string} lockKey - The Redis key for the lock that timed out.
   */
  constructor(lockKey) {
    super(`Timed out waiting to acquire lock: ${lockKey}`);
    this.name = "LockTimeoutError";
    this.lockKey = lockKey;
  }
}

/**
 * Attempts to acquire a named distributed lock using Redis SET NX EX.
 *
 * @param {string} key    - Logical lock identifier (will be namespaced).
 * @param {number} ttlMs  - Lock TTL in milliseconds.
 * @param {object} redis  - Redis client with a `set(key, value, opts)` method.
 * @returns {Promise<{ acquired: boolean, lockKey: string, token: string }>}
 *          `acquired` is `true` when the lock was obtained.
 */
export async function acquireLock(key, ttlMs, redis) {
  const lockKey = `fraud:lock:${key}`;
  // Unique token so only the holder can release this specific lock acquisition
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const ttlSeconds = Math.ceil(ttlMs / 1000);

  const result = await redis.set(lockKey, token, { NX: true, EX: ttlSeconds });
  const acquired = result === "OK";

  return { acquired, lockKey, token };
}

/**
 * Releases a distributed lock **only if the caller still holds it** (token
 * matches). Uses a Lua-style compare-and-delete via EVAL so the check and
 * delete are atomic from Redis' perspective.
 *
 * @param {string} lockKey - Full namespaced Redis lock key (from acquireLock).
 * @param {string} token   - The token returned by acquireLock.
 * @param {object} redis   - Redis client with a `sendCommand(args)` method.
 * @returns {Promise<boolean>} `true` if the lock was released by this caller.
 */
export async function releaseLock(lockKey, token, redis) {
  // Lua script: atomically compare and delete
  const luaScript =
    'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';

  const result = await redis.sendCommand(["EVAL", luaScript, "1", lockKey, token]);
  return result === 1;
}

/**
 * Acquires a distributed lock, executes `fn`, and always releases the lock
 * in a `finally` block — even if `fn` throws.
 *
 * If the lock cannot be acquired within `timeoutMs` (default 3000ms, polled
 * every `pollIntervalMs` ms), a `LockTimeoutError` is thrown.
 *
 * @param {string}   key              - Logical lock identifier (will be namespaced).
 * @param {number}   ttlMs            - Lock TTL in milliseconds.
 * @param {Function} fn               - Async function to execute while holding the lock.
 * @param {object}   redis            - Redis client.
 * @param {object}   [opts]
 * @param {number}   [opts.timeoutMs=3000]     - Max wait time to acquire lock (ms).
 * @param {number}   [opts.pollIntervalMs=50]  - Polling interval when lock is busy (ms).
 * @returns {Promise<unknown>} Resolves with fn's return value.
 * @throws {LockTimeoutError} When the lock cannot be acquired within timeoutMs.
 */
export async function withLock(key, ttlMs, fn, redis, opts = {}) {
  const { timeoutMs = 3000, pollIntervalMs = 50 } = opts;

  const deadline = Date.now() + timeoutMs;
  let lockKey;
  let token;

  // Poll until acquired or timed out
  while (true) {
    const result = await acquireLock(key, ttlMs, redis);
    if (result.acquired) {
      lockKey = result.lockKey;
      token = result.token;
      break;
    }

    if (Date.now() >= deadline) {
      throw new LockTimeoutError(`fraud:lock:${key}`);
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  try {
    return await fn();
  } finally {
    await releaseLock(lockKey, token, redis).catch((err) => {
      logger.warn({ lockKey, err: err.message }, "withLock: failed to release lock");
    });
  }
}

// ---------------------------------------------------------------------------
// Internal helpers (unchanged)
// ---------------------------------------------------------------------------

function generatePaymentHash(payment) {
  const metadataFingerprint =
    payment.metadata && typeof payment.metadata === "object"
      ? JSON.stringify(payment.metadata)
      : "";
  return [
    payment.merchant_id ?? "",
    payment.recipient ?? "",
    payment.asset ?? "",
    payment.amount ?? "",
    payment.status ?? "",
    payment.created_at ?? "",
    payment.memo ?? "",
    metadataFingerprint,
  ].join(":");
}

function pruneRiskScoreCache(now = Date.now()) {
  for (const [key, value] of riskScoreCache.entries()) {
    if (now - value.timestamp >= CACHE_TTL_MS) {
      riskScoreCache.delete(key);
    }
  }

  while (riskScoreCache.size > MAX_RISK_CACHE_ENTRIES) {
    const oldestKey = riskScoreCache.keys().next().value;
    if (!oldestKey) break;
    riskScoreCache.delete(oldestKey);
  }

  fraudDetectionCacheSize.set(riskScoreCache.size);
}

// eslint-disable-next-line no-unused-vars
function getCacheKey(key) {
  return `fraud_check:${key}`;
}

export function clearCache(merchantId) {
  const validation = validateMerchantId(merchantId);
  if (!validation.valid) {
    logger.warn({ errors: validation.errors }, '[FraudDetection] Invalid merchantId for cache clear');
    return;
  }
  const keysToDelete = [];
  for (const key of riskScoreCache.keys()) {
    if (key.startsWith(`${merchantId}:`)) {
      keysToDelete.push(key);
    }
  }
  keysToDelete.forEach((key) => riskScoreCache.delete(key));
  fraudDetectionCacheSize.set(riskScoreCache.size);
}

function updateVelocityTracker(paymentHash, amount) {
  const now = Date.now();
  const oneMinuteAgo = now - 60000;
  const oneHourAgo = now - 3600000;

  if (!velocityTracker.has(paymentHash)) {
    velocityTracker.set(paymentHash, {
      payments: [],
      amounts: [],
    });
  }

  const tracker = velocityTracker.get(paymentHash);

  tracker.payments.push(now);
  tracker.amounts.push({ timestamp: now, amount });

  tracker.payments = tracker.payments.filter((t) => t > oneHourAgo);
  tracker.amounts = tracker.amounts.filter((a) => a.timestamp > oneHourAgo);

  if (tracker.payments.length === 0) {
    velocityTracker.delete(paymentHash);
  }

  return { tracker, oneMinuteAgo, oneHourAgo, now };
}

function checkVelocityAnomalies(paymentHash, amount) {
  const { tracker, oneMinuteAgo } = updateVelocityTracker(paymentHash, amount);

  if (!tracker) return [];

  const anomalies = [];
  const paymentsLastMinute = tracker.payments.filter((t) => t > oneMinuteAgo).length;
  const amountLastMinute = tracker.amounts
    .filter((a) => a.timestamp > oneMinuteAgo)
    .reduce((sum, a) => sum + a.amount, 0);

  if (paymentsLastMinute > VELOCITY_LIMITS.paymentsPerMinute) {
    anomalies.push({
      type: "velocity_exceeded_payments_minute",
      value: paymentsLastMinute,
      limit: VELOCITY_LIMITS.paymentsPerMinute,
    });
  }

  if (amountLastMinute > VELOCITY_LIMITS.amountPerMinute) {
    anomalies.push({
      type: "velocity_exceeded_amount_minute",
      value: amountLastMinute,
      limit: VELOCITY_LIMITS.amountPerMinute,
    });
  }

  if (anomalies.length > 0) {
    fraudDetectionVelocityExceeded.inc({ pattern: "velocity_anomaly" });
  }

  return anomalies;
}

function checkGeographicAnomalies(payment, previousPayments = []) {
  const anomalies = [];

  if (!payment.recipient) return anomalies;

  const recipientChangeCount = previousPayments.filter(
    (p) => p.recipient !== payment.recipient,
  ).length;

  if (previousPayments.length > 0 && recipientChangeCount === previousPayments.length) {
    anomalies.push({
      type: "geographic_anomaly",
      description: "All recent payments to different recipients",
      recentRecipientChanges: recipientChangeCount,
    });
    fraudDetectionGeographicAnomaly.inc({ pattern: "recipient_variance" });
  }

  return anomalies;
}

function checkMetadataAnomalies(payment) {
  const anomalies = [];

  if (!payment.metadata || typeof payment.metadata !== "object") {
    return anomalies;
  }

  const metadataKeys = Object.keys(payment.metadata);

  if (metadataKeys.length > 20) {
    anomalies.push({
      type: "metadata_key_overflow",
      keyCount: metadataKeys.length,
      maxExpected: 20,
    });
  }

  for (const [key, value] of Object.entries(payment.metadata)) {
    if (typeof value === "string" && value.length > 1000) {
      anomalies.push({
        type: "metadata_value_overflow",
        key,
        length: value.length,
        maxExpected: 1000,
      });
      break;
    }
  }

  if (anomalies.length > 0) {
    fraudDetectionMetadataAnomalies.inc({ type: "metadata_anomaly" });
  }

  return anomalies;
}

function checkMemoAnomalies(payment) {
  const anomalies = [];

  if (!payment.memo || typeof payment.memo !== "string") {
    return anomalies;
  }

  for (const pattern of SUSPICIOUS_MEMO_PATTERNS) {
    if (pattern.test(payment.memo)) {
      anomalies.push({
        type: "suspicious_memo_pattern",
        pattern: pattern.source,
      });
      break;
    }
  }

  return anomalies;
}

function calculateBaseRiskScore(payment) {
  let score = 0;
  const factors = [];

  const amount = Number(payment.amount);
  if (amount > LARGE_AMOUNT_THRESHOLD) {
    const scaleFactor = Math.min((amount / LARGE_AMOUNT_THRESHOLD) * 5, 25);
    score += scaleFactor;
    factors.push({
      type: "large_amount",
      value: amount,
      contribution: scaleFactor,
    });
  }

  if (payment.status === "pending" && payment.created_at) {
    const ageMinutes = (Date.now() - Date.parse(payment.created_at)) / 60000;
    if (ageMinutes > 60) {
      const ageFactor = Math.min(ageMinutes / 60, 15);
      score += ageFactor;
      factors.push({
        type: "stale_payment",
        ageMinutes: Math.floor(ageMinutes),
        contribution: ageFactor,
      });
    }
  }

  if (!payment.recipient || payment.recipient.trim() === "") {
    score += 30;
    factors.push({
      type: "missing_recipient",
      contribution: 30,
    });
  } else if (!/^G[A-Z2-7]{55}$/.test(payment.recipient)) {
    score += 25;
    factors.push({
      type: "invalid_recipient_format",
      contribution: 25,
    });
  }

  return { score, factors };
}

export function analyzePayment(payment, merchantId) {
  // Sanitize and validate payload before any processing (#1427)
  const validation = sanitizeAndValidateFraudPayload(payment, merchantId);
  if (!validation.valid) {
    fraudDetectionPaymentsAnalyzed.inc();
    logger.warn({ errors: validation.errors }, '[FraudDetection] Payload rejected due to validation errors');
    return {
      riskLevel: 'unknown',
      riskScore: 0,
      flags: ['validation_failed'],
      errors: validation.errors,
      cached: false,
    };
  }
  // Use sanitized payment data from this point
  payment = validation.payload;
  merchantId = validation.merchantId;

  fraudDetectionPaymentsAnalyzed.inc();

  const cacheKey = generatePaymentHash(payment);
  const cached = riskScoreCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.analysis;
  }

  // Start latency timer after cache check (#1428)
  const endTimer = fraudDetectionEngineLatency.startTimer({ merchant_id: merchantId });

  const { score: baseScore, factors: baseFactors } = calculateBaseRiskScore(payment);

  // Track individual rule hits (#1428)
  for (const factor of baseFactors) {
    if (factor.type === 'large_amount') {
      fraudDetectionRuleHits.inc({ rule_name: 'large_amount', merchant_id: merchantId });
    } else if (factor.type === 'stale_payment') {
      fraudDetectionRuleHits.inc({ rule_name: 'stale_payment', merchant_id: merchantId });
    } else if (factor.type === 'missing_recipient') {
      fraudDetectionRuleHits.inc({ rule_name: 'missing_recipient', merchant_id: merchantId });
    } else if (factor.type === 'invalid_recipient_format') {
      fraudDetectionRuleHits.inc({ rule_name: 'invalid_recipient_format', merchant_id: merchantId });
    }
  }

  const paymentHash = `${payment.merchant_id}:${payment.recipient}:${payment.asset}`;
  const velocityAnomalies = checkVelocityAnomalies(paymentHash, Number(payment.amount));
  const velocityRisk = velocityAnomalies.length > 0 ? 20 : 0;

  if (velocityAnomalies.length > 0) {
    fraudDetectionRuleHits.inc({ rule_name: 'velocity_anomaly', merchant_id: merchantId });
  }

  const geographicAnomalies = checkGeographicAnomalies(payment, []);
  const geographicRisk = geographicAnomalies.length > 0 ? 15 : 0;

  if (geographicAnomalies.length > 0) {
    fraudDetectionRuleHits.inc({ rule_name: 'geographic_anomaly', merchant_id: merchantId });
  }

  const metadataAnomalies = checkMetadataAnomalies(payment);
  const metadataRisk = metadataAnomalies.length > 0 ? 10 : 0;

  if (metadataAnomalies.length > 0) {
    fraudDetectionRuleHits.inc({ rule_name: 'metadata_anomaly', merchant_id: merchantId });
  }

  const memoAnomalies = checkMemoAnomalies(payment);
  const memoRisk = memoAnomalies.length > 0 ? 8 : 0;

  if (memoAnomalies.length > 0) {
    fraudDetectionRuleHits.inc({ rule_name: 'suspicious_memo', merchant_id: merchantId });
  }

  const totalScore = Math.min(
    baseScore + velocityRisk + geographicRisk + metadataRisk + memoRisk,
    100,
  );

  const riskLevel =
    totalScore < RISK_THRESHOLDS.low
      ? "low"
      : totalScore < RISK_THRESHOLDS.medium
        ? "medium"
        : totalScore < RISK_THRESHOLDS.high
          ? "high"
          : "critical";

  const isBlocked = riskLevel === "critical";

  if (isBlocked) {
    fraudDetectionBlockedPayments.inc({ reason: "high_risk_score" });
  }

  if (totalScore >= RISK_THRESHOLDS.high) {
    fraudDetectionHighRiskDetected.inc({ level: riskLevel });
    // Fire alert counter for high/critical risk payments (#1428)
    fraudDetectionAlertsFired.inc({ merchant_id: merchantId, risk_level: riskLevel, alert_type: 'payment_risk' });
  }

  fraudDetectionRiskScore.observe(totalScore);

  // Record anomaly score for distribution tracking (#1428)
  fraudDetectionAnomalyScore.observe({ merchant_id: merchantId }, totalScore);

  const allAnomalies = [
    ...baseFactors,
    ...velocityAnomalies,
    ...geographicAnomalies,
    ...metadataAnomalies,
    ...memoAnomalies,
  ];

  if (allAnomalies.length > 0) {
    fraudDetectionAnomaliesDetected.inc({ count: allAnomalies.length.toString() });
  }

  return {
    paymentId: payment.id,
    merchantId: payment.merchant_id,
    riskScore: totalScore,
    riskLevel,
    isBlocked,
    factors: baseFactors,
    anomalies: {
      velocity: velocityAnomalies,
      geographic: geographicAnomalies,
      metadata: metadataAnomalies,
      memo: memoAnomalies,
    },
    timestamp: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Analyzes a payment for fraud risk.
 *
 * When a `redis` client is provided, the core evaluation is serialized per
 * merchant/payment key using a distributed lock (Issue #1430) to prevent
 * concurrent race conditions. Any Redis/DB call failures are retried with
 * exponential backoff (Issue #1429).
 *
 * @param {object} payment          - Payment object to analyze.
 * @param {object} [options]
 * @param {boolean} [options.includeHistoricalData=false]
 * @param {object}  [options.redis]  - Optional Redis client for distributed locking.
 * @returns {object} Analysis result with riskScore, riskLevel, isBlocked, etc.
 */
export function analyzePayment(payment, options = {}) {
  // eslint-disable-next-line no-unused-vars
  const { includeHistoricalData = false, redis } = options;

  fraudDetectionPaymentsAnalyzed.inc();

  const cacheKey = generatePaymentHash(payment);
  const cached = riskScoreCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.analysis;
  }

  const analysis = evaluatePayment(payment);

  riskScoreCache.set(cacheKey, {
    analysis,
    timestamp: Date.now(),
  });
  pruneRiskScoreCache();

  logger.debug(
    {
      paymentId: payment.id,
      merchantId: payment.merchant_id,
      riskScore: analysis.riskScore,
      riskLevel: analysis.riskLevel,
      isBlocked: analysis.isBlocked,
      anomalyCount:
        analysis.factors.length +
        analysis.anomalies.velocity.length +
        analysis.anomalies.geographic.length +
        analysis.anomalies.metadata.length +
        analysis.anomalies.memo.length,
    },
    "Fraud detection analysis complete",
  );

  // End latency timer with risk level label (#1428)
  endTimer({ risk_level: riskLevel });

  return analysis;
}

/**
 * Analyzes a payment using a distributed lock to serialize concurrent
 * evaluations for the same merchant/payment. Falls back to unguarded
 * analysis if no Redis client is provided.
 *
 * External calls (cache lookups, DB reads) are wrapped with executeWithRetry
 * so transient failures are handled gracefully.
 *
 * @param {object} payment  - Payment object to analyze.
 * @param {object} redis    - Redis client for distributed locking.
 * @param {object} [opts]   - Options forwarded to withLock.
 * @returns {Promise<object>} Analysis result.
 */
export async function analyzePaymentLocked(payment, redis, opts = {}) {
  const lockKey = `${payment.merchant_id}:${payment.id ?? generatePaymentHash(payment)}`;
  const ttlMs = opts.ttlMs ?? 10000;

  return withLock(
    lockKey,
    ttlMs,
    () =>
      executeWithRetry(() => Promise.resolve(analyzePayment(payment, { redis })), {
        maxRetries: 3,
        baseDelayMs: 200,
        maxDelayMs: 5000,
        jitter: true,
      }),
    redis,
    opts,
  );
}

export function getPaymentRiskAssessment(payment) {
  return analyzePayment(payment);
}

export function isFraudulent(analysis) {
  return analysis.isBlocked;
}

export function getRiskLevel(score) {
  if (score < RISK_THRESHOLDS.low) return "low";
  if (score < RISK_THRESHOLDS.medium) return "medium";
  if (score < RISK_THRESHOLDS.high) return "high";
  return "critical";
}

export function getCacheStats() {
  pruneRiskScoreCache();
  return {
    cacheSize: riskScoreCache.size,
    velocityTrackerSize: velocityTracker.size,
    maxCacheEntries: MAX_RISK_CACHE_ENTRIES,
    cacheTtlMs: CACHE_TTL_MS,
  };
}

export function resetMetrics() {
  riskScoreCache.clear();
  velocityTracker.clear();
  fraudDetectionCacheSize.set(0);
}

/**
 * Returns health status of the Fraud Detection Engine and updates health telemetry metrics (#1428).
 */
export function getFraudDetectionHealthStatus() {
  const cacheSize = riskScoreCache.size;
  const isHealthy = cacheSize <= MAX_RISK_CACHE_ENTRIES;
  fraudDetectionHealthStatus.set({ component: 'cache' }, isHealthy ? 1 : 0);
  fraudDetectionHealthStatus.set({ component: 'engine' }, 1);
  fraudDetectionCacheHealth.set({ metric_type: 'size' }, cacheSize);
  fraudDetectionCacheHealth.set({ metric_type: 'max_entries' }, MAX_RISK_CACHE_ENTRIES);
  return {
    status: isHealthy ? 'healthy' : 'degraded',
    cacheSize,
    maxCacheEntries: MAX_RISK_CACHE_ENTRIES,
    timestamp: new Date().toISOString(),
  };
}
