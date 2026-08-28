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

export const txSignatureVerificationTotal = new client.Counter({
  name: "tx_signature_verification_total",
  help: "Total number of transaction signature verifications",
  labelNames: ["outcome"], // valid, invalid
});

export const txSignatureVerificationLatency = new client.Histogram({
  name: "tx_signature_verification_latency_seconds",
  help: "Latency of transaction signature verification",
  labelNames: ["label"],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

export const txSignatureVerificationErrors = new client.Counter({
  name: "tx_signature_verification_errors_total",
  help: "Total number of transaction signature verification errors",
  labelNames: ["error_type"], // validation_failure, replay_attempt, verification_exception, invalid_signature
});

export const txSignatureReplayAttempts = new client.Counter({
  name: "tx_signature_replay_attempts_total",
  help: "Total number of replay attempts detected by the transaction signer",
});

export const txSignatureValidationFailures = new client.Counter({
  name: "tx_signature_validation_failures_total",
  help: "Total number of txHash validation failures",
  labelNames: ["reason"], // empty_or_non_string, invalid_format
});

export const txSignatureCacheSize = new client.Gauge({
  name: "tx_signature_cache_size",
  help: "Current number of entries in the transaction signer replay cache",
});

export const txSignatureCacheHits = new client.Counter({
  name: "tx_signature_cache_hits_total",
  help: "Total number of verification cache hits",
});

export const txSignatureCacheMisses = new client.Counter({
  name: "tx_signature_cache_misses_total",
  help: "Total number of verification cache misses",
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

export const ledgerMonitorBatchSize = new client.Gauge({
  name: "ledger_monitor_batch_size",
  help: "Number of pending payments fetched in the most recent ledger monitor cycle",
});

export const ledgerMonitorRateLimiterWaitSeconds = new client.Histogram({
  name: "ledger_monitor_rate_limiter_wait_seconds",
  help: "Time spent waiting for a Horizon rate-limit token during a ledger monitor cycle",
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});

export const ledgerMonitorValidationFailures = new client.Counter({
  name: "ledger_monitor_validation_failures_total",
  help: "Total number of payment records that failed security validation",
  labelNames: ["reason"], // missing_id, bad_recipient, bad_amount, bad_asset, bad_issuer, bad_memo, future_date
});

export const ledgerMonitorAnomaliesDetected = new client.Counter({
  name: "ledger_monitor_anomalies_detected_total",
  help: "Total number of anomalous patterns detected in payment records",
  labelNames: ["type"], // large_amount, memo_control_chars, memo_sql_chars, stale_payment, metadata_unknown_keys
});

export const ledgerMonitorMerchantCacheHits = new client.Counter({
  name: "ledger_monitor_merchant_cache_hits_total",
  help: "Total number of merchant config cache hits during ledger monitor cycles",
});

export const ledgerMonitorMerchantCacheMisses = new client.Counter({
  name: "ledger_monitor_merchant_cache_misses_total",
  help: "Total number of merchant config cache misses during ledger monitor cycles",
});

export const ledgerMonitorMerchantCacheSize = new client.Gauge({
  name: "ledger_monitor_merchant_cache_size",
  help: "Current number of entries in the ledger monitor merchant config cache",
});

export const ledgerMonitorSignatureVerifications = new client.Counter({
  name: "ledger_monitor_signature_verifications_total",
  help: "Total number of transaction signature verifications performed by ledger monitor",
  labelNames: ["result"], // passed, failed, error
});

export const ledgerMonitorHorizonOperations = new client.Counter({
  name: "ledger_monitor_horizon_operations_total",
  help: "Total number of Horizon API operations performed by ledger monitor",
  labelNames: ["operation", "result"], // operation: findMatch, findAny; result: found, not_found, error
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

/**
 * API Gateway Security Metrics (Issue #1060 - replay-protection cache)
 */

export const apiGatewaySignatureCacheSize = new client.Gauge({
  name: "api_gateway_signature_cache_size",
  help: "Current number of verified-signature entries held for API gateway replay protection",
});

export const apiGatewayReplayBlockedTotal = new client.Counter({
  name: "api_gateway_replay_blocked_total",
  help: "Total number of API gateway requests rejected as replays of a previously verified signature",
});

/**
 * Database Pooler Granular Operational Metrics (Issue #1058)
 *
 * Complements the coarser dbPoolerQueryTotal counter above with latency
 * and live-state visibility. Deliberately avoids per-merchant-ID labels
 * (unbounded cardinality) - merchant-level detail is exposed as an
 * aggregate window count instead.
 */

export const dbPoolerQueryDuration = new client.Histogram({
  name: "db_pooler_query_duration_seconds",
  help: "Time spent in optimizedQuery/optimizedWrite, including rate-limit and cache overhead",
  labelNames: ["label", "status"], // success, error, rate_limited, signature_invalid, fallback_success, fallback_error
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});

export const dbPoolerCircuitBreakerState = new client.Gauge({
  name: "db_pooler_circuit_breaker_state",
  help: "Current state of the database pooler's circuit breaker (0 = closed, 1 = open)",
});

export const dbPoolerFallbackModeActive = new client.Gauge({
  name: "db_pooler_fallback_mode_active",
  help: "Whether the database pooler is currently bypassing rate limiting/caching in fallback mode (0 = no, 1 = yes)",
});

export const dbPoolerActiveMerchantWindows = new client.Gauge({
  name: "db_pooler_active_merchant_windows",
  help: "Current number of merchants with an active rate-limit window tracked by the database pooler",
});

export const dbPoolerRateLimitUtilizationPercent = new client.Gauge({
  name: "db_pooler_rate_limit_utilization_percent",
  help: "Percentage of the global database pooler rate limit currently in use",
});

/**
 * Exchange Rate Service Metrics
 */

export const exchangeRateQuoteRequests = new client.Counter({
  name: "exchange_rate_quote_requests_total",
  help: "Total number of exchange rate quote requests",
  labelNames: ["source_asset", "dest_asset", "result"], // success, not_found, error, rate_limited, same_asset, not_pending
});

export const exchangeRateQuoteDuration = new client.Histogram({
  name: "exchange_rate_quote_duration_seconds",
  help: "Time taken to resolve an exchange rate quote in seconds",
  labelNames: ["source_asset", "dest_asset", "result"],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

export const exchangeRateHorizonCalls = new client.Counter({
  name: "exchange_rate_horizon_calls_total",
  help: "Total number of Horizon API calls made by the exchange rate service",
  labelNames: ["operation", "status"], // operation: strict_receive_paths, load_account; status: success, error
});

export const exchangeRateSourceAccountValidation = new client.Counter({
  name: "exchange_rate_source_account_validation_total",
  help: "Total number of source account validations",
  labelNames: ["result"], // valid, not_found, error, skipped
});

export const exchangeRateSlippageApplied = new client.Counter({
  name: "exchange_rate_slippage_applied_total",
  help: "Total number of exchange rate quotes with slippage applied",
  labelNames: ["slippage_pct"],
});

/**
 * Horizon Client Cache Metrics
 */

export const horizonCacheHitsTotal = new client.Counter({
  name: "horizon_cache_hits_total",
  help: "Total number of Horizon client cache hits",
  labelNames: ["operation"],
});

export const horizonCacheMissesTotal = new client.Counter({
  name: "horizon_cache_misses_total",
  help: "Total number of Horizon client cache misses",
  labelNames: ["operation"],
});

export const horizonCacheEntries = new client.Gauge({
  name: "horizon_cache_entries",
  help: "Current number of entries in the Horizon client response cache",
});

/**
 * Webhook Dispatcher Metrics
 */

export const webhookDispatchAttemptsTotal = new client.Counter({
  name: "webhook_dispatch_attempts_total",
  help: "Total number of webhook dispatch attempts",
  labelNames: ["event_type", "result", "status_code"],
});

export const webhookDispatchDuration = new client.Histogram({
  name: "webhook_dispatch_duration_seconds",
  help: "Time spent dispatching webhook requests",
  labelNames: ["event_type", "result"],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
});

export const webhookDispatchRetriesTotal = new client.Counter({
  name: "webhook_dispatch_retries_total",
  help: "Total number of webhook retries scheduled by the dispatcher",
  labelNames: ["event_type", "reason"],
});

export const webhookDispatchBlockedTotal = new client.Counter({
  name: "webhook_dispatch_blocked_total",
  help: "Total number of webhook dispatches blocked before delivery",
  labelNames: ["event_type", "reason"],
});

/**
 * Smart Contract Oracle Integrator Metrics (Issue #TBD)
 */

export const oracleCacheHitTotal = new client.Counter({
  name: "oracle_cache_hit_total",
  help: "Total number of oracle cache hits",
  labelNames: ["provider"],
});

export const oracleCacheMissTotal = new client.Counter({
  name: "oracle_cache_miss_total",
  help: "Total number of oracle cache misses",
  labelNames: ["provider"],
});

export const oracleCacheSize = new client.Gauge({
  name: "oracle_cache_size",
  help: "Current number of entries in the oracle cache",
  labelNames: ["provider"],
});

export const oracleFetchDuration = new client.Histogram({
  name: "oracle_fetch_duration_seconds",
  help: "Time taken to fetch oracle data from provider",
  labelNames: ["provider", "result"],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
});

export const oracleFetchErrorsTotal = new client.Counter({
  name: "oracle_fetch_errors_total",
  help: "Total number of oracle fetch errors",
  labelNames: ["provider", "error_type"],
});

export const oracleStaleDataServedTotal = new client.Counter({
  name: "oracle_stale_data_served_total",
  help: "Total number of times stale oracle data was served as fallback",
  labelNames: ["provider"],
});

export const oracleCircuitBreakerTripsTotal = new client.Counter({
  name: "oracle_circuit_breaker_trips_total",
  help: "Total number of times the oracle circuit breaker was tripped",
  labelNames: ["provider"],
});

/**
 * Admin Dashboard Service Metrics (granular per-endpoint request tracking)
 *
 * Labeled by `endpoint` (summary/revenue/volume) rather than merchant_id to
 * keep Prometheus label cardinality bounded - per-merchant breakdowns belong
 * in the business-facing responses these endpoints already return, not in
 * the internal request/latency series.
 */

export const dashboardMetricsRequestsTotal = new client.Counter({
  name: "dashboard_metrics_requests_total",
  help: "Total number of requests to Admin Dashboard Service endpoints",
  labelNames: ["endpoint", "status_code"],
});

export const dashboardMetricsRequestDuration = new client.Histogram({
  name: "dashboard_metrics_request_duration_seconds",
  help: "Time taken to serve Admin Dashboard Service endpoint requests",
  labelNames: ["endpoint"],
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});

export const dashboardMetricsErrorsTotal = new client.Counter({
  name: "dashboard_metrics_errors_total",
  help: "Total number of errors from Admin Dashboard Service endpoints",
  labelNames: ["endpoint", "error_type"],
});

export const dashboardMetricsCacheHitTotal = new client.Counter({
  name: "dashboard_metrics_cache_hit_total",
  help: "Total number of Admin Dashboard Service cache hits",
  labelNames: ["endpoint"],
});

export const dashboardMetricsCacheMissTotal = new client.Counter({
  name: "dashboard_metrics_cache_miss_total",
  help: "Total number of Admin Dashboard Service cache misses",
  labelNames: ["endpoint"],
});

/**
 * Webhook Event Dispatcher Cache Metrics (Issue #1100)
 */

export const webhookEventCacheHitTotal = new client.Counter({
  name: "webhook_event_cache_hit_total",
  help: "Total number of webhook event cache hits",
  labelNames: ["event_type"],
});

export const webhookEventCacheMissTotal = new client.Counter({
  name: "webhook_event_cache_miss_total",
  help: "Total number of webhook event cache misses",
  labelNames: ["event_type"],
});

export const webhookEventCacheSize = new client.Gauge({
  name: "webhook_event_cache_size",
  help: "Current number of entries in the webhook event payload cache",
});

export const webhookEventDeduplicationCacheSize = new client.Gauge({
  name: "webhook_event_deduplication_cache_size",
  help: "Current number of entries in the webhook event deduplication cache",
});

export const webhookEventDeliveryAttemptsCached = new client.Counter({
  name: "webhook_event_delivery_attempts_cached_total",
  help: "Total number of cached webhook delivery attempts",
  labelNames: ["action"], // deduplicated, success
});

/**
 * Fraud Detection Engine Metrics (Issue #1098)
 */

export const fraudDetectionPaymentsAnalyzed = new client.Counter({
  name: "fraud_detection_payments_analyzed_total",
  help: "Total number of payments analyzed by fraud detection engine",
});

export const fraudDetectionRiskScore = new client.Histogram({
  name: "fraud_detection_risk_score",
  help: "Distribution of fraud detection risk scores",
  buckets: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
});

export const fraudDetectionAnomaliesDetected = new client.Counter({
  name: "fraud_detection_anomalies_detected_total",
  help: "Total number of anomalies detected in payment patterns",
  labelNames: ["count"],
});

export const fraudDetectionBlockedPayments = new client.Counter({
  name: "fraud_detection_blocked_payments_total",
  help: "Total number of payments blocked by fraud detection",
  labelNames: ["reason"],
});

export const fraudDetectionHighRiskDetected = new client.Counter({
  name: "fraud_detection_high_risk_detected_total",
  help: "Total number of high-risk payments detected",
  labelNames: ["level"],
});

export const fraudDetectionVelocityExceeded = new client.Counter({
  name: "fraud_detection_velocity_exceeded_total",
  help: "Total number of velocity-based anomalies detected",
  labelNames: ["pattern"],
});

export const fraudDetectionGeographicAnomaly = new client.Counter({
  name: "fraud_detection_geographic_anomaly_total",
  help: "Total number of geographic pattern anomalies detected",
  labelNames: ["pattern"],
});

export const fraudDetectionMetadataAnomalies = new client.Counter({
  name: "fraud_detection_metadata_anomalies_total",
  help: "Total number of metadata-based anomalies detected",
  labelNames: ["type"],
});

export const fraudDetectionCacheSize = new client.Gauge({
  name: "fraud_detection_cache_size",
  help: "Current number of entries in the fraud detection risk score cache",
});

/**
 * Horizon Client Metrics (Issue #1106, #1108)
 */

export const horizonClientOperations = new client.Counter({
  name: "horizon_client_operations_total",
  help: "Total number of Horizon client operations",
  labelNames: ["operation", "result"], // operation: loadAccount, fetchPayments, etc.; result: success, error
});

export const horizonClientErrors = new client.Counter({
  name: "horizon_client_errors_total",
  help: "Total number of Horizon client errors",
  labelNames: ["operation", "error_type"], // error_type: rate_limit, not_found, server_error, network_error, etc.
});

export const horizonClientRetries = new client.Counter({
  name: "horizon_client_retries_total",
  help: "Total number of Horizon client retry attempts",
  labelNames: ["operation"],
});

export const horizonClientLatency = new client.Histogram({
  name: "horizon_client_latency_seconds",
  help: "Horizon client operation latency in seconds",
  labelNames: ["operation", "result"],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

// Enhanced granular metrics for Horizon Client
export const horizonClientRequestSize = new client.Histogram({
  name: "horizon_client_request_size_bytes",
  help: "Horizon client request size in bytes",
  labelNames: ["operation"],
  buckets: [100, 1000, 10000, 100000, 1000000],
});

export const horizonClientResponseSize = new client.Histogram({
  name: "horizon_client_response_size_bytes",
  help: "Horizon client response size in bytes",
  labelNames: ["operation"],
  buckets: [100, 1000, 10000, 100000, 1000000],
});

export const horizonClientCacheHits = new client.Counter({
  name: "horizon_client_cache_hits_total",
  help: "Total number of Horizon client cache hits",
  labelNames: ["operation"],
});

export const horizonClientCacheMisses = new client.Counter({
  name: "horizon_client_cache_misses_total",
  help: "Total number of Horizon client cache misses",
  labelNames: ["operation"],
});

export const horizonClientConnections = new client.Gauge({
  name: "horizon_client_active_connections",
  help: "Number of active Horizon client connections",
});

export const horizonClientQueueDepth = new client.Gauge({
  name: "horizon_client_request_queue_depth",
  help: "Number of pending requests in Horizon client queue",
});

export const horizonClientBackpressure = new client.Counter({
  name: "horizon_client_backpressure_rejections_total",
  help: "Total number of requests rejected due to backpressure",
  labelNames: ["operation"],
});

export const horizonClientTimeouts = new client.Counter({
  name: "horizon_client_timeouts_total",
  help: "Total number of Horizon client timeout errors",
  labelNames: ["operation", "timeout_type"],
});

export const horizonClientCircuitBreakerTrips = new client.Counter({
  name: "horizon_client_circuit_breaker_trips_total",
  help: "Total number of Horizon client circuit breaker trips",
  labelNames: ["operation"],
});

export const horizonClientCircuitBreakerState = new client.Gauge({
  name: "horizon_client_circuit_breaker_state",
  help: "Current state of Horizon client circuit breaker (0=closed, 1=open, 2=half-open)",
  labelNames: ["operation"],
});

export const horizonClientHealthCheckDuration = new client.Histogram({
  name: "horizon_client_health_check_duration_seconds",
  help: "Duration of Horizon client health checks in seconds",
  buckets: [0.1, 0.5, 1, 2, 5, 10],
});

export const horizonClientHealthCheckResult = new client.Counter({
  name: "horizon_client_health_check_results_total",
  help: "Total number of Horizon client health check results",
  labelNames: ["result"], // success, failure, timeout
});

export const horizonClientConcurrentOperations = new client.Gauge({
  name: "horizon_client_concurrent_operations",
  help: "Number of concurrent Horizon client operations",
});

export const horizonClientOperationDuration = new client.Histogram({
  name: "horizon_client_operation_duration_seconds",
  help: "Duration of Horizon client operations by type",
  labelNames: ["operation", "phase"], // phase: execution, retry, total
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
});

export const horizonClientRetryAttemptDuration = new client.Histogram({
  name: "horizon_client_retry_attempt_duration_seconds",
  help: "Duration of individual retry attempts",
  labelNames: ["operation", "attempt"],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});

export const horizonClientErrorRecovery = new client.Counter({
  name: "horizon_client_error_recovery_total",
  help: "Total number of successful error recoveries",
  labelNames: ["operation", "error_type", "recovery_attempt"],
});

export const horizonClientDataValidationErrors = new client.Counter({
  name: "horizon_client_data_validation_errors_total",
  help: "Total number of data validation errors in Horizon client",
  labelNames: ["operation", "validation_type"],
});

export const horizonClientSerializationErrors = new client.Counter({
  name: "horizon_client_serialization_errors_total",
  help: "Total number of serialization errors in Horizon client",
  labelNames: ["operation", "data_type"],
});

export const horizonClientRateLimitWaitTime = new client.Histogram({
  name: "horizon_client_rate_limit_wait_time_seconds",
  help: "Time spent waiting for rate limit recovery",
  buckets: [1, 5, 10, 30, 60, 120, 300],
});

export const horizonClientThroughput = new client.Gauge({
  name: "horizon_client_throughput_operations_per_second",
  help: "Current throughput of Horizon client operations",
  labelNames: ["operation"],
});

export const horizonClientOperationSuccessRate = new client.Gauge({
  name: "horizon_client_operation_success_rate",
  help: "Success rate of Horizon client operations",
  labelNames: ["operation"],
});

export const paymentMatchingOperations = new client.Counter({
  name: "payment_matching_operations_total",
  help: "Total number of payment matching operations",
  labelNames: ["result"], // result: found, not_found
});

export const paymentMatchingErrors = new client.Counter({
  name: "payment_matching_errors_total",
  help: "Total number of payment matching errors",
  labelNames: ["error_type"],
});

export const signatureVerificationOperations = new client.Counter({
  name: "signature_verification_operations_total",
  help: "Total number of signature verification operations",
  labelNames: ["result"], // result: valid, invalid, error
});

export const signatureVerificationLatency = new client.Histogram({
  name: "signature_verification_latency_seconds",
  help: "Signature verification operation latency in seconds",
  labelNames: ["result"],
  buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

export const signatureVerificationReplayDetected = new client.Counter({
  name: "signature_verification_replay_detected_total",
  help: "Total number of signature replay attempts detected",
});

/**
 * Audit Logger Metrics
 */

export const auditLogWritesTotal = new client.Counter({
  name: "audit_log_writes_total",
  help: "Total number of audit log write attempts",
  labelNames: ["source", "result"], // source: login_attempt, profile_change; result: success, failure, circuit_open
});

export const auditLogWriteDuration = new client.Histogram({
  name: "audit_log_write_duration_seconds",
  help: "Time taken to write an audit log record, including retries",
  labelNames: ["source", "result"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
});

export const auditLogFallbackWritesTotal = new client.Counter({
  name: "audit_log_fallback_writes_total",
  help: "Total number of audit log entries written to the fallback file log",
  labelNames: ["source"],
});

export const auditLogCircuitBreakerTrips = new client.Counter({
  name: "audit_log_circuit_breaker_trips_total",
  help: "Total number of times an audit log circuit breaker tripped open",
  labelNames: ["source"],
});

export const auditLogCircuitBreakerState = new client.Gauge({
  name: "audit_log_circuit_breaker_state",
  help: "Current state of the audit log circuit breaker (0=closed, 1=open, 2=half_open)",
  labelNames: ["source"],
});

export const auditLogReplayTotal = new client.Counter({
  name: "audit_log_replay_total",
  help: "Total number of fallback audit log lines processed during replay",
  labelNames: ["result"], // result: success, failed
});

export const auditLogRateLimitRejectionsTotal = new client.Counter({
  name: "audit_log_rate_limit_rejections_total",
  help: "Total number of audit log operations rejected by the rate limiter",
  labelNames: ["source"], // login_attempt, profile_change, read
});

export const auditLogReadRequestsTotal = new client.Counter({
  name: "audit_log_read_requests_total",
  help: "Total number of GET /api/audit-logs requests",
  labelNames: ["result"], // success, rate_limited, error
});

export const auditLogIntegrityVerificationsTotal = new client.Counter({
  name: "audit_log_integrity_verifications_total",
  help: "Total number of audit log row integrity verifications performed on read",
  labelNames: ["result"], // verified, unsigned_verified, failed
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
register.registerMetric(txSignatureVerificationTotal);
register.registerMetric(txSignatureVerificationLatency);
register.registerMetric(txSignatureVerificationErrors);
register.registerMetric(txSignatureReplayAttempts);
register.registerMetric(txSignatureValidationFailures);
register.registerMetric(txSignatureCacheSize);
register.registerMetric(txSignatureCacheHits);
register.registerMetric(txSignatureCacheMisses);
register.registerMetric(ledgerMonitorCycleDuration);
register.registerMetric(ledgerMonitorPaymentsChecked);
register.registerMetric(ledgerMonitorCircuitBreakerTrips);
register.registerMetric(ledgerMonitorBatchSize);
register.registerMetric(ledgerMonitorRateLimiterWaitSeconds);
register.registerMetric(ledgerMonitorValidationFailures);
register.registerMetric(ledgerMonitorAnomaliesDetected);
register.registerMetric(ledgerMonitorMerchantCacheHits);
register.registerMetric(ledgerMonitorMerchantCacheMisses);
register.registerMetric(ledgerMonitorMerchantCacheSize);
register.registerMetric(ledgerMonitorSignatureVerifications);
register.registerMetric(ledgerMonitorHorizonOperations);
register.registerMetric(rateLimitExceededTotal);
register.registerMetric(rateLimitRequestsTotal);
register.registerMetric(queryCacheHitTotal);
register.registerMetric(queryCacheMissTotal);
register.registerMetric(queryCacheSize);
register.registerMetric(dbPoolerRateLimitExceeded);
register.registerMetric(dbPoolerQueryTotal);
register.registerMetric(dbPoolerSignatureVerified);
register.registerMetric(apiGatewaySignatureCacheSize);
register.registerMetric(apiGatewayReplayBlockedTotal);
register.registerMetric(dbPoolerQueryDuration);
register.registerMetric(dbPoolerCircuitBreakerState);
register.registerMetric(dbPoolerFallbackModeActive);
register.registerMetric(dbPoolerActiveMerchantWindows);
register.registerMetric(dbPoolerRateLimitUtilizationPercent);
register.registerMetric(exchangeRateQuoteRequests);
register.registerMetric(exchangeRateQuoteDuration);
register.registerMetric(exchangeRateHorizonCalls);
register.registerMetric(exchangeRateSourceAccountValidation);
register.registerMetric(exchangeRateSlippageApplied);
register.registerMetric(horizonCacheHitsTotal);
register.registerMetric(horizonCacheMissesTotal);
register.registerMetric(horizonCacheEntries);
register.registerMetric(webhookDispatchAttemptsTotal);
register.registerMetric(webhookDispatchDuration);
register.registerMetric(webhookDispatchRetriesTotal);
register.registerMetric(webhookDispatchBlockedTotal);
register.registerMetric(oracleCacheHitTotal);
register.registerMetric(oracleCacheMissTotal);
register.registerMetric(oracleCacheSize);
register.registerMetric(oracleFetchDuration);
register.registerMetric(oracleFetchErrorsTotal);
register.registerMetric(oracleStaleDataServedTotal);
register.registerMetric(oracleCircuitBreakerTripsTotal);
register.registerMetric(dashboardMetricsRequestsTotal);
register.registerMetric(dashboardMetricsRequestDuration);
register.registerMetric(dashboardMetricsErrorsTotal);
register.registerMetric(dashboardMetricsCacheHitTotal);
register.registerMetric(dashboardMetricsCacheMissTotal);
register.registerMetric(webhookEventCacheHitTotal);
register.registerMetric(webhookEventCacheMissTotal);
register.registerMetric(webhookEventCacheSize);
register.registerMetric(webhookEventDeduplicationCacheSize);
register.registerMetric(webhookEventDeliveryAttemptsCached);
register.registerMetric(fraudDetectionPaymentsAnalyzed);
register.registerMetric(fraudDetectionRiskScore);
register.registerMetric(fraudDetectionAnomaliesDetected);
register.registerMetric(fraudDetectionBlockedPayments);
register.registerMetric(fraudDetectionHighRiskDetected);
register.registerMetric(fraudDetectionVelocityExceeded);
register.registerMetric(fraudDetectionGeographicAnomaly);
register.registerMetric(fraudDetectionMetadataAnomalies);
register.registerMetric(fraudDetectionCacheSize);
register.registerMetric(horizonClientOperations);
register.registerMetric(horizonClientErrors);
register.registerMetric(horizonClientRetries);
register.registerMetric(horizonClientLatency);
register.registerMetric(horizonClientRequestSize);
register.registerMetric(horizonClientResponseSize);
register.registerMetric(horizonClientCacheHits);
register.registerMetric(horizonClientCacheMisses);
register.registerMetric(horizonClientConnections);
register.registerMetric(horizonClientQueueDepth);
register.registerMetric(horizonClientBackpressure);
register.registerMetric(horizonClientTimeouts);
register.registerMetric(horizonClientCircuitBreakerTrips);
register.registerMetric(horizonClientCircuitBreakerState);
register.registerMetric(horizonClientHealthCheckDuration);
register.registerMetric(horizonClientHealthCheckResult);
register.registerMetric(horizonClientConcurrentOperations);
register.registerMetric(horizonClientOperationDuration);
register.registerMetric(horizonClientRetryAttemptDuration);
register.registerMetric(horizonClientErrorRecovery);
register.registerMetric(horizonClientDataValidationErrors);
register.registerMetric(horizonClientSerializationErrors);
register.registerMetric(horizonClientRateLimitWaitTime);
register.registerMetric(horizonClientThroughput);
register.registerMetric(horizonClientOperationSuccessRate);
register.registerMetric(paymentMatchingOperations);
register.registerMetric(paymentMatchingErrors);
register.registerMetric(signatureVerificationOperations);
register.registerMetric(signatureVerificationLatency);
register.registerMetric(signatureVerificationReplayDetected);
register.registerMetric(auditLogWritesTotal);
register.registerMetric(auditLogWriteDuration);
register.registerMetric(auditLogFallbackWritesTotal);
register.registerMetric(auditLogCircuitBreakerTrips);
register.registerMetric(auditLogCircuitBreakerState);
register.registerMetric(auditLogReplayTotal);
register.registerMetric(auditLogRateLimitRejectionsTotal);
register.registerMetric(auditLogReadRequestsTotal);
register.registerMetric(auditLogIntegrityVerificationsTotal);

export { register };

// ── Audit Queue Metrics (Issue #1330) ───────────────────────────────────────
export const auditLogQueueDepth = new promClient.Gauge({
  name: "audit_log_queue_depth",
  help: "Number of audit writes waiting in queue",
  labelNames: ["label"],
});

export const auditLogQueueWaitDuration = new promClient.Histogram({
  name: "audit_log_queue_wait_duration_seconds",
  help: "Time audit writes spend waiting in queue",
  labelNames: ["label"],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5],
});

register.registerMetric(auditLogQueueDepth);
register.registerMetric(auditLogQueueWaitDuration);
