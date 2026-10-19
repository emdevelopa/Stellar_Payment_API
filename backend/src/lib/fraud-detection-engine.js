/**
 * Fraud Detection Engine — Issue #1098
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

let riskScoreCache = new Map();
let velocityTracker = new Map();

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
  const { tracker, oneMinuteAgo, now } = updateVelocityTracker(paymentHash, amount);

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

  const analysis = {
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

  riskScoreCache.set(cacheKey, {
    analysis,
    timestamp: Date.now(),
  });
  pruneRiskScoreCache();

  logger.debug(
    {
      paymentId: payment.id,
      merchantId: payment.merchant_id,
      riskScore: totalScore,
      riskLevel,
      isBlocked,
      anomalyCount: allAnomalies.length,
    },
    "Fraud detection analysis complete",
  );

  // End latency timer with risk level label (#1428)
  endTimer({ risk_level: riskLevel });

  return analysis;
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
