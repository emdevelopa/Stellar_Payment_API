import client from "prom-client";

/**
 * Granular Trustline Manager metrics (issue #1043).
 *
 * The coarse Trustline Manager observability surface (recovery metrics and
 * circuit breaker snapshots) already lives in trustline-manager.js. This
 * module tracks FINE-GRAINED series those in-memory snapshots cannot answer:
 *
 *   - Signature verification outcomes (valid / invalid / error) and latency
 *   - Verification cache effectiveness
 *   - Rate limit rejections per limiter track (burst / operations / verify)
 *   - Circuit breaker state and failure counts per context
 *   - Error recovery outcomes (success / failure) per context
 *   - Dead-letter queue depth and entries by error type
 *
 * The metrics are kept in their own registry so they can be unit-tested in
 * isolation; the /metrics endpoint merges this registry with the main one.
 */

const register = new client.Registry();

register.setDefaultLabels({
  app: "stellar-payment-api",
});

/**
 * Signature verification outcomes.
 * outcome: valid | invalid | error
 */
export const trustlineSignatureVerificationsTotal = new client.Counter({
  name: "trustline_signature_verifications_total",
  help: "Total number of trustline signature verifications, by outcome",
  labelNames: ["outcome"],
});

/** Wall-clock time to execute a trustline signature verification. */
export const trustlineSignatureVerificationDuration = new client.Histogram({
  name: "trustline_signature_verification_duration_seconds",
  help: "Duration of trustline signature verification attempts in seconds",
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

/** Read-through cache effectiveness for trustline signature verification. */
export const trustlineSignatureVerificationCacheHits = new client.Counter({
  name: "trustline_signature_verification_cache_hits_total",
  help: "Total number of trustline signature verifications served from cache",
});

/**
 * Rate limit rejections.
 * limiter: burst | operations | verifications
 */
export const trustlineRateLimitRejectionsTotal = new client.Counter({
  name: "trustline_rate_limit_rejections_total",
  help: "Total number of rejected trustline requests, by limiter track",
  labelNames: ["limiter"],
});

/** Circuit breaker open flag per context (1 = open, 0 = closed). */
export const trustlineCircuitBreakerOpen = new client.Gauge({
  name: "trustline_circuit_breaker_open",
  help: "Whether the per-context trustline circuit breaker is open",
  labelNames: ["context"],
});

/** Current consecutive failure count per circuit breaker context. */
export const trustlineCircuitBreakerFailures = new client.Gauge({
  name: "trustline_circuit_breaker_failures",
  help: "Current consecutive failure count per trustline circuit breaker context",
  labelNames: ["context"],
});

/**
 * Error recovery outcomes.
 * outcome: success | failure
 */
export const trustlineErrorRecoveryTotal = new client.Counter({
  name: "trustline_error_recovery_total",
  help: "Total number of trustline operation recovery outcomes, by context",
  labelNames: ["context", "outcome"],
});

/** Current in-memory dead-letter queue depth. */
export const trustlineDeadLetterQueueDepth = new client.Gauge({
  name: "trustline_dead_letter_queue_depth",
  help: "Number of trustline operations waiting in the dead-letter queue",
});

/**
 * Dead-letter queue entries.
 */
export const trustlineDeadLetterQueueEntriesTotal = new client.Counter({
  name: "trustline_dead_letter_queue_entries_total",
  help: "Total number of trustline operations pushed to the dead-letter queue, by error type",
  labelNames: ["error_type"],
});

register.registerMetric(trustlineSignatureVerificationsTotal);
register.registerMetric(trustlineSignatureVerificationDuration);
register.registerMetric(trustlineSignatureVerificationCacheHits);
register.registerMetric(trustlineRateLimitRejectionsTotal);
register.registerMetric(trustlineCircuitBreakerOpen);
register.registerMetric(trustlineCircuitBreakerFailures);
register.registerMetric(trustlineErrorRecoveryTotal);
register.registerMetric(trustlineDeadLetterQueueDepth);
register.registerMetric(trustlineDeadLetterQueueEntriesTotal);

/**
 * Record one trustline signature verification attempt.
 * @param {"valid"|"invalid"|"error"} outcome
 * @param {number} [durationSeconds]
 */
export function recordTrustlineSignatureVerification(
  outcome,
  durationSeconds,
) {
  trustlineSignatureVerificationsTotal.inc({ outcome });
  if (typeof durationSeconds === "number" && Number.isFinite(durationSeconds)) {
    trustlineSignatureVerificationDuration.observe(durationSeconds);
  }
}

/** Record a signature verification served from the in-memory cache. */
export function recordTrustlineSignatureCacheHit() {
  trustlineSignatureVerificationCacheHits.inc();
}

/**
 * Record a rejected trustline request.
 * @param {"burst"|"operations"|"verifications"} limiter
 */
export function recordTrustlineRateLimitRejection(limiter) {
  trustlineRateLimitRejectionsTotal.inc({ limiter });
}

/**
 * Publish the current circuit breaker state for a context.
 * @param {string} context
 * @param {boolean} isOpen
 * @param {number} failures
 */
export function setTrustlineCircuitBreakerState(context, isOpen, failures) {
  trustlineCircuitBreakerOpen.set({ context }, isOpen ? 1 : 0);
  trustlineCircuitBreakerFailures.set({ context }, failures);
}

/**
 * Record a trustline operation recovery outcome.
 * @param {string} context
 * @param {boolean} success
 */
export function recordTrustlineRecoveryOutcome(context, success) {
  trustlineErrorRecoveryTotal.inc({ context, outcome: success ? "success" : "failure" });
}

/**
 * Publish dead-letter queue depth and record a newly enqueued entry.
 * @param {number} depth
 * @param {string} errorType
 */
export function recordTrustlineDeadLetterEntry(depth, errorType) {
  trustlineDeadLetterQueueDepth.set(depth);
  trustlineDeadLetterQueueEntriesTotal.inc({ error_type: errorType });
}

/** Publish the dead-letter queue depth after a drain. */
export function setTrustlineDeadLetterQueueDepth(depth) {
  trustlineDeadLetterQueueDepth.set(depth);
}

/** Reset all granular series — test use only. */
export function resetTrustlineManagerMetrics() {
  trustlineSignatureVerificationsTotal.reset();
  trustlineSignatureVerificationDuration.reset();
  trustlineSignatureVerificationCacheHits.reset();
  trustlineRateLimitRejectionsTotal.reset();
  trustlineCircuitBreakerOpen.reset();
  trustlineCircuitBreakerFailures.reset();
  trustlineErrorRecoveryTotal.reset();
  trustlineDeadLetterQueueDepth.reset();
  trustlineDeadLetterQueueEntriesTotal.reset();
}

export { register as trustlineManagerRegister };
