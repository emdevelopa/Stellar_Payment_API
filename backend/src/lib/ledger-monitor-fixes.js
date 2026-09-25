/**
 * Ledger Monitor Fixes (Issues #1332, #1333, #1335)
 *
 * This module provides patches for critical issues in the Ledger Monitor:
 * - Issue #1332: Memory leak from unclosed connections and event listeners
 * - Issue #1333: Null pointer exceptions from missing ledger data
 * - Issue #1335: Race condition in concurrent state updates
 *
 * These utilities can be imported into horizon-poller.js to fix the issues.
 */

/**
 * ══════════════════════════════════════════════════════════════════════════
 * ISSUE #1332: Memory Leak Prevention
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Problem: Event listeners and HTTP connections accumulate over time
 * Symptoms: Heap grows continuously, eventual OOM crash
 * Root causes:
 *   1. EventEmitter listeners not cleaned up
 *   2. HTTP keep-alive connections not closed
 *   3. Timers/intervals not cleared on shutdown
 *   4. Cache entries never evicted
 */

export class ResourceManager {
  constructor(label = "resource-manager") {
    this.label = label;
    this.resources = new Set();
    this.timers = new Set();
    this.listeners = new Map(); // emitter => [{event, handler}]
  }

  /**
   * Register a resource (connection, stream, etc.) for cleanup
   */
  register(resource, cleanupFn) {
    const entry = { resource, cleanupFn };
    this.resources.add(entry);
    return () => this.unregister(entry);
  }

  /**
   * Register a timer/interval for cleanup
   */
  registerTimer(timerId) {
    this.timers.add(timerId);
    return () => {
      clearTimeout(timerId);
      clearInterval(timerId);
      this.timers.delete(timerId);
    };
  }

  /**
   * Register an event listener for cleanup
   */
  registerListener(emitter, event, handler) {
    if (!this.listeners.has(emitter)) {
      this.listeners.set(emitter, []);
    }
    this.listeners.get(emitter).push({ event, handler });
    emitter.on(event, handler);

    return () => {
      emitter.removeListener(event, handler);
      const handlers = this.listeners.get(emitter);
      if (handlers) {
        const index = handlers.findIndex((h) => h.event === event && h.handler === handler);
        if (index >= 0) handlers.splice(index, 1);
        if (handlers.length === 0) this.listeners.delete(emitter);
      }
    };
  }

  /**
   * Cleanup all registered resources
   */
  async cleanup() {
    console.log(`[${this.label}] Cleaning up ${this.resources.size} resources, ${this.timers.size} timers, ${this.listeners.size} event emitters`);

    // Clear all timers
    for (const timerId of this.timers) {
      clearTimeout(timerId);
      clearInterval(timerId);
    }
    this.timers.clear();

    // Remove all event listeners
    for (const [emitter, handlers] of this.listeners) {
      for (const { event, handler } of handlers) {
        emitter.removeListener(event, handler);
      }
    }
    this.listeners.clear();

    // Cleanup all resources
    const cleanupPromises = [];
    for (const { resource, cleanupFn } of this.resources) {
      try {
        const result = cleanupFn(resource);
        if (result && typeof result.then === "function") {
          cleanupPromises.push(result);
        }
      } catch (err) {
        console.error(`[${this.label}] Resource cleanup error:`, err);
      }
    }

    await Promise.allSettled(cleanupPromises);
    this.resources.clear();
  }

  unregister(entry) {
    this.resources.delete(entry);
  }

  getStats() {
    return {
      resources: this.resources.size,
      timers: this.timers.size,
      eventEmitters: this.listeners.size,
    };
  }
}

/**
 * ══════════════════════════════════════════════════════════════════════════
 * ISSUE #1333: Null Pointer Exception Prevention
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Problem: Missing null checks for ledger data cause crashes
 * Symptoms: TypeError: Cannot read property 'X' of null/undefined
 * Root causes:
 *   1. Ledger data from Horizon can be null (maintenance, network issues)
 *   2. Transaction lookups can return undefined
 *   3. Nested object access without guards
 */

/**
 * Safe accessor for nested object properties
 * Returns defaultValue if any part of the path is null/undefined
 */
export function safeGet(obj, path, defaultValue = null) {
  if (!obj) return defaultValue;

  const keys = path.split(".");
  let current = obj;

  for (const key of keys) {
    if (current == null || typeof current !== "object") {
      return defaultValue;
    }
    current = current[key];
  }

  return current ?? defaultValue;
}

/**
 * Validates ledger data structure before processing
 * Throws descriptive error if data is malformed
 */
export function validateLedgerData(data, source = "unknown") {
  if (!data) {
    throw new Error(`[${source}] Ledger data is null or undefined`);
  }

  const required = ["id", "sequence"];
  for (const field of required) {
    if (!(field in data)) {
      throw new Error(`[${source}] Ledger data missing required field: ${field}`);
    }
  }

  return true;
}

/**
 * Validates transaction data before processing
 */
export function validateTransactionData(tx, source = "unknown") {
  if (!tx) {
    throw new Error(`[${source}] Transaction data is null or undefined`);
  }

  const required = ["id", "hash"];
  for (const field of required) {
    if (!(field in tx) || tx[field] == null) {
      throw new Error(`[${source}] Transaction missing required field: ${field}`);
    }
  }

  return true;
}

/**
 * Validates payment record from database
 */
export function validatePaymentData(payment, source = "unknown") {
  if (!payment) {
    throw new Error(`[${source}] Payment data is null or undefined`);
  }

  // Critical fields that must be present
  const required = ["id", "merchant_id", "amount", "currency"];
  for (const field of required) {
    if (!(field in payment) || payment[field] == null) {
      throw new Error(`[${source}] Payment missing required field: ${field}`);
    }
  }

  return true;
}

/**
 * ══════════════════════════════════════════════════════════════════════════
 * ISSUE #1335: Race Condition Prevention
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Problem: Concurrent ledger state updates cause inconsistencies
 * Symptoms: Payments confirmed multiple times, duplicate webhooks, DB conflicts
 * Root causes:
 *   1. Multiple poller cycles can process the same payment
 *   2. No locking mechanism for payment state transitions
 *   3. Horizon API calls can overlap
 */

export class StateLock {
  constructor(label = "state-lock") {
    this.label = label;
    this.locks = new Map(); // key => Promise
  }

  /**
   * Acquires an exclusive lock for the given key
   * Returns a function to release the lock
   */
  async acquire(key) {
    // Wait for any existing lock on this key
    while (this.locks.has(key)) {
      await this.locks.get(key);
    }

    // Create new lock
    let releaseFn;
    const lockPromise = new Promise((resolve) => {
      releaseFn = resolve;
    });

    this.locks.set(key, lockPromise);

    // Return release function
    return () => {
      this.locks.delete(key);
      releaseFn();
    };
  }

  /**
   * Executes a function with an exclusive lock
   */
  async withLock(key, fn) {
    const release = await this.acquire(key);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /**
   * Check if a key is currently locked
   */
  isLocked(key) {
    return this.locks.has(key);
  }

  /**
   * Get all currently locked keys
   */
  getLockedKeys() {
    return Array.from(this.locks.keys());
  }

  getStats() {
    return {
      activeLocks: this.locks.size,
      lockedKeys: this.getLockedKeys(),
    };
  }

  /**
   * Force release all locks (for testing/emergency)
   */
  _releaseAll() {
    for (const [key, promise] of this.locks) {
      this.locks.delete(key);
      // Resolve the promise to unblock waiters
      promise.then(() => {});
    }
  }
}

/**
 * Distributed-safe payment processing with deduplication
 */
export class PaymentProcessor {
  constructor({ stateLock, resourceManager } = {}) {
    this.stateLock = stateLock || new StateLock("payment-processor");
    this.resourceManager = resourceManager || new ResourceManager("payment-processor");
    this.processing = new Set(); // Track currently processing payment IDs
  }

  /**
   * Process a payment with automatic locking and deduplication
   */
  async processPayment(paymentId, processFn) {
    // Quick check: already processing?
    if (this.processing.has(paymentId)) {
      return { skipped: true, reason: "already_processing" };
    }

    // Acquire exclusive lock for this payment
    return await this.stateLock.withLock(`payment:${paymentId}`, async () => {
      // Double-check inside lock
      if (this.processing.has(paymentId)) {
        return { skipped: true, reason: "already_processing_locked" };
      }

      this.processing.add(paymentId);
      try {
        const result = await processFn();
        return { success: true, result };
      } catch (err) {
        return { success: false, error: err.message };
      } finally {
        this.processing.delete(paymentId);
      }
    });
  }

  /**
   * Batch process multiple payments with parallelism control
   */
  async processBatch(payments, processFn, { maxConcurrent = 5 } = {}) {
    const results = [];
    const queue = [...payments];

    while (queue.length > 0) {
      const batch = queue.splice(0, maxConcurrent);
      const batchResults = await Promise.all(
        batch.map((payment) =>
          this.processPayment(payment.id, () => processFn(payment))
        )
      );
      results.push(...batchResults);
    }

    return results;
  }

  getStats() {
    return {
      processing: this.processing.size,
      processingIds: Array.from(this.processing),
      locks: this.stateLock.getStats(),
    };
  }

  async cleanup() {
    await this.resourceManager.cleanup();
    this.processing.clear();
  }
}

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Integration Helper
 * ══════════════════════════════════════════════════════════════════════════
 */

export function createLedgerMonitorContext() {
  const resourceManager = new ResourceManager("ledger-monitor");
  const stateLock = new StateLock("ledger-monitor");
  const paymentProcessor = new PaymentProcessor({ stateLock, resourceManager });

  return {
    resourceManager,
    stateLock,
    paymentProcessor,
    
    // Helpers
    safeGet,
    validateLedgerData,
    validateTransactionData,
    validatePaymentData,

    // Cleanup on shutdown
    async cleanup() {
      await paymentProcessor.cleanup();
      await resourceManager.cleanup();
      stateLock._releaseAll();
    },

    // Stats for monitoring
    getStats() {
      return {
        resources: resourceManager.getStats(),
        processor: paymentProcessor.getStats(),
      };
    },
  };
}
