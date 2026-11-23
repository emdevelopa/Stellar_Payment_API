import client from "prom-client";

/**
 * Metrics for the Merchant Onboarding and Key Lifecycle Route: concurrency
 * control (#1772) and dead-letter recovery (#1771). Isolated registry, merged
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

export function resetMerchantLifecycleMetrics() {
  merchantLockTotal.reset();
  merchantLockHeldSeconds.reset();
  merchantCredentialConflictsTotal.reset();
  merchantPersistRetriesTotal.reset();
  merchantDlqDepth.reset();
  merchantDlqOperationsTotal.reset();
}
