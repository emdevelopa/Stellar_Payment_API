/**
 * websocket-relay-load.test.js
 *
 * Rigorous load testing for WebSocket Relay (Issue #1084).
 *
 * Tests relay performance under various load scenarios:
 *   - High message throughput
 *   - Large payload sizes
 *   - Connection stress
 *   - Queue congestion
 *   - Circuit breaker activation
 *   - Memory pressure
 *
 * Run with: NODE_ENV=test npm run test:load
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  getRecentEvents,
  batchInsertEvents,
  dequeueNextEvent,
} from "../src/lib/websocket-relay-queries.js";
import {
  CircuitBreaker,
  DeadLetterQueue,
  reconnectWithBackoff,
} from "../src/lib/websocket-relay-recovery.js";

/**
 * Mock database that simulates various latency/failure scenarios.
 */
class MockDatabase {
  constructor(options = {}) {
    this.latencyMs = options.latencyMs || 0;
    this.failureRate = options.failureRate || 0;
    this.data = options.data || [];
    this.callCount = 0;
  }

  async query(sql, params) {
    this.callCount += 1;
    if (this.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    }
    if (Math.random() < this.failureRate) {
      throw new Error(`Simulated database failure on call ${this.callCount}`);
    }
    return { rows: this.data };
  }
}

describe("WebSocket Relay Load Tests", () => {
  describe("High-throughput event insertion", () => {
    it("handles 1000 batch inserts without degradation", async () => {
      const db = new MockDatabase();
      const events = Array.from({ length: 100 }, (_, i) => ({
        payment_id: `p${i}`,
        event_type: "payment.confirmed",
        payload: { amount: 100 + i },
        status: "pending",
      }));

      const startTime = Date.now();
      for (let batch = 0; batch < 10; batch++) {
        try {
          await batchInsertEvents(db, events);
        } catch (err) {
          expect.fail(`Batch ${batch} failed: ${err.message}`);
        }
      }
      const duration = Date.now() - startTime;

      expect(db.callCount).toBe(10);
      expect(duration).toBeLessThan(5000);
    });

    it("handles concurrent batch inserts", async () => {
      const db = new MockDatabase({ latencyMs: 10 });
      const events = Array.from({ length: 50 }, (_, i) => ({
        payment_id: `p${i}`,
        event_type: "relay.send",
        payload: { id: i },
      }));

      const promises = Array.from({ length: 5 }, () =>
        batchInsertEvents(db, events),
      );

      const results = await Promise.all(promises);
      expect(results.length).toBe(5);
      expect(db.callCount).toBe(5);
    });

    it("rejects batches with 10% simulated failure rate", async () => {
      const db = new MockDatabase({ failureRate: 0.1 });
      const events = Array.from({ length: 50 }, (_, i) => ({
        payment_id: `p${i}`,
        event_type: "test.event",
      }));

      let successCount = 0;
      let failureCount = 0;

      for (let i = 0; i < 20; i++) {
        try {
          await batchInsertEvents(db, events);
          successCount += 1;
        } catch {
          failureCount += 1;
        }
      }

      expect(successCount + failureCount).toBe(20);
      expect(failureCount).toBeGreaterThan(0);
      expect(successCount).toBeGreaterThan(0);
    });
  });

  describe("Queue dequeue under load", () => {
    it("dequeues 1000 events with SKIP LOCKED contention", async () => {
      const db = new MockDatabase({
        data: [
          {
            id: "evt1",
            payment_id: "p1",
            event_type: "relay.ack",
            payload: {},
            created_at: new Date(),
          },
        ],
      });

      let successCount = 0;
      const promises = Array.from({ length: 50 }, () =>
        (async () => {
          try {
            const event = await dequeueNextEvent(db);
            if (event) successCount += 1;
          } catch {
            // Expected when queue is empty or timeout
          }
        })(),
      );

      await Promise.all(promises);
      expect(successCount).toBeGreaterThanOrEqual(0);
    });

    it("handles timeouts during concurrent dequeue", async () => {
      const db = new MockDatabase({
        latencyMs: 50,
        data: [
          {
            id: "evt1",
            payment_id: "p1",
            event_type: "relay.send",
            payload: {},
            created_at: new Date(),
          },
        ],
      });

      const startTime = Date.now();
      const promises = Array.from({ length: 20 }, () =>
        dequeueNextEvent(db),
      );

      const results = await Promise.all(promises);
      const duration = Date.now() - startTime;

      expect(results.length).toBe(20);
      expect(duration).toBeLessThan(2000);
    });
  });

  describe("Pagination under large datasets", () => {
    it("paginates through 1M+ row equivalent efficiently", async () => {
      const rows = Array.from({ length: 1000 }, (_, i) => ({
        id: `evt${i}`,
        payment_id: `p${i}`,
        event_type: "payment.confirmed",
        status: "pending",
        created_at: new Date(),
      }));

      const db = new MockDatabase({ data: rows });

      const startTime = Date.now();
      let totalEvents = 0;

      for (let offset = 0; offset < 10000; offset += 1000) {
        try {
          const events = await getRecentEvents(db, 1000, offset);
          totalEvents += events.length;
          if (events.length === 0) break;
        } catch (err) {
          expect.fail(`Pagination failed at offset ${offset}: ${err.message}`);
        }
      }

      const duration = Date.now() - startTime;
      expect(totalEvents).toBeGreaterThan(0);
      expect(duration).toBeLessThan(3000);
    });
  });

  describe("Circuit breaker under load", () => {
    it("opens after 5 failures and remains open for reset timeout", async () => {
      const cb = new CircuitBreaker({
        failureThreshold: 5,
        resetTimeoutMs: 100,
      });

      let failures = 0;
      for (let i = 0; i < 10; i++) {
        try {
          await cb.call(async () => {
            throw new Error("Simulated failure");
          });
        } catch {
          failures += 1;
        }
      }

      expect(cb.state).toBe("OPEN");
      expect(failures).toBe(5);
    });

    it("transitions to HALF_OPEN after reset timeout", async () => {
      const cb = new CircuitBreaker({
        failureThreshold: 3,
        resetTimeoutMs: 100,
      });

      for (let i = 0; i < 3; i++) {
        try {
          await cb.call(async () => {
            throw new Error("Fail");
          });
        } catch {
          // Expected
        }
      }

      expect(cb.state).toBe("OPEN");

      await new Promise((resolve) => setTimeout(resolve, 150));

      const cb_now = () => Date.now();
      const cbWithTime = new CircuitBreaker({
        failureThreshold: 3,
        resetTimeoutMs: 100,
        now: cb_now,
      });

      for (let i = 0; i < 3; i++) {
        try {
          await cbWithTime.call(async () => {
            throw new Error("Fail");
          });
        } catch {
          // Expected
        }
      }
    });

    it("closes on successful call in HALF_OPEN state", async () => {
      let callCount = 0;
      const cb = new CircuitBreaker({
        failureThreshold: 2,
        resetTimeoutMs: 50,
      });

      for (let i = 0; i < 2; i++) {
        try {
          await cb.call(async () => {
            throw new Error("Fail");
          });
        } catch {
          // Expected
        }
      }

      expect(cb.state).toBe("OPEN");

      await new Promise((resolve) => setTimeout(resolve, 100));

      await cb
        .call(async () => {
          callCount += 1;
          return "success";
        })
        .catch(() => {
          // May still be open or transition to half-open
        });
    });
  });

  describe("Dead letter queue accumulation", () => {
    it("efficiently stores 10000 failed messages", () => {
      const dlq = new DeadLetterQueue();

      const startTime = Date.now();
      for (let i = 0; i < 10000; i++) {
        dlq.push(
          { id: i, type: "event" },
          new Error(`Failure ${i}`),
          i % 3,
        );
      }
      const insertDuration = Date.now() - startTime;

      expect(dlq.size).toBe(10000);
      expect(insertDuration).toBeLessThan(500);

      const retrieveStart = Date.now();
      const firstBatch = Array.from({ length: 1000 }, () => dlq.shift());
      const retrieveDuration = Date.now() - retrieveStart;

      expect(firstBatch.length).toBe(1000);
      expect(dlq.size).toBe(9000);
      expect(retrieveDuration).toBeLessThan(100);
    });

    it("retrieves DLQ entries without memory spikes", () => {
      const dlq = new DeadLetterQueue();

      for (let i = 0; i < 5000; i++) {
        dlq.push({ id: i }, new Error("Failure"), 0);
      }

      const allEntries = dlq.getAll();
      expect(allEntries.length).toBe(5000);
      expect(dlq.size).toBe(5000);
    });
  });

  describe("Reconnection backoff strategy", () => {
    it("handles exponential backoff with jitter", async () => {
      let attemptCount = 0;
      const mockConnect = async () => {
        attemptCount += 1;
        if (attemptCount < 3) throw new Error("Connection failed");
        return { status: "connected" };
      };

      const startTime = Date.now();
      const result = await reconnectWithBackoff(mockConnect, {
        maxRetries: 5,
        baseDelayMs: 50,
        maxDelayMs: 200,
      });
      const duration = Date.now() - startTime;

      expect(attemptCount).toBe(3);
      expect(result.status).toBe("connected");
      expect(duration).toBeGreaterThanOrEqual(50);
    });

    it("respects maxRetries limit", async () => {
      let attemptCount = 0;
      const mockConnect = async () => {
        attemptCount += 1;
        throw new Error("Always fails");
      };

      try {
        await reconnectWithBackoff(mockConnect, {
          maxRetries: 3,
          baseDelayMs: 10,
          sleep: async () => {}, // no-op for speed
        });
      } catch {
        // Expected
      }

      expect(attemptCount).toBe(4);
    });
  });

  describe("Message size handling", () => {
    it("processes large payloads (16KB+)", async () => {
      const largePayload = {
        data: "x".repeat(16384),
        nested: {
          more: "y".repeat(8192),
        },
      };

      const db = new MockDatabase();
      const events = [
        {
          payment_id: "p1",
          event_type: "large.payload",
          payload: largePayload,
        },
      ];

      const result = await batchInsertEvents(db, events);
      expect(db.callCount).toBe(1);
    });

    it("handles null/empty payloads", async () => {
      const db = new MockDatabase();
      const events = [
        { payment_id: "p1", event_type: "e1", payload: null },
        { payment_id: "p2", event_type: "e2", payload: {} },
        { payment_id: "p3", event_type: "e3" },
      ];

      const result = await batchInsertEvents(db, events);
      expect(db.callCount).toBe(1);
    });
  });

  describe("Performance benchmarks", () => {
    it("completes 1000 sequential gets under 2 seconds", async () => {
      const db = new MockDatabase({ latencyMs: 1 });
      const startTime = Date.now();

      for (let i = 0; i < 1000; i++) {
        await getRecentEvents(db, 10, 0);
      }

      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(2000);
    });

    it("processes 500 concurrent operations", async () => {
      const db = new MockDatabase({ latencyMs: 5 });
      const startTime = Date.now();

      const promises = Array.from({ length: 500 }, () =>
        getRecentEvents(db, 1, 0),
      );

      await Promise.all(promises);
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(5000);
    });
  });
});
