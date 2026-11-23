import client from "prom-client";

/**
 * Metrics for the Public Hosted Checkout Session Route's Horizon lookups,
 * dead-letter recovery (#1776), and caching and throughput telemetry (#1775). Isolated registry, merged into /metrics by
 * routes/prometheus.js.
 */
export const paymentDetailsRegister = new client.Registry();
paymentDetailsRegister.setDefaultLabels({ app: "stellar-payment-api" });

/** outcome: success | cache_hit | not_found | error | dead_lettered */
export const paymentDetailsHorizonFetchTotal = new client.Counter({
  name: "payment_details_horizon_fetch_total",
  help: "Horizon transaction lookups for payment details by outcome",
  labelNames: ["outcome"],
  registers: [paymentDetailsRegister],
});

export const paymentDetailsHorizonRetriesTotal = new client.Counter({
  name: "payment_details_horizon_retries_total",
  help: "Retried Horizon transaction lookups for payment details",
  registers: [paymentDetailsRegister],
});

export const paymentDetailsDlqDepth = new client.Gauge({
  name: "payment_details_dlq_depth",
  help: "Current number of payment-details lookups in the dead-letter queue",
  registers: [paymentDetailsRegister],
});

/** action: push | recover | retry | exhaust | evict | clear */
export const paymentDetailsDlqOperationsTotal = new client.Counter({
  name: "payment_details_dlq_operations_total",
  help: "Payment-details dead-letter queue operations by action and status",
  labelNames: ["action", "status"],
  registers: [paymentDetailsRegister],
});

/**
 * Distributed cache operations (#1775).
 * result: hit | miss | bypass | error | store | store_error | skip_store
 */
export const paymentDetailsCacheOperationsTotal = new client.Counter({
  name: "payment_details_cache_operations_total",
  help: "Payment details Redis cache operations by result",
  labelNames: ["result"],
  registers: [paymentDetailsRegister],
});

/** Throughput telemetry (#1775). route is the Express pattern, e.g. "/:id". */
export const paymentDetailsRequestsTotal = new client.Counter({
  name: "payment_details_requests_total",
  help: "Payment details requests by route, method and status class",
  labelNames: ["route", "method", "status_class"],
  registers: [paymentDetailsRegister],
});

export const paymentDetailsRequestDurationSeconds = new client.Histogram({
  name: "payment_details_request_duration_seconds",
  help: "Payment details request latency",
  labelNames: ["route", "method"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [paymentDetailsRegister],
});

export const paymentDetailsInFlight = new client.Gauge({
  name: "payment_details_in_flight_requests",
  help: "Payment details requests currently being served",
  labelNames: ["route"],
  registers: [paymentDetailsRegister],
});

export function resetPaymentDetailsMetrics() {
  paymentDetailsHorizonFetchTotal.reset();
  paymentDetailsHorizonRetriesTotal.reset();
  paymentDetailsDlqDepth.reset();
  paymentDetailsDlqOperationsTotal.reset();
  paymentDetailsCacheOperationsTotal.reset();
  paymentDetailsRequestsTotal.reset();
  paymentDetailsRequestDurationSeconds.reset();
  paymentDetailsInFlight.reset();
}
