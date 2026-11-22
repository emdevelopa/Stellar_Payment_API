import client from "prom-client";

/**
 * Stellar Validators Metrics
 *
 * Tracks operations, validation outcomes, latencies, and dead-letter queue (DLQ)
 * telemetry for the Stellar Account & Ledger Key Validator module.
 *
 * Uses an isolated registry so tests can verify metrics in isolation, and merges
 * with the global Prometheus registry in routes/prometheus.js.
 */

export const validatorRegister = new client.Registry();

validatorRegister.setDefaultLabels({
  app: "stellar-payment-api",
});

/**
 * Total validation evaluations by operation and outcome (valid, invalid, error).
 */
export const validatorEvaluationsTotal = new client.Counter({
  name: "stellar_validator_evaluations_total",
  help: "Total validation evaluations by operation and outcome",
  labelNames: ["operation", "outcome"],
});

/**
 * Total validation rejections by operation and specific failure reason.
 */
export const validatorRejectionsTotal = new client.Counter({
  name: "stellar_validator_rejections_total",
  help: "Total validation rejections by operation and reason",
  labelNames: ["operation", "reason"],
});

/**
 * Latency histogram for validator operations in seconds.
 */
export const validatorDuration = new client.Histogram({
  name: "stellar_validator_duration_seconds",
  help: "Duration of validator operations in seconds",
  labelNames: ["operation"],
  buckets: [0.0001, 0.0005, 0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2.5, 5],
});

/**
 * Current depth of the Validator Dead-Letter Queue.
 */
export const validatorDlqDepth = new client.Gauge({
  name: "stellar_validator_dlq_depth",
  help: "Current number of items in the Stellar validator dead-letter queue",
});

/**
 * Total DLQ operations by action (push, recover, retry, exhaust, clear) and status.
 */
export const validatorDlqOperationsTotal = new client.Counter({
  name: "stellar_validator_dlq_operations_total",
  help: "Total DLQ operations by action and status",
  labelNames: ["action", "status"],
});

// Register all metrics with isolated registry
validatorRegister.registerMetric(validatorEvaluationsTotal);
validatorRegister.registerMetric(validatorRejectionsTotal);
validatorRegister.registerMetric(validatorDuration);
validatorRegister.registerMetric(validatorDlqDepth);
validatorRegister.registerMetric(validatorDlqOperationsTotal);

/**
 * Reset all validator metrics (useful for isolated tests).
 */
export function resetValidatorMetrics() {
  validatorEvaluationsTotal.reset();
  validatorRejectionsTotal.reset();
  validatorDuration.reset();
  validatorDlqDepth.reset();
  validatorDlqOperationsTotal.reset();
}
