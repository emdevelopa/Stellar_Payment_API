/**
 * payment-session-validator.js
 *
 * Instrumented entry point for payment session validation (issues #1447,
 * #1448). Wraps the pure rules in payment-session-rules.js with:
 *
 *   - payload sanitization + strict validation, run before business rules
 *   - Prometheus metrics (payment-session-validator-metrics.js)
 *   - structured logging of rejections and suspicious payloads
 *   - a rolling-window health monitor exposed via /health and gauges
 *
 * Rule order (first failure wins):
 *
 *   sanitization → payload (asset, amount) → issuer → limits → allowlist
 *
 * All checks are synchronous and free of network I/O, so callers should run
 * this before anything expensive (e.g. on-chain issuer lookups).
 *
 * Logs never include the raw payload — only the rule, reason, call site and
 * merchant id — so attacker-controlled content does not reach log sinks.
 */

import { logger } from "./logger.js";
import {
  sanitizeSessionPayload,
  validateSessionAsset,
  validateSessionAmount,
  inspectPaymentLimitsConfig,
  resolveAndValidateIssuer,
  validatePerAssetLimits,
  validateAllowedIssuers,
} from "./payment-session-rules.js";
import {
  sessionValidatorEvaluationsTotal,
  sessionValidatorRejectionsTotal,
  sessionValidatorDuration,
  sessionValidatorSanitizedFieldsTotal,
  sessionValidatorSuspiciousPayloadsTotal,
  sessionValidatorConfigAnomaliesTotal,
  sessionValidatorHealthState,
  sessionValidatorRejectionRatio,
  sessionValidatorErrorRatio,
  sessionValidatorLastEvaluationTimestamp,
} from "./payment-session-validator-metrics.js";

const KNOWN_SOURCES = new Set(["http", "service"]);

const HEALTH_STATE_VALUES = { healthy: 0, degraded: 1, unhealthy: 2 };

function readNumberEnv(name, fallback) {
  const raw = Number.parseFloat(process.env[name] ?? "");
  return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
}

export const DEFAULT_HEALTH_OPTIONS = Object.freeze({
  windowMs: readNumberEnv("PAYMENT_SESSION_VALIDATOR_HEALTH_WINDOW_MS", 300_000),
  bucketMs: 5_000,
  minSamples: readNumberEnv("PAYMENT_SESSION_VALIDATOR_HEALTH_MIN_SAMPLES", 20),
  errorRatioThreshold: readNumberEnv("PAYMENT_SESSION_VALIDATOR_ERROR_RATIO_THRESHOLD", 0.05),
  rejectionRatioThreshold: readNumberEnv("PAYMENT_SESSION_VALIDATOR_REJECTION_RATIO_THRESHOLD", 0.5),
  suspiciousThreshold: readNumberEnv("PAYMENT_SESSION_VALIDATOR_SUSPICIOUS_THRESHOLD", 10),
});

/**
 * Rolling-window health tracker. Counts are kept in fixed-size time buckets
 * so memory stays constant regardless of traffic.
 */
export class SessionValidatorHealthMonitor {
  constructor(options = {}, now = () => Date.now()) {
    this.options = { ...DEFAULT_HEALTH_OPTIONS, ...options };
    this.now = now;
    this.bucketCount = Math.max(1, Math.ceil(this.options.windowMs / this.options.bucketMs));
    this.reset();
  }

  reset() {
    this.buckets = Array.from({ length: this.bucketCount }, () => ({
      slot: -1,
      accepted: 0,
      rejected: 0,
      errors: 0,
      suspicious: 0,
    }));
    this.lastEvaluationAt = null;
  }

  _bucketFor(time) {
    const slot = Math.floor(time / this.options.bucketMs);
    const bucket = this.buckets[slot % this.bucketCount];
    if (bucket.slot !== slot) {
      bucket.slot = slot;
      bucket.accepted = 0;
      bucket.rejected = 0;
      bucket.errors = 0;
      bucket.suspicious = 0;
    }
    return bucket;
  }

  /**
   * @param {"accepted"|"rejected"|"error"} outcome
   * @param {{ suspicious?: boolean }} [flags]
   */
  record(outcome, { suspicious = false } = {}) {
    const time = this.now();
    const bucket = this._bucketFor(time);
    if (outcome === "accepted") bucket.accepted++;
    else if (outcome === "rejected") bucket.rejected++;
    else bucket.errors++;
    if (suspicious) bucket.suspicious++;
    this.lastEvaluationAt = time;
  }

  snapshot() {
    const time = this.now();
    const currentSlot = Math.floor(time / this.options.bucketMs);
    const oldestSlot = currentSlot - this.bucketCount + 1;
    const counts = { accepted: 0, rejected: 0, errors: 0, suspicious: 0 };

    for (const bucket of this.buckets) {
      if (bucket.slot < oldestSlot || bucket.slot > currentSlot) continue;
      counts.accepted += bucket.accepted;
      counts.rejected += bucket.rejected;
      counts.errors += bucket.errors;
      counts.suspicious += bucket.suspicious;
    }

    const total = counts.accepted + counts.rejected + counts.errors;
    const rejectionRatio = total > 0 ? counts.rejected / total : 0;
    const errorRatio = total > 0 ? counts.errors / total : 0;
    const { minSamples, errorRatioThreshold, rejectionRatioThreshold, suspiciousThreshold } =
      this.options;

    const reasons = [];
    let status = "healthy";
    if (total >= minSamples && errorRatio >= errorRatioThreshold) {
      status = "unhealthy";
      reasons.push("error_ratio_exceeded");
    }
    if (total >= minSamples && rejectionRatio >= rejectionRatioThreshold) {
      if (status === "healthy") status = "degraded";
      reasons.push("rejection_ratio_exceeded");
    }
    if (counts.suspicious >= suspiciousThreshold) {
      if (status === "healthy") status = "degraded";
      reasons.push("suspicious_payload_spike");
    }

    return {
      status,
      reasons,
      window_ms: this.bucketCount * this.options.bucketMs,
      total,
      ...counts,
      rejection_ratio: Number(rejectionRatio.toFixed(4)),
      error_ratio: Number(errorRatio.toFixed(4)),
      last_evaluation_at:
        this.lastEvaluationAt === null ? null : new Date(this.lastEvaluationAt).toISOString(),
      thresholds: {
        min_samples: minSamples,
        error_ratio: errorRatioThreshold,
        rejection_ratio: rejectionRatioThreshold,
        suspicious: suspiciousThreshold,
      },
    };
  }
}

const healthMonitor = new SessionValidatorHealthMonitor();

// Refresh rolling-window gauges at scrape time so they decay when idle.
sessionValidatorHealthState.collect = function collectHealthState() {
  const snap = healthMonitor.snapshot();
  this.set(HEALTH_STATE_VALUES[snap.status]);
  sessionValidatorRejectionRatio.set(snap.rejection_ratio);
  sessionValidatorErrorRatio.set(snap.error_ratio);
};

/** Current validator health, for /health endpoints. */
export function getPaymentSessionValidatorHealth() {
  return healthMonitor.snapshot();
}

/** Test-only: clear the rolling health window. */
export function resetPaymentSessionValidatorHealth() {
  healthMonitor.reset();
}

/**
 * Validate a payment session request.
 *
 * @param {object} params
 * @param {unknown} params.body       Request body (already schema-parsed on HTTP)
 * @param {object} params.merchant    Merchant record (payment_limits, allowed_issuers, id)
 * @param {"http"|"service"} [params.source] Call site, used as a metric label
 * @returns {{ ok: true, payload: object, asset: string, assetIssuer: string|null }
 *   | { ok: false, rejection: { rule: string, reason: string, message: string, details?: object } }}
 * @throws Re-throws unexpected internal errors after recording them.
 */
export function validatePaymentSession({ body, merchant, source = "unknown" }) {
  const label = KNOWN_SOURCES.has(source) ? source : "unknown";
  const startedAt = process.hrtime.bigint();
  let suspicious = false;

  const finish = (outcome) => {
    const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
    sessionValidatorEvaluationsTotal.inc({ source: label, outcome });
    sessionValidatorDuration.observe({ source: label, outcome }, seconds);
    sessionValidatorLastEvaluationTimestamp.set(Date.now() / 1000);
    healthMonitor.record(outcome, { suspicious });
  };

  const reject = (rule, rejection) => {
    sessionValidatorRejectionsTotal.inc({ source: label, rule, reason: rejection.reason });
    finish("rejected");
    logger.info(
      { merchantId: merchant?.id, source: label, rule, reason: rejection.reason },
      "Payment session rejected by validator",
    );
    return { ok: false, rejection: { rule, ...rejection } };
  };

  try {
    const sanitized = sanitizeSessionPayload(body);

    for (const field of sanitized.modifiedFields) {
      sessionValidatorSanitizedFieldsTotal.inc({ field });
    }
    if (sanitized.suspicious.length > 0) {
      suspicious = true;
      for (const signal of sanitized.suspicious) {
        sessionValidatorSuspiciousPayloadsTotal.inc({ signal });
      }
      logger.warn(
        { merchantId: merchant?.id, source: label, signals: sanitized.suspicious },
        "Suspicious payment session payload",
      );
    }
    if (sanitized.rejection) {
      return reject("sanitization", sanitized.rejection);
    }

    const payload = sanitized.payload;
    const asset = payload.asset?.toUpperCase();

    const payloadRejection = validateSessionAsset(asset) || validateSessionAmount(payload.amount);
    if (payloadRejection) {
      return reject("payload", payloadRejection);
    }

    const { assetIssuer, rejection: issuerRejection } = resolveAndValidateIssuer(
      asset,
      payload.asset_issuer,
    );
    if (issuerRejection) {
      return reject("issuer", issuerRejection);
    }

    const anomalies = inspectPaymentLimitsConfig({
      rawAsset: payload.asset,
      paymentLimits: merchant?.payment_limits,
    });
    if (anomalies.length > 0) {
      for (const kind of anomalies) {
        sessionValidatorConfigAnomaliesTotal.inc({ kind });
      }
      logger.warn(
        { merchantId: merchant?.id, source: label, anomalies },
        "Merchant payment_limits misconfigured; affected bounds are ignored",
      );
    }

    const limitRejection = validatePerAssetLimits({
      rawAsset: payload.asset,
      amount: payload.amount,
      paymentLimits: merchant?.payment_limits,
    });
    if (limitRejection) {
      return reject("limits", limitRejection);
    }

    const allowlistRejection = validateAllowedIssuers({
      asset,
      assetIssuer,
      allowedIssuers: merchant?.allowed_issuers,
    });
    if (allowlistRejection) {
      return reject("allowlist", allowlistRejection);
    }

    finish("accepted");
    return { ok: true, payload, asset, assetIssuer };
  } catch (err) {
    finish("error");
    logger.error(
      { err, merchantId: merchant?.id, source: label },
      "Payment session validator failed unexpectedly",
    );
    throw err;
  }
}
