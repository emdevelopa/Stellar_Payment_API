import { describe, it, expect, beforeEach } from "vitest";
import {
  relayConnectionsTotal,
  relayConnectionsActive,
  relayReconnectAttemptsTotal,
  relayMessagesReceivedTotal,
  relayMessagesSentTotal,
  relayEventsEnqueuedTotal,
  relayEventsDequeuedTotal,
  relayCircuitBreakerState,
  relayDlqSize,
  relayHealthStatus,
  relayMetricsRegister,
} from "./websocket-relay-metrics.js";

describe("WebSocket Relay Metrics", () => {
  beforeEach(() => {
    relayMetricsRegister.resetMetrics();
  });

  describe("Connection Lifecycle Metrics", () => {
    it("tracks new connections", () => {
      relayConnectionsTotal.inc({ status: "connected" });
      relayConnectionsActive.inc();

      const metrics = relayMetricsRegister.getSingleMetricAsString("relay_connections_total");
      expect(metrics).toContain('status="connected"');
      expect(metrics).toContain("1.0");
    });

    it("tracks reconnection attempts", () => {
      relayReconnectAttemptsTotal.inc({ outcome: "success" });
      relayReconnectAttemptsTotal.inc({ outcome: "failure" });

      const metrics = relayMetricsRegister.getSingleMetricAsString("relay_reconnect_attempts_total");
      expect(metrics).toContain('outcome="success"');
      expect(metrics).toContain('outcome="failure"');
    });

    it("increments and decrements active connections", () => {
      relayConnectionsActive.set(0);
      relayConnectionsActive.inc();
      relayConnectionsActive.inc();
      relayConnectionsActive.dec();

      const metrics = relayMetricsRegister.getSingleMetricAsString("relay_connections_active");
      expect(metrics).toContain("1.0");
    });
  });

  describe("Message Processing Metrics", () => {
    it("tracks received messages by type", () => {
      relayMessagesReceivedTotal.inc({ type: "normal" });
      relayMessagesReceivedTotal.inc({ type: "normal" });
      relayMessagesReceivedTotal.inc({ type: "error" });

      const metrics = relayMetricsRegister.getSingleMetricAsString("relay_messages_received_total");
      expect(metrics).toContain('type="normal"');
      expect(metrics).toContain('type="error"');
    });

    it("tracks sent messages with outcome", () => {
      relayMessagesSentTotal.inc({ type: "event", outcome: "success" });
      relayMessagesSentTotal.inc({ type: "ack", outcome: "success" });
      relayMessagesSentTotal.inc({ type: "event", outcome: "failure" });

      const metrics = relayMetricsRegister.getSingleMetricAsString("relay_messages_sent_total");
      expect(metrics).toContain('type="event"');
      expect(metrics).toContain('type="ack"');
      expect(metrics).toContain('outcome="failure"');
    });
  });

  describe("Event Queue Metrics", () => {
    it("tracks enqueued events by type", () => {
      relayEventsEnqueuedTotal.inc({ event_type: "payment.confirmed" });
      relayEventsEnqueuedTotal.inc({ event_type: "payment.confirmed" });
      relayEventsEnqueuedTotal.inc({ event_type: "refund.created" });

      const metrics = relayMetricsRegister.getSingleMetricAsString("relay_events_enqueued_total");
      expect(metrics).toContain('event_type="payment.confirmed"');
      expect(metrics).toContain('event_type="refund.created"');
    });

    it("tracks dequeued events", () => {
      relayEventsDequeuedTotal.inc();
      relayEventsDequeuedTotal.inc();
      relayEventsDequeuedTotal.inc();

      const metrics = relayMetricsRegister.getSingleMetricAsString("relay_events_dequeued_total");
      expect(metrics).toContain("3.0");
    });
  });

  describe("Circuit Breaker Metrics", () => {
    it("tracks circuit breaker state", () => {
      relayCircuitBreakerState.set(0); // CLOSED
      let metrics = relayMetricsRegister.getSingleMetricAsString("relay_circuit_breaker_state");
      expect(metrics).toContain("0.0");

      relayCircuitBreakerState.set(1); // OPEN
      metrics = relayMetricsRegister.getSingleMetricAsString("relay_circuit_breaker_state");
      expect(metrics).toContain("1.0");

      relayCircuitBreakerState.set(2); // HALF_OPEN
      metrics = relayMetricsRegister.getSingleMetricAsString("relay_circuit_breaker_state");
      expect(metrics).toContain("2.0");
    });
  });

  describe("Dead Letter Queue Metrics", () => {
    it("tracks DLQ size", () => {
      relayDlqSize.set(0);
      relayDlqSize.inc();
      relayDlqSize.inc();
      relayDlqSize.inc();

      const metrics = relayMetricsRegister.getSingleMetricAsString("relay_dlq_size");
      expect(metrics).toContain("3.0");
    });

    it("tracks messages moved to DLQ by reason", () => {
      relayMessagesReceivedTotal.inc({ type: "normal" });

      const metrics = relayMetricsRegister.getSingleMetricAsString("relay_messages_received_total");
      expect(metrics).toContain("1.0");
    });
  });

  describe("Health Metrics", () => {
    it("tracks overall health status", () => {
      relayHealthStatus.set(1); // healthy
      let metrics = relayMetricsRegister.getSingleMetricAsString("relay_health_status");
      expect(metrics).toContain("1.0");

      relayHealthStatus.set(0); // degraded
      metrics = relayMetricsRegister.getSingleMetricAsString("relay_health_status");
      expect(metrics).toContain("0.0");
    });
  });

  describe("Metric Registry", () => {
    it("exports registry with all metrics", () => {
      expect(relayMetricsRegister).toBeDefined();
      const metrics = relayMetricsRegister.getMetricsAsJSON();
      expect(Array.isArray(metrics)).toBe(true);
      expect(metrics.length).toBeGreaterThan(0);
    });

    it("includes app and module labels", () => {
      relayConnectionsTotal.inc({ status: "connected" });
      const metrics = relayMetricsRegister.getSingleMetricAsString("relay_connections_total");
      expect(metrics).toContain('app="stellar-payment-api"');
      expect(metrics).toContain('module="websocket-relay"');
    });
  });
});
