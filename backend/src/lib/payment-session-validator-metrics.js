import client from "prom-client";

/**
 * Payment Session Validator metrics (issue #1448).
 *
 * Tracks the validation stage that runs before a payment session is
 * persisted (see payment-session-validator.js):
 *
 *   - evaluation outcomes and latency, per call site
 *   - WHICH rule rejected a session and WHY
 *   - payload sanitization activity and suspicious-payload signals
 *   - merchant payment_limits misconfiguration
 *   - rolling-window health state for alerting
 *
 * Label values are all drawn from fixed, server-defined sets — never from
 * request data such as the asset code — so a client cannot inflate series
 * cardinality.
 *
 * The metrics live in their own registry so they can be unit-tested in
 * isolation; the /metrics endpoint merges this registry with the main one.
 */

const register = new client.Registry();

register.setDefaultLabels({
  app: "stellar-payment-api",
});

/**
 * source:  http | service | unknown
 * outcome: accepted | rejected | error
 */
export const sessionValidatorEvaluationsTotal = new client.Counter({
  name: "payment_session_validator_evaluations_total",
  help: "Total number of payment session validations, by call site and outcome",
  labelNames: ["source", "outcome"],
});

/**
 * rule:   sanitization | payload | issuer | limits | allowlist
 * reason: the rejection reason emitted by payment-session-rules.js
 */
export const sessionValidatorRejectionsTotal = new client.Counter({
  name: "payment_session_validator_rejections_total",
  help: "Total number of payment sessions rejected by the validator, by rule and reason",
  labelNames: ["source", "rule", "reason"],
});

export const sessionValidatorDuration = new client.Histogram({
  name: "payment_session_validator_duration_seconds",
  help: "Time spent validating a payment session in seconds",
  labelNames: ["source", "outcome"],
  buckets: [0.0001, 0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1],
});

/** field: one of the sanitized string fields (see SESSION_FIELD_MAX_LENGTHS) */
export const sessionValidatorSanitizedFieldsTotal = new client.Counter({
  name: "payment_session_validator_sanitized_fields_total",
  help: "Total number of payload fields altered by sanitization, by field",
  labelNames: ["field"],
});

/** signal: forbidden_key | malformed_payload | bidi_control | oversized_field */
export const sessionValidatorSuspiciousPayloadsTotal = new client.Counter({
  name: "payment_session_validator_suspicious_payloads_total",
  help: "Total number of payment session payloads carrying a suspicious signal",
  labelNames: ["signal"],
});

/** kind: invalid_entry | invalid_min | invalid_max | min_greater_than_max */
export const sessionValidatorConfigAnomaliesTotal = new client.Counter({
  name: "payment_session_validator_config_anomalies_total",
  help: "Total number of merchant payment_limits misconfigurations encountered during validation",
  labelNames: ["kind"],
});

/**
 * Rolling-window health gauges. Their values are refreshed at scrape time via
 * the collect hook installed by payment-session-validator.js so they decay
 * correctly when traffic stops.
 *
 * health_state: 0 = healthy, 1 = degraded, 2 = unhealthy
 */
export const sessionValidatorHealthState = new client.Gauge({
  name: "payment_session_validator_health_state",
  help: "Payment session validator health (0 = healthy, 1 = degraded, 2 = unhealthy)",
});

export const sessionValidatorRejectionRatio = new client.Gauge({
  name: "payment_session_validator_rejection_ratio",
  help: "Share of validations rejected over the rolling health window",
});

export const sessionValidatorErrorRatio = new client.Gauge({
  name: "payment_session_validator_error_ratio",
  help: "Share of validations that failed with an internal error over the rolling health window",
});

export const sessionValidatorLastEvaluationTimestamp = new client.Gauge({
  name: "payment_session_validator_last_evaluation_timestamp_seconds",
  help: "Unix time of the most recent payment session validation",
});

register.registerMetric(sessionValidatorEvaluationsTotal);
register.registerMetric(sessionValidatorRejectionsTotal);
register.registerMetric(sessionValidatorDuration);
register.registerMetric(sessionValidatorSanitizedFieldsTotal);
register.registerMetric(sessionValidatorSuspiciousPayloadsTotal);
register.registerMetric(sessionValidatorConfigAnomaliesTotal);
register.registerMetric(sessionValidatorHealthState);
register.registerMetric(sessionValidatorRejectionRatio);
register.registerMetric(sessionValidatorErrorRatio);
register.registerMetric(sessionValidatorLastEvaluationTimestamp);

export { register as paymentSessionValidatorRegister };
