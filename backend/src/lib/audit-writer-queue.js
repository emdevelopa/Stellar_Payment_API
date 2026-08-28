/**
 * Audit Writer Queue - Race Condition Fix (Issue #1330)
 *
 * Provides a thread-safe queue for audit log writes to prevent race conditions
 * when multiple concurrent requests attempt to write audit logs simultaneously.
 *
 * Key features:
 * - Sequential processing: ensures writes happen one at a time
 * - Promise-based queueing: callers await their turn
 * - Graceful error handling: one failed write doesn't block the queue
 * - Metrics integration: tracks queue depth and processing time
 * - Memory bounded: configurable max queue size prevents OOM
 *
 * Race condition scenario (fixed):
 * Before: Two login attempts could interleave their DB writes, causing:
 *   - Lost audit logs (one overwrites the other's transaction)
 *   - Integrity hash mismatches
 *   - Inconsistent signature verification
 *
 * After: All writes are serialized through a promise queue
 */

import { auditLogQueueDepth, auditLogQueueWaitDuration } from "./metrics.js";

export class AuditWriterQueue {
  constructor({ maxQueueSize = 1000, label = "audit-queue" } = {}) {
    this.maxQueueSize = maxQueueSize;
    this.label = label;
    this.queue = [];
    this.processing = false;
    this.droppedCount = 0;
  }

  /**
   * Enqueues a write operation and waits for it to complete.
   * Throws if queue is full (circuit breaker should catch this upstream).
   */
  async enqueue(writeFn) {
    if (this.queue.length >= this.maxQueueSize) {
      this.droppedCount++;
      throw new Error(`Audit write queue full (${this.maxQueueSize} entries)`);
    }

    const enqueuedAt = process.hrtime.bigint();

    return new Promise((resolve, reject) => {
      this.queue.push({
        writeFn,
        resolve,
        reject,
        enqueuedAt,
      });

      auditLogQueueDepth.set({ label: this.label }, this.queue.length);

      // Start processing if not already running
      if (!this.processing) {
        this.processQueue().catch((err) => {
          console.error(`[${this.label}] Queue processing failed:`, err);
        });
      }
    });
  }

  async processQueue() {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift();
      auditLogQueueDepth.set({ label: this.label }, this.queue.length);

      const waitDurationSeconds = Number(process.hrtime.bigint() - item.enqueuedAt) / 1e9;
      auditLogQueueWaitDuration.observe({ label: this.label }, waitDurationSeconds);

      try {
        const result = await item.writeFn();
        item.resolve(result);
      } catch (err) {
        item.reject(err);
      }
    }

    this.processing = false;
  }

  /**
   * Returns queue stats for monitoring
   */
  getStats() {
    return {
      queueDepth: this.queue.length,
      droppedCount: this.droppedCount,
      processing: this.processing,
      maxQueueSize: this.maxQueueSize,
    };
  }

  /**
   * Test helper: reset queue state
   */
  _resetForTests() {
    this.queue = [];
    this.processing = false;
    this.droppedCount = 0;
  }
}

/**
 * Wraps an audit writer to use the queue for all writes
 */
export function createQueuedAuditWriter(writer, queueLabel) {
  const queue = new AuditWriterQueue({ label: queueLabel });

  return {
    ...writer,
    write: (sql, params, payload) => {
      // Enqueue the write, ensuring it executes sequentially
      return queue.enqueue(() => writer.write(sql, params, payload));
    },
    getQueueStats: () => queue.getStats(),
    _resetQueueForTests: () => queue._resetForTests(),
  };
}
