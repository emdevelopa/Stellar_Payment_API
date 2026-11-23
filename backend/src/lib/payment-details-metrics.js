import client from "prom-client";

/**
 * Metrics for the Public Hosted Checkout Session Route's Horizon lookups and
 * dead-letter recovery (#1776). Isolated registry, merged into /metrics by
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

export function resetPaymentDetailsMetrics() {
  paymentDetailsHorizonFetchTotal.reset();
  paymentDetailsHorizonRetriesTotal.reset();
  paymentDetailsDlqDepth.reset();
  paymentDetailsDlqOperationsTotal.reset();
}
