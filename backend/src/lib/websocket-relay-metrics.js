/**
 * websocket-relay-metrics.js
 *
 * Granular WebSocket Relay metrics (Issue #1083).
 *
 * Tracks fine-grained relay operations:
 *   - Connection lifecycle (connected, disconnected, reconnected)
 *   - Message processing (received, sent, failed)
 *   - Relay event queue (enqueued, dequeued, completed, failed)
 *   - Circuit breaker state changes
 *   - Dead letter queue accumulation
 *   - Connection health and latency
 *
 * Metrics are integrated with Prometheus for production monitoring.
 */

import client from "prom-client";

const register = new client.Registry();

register.setDefaultLabels({
  app: "stellar-payment-api",
  module: "websocket-relay",
});

// ─── Connection Lifecycle Metrics ────────────────────────────────────────

export const relayConnectionsTotal = new client.Counter({
  name: "relay_connections_total",
  help: "Total number of relay connections established",
  labelNames: ["status"], // connected | reconnected
});

export const relayConnectionsActive = new client.Gauge({
  name: "relay_connections_active",
  help: "Number of currently active relay connections",
});

export const relayReconnectAttemptsTotal = new client.Counter({
  name: "relay_reconnect_attempts_total",
  help: "Total number of reconnection attempts",
  labelNames: ["outcome"], // success | failure
});

export const relayReconnectDuration = new client.Histogram({
  name: "relay_reconnect_duration_seconds",
  help: "Duration of reconnection attempts in seconds",
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
});

// ─── Message Processing Metrics ──────────────────────────────────────────

export const relayMessagesReceivedTotal = new client.Counter({
  name: "relay_messages_received_total",
  help: "Total number of messages received from relay",
  labelNames: ["type"], // normal | error | control
});

export const relayMessagesSentTotal = new client.Counter({
  name: "relay_messages_sent_total",
  help: "Total number of messages sent to relay",
  labelNames: ["type", "outcome"], // type: event | ack | heartbeat; outcome: success | failure
});

export const relayMessageLatency = new client.Histogram({
  name: "relay_message_latency_seconds",
  help: "Message processing latency in seconds",
  labelNames: ["direction"], // inbound | outbound
  buckets: [0.001, 0.01, 0.05, 0.1, 0.5, 1, 2.5],
});

export const relayMessageSizeBytes = new client.Histogram({
  name: "relay_message_size_bytes",
  help: "Message size distribution in bytes",
  labelNames: ["direction"], // inbound | outbound
  buckets: [128, 512, 1024, 4096, 16384, 65536],
});

// ─── Event Queue Metrics ─────────────────────────────────────────────────

export const relayEventsEnqueuedTotal = new client.Counter({
  name: "relay_events_enqueued_total",
  help: "Total number of events enqueued for relay",
  labelNames: ["event_type"],
});

export const relayEventsDequeuedTotal = new client.Counter({
  name: "relay_events_dequeued_total",
  help: "Total number of events dequeued from relay",
});

export const relayEventsProcessedTotal = new client.Counter({
  name: "relay_events_processed_total",
  help: "Total number of events successfully processed",
  labelNames: ["event_type"],
});

export const relayEventsFailedTotal = new client.Counter({
  name: "relay_events_failed_total",
  help: "Total number of events that failed processing",
  labelNames: ["event_type", "reason"], // reason: timeout | circuit_open | delivery_failed | validation_failed
});

export const relayEventProcessingDuration = new client.Histogram({
  name: "relay_event_processing_duration_seconds",
  help: "Duration of event processing in seconds",
  labelNames: ["event_type"],
  buckets: [0.01, 0.1, 0.5, 1, 2.5, 5, 10],
});

export const relayQueueSize = new client.Gauge({
  name: "relay_queue_size",
  help: "Current number of pending events in queue",
  labelNames: ["status"], // pending | processing
});

// ─── Circuit Breaker Metrics ─────────────────────────────────────────────

export const relayCircuitBreakerState = new client.Gauge({
  name: "relay_circuit_breaker_state",
  help: "Current circuit breaker state (0=CLOSED, 1=OPEN, 2=HALF_OPEN)",
});

export const relayCircuitBreakerTrips = new client.Counter({
  name: "relay_circuit_breaker_trips_total",
  help: "Total number of times circuit breaker transitioned to OPEN",
});

export const relayCircuitBreakerRecoveries = new client.Counter({
  name: "relay_circuit_breaker_recoveries_total",
  help: "Total number of times circuit breaker recovered to CLOSED",
});

export const relayCircuitBreakerFailureCount = new client.Gauge({
  name: "relay_circuit_breaker_failure_count",
  help: "Current failure count in circuit breaker",
});

// ─── Dead Letter Queue Metrics ───────────────────────────────────────────

export const relayDlqSize = new client.Gauge({
  name: "relay_dlq_size",
  help: "Number of messages in the dead letter queue",
});

export const relayDlqMessagesMovedTotal = new client.Counter({
  name: "relay_dlq_messages_moved_total",
  help: "Total number of messages moved to DLQ",
  labelNames: ["reason"], // timeout | circuit_open | delivery_failed | signature_invalid
});

// ─── Connection Health Metrics ───────────────────────────────────────────

export const relayHealthStatus = new client.Gauge({
  name: "relay_health_status",
  help: "Overall relay health status (0=degraded, 1=healthy)",
});

export const relayLastHeartbeatSeconds = new client.Gauge({
  name: "relay_last_heartbeat_seconds",
  help: "Unix timestamp of the last successful heartbeat",
});

export const relayUptime = new client.Gauge({
  name: "relay_uptime_seconds",
  help: "Seconds since the relay connection was established",
});

// ─── Error Metrics ───────────────────────────────────────────────────────

export const relayErrorsTotal = new client.Counter({
  name: "relay_errors_total",
  help: "Total number of relay errors",
  labelNames: ["type"], // connection | parsing | validation | timeout | unknown
});

export const relayLastErrorTimestamp = new client.Gauge({
  name: "relay_last_error_timestamp",
  help: "Unix timestamp of the last relay error",
});

// Register all metrics
register.registerMetric(relayConnectionsTotal);
register.registerMetric(relayConnectionsActive);
register.registerMetric(relayReconnectAttemptsTotal);
register.registerMetric(relayReconnectDuration);
register.registerMetric(relayMessagesReceivedTotal);
register.registerMetric(relayMessagesSentTotal);
register.registerMetric(relayMessageLatency);
register.registerMetric(relayMessageSizeBytes);
register.registerMetric(relayEventsEnqueuedTotal);
register.registerMetric(relayEventsDequeuedTotal);
register.registerMetric(relayEventsProcessedTotal);
register.registerMetric(relayEventsFailedTotal);
register.registerMetric(relayEventProcessingDuration);
register.registerMetric(relayQueueSize);
register.registerMetric(relayCircuitBreakerState);
register.registerMetric(relayCircuitBreakerTrips);
register.registerMetric(relayCircuitBreakerRecoveries);
register.registerMetric(relayCircuitBreakerFailureCount);
register.registerMetric(relayDlqSize);
register.registerMetric(relayDlqMessagesMovedTotal);
register.registerMetric(relayHealthStatus);
register.registerMetric(relayLastHeartbeatSeconds);
register.registerMetric(relayUptime);
register.registerMetric(relayErrorsTotal);
register.registerMetric(relayLastErrorTimestamp);

export { register as relayMetricsRegister };
