import client from "prom-client";

/**
 * Granular Payment Processor metrics (issue #1088).
 *
 * The coarse lifecycle counters (payment_created_total, payment_confirmed_total,
 * payment_failed_total, payment_confirmation_latency_seconds) already live in
 * lib/metrics.js. This module tracks FINE-GRAINED processor internals that the
 * coarse series cannot answer:
 *
 *   - WHY a session creation failed (validation vs persistence)
 *   - HOW LONG each processor stage takes, per outcome
 *   - Verification outcome breakdown (underpayment, overpayment, signature
 *     rejection, tx-claim race conflicts, no-match polls)
 *   - Status-poll cache effectiveness
 *   - Refund funnel progression (generate → confirm) and rejections
 *
 * The metrics are kept in their own registry so they can be unit-tested in
 * isolation; the /metrics endpoint merges this registry with the main one.
 */

const register = new client.Registry();

register.setDefaultLabels({
  app: "stellar-payment-api",
});

/**
 * Session creation outcomes.
 * outcome: created | validation_failed | persistence_failed | sandbox_skipped
 */
export const paymentProcessorSessionsTotal = new client.Counter({
  name: "payment_processor_sessions_total",
  help: "Total number of payment session creations processed, by outcome",
  labelNames: ["asset", "outcome"],
});

/** Wall-clock time to execute a session creation attempt. */
export const paymentProcessorSessionDuration = new client.Histogram({
  name: "payment_processor_session_duration_seconds",
  help: "Duration of payment session creation attempts in seconds",
  labelNames: ["asset", "outcome"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});

/**
 * Payment verification outcomes.
 * outcome: confirmed | already_confirmed | pending_no_match | signature_invalid
 *        | underpayment | overpayment | tx_claim_conflict | error
 */
export const paymentProcessorVerificationsTotal = new client.Counter({
  name: "payment_processor_verifications_total",
  help: "Total number of payment verification attempts, by outcome",
  labelNames: ["asset", "outcome"],
});

export const paymentProcessorVerificationDuration = new client.Histogram({
  name: "payment_processor_verification_duration_seconds",
  help: "Duration of payment verification attempts in seconds",
  labelNames: ["asset", "outcome"],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

/** Read-through cache effectiveness for payment status polling. */
export const paymentProcessorStatusCacheHits = new client.Counter({
  name: "payment_processor_status_cache_hits_total",
  help: "Total number of payment status reads served from cache",
});

export const paymentProcessorStatusCacheMisses = new client.Counter({
  name: "payment_processor_status_cache_misses_total",
  help: "Total number of payment status reads that missed the cache",
});

/**
 * Refund funnel.
 * stage: generate | confirm ; outcome: success | rejected | error
 */
export const paymentProcessorRefundsTotal = new client.Counter({
  name: "payment_processor_refunds_total",
  help: "Total number of refund operations, by stage and outcome",
  labelNames: ["stage", "outcome"],
});

/**
 * Paginated payments list requests.
 * outcome: success | pool_fallback | error
 */
export const paymentProcessorListRequestsTotal = new client.Counter({
  name: "payment_processor_list_requests_total",
  help: "Total number of merchant payments list requests, by outcome",
  labelNames: ["outcome"],
});

register.registerMetric(paymentProcessorSessionsTotal);
register.registerMetric(paymentProcessorSessionDuration);
register.registerMetric(paymentProcessorVerificationsTotal);
register.registerMetric(paymentProcessorVerificationDuration);
register.registerMetric(paymentProcessorStatusCacheHits);
register.registerMetric(paymentProcessorStatusCacheMisses);
register.registerMetric(paymentProcessorRefundsTotal);
register.registerMetric(paymentProcessorListRequestsTotal);

export { register as paymentProcessorRegister };
