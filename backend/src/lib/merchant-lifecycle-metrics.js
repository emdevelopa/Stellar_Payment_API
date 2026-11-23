import client from "prom-client";

/**
 * Metrics for the Merchant Onboarding and Key Lifecycle Route: concurrency
 * control (#1772), dead-letter recovery (#1771), payload validation (#1769), and caching
 * and throughput telemetry (#1770). Isolated registry, merged
 * into /metrics by routes/prometheus.js.
 */
export const merchantLifecycleRegister = new client.Registry();
merchantLifecycleRegister.setDefaultLabels({ app: "stellar-payment-api" });

/**
 * operation: register | rotate_api_key | generate_api_key | regenerate_webhook_secret | rotate_webhook_secret
 * outcome:   acquired | contended
 */
export const merchantLockTotal = new client.Counter({
  name: "merchant_lifecycle_lock_total",
  help: "Merchant lifecycle lock acquisitions by operation and outcome",
  labelNames: ["operation", "outcome"],
  registers: [merchantLifecycleRegister],
});

export const merchantLockHeldSeconds = new client.Histogram({
  name: "merchant_lifecycle_lock_held_seconds",
  help: "How long a merchant lifecycle lock was held",
  labelNames: ["operation"],
  buckets: [0.005, 0.025, 0.1, 0.25, 0.5, 1, 2.5, 5, 15],
  registers: [merchantLifecycleRegister],
});

/** A credential update rejected because the stored credential changed underneath it. */
export const merchantCredentialConflictsTotal = new client.Counter({
  name: "merchant_credential_conflicts_total",
  help: "Credential updates rejected by the compare-and-swap guard",
  labelNames: ["operation"],
  registers: [merchantLifecycleRegister],
});

export const merchantPersistRetriesTotal = new client.Counter({
  name: "merchant_lifecycle_persist_retries_total",
  help: "Retried transient merchant metadata persistence failures",
  registers: [merchantLifecycleRegister],
});

export const merchantDlqDepth = new client.Gauge({
  name: "merchant_lifecycle_dlq_depth",
  help: "Current number of merchant writes in the dead-letter queue",
  registers: [merchantLifecycleRegister],
});

/** action: push | recover | retry | exhaust | evict | clear */
export const merchantDlqOperationsTotal = new client.Counter({
  name: "merchant_lifecycle_dlq_operations_total",
  help: "Merchant lifecycle dead-letter queue operations by action and status",
  labelNames: ["action", "status"],
  registers: [merchantLifecycleRegister],
});

/**
 * Payloads rejected before reaching a handler (#1769).
 * route:  Express route pattern (fixed set, never the raw URL)
 * reason: sanitize | schema
 */
export const merchantPayloadRejectionsTotal = new client.Counter({
  name: "merchant_payload_rejections_total",
  help: "Merchant route payloads rejected by sanitization or schema validation",
  labelNames: ["route", "reason"],
  registers: [merchantLifecycleRegister],
});

/** Unsafe keys (prototype-pollution, control characters) stripped from payloads. */
export const merchantPayloadKeysDroppedTotal = new client.Counter({
  name: "merchant_payload_keys_dropped_total",
  help: "Unsafe keys dropped from merchant route payloads",
  labelNames: ["route"],
  registers: [merchantLifecycleRegister],
});

/**
 * Distributed cache operations (#1770).
 * resource: profile | branding | webhook_settings | all (invalidation)
 * result:   hit | miss | bypass | error | store | store_error |
 *           invalidate | invalidate_error | invalidate_skipped
 */
export const merchantCacheOperationsTotal = new client.Counter({
  name: "merchant_cache_operations_total",
  help: "Merchant route Redis cache operations by resource and result",
  labelNames: ["resource", "result"],
  registers: [merchantLifecycleRegister],
});

/** Throughput telemetry for every merchant route (#1770). */
export const merchantRouteRequestsTotal = new client.Counter({
  name: "merchant_route_requests_total",
  help: "Merchant Onboarding and Key Lifecycle Route requests by route, method and status class",
  labelNames: ["route", "method", "status_class"],
  registers: [merchantLifecycleRegister],
});

export const merchantRouteRequestDurationSeconds = new client.Histogram({
  name: "merchant_route_request_duration_seconds",
  help: "Merchant Onboarding and Key Lifecycle Route latency",
  labelNames: ["route", "method"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [merchantLifecycleRegister],
});

export const merchantRouteInFlight = new client.Gauge({
  name: "merchant_route_in_flight_requests",
  help: "Merchant Onboarding and Key Lifecycle Route requests currently being served",
  labelNames: ["route"],
  registers: [merchantLifecycleRegister],
});

export function resetMerchantLifecycleMetrics() {
  merchantLockTotal.reset();
  merchantLockHeldSeconds.reset();
  merchantCredentialConflictsTotal.reset();
  merchantPersistRetriesTotal.reset();
  merchantDlqDepth.reset();
  merchantDlqOperationsTotal.reset();
  merchantPayloadRejectionsTotal.reset();
  merchantPayloadKeysDroppedTotal.reset();
  merchantCacheOperationsTotal.reset();
  merchantRouteRequestsTotal.reset();
  merchantRouteRequestDurationSeconds.reset();
  merchantRouteInFlight.reset();
}
