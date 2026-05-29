import client from "prom-client";

// Create a Registry which registers the metrics
const register = new client.Registry();

// Add a default label which is added to all metrics
register.setDefaultLabels({
  app: "stellar-payment-api",
});

// Enable the collection of default metrics
client.collectDefaultMetrics({ register });

/**
 * Payment Metrics
 */

export const paymentCreatedCounter = new client.Counter({
  name: "payment_created_total",
  help: "Total number of payment sessions created",
  labelNames: ["asset"],
});

export const paymentConfirmedCounter = new client.Counter({
  name: "payment_confirmed_total",
  help: "Total number of payments confirmed on the Stellar network",
  labelNames: ["asset"],
});

export const paymentFailedCounter = new client.Counter({
  name: "payment_failed_total",
  help: "Total number of failed payment attempts",
  labelNames: ["asset", "reason"],
});

export const paymentConfirmationLatency = new client.Histogram({
  name: "payment_confirmation_latency_seconds",
  help: "Time from payment creation to confirmation in seconds",
  labelNames: ["asset"],
  buckets: [10, 30, 60, 120, 300, 600, 1800, 3600], // Buckets in seconds
});

/**
 * Database Connection Pool Metrics
 */

export const pgPoolTotalConnections = new client.Gauge({
  name: "pg_pool_total_connections",
  help: "Total number of connections in the pool",
});

export const pgPoolIdleConnections = new client.Gauge({
  name: "pg_pool_idle_connections",
  help: "Number of idle connections available in the pool",
});

export const pgPoolWaitingRequests = new client.Gauge({
  name: "pg_pool_waiting_requests",
  help: "Number of requests waiting for a connection from the pool",
});

export const pgPoolUtilizationPercent = new client.Gauge({
  name: "pg_pool_utilization_percent",
  help: "Percentage of pool connections in use",
});

/**
 * Query Performance Metrics
 */

export const queryDuration = new client.Histogram({
  name: "db_query_duration_milliseconds",
  help: "Database query execution time in milliseconds",
  labelNames: ["label"],
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
});

export const queryRetryCount = new client.Counter({
  name: "db_query_retry_total",
  help: "Total number of query retry attempts",
  labelNames: ["label"],
});

export const slowQueryCount = new client.Counter({
  name: "db_slow_query_total",
  help: "Total number of slow queries exceeding threshold",
  labelNames: ["label", "threshold"],
});

/**
 * Transaction Signer Metrics
 */

export const signatureVerificationTotal = new client.Counter({
  name: "transaction_signer_verification_total",
  help: "Total number of transaction signature verifications",
  labelNames: ["result"], // valid, invalid, error
});

export const signatureVerificationDuration = new client.Histogram({
  name: "transaction_signer_verification_duration_seconds",
  help: "Time taken to verify transaction signature in seconds",
  labelNames: ["result"],
  buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

export const signatureVerificationReplayAttempts = new client.Counter({
  name: "transaction_signer_replay_attempts_total",
  help: "Total number of detected signature replay attempts",
});

/**
 * Ledger Monitor Metrics
 */

export const ledgerMonitorCycleDuration = new client.Histogram({
  name: "ledger_monitor_cycle_duration_seconds",
  help: "Time taken for each ledger monitor poll cycle",
  buckets: [1, 5, 10, 30, 60, 120],
});

export const ledgerMonitorPaymentsChecked = new client.Counter({
  name: "ledger_monitor_payments_checked_total",
  help: "Total number of payments checked by ledger monitor",
  labelNames: ["result"], // confirmed, failed, pending, skipped
});

export const ledgerMonitorCircuitBreakerTrips = new client.Counter({
  name: "ledger_monitor_circuit_breaker_trips_total",
  help: "Total number of times the circuit breaker was tripped",
});

/**
 * Rate Limiting Metrics
 */

export const rateLimitExceededTotal = new client.Counter({
  name: "rate_limit_exceeded_total",
  help: "Total number of rate limit violations",
  labelNames: ["endpoint", "type"], // endpoint name, type (ip, api_key, merchant)
});

export const rateLimitRequestsTotal = new client.Counter({
  name: "rate_limit_requests_total",
  help: "Total number of requests subject to rate limiting",
  labelNames: ["endpoint", "type"],
});

/**
 * Query Cache Metrics (Issue #760)
 */

export const queryCacheHitTotal = new client.Counter({
  name: "db_query_cache_hit_total",
  help: "Total number of query cache hits",
});

export const queryCacheMissTotal = new client.Counter({
  name: "db_query_cache_miss_total",
  help: "Total number of query cache misses",
});

export const queryCacheSize = new client.Gauge({
  name: "db_query_cache_size",
  help: "Current number of entries in the query cache",
});

/**
 * Database Pooler Rate Limiting Metrics (Issue #758)
 */

export const dbPoolerRateLimitExceeded = new client.Counter({
  name: "db_pooler_rate_limit_exceeded_total",
  help: "Total number of database pooler rate limit violations",
  labelNames: ["type"], // query, connection, merchant
});

export const dbPoolerQueryTotal = new client.Counter({
  name: "db_pooler_query_total",
  help: "Total number of queries executed through the pooler",
  labelNames: ["label", "status"], // success, error, rate_limited
});

/**
 * Database Pooler Signature Verification Metrics (Issue #759)
 */

export const dbPoolerSignatureVerified = new client.Counter({
  name: "db_pooler_signature_verified_total",
  help: "Total number of query signature verifications",
  labelNames: ["result"], // valid, invalid, skipped
});

// Register custom metrics
register.registerMetric(paymentCreatedCounter);
register.registerMetric(paymentConfirmedCounter);
register.registerMetric(paymentFailedCounter);
register.registerMetric(paymentConfirmationLatency);
register.registerMetric(pgPoolTotalConnections);
register.registerMetric(pgPoolIdleConnections);
register.registerMetric(pgPoolWaitingRequests);
register.registerMetric(pgPoolUtilizationPercent);
register.registerMetric(queryDuration);
register.registerMetric(queryRetryCount);
register.registerMetric(slowQueryCount);
register.registerMetric(signatureVerificationTotal);
register.registerMetric(signatureVerificationDuration);
register.registerMetric(signatureVerificationReplayAttempts);
register.registerMetric(ledgerMonitorCycleDuration);
register.registerMetric(ledgerMonitorPaymentsChecked);
register.registerMetric(ledgerMonitorCircuitBreakerTrips);
register.registerMetric(rateLimitExceededTotal);
register.registerMetric(rateLimitRequestsTotal);
register.registerMetric(queryCacheHitTotal);
register.registerMetric(queryCacheMissTotal);
register.registerMetric(queryCacheSize);
register.registerMetric(dbPoolerRateLimitExceeded);
register.registerMetric(dbPoolerQueryTotal);
register.registerMetric(dbPoolerSignatureVerified);

export { register };
