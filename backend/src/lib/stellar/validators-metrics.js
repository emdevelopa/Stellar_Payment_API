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

/**
 * Cache operations for federated-address resolution (#1765).
 *
 * result:  hit | miss | set | invalid | error | coalesced
 * backend: redis | memory
 */
export const validatorCacheOperationsTotal = new client.Counter({
  name: "stellar_validator_cache_operations_total",
  help: "Validator cache operations by operation, result and backend",
  labelNames: ["operation", "result", "backend"],
});

/**
 * Throughput over a rolling window, per operation, in evaluations per second.
 * Refreshed at scrape time so it decays to zero when traffic stops.
 */
export const validatorThroughputPerSecond = new client.Gauge({
  name: "stellar_validator_throughput_per_second",
  help: "Validator evaluations per second over the rolling throughput window",
  labelNames: ["operation"],
  collect() {
    this.reset();
    for (const [operation, perSecond] of Object.entries(getValidatorThroughput())) {
      this.set({ operation }, perSecond);
    }
  },
});

export const THROUGHPUT_WINDOW_SECONDS = 60;
const MAX_TRACKED_OPERATIONS = 32;
// operation -> Map(epochSecond -> count)
const throughputBuckets = new Map();

/**
 * Record one evaluation of `operation`. O(1); buckets older than the window are
 * dropped on write, so memory is bounded by window x operations.
 */
export function recordValidatorThroughput(operation, now = Date.now()) {
  const op = String(operation);
  let buckets = throughputBuckets.get(op);
  if (!buckets) {
    if (throughputBuckets.size >= MAX_TRACKED_OPERATIONS) return;
    buckets = new Map();
    throughputBuckets.set(op, buckets);
  }
  const second = Math.floor(now / 1000);
  buckets.set(second, (buckets.get(second) || 0) + 1);
  const cutoff = second - THROUGHPUT_WINDOW_SECONDS;
  for (const key of buckets.keys()) {
    if (key <= cutoff) buckets.delete(key);
    else break; // keys are inserted in increasing order
  }
}

/**
 * Evaluations per second per operation over the last THROUGHPUT_WINDOW_SECONDS.
 */
export function getValidatorThroughput(now = Date.now()) {
  const second = Math.floor(now / 1000);
  const cutoff = second - THROUGHPUT_WINDOW_SECONDS;
  const result = {};
  for (const [operation, buckets] of throughputBuckets) {
    let total = 0;
    for (const [key, count] of buckets) {
      if (key > cutoff) total += count;
    }
    if (total > 0) result[operation] = total / THROUGHPUT_WINDOW_SECONDS;
  }
  return result;
}

// Register all metrics with isolated registry
validatorRegister.registerMetric(validatorCacheOperationsTotal);
validatorRegister.registerMetric(validatorThroughputPerSecond);
validatorRegister.registerMetric(validatorEvaluationsTotal);
validatorRegister.registerMetric(validatorRejectionsTotal);
validatorRegister.registerMetric(validatorDuration);
validatorRegister.registerMetric(validatorDlqDepth);
validatorRegister.registerMetric(validatorDlqOperationsTotal);

/**
 * Reset all validator metrics (useful for isolated tests).
 */
export function resetValidatorMetrics() {
  throughputBuckets.clear();
  validatorCacheOperationsTotal.reset();
  validatorEvaluationsTotal.reset();
  validatorRejectionsTotal.reset();
  validatorDuration.reset();
  validatorDlqDepth.reset();
  validatorDlqOperationsTotal.reset();
}
