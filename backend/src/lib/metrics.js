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

// Register custom metrics
register.registerMetric(paymentCreatedCounter);
register.registerMetric(paymentConfirmedCounter);
register.registerMetric(paymentFailedCounter);
register.registerMetric(paymentConfirmationLatency);
register.registerMetric(pgPoolTotalConnections);
register.registerMetric(pgPoolIdleConnections);
register.registerMetric(pgPoolWaitingRequests);
register.registerMetric(pgPoolUtilizationPercent);

export { register };
