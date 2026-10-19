/**
 * Audit Writer Queue - Race Condition Fix (Issue #1330)
 *
 * Provides a thread-safe queue for audit log writes to prevent race conditions
 * when multiple concurrent requests attempt to write audit logs simultaneously.
 *
 * Key features:
 * - Sequential processing: ensures writes happen one at a time (default)
 * - Promise-based queueing: callers await their turn
 * - Graceful error handling: one failed write doesn't block the queue
 * - Metrics integration: tracks queue depth, processing time, and active concurrency
 * - Memory bounded: configurable max queue size prevents OOM
 *
 * Issue #1435 — Distributed concurrency control:
 *   Adds `setMaxConcurrency(n)` to control how many write operations run in
 *   parallel. Internally uses a semaphore (counter + waiter queue) so that
 *   transitioning from fully-sequential (n=1) to concurrent (n>1) is safe at
 *   runtime. Adds `audit_write_queue_concurrency_active` Gauge metric.
 *
 * Race condition scenario (fixed):
 * Before: Two login attempts could interleave their DB writes, causing:
 *   - Lost audit logs (one overwrites the other's transaction)
 *   - Integrity hash mismatches
 *   - Inconsistent signature verification
 *
 * After: All writes are serialized through a promise queue (or bounded by
 *        the configured maxConcurrency semaphore).
 */

import client from "prom-client";
import { auditLogQueueDepth, auditLogQueueWaitDuration } from "./metrics.js";

// ── Concurrency-active gauge (self-contained to avoid naming conflicts) ──────

const _queueRegistry = new client.Registry();

const auditWriteQueueConcurrencyActive = new client.Gauge({
  name: "audit_write_queue_concurrency_active",
  help: "Number of audit write operations currently executing (bounded by maxConcurrency)",
  labelNames: ["label"],
  registers: [_queueRegistry],
});

export class AuditWriterQueue {
  /**
   * @param {object} opts
   * @param {number} [opts.maxQueueSize=1000]  - Maximum pending items before dropping
   * @param {string} [opts.label="audit-queue"] - Prometheus/log label
   * @param {number} [opts.maxConcurrency=1]   - Max parallel write operations
   */
  constructor({ maxQueueSize = 1000, label = "audit-queue", maxConcurrency = 1 } = {}) {
    this.maxQueueSize = maxQueueSize;
    this.label = label;

    this.queue = [];
    this.processing = false;
    this.droppedCount = 0;

    // Semaphore state
    this._maxConcurrency = maxConcurrency;
    this._activeCount = 0;       // currently running operations
    this._semWaiters = [];       // resolve callbacks waiting to acquire a slot
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Dynamically update the concurrency limit.
   * Immediately allows additional waiters to proceed if the new limit is higher.
   *
   * @param {number} n - New maximum concurrency (must be >= 1)
   */
  setMaxConcurrency(n) {
    if (typeof n !== "number" || n < 1) {
      throw new RangeError("maxConcurrency must be a positive integer");
    }
    this._maxConcurrency = n;
    // Wake up any queued waiters that can now proceed.
    this._drainSemaphoreWaiters();
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

      // Start processing if not already running.
      if (!this.processing) {
        this.processQueue().catch((err) => {
          console.error(`[${this.label}] Queue processing failed:`, err);
        });
      }
    });
  }

  // ── Internal processing ─────────────────────────────────────────────────────

  async processQueue() {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      // Acquire a concurrency slot before dispatching.
      await this._acquireSlot();

      const item = this.queue.shift();
      if (!item) {
        // Queue drained while we were waiting; release and re-check.
        this._releaseSlot();
        continue;
      }

      auditLogQueueDepth.set({ label: this.label }, this.queue.length);

      const waitDurationSeconds =
        Number(process.hrtime.bigint() - item.enqueuedAt) / 1e9;
      auditLogQueueWaitDuration.observe({ label: this.label }, waitDurationSeconds);

      auditWriteQueueConcurrencyActive.set({ label: this.label }, this._activeCount);

      // Dispatch the write without awaiting here so that when maxConcurrency > 1
      // the loop can immediately grab another slot.
      const dispatch = item.writeFn()
        .then((result) => {
          item.resolve(result);
        })
        .catch((err) => {
          item.reject(err);
        })
        .finally(() => {
          this._releaseSlot();
          auditWriteQueueConcurrencyActive.set({ label: this.label }, this._activeCount);
        });

      // When fully sequential (maxConcurrency === 1) we must wait for the
      // dispatch to finish before allowing the next item through; the semaphore
      // enforces this naturally because _activeCount will equal _maxConcurrency.
      // For maxConcurrency > 1 we let the loop continue immediately.
      if (this._maxConcurrency === 1) {
        await dispatch;
      }
    }

    this.processing = false;
  }

  // ── Semaphore helpers ────────────────────────────────────────────────────────

  /**
   * Waits until a concurrency slot is available, then claims it.
   * @returns {Promise<void>}
   */
  _acquireSlot() {
    if (this._activeCount < this._maxConcurrency) {
      this._activeCount++;
      return Promise.resolve();
    }
    // All slots taken — queue until one is released.
    return new Promise((resolve) => {
      this._semWaiters.push(resolve);
    });
  }

  /**
   * Releases a concurrency slot, waking the next waiter if any.
   */
  _releaseSlot() {
    this._activeCount = Math.max(0, this._activeCount - 1);
    this._drainSemaphoreWaiters();
  }

  /**
   * Wake up as many semaphore waiters as possible given current limit.
   */
  _drainSemaphoreWaiters() {
    while (
      this._semWaiters.length > 0 &&
      this._activeCount < this._maxConcurrency
    ) {
      this._activeCount++;
      const next = this._semWaiters.shift();
      next();
    }
  }

  // ── Monitoring & test helpers ────────────────────────────────────────────────

  /**
   * Returns queue stats for monitoring.
   */
  getStats() {
    return {
      queueDepth: this.queue.length,
      droppedCount: this.droppedCount,
      processing: this.processing,
      maxQueueSize: this.maxQueueSize,
      maxConcurrency: this._maxConcurrency,
      activeCount: this._activeCount,
    };
  }

  /**
   * Test helper: reset queue state.
   */
  _resetForTests() {
    this.queue = [];
    this.processing = false;
    this.droppedCount = 0;
    this._activeCount = 0;
    this._semWaiters = [];
  }
}

/**
 * Wraps an audit writer to use the queue for all writes.
 */
export function createQueuedAuditWriter(writer, queueLabel) {
  const queue = new AuditWriterQueue({ label: queueLabel });

  return {
    ...writer,
    write: (sql, params, payload) => {
      // Enqueue the write, ensuring it executes within the concurrency limit.
      return queue.enqueue(() => writer.write(sql, params, payload));
    },
    getQueueStats: () => queue.getStats(),
    _resetQueueForTests: () => queue._resetForTests(),
    // Expose the queue instance for tests that need setMaxConcurrency.
    _queue: queue,
  };
}
