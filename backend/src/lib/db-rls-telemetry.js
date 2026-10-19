/**
 * Database Row-Level Security Service telemetry (issue #1468).
 *
 * Prometheus series and a rolling-window health snapshot for every
 * `withMerchantContext()` transaction (src/lib/db-rls.js):
 *
 *   - outcome counts and latency per outcome
 *   - active transaction gauge
 *   - rolling-window health state + ratios for alerting
 *
 * Label values come from a fixed server-side set (committed | rolled_back |
 * invalid_input | connection_error | transaction_error) — never merchant ids,
 * query text or error strings — so request traffic cannot inflate series
 * cardinality or leak customer data into the scrape output.
 *
 * The metrics live in their own registry so they can be unit-tested in
 * isolation; the /metrics endpoint merges this registry with the others.
 */

import client from "prom-client";

const register = new client.Registry();

register.setDefaultLabels({
  app: "stellar-payment-api",
});

/**
 * outcome: committed | rolled_back | invalid_input | connection_error | transaction_error
 */
export const dbRlsTransactionsTotal = new client.Counter({
  name: "database_rls_transactions_total",
  help: "Row-Level Security transactions started through withMerchantContext, by outcome",
  labelNames: ["outcome"],
});

export const dbRlsTransactionDuration = new client.Histogram({
  name: "database_rls_transaction_duration_seconds",
  help: "Wall time of a withMerchantContext transaction, by outcome",
  labelNames: ["outcome"],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

export const dbRlsActiveTransactions = new client.Gauge({
  name: "database_rls_active_transactions",
  help: "RLS transactions currently in flight (connected, transaction open)",
});

/**
 * Rolling-window gauges. Refreshed at scrape time so they decay when idle.
 * health_state: 0 = healthy, 1 = degraded, 2 = unhealthy
 */
export const dbRlsHealthState = new client.Gauge({
  name: "database_rls_health_state",
  help: "Row-Level Security service health (0 = healthy, 1 = degraded, 2 = unhealthy)",
});

export const dbRlsErrorRatio = new client.Gauge({
  name: "database_rls_error_ratio",
  help: "Share of RLS transactions that failed before completing (connection or transaction error) over the rolling window",
});

export const dbRlsRollbackRatio = new client.Gauge({
  name: "database_rls_rollback_ratio",
  help: "Share of RLS transactions rolled back by a failing callback over the rolling window",
});

export const dbRlsLastTransactionTimestamp = new client.Gauge({
  name: "database_rls_last_transaction_timestamp_seconds",
  help: "Unix time of the most recent RLS transaction attempt",
});

const OUTCOMES = new Set([
  "committed",
  "rolled_back",
  "invalid_input",
  "connection_error",
  "transaction_error",
]);

export const HEALTH_STATE_VALUES = Object.freeze({
  healthy: 0,
  degraded: 1,
  unhealthy: 2,
});

function readNumberEnv(name, fallback) {
  const raw = Number.parseFloat(process.env[name] ?? "");
  return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
}

export const DEFAULT_HEALTH_OPTIONS = Object.freeze({
  windowMs: readNumberEnv("DATABASE_RLS_HEALTH_WINDOW_MS", 300_000),
  bucketMs: 5_000,
  minSamples: readNumberEnv("DATABASE_RLS_HEALTH_MIN_SAMPLES", 20),
  errorRatioThreshold: readNumberEnv("DATABASE_RLS_ERROR_RATIO_THRESHOLD", 0.05),
  rollbackRatioThreshold: readNumberEnv("DATABASE_RLS_ROLLBACK_RATIO_THRESHOLD", 0.5),
  invalidInputThreshold: readNumberEnv("DATABASE_RLS_INVALID_INPUT_THRESHOLD", 10),
});

function emptyBucket() {
  return {
    slot: -1,
    committed: 0,
    rolledBack: 0,
    invalidInput: 0,
    connectionErrors: 0,
    transactionErrors: 0,
  };
}

/**
 * Rolling-window health tracker. Counts live in a fixed ring of time buckets
 * so memory stays constant regardless of traffic.
 */
export class DatabaseRlsHealthMonitor {
  constructor(options = {}, now = () => Date.now()) {
    this.options = { ...DEFAULT_HEALTH_OPTIONS, ...options };
    this.now = now;
    this.bucketCount = Math.max(
      1,
      Math.ceil(this.options.windowMs / this.options.bucketMs),
    );
    this.reset();
  }

  reset() {
    this.buckets = Array.from({ length: this.bucketCount }, emptyBucket);
    this.lastTransactionAt = null;
  }

  _bucketFor(time) {
    const slot = Math.floor(time / this.options.bucketMs);
    const bucket = this.buckets[slot % this.bucketCount];
    if (bucket.slot !== slot) {
      Object.assign(bucket, emptyBucket(), { slot });
    }
    return bucket;
  }

  record(outcome, time = this.now()) {
    const bucket = this._bucketFor(time);
    if (outcome === "committed") bucket.committed++;
    else if (outcome === "rolled_back") bucket.rolledBack++;
    else if (outcome === "invalid_input") bucket.invalidInput++;
    else if (outcome === "connection_error") bucket.connectionErrors++;
    else if (outcome === "transaction_error") bucket.transactionErrors++;
    this.lastTransactionAt = time;
  }

  snapshot() {
    const time = this.now();
    const currentSlot = Math.floor(time / this.options.bucketMs);
    const oldestSlot = currentSlot - this.bucketCount + 1;
    const counts = {
      committed: 0,
      rolled_back: 0,
      invalid_input: 0,
      connection_error: 0,
      transaction_error: 0,
    };

    for (const bucket of this.buckets) {
      if (bucket.slot < oldestSlot || bucket.slot > currentSlot) continue;
      counts.committed += bucket.committed;
      counts.rolled_back += bucket.rolledBack;
      counts.invalid_input += bucket.invalidInput;
      counts.connection_error += bucket.connectionErrors;
      counts.transaction_error += bucket.transactionErrors;
    }

    const errors = counts.connection_error + counts.transaction_error;
    const total = counts.committed + counts.rolled_back + counts.invalid_input + errors;
    const errorRatio = total > 0 ? errors / total : 0;
    const rollbackRatio = total > 0 ? counts.rolled_back / total : 0;
    const { minSamples, errorRatioThreshold, rollbackRatioThreshold, invalidInputThreshold } =
      this.options;

    const reasons = [];
    let status = "healthy";
    if (total >= minSamples && errorRatio >= errorRatioThreshold) {
      status = "unhealthy";
      reasons.push("error_ratio_exceeded");
    }
    if (total >= minSamples && rollbackRatio >= rollbackRatioThreshold) {
      if (status === "healthy") status = "degraded";
      reasons.push("rollback_ratio_exceeded");
    }
    if (counts.invalid_input >= invalidInputThreshold) {
      if (status === "healthy") status = "degraded";
      reasons.push("invalid_input_spike");
    }

    return {
      status,
      reasons,
      window_ms: this.bucketCount * this.options.bucketMs,
      total,
      ...counts,
      errors,
      rollback_ratio: Number(rollbackRatio.toFixed(4)),
      error_ratio: Number(errorRatio.toFixed(4)),
      last_transaction_at:
        this.lastTransactionAt === null
          ? null
          : new Date(this.lastTransactionAt).toISOString(),
      thresholds: {
        min_samples: minSamples,
        error_ratio: errorRatioThreshold,
        rollback_ratio: rollbackRatioThreshold,
        invalid_input: invalidInputThreshold,
      },
    };
  }
}

export const healthMonitor = new DatabaseRlsHealthMonitor();

// Refresh rolling-window gauges at scrape time so they decay when idle.
dbRlsHealthState.collect = function collectHealthState() {
  const snap = healthMonitor.snapshot();
  this.set(HEALTH_STATE_VALUES[snap.status]);
  dbRlsErrorRatio.set(snap.error_ratio);
  dbRlsRollbackRatio.set(snap.rollback_ratio);
};

/** Record one RLS transaction attempt: counters, histogram and health window. */
export function recordRlsTransaction(outcome, durationSeconds) {
  const label = OUTCOMES.has(outcome) ? outcome : "transaction_error";
  dbRlsTransactionsTotal.inc({ outcome: label });
  if (Number.isFinite(durationSeconds)) {
    dbRlsTransactionDuration.observe({ outcome: label }, durationSeconds);
  }
  dbRlsLastTransactionTimestamp.set(Date.now() / 1000);
  healthMonitor.record(label);
}

/** Current RLS service health, for /health endpoints. */
export function getDatabaseRowLevelSecurityHealth() {
  return healthMonitor.snapshot();
}

/** Test-only: clear counters, histogram and the rolling health window. */
export function resetDatabaseRowLevelSecurityTelemetry() {
  dbRlsTransactionsTotal.reset();
  dbRlsTransactionDuration.reset();
  dbRlsActiveTransactions.reset();
  dbRlsLastTransactionTimestamp.set(0);
  healthMonitor.reset();
}

register.registerMetric(dbRlsTransactionsTotal);
register.registerMetric(dbRlsTransactionDuration);
register.registerMetric(dbRlsActiveTransactions);
register.registerMetric(dbRlsHealthState);
register.registerMetric(dbRlsErrorRatio);
register.registerMetric(dbRlsRollbackRatio);
register.registerMetric(dbRlsLastTransactionTimestamp);

export { register as dbRlsRegister };
