/**
 * System Fixes Test Suite (Issues #1330, #1332, #1333, #1335)
 *
 * Comprehensive tests for:
 * - Audit Logger race condition fix
 * - Ledger Monitor memory leak prevention
 * - Ledger Monitor null pointer exception handling
 * - Ledger Monitor race condition fix
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AuditWriterQueue, createQueuedAuditWriter } from "./audit-writer-queue.js";
import {
  ResourceManager,
  StateLock,
  PaymentProcessor,
  safeGet,
  validateLedgerData,
  validateTransactionData,
  validatePaymentData,
  createLedgerMonitorContext,
} from "./ledger-monitor-fixes.js";

// ══════════════════════════════════════════════════════════════════════════════
// Issue #1330: Audit Logger Race Condition Tests
// ══════════════════════════════════════════════════════════════════════════════

describe("AuditWriterQueue - Race Condition Prevention", () => {
  let queue;

  beforeEach(() => {
    queue = new AuditWriterQueue({ maxQueueSize: 10, label: "test-queue" });
  });

  afterEach(() => {
    queue._resetForTests();
  });

  it("should process writes sequentially", async () => {
    const results = [];
    const writes = [];

    // Simulate 5 concurrent writes
    for (let i = 0; i < 5; i++) {
      writes.push(
        queue.enqueue(async () => {
          results.push(`start-${i}`);
          await new Promise((resolve) => setTimeout(resolve, 10));
          results.push(`end-${i}`);
          return `result-${i}`;
        })
      );
    }

    await Promise.all(writes);

    // Verify writes were sequential (no interleaving)
    expect(results).toEqual([
      "start-0",
      "end-0",
      "start-1",
      "end-1",
      "start-2",
      "end-2",
      "start-3",
      "end-3",
      "start-4",
      "end-4",
    ]);
  });

  it("should handle concurrent enqueues correctly", async () => {
    let writeCount = 0;

    const writes = Array.from({ length: 20 }, (_, i) =>
      queue.enqueue(async () => {
        writeCount++;
        return i;
      })
    );

    await Promise.all(writes);
    expect(writeCount).toBe(20);
  });

  it("should reject when queue is full", async () => {
    const smallQueue = new AuditWriterQueue({ maxQueueSize: 2 });

    // Fill the queue
    const write1 = smallQueue.enqueue(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    const write2 = smallQueue.enqueue(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    // Third write should fail
    await expect(
      smallQueue.enqueue(async () => "should-fail")
    ).rejects.toThrow("Audit write queue full");

    await Promise.all([write1, write2]);
  });

  it("should continue processing after error", async () => {
    const results = [];

    await queue.enqueue(async () => {
      results.push("write-1");
    });

    await queue.enqueue(async () => {
      results.push("write-2-error");
      throw new Error("Intentional error");
    }).catch(() => {});

    await queue.enqueue(async () => {
      results.push("write-3");
    });

    expect(results).toEqual(["write-1", "write-2-error", "write-3"]);
  });

  it("should track queue depth correctly", () => {
    const stats = queue.getStats();
    expect(stats.queueDepth).toBe(0);
    expect(stats.droppedCount).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Issue #1332: Memory Leak Prevention Tests
// ══════════════════════════════════════════════════════════════════════════════

describe("ResourceManager - Memory Leak Prevention", () => {
  let resourceManager;

  beforeEach(() => {
    resourceManager = new ResourceManager("test-manager");
  });

  afterEach(async () => {
    await resourceManager.cleanup();
  });

  it("should register and cleanup resources", async () => {
    const cleanedResources = [];

    resourceManager.register("resource-1", (res) => {
      cleanedResources.push(res);
    });

    resourceManager.register("resource-2", (res) => {
      cleanedResources.push(res);
    });

    expect(resourceManager.getStats().resources).toBe(2);

    await resourceManager.cleanup();

    expect(cleanedResources).toEqual(["resource-1", "resource-2"]);
    expect(resourceManager.getStats().resources).toBe(0);
  });

  it("should cleanup timers", async () => {
    const timer1 = setTimeout(() => {}, 10000);
    const timer2 = setInterval(() => {}, 10000);

    resourceManager.registerTimer(timer1);
    resourceManager.registerTimer(timer2);

    expect(resourceManager.getStats().timers).toBe(2);

    await resourceManager.cleanup();

    expect(resourceManager.getStats().timers).toBe(0);
  });

  it("should cleanup event listeners", async () => {
    const { EventEmitter } = await import("node:events");
    const emitter = new EventEmitter();

    const handler1 = vi.fn();
    const handler2 = vi.fn();

    resourceManager.registerListener(emitter, "test-event", handler1);
    resourceManager.registerListener(emitter, "other-event", handler2);

    emitter.emit("test-event");
    expect(handler1).toHaveBeenCalledTimes(1);

    await resourceManager.cleanup();

    // Listeners should be removed
    emitter.emit("test-event");
    expect(handler1).toHaveBeenCalledTimes(1); // Still 1, not called again
  });

  it("should handle async cleanup functions", async () => {
    const cleanupLog = [];

    resourceManager.register("async-resource", async (res) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      cleanupLog.push(res);
    });

    await resourceManager.cleanup();

    expect(cleanupLog).toEqual(["async-resource"]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Issue #1333: Null Pointer Exception Prevention Tests
// ══════════════════════════════════════════════════════════════════════════════

describe("Null Safety Helpers", () => {
  describe("safeGet", () => {
    it("should safely access nested properties", () => {
      const obj = {
        a: {
          b: {
            c: "value",
          },
        },
      };

      expect(safeGet(obj, "a.b.c")).toBe("value");
      expect(safeGet(obj, "a.b")).toEqual({ c: "value" });
      expect(safeGet(obj, "a")).toEqual({ b: { c: "value" } });
    });

    it("should return defaultValue for null/undefined paths", () => {
      const obj = {
        a: {
          b: null,
        },
      };

      expect(safeGet(obj, "a.b.c", "default")).toBe("default");
      expect(safeGet(obj, "x.y.z", "default")).toBe("default");
      expect(safeGet(null, "a.b", "default")).toBe("default");
      expect(safeGet(undefined, "a.b", "default")).toBe("default");
    });

    it("should handle array indices", () => {
      const obj = {
        items: [{ name: "item1" }, { name: "item2" }],
      };

      expect(safeGet(obj, "items.0.name")).toBe("item1");
      expect(safeGet(obj, "items.1.name")).toBe("item2");
      expect(safeGet(obj, "items.2.name", "default")).toBe("default");
    });
  });

  describe("validateLedgerData", () => {
    it("should accept valid ledger data", () => {
      const ledger = {
        id: "ledger-1",
        sequence: 12345,
        closed_at: "2024-01-01T00:00:00Z",
      };

      expect(() => validateLedgerData(ledger)).not.toThrow();
    });

    it("should reject null ledger data", () => {
      expect(() => validateLedgerData(null)).toThrow("Ledger data is null or undefined");
    });

    it("should reject ledger missing required fields", () => {
      expect(() => validateLedgerData({ id: "ledger-1" })).toThrow(
        "Ledger data missing required field: sequence"
      );
    });
  });

  describe("validateTransactionData", () => {
    it("should accept valid transaction data", () => {
      const tx = {
        id: "tx-1",
        hash: "abc123",
        source_account: "GABC...",
      };

      expect(() => validateTransactionData(tx)).not.toThrow();
    });

    it("should reject null transaction data", () => {
      expect(() => validateTransactionData(null)).toThrow(
        "Transaction data is null or undefined"
      );
    });

    it("should reject transaction missing required fields", () => {
      expect(() => validateTransactionData({ id: "tx-1" })).toThrow(
        "Transaction missing required field: hash"
      );
    });
  });

  describe("validatePaymentData", () => {
    it("should accept valid payment data", () => {
      const payment = {
        id: "payment-1",
        merchant_id: "merchant-1",
        amount: "100.00",
        currency: "USD",
      };

      expect(() => validatePaymentData(payment)).not.toThrow();
    });

    it("should reject null payment data", () => {
      expect(() => validatePaymentData(null)).toThrow("Payment data is null or undefined");
    });

    it("should reject payment missing required fields", () => {
      expect(() =>
        validatePaymentData({
          id: "payment-1",
          merchant_id: "merchant-1",
          amount: "100.00",
        })
      ).toThrow("Payment missing required field: currency");
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Issue #1335: Race Condition Prevention Tests
// ══════════════════════════════════════════════════════════════════════════════

describe("StateLock - Race Condition Prevention", () => {
  let stateLock;

  beforeEach(() => {
    stateLock = new StateLock("test-lock");
  });

  afterEach(() => {
    stateLock._releaseAll();
  });

  it("should enforce exclusive access", async () => {
    const results = [];

    const task1 = stateLock.withLock("resource-1", async () => {
      results.push("task1-start");
      await new Promise((resolve) => setTimeout(resolve, 50));
      results.push("task1-end");
    });

    const task2 = stateLock.withLock("resource-1", async () => {
      results.push("task2-start");
      await new Promise((resolve) => setTimeout(resolve, 50));
      results.push("task2-end");
    });

    await Promise.all([task1, task2]);

    // Task2 should wait for task1 to complete
    expect(results).toEqual(["task1-start", "task1-end", "task2-start", "task2-end"]);
  });

  it("should allow concurrent access to different keys", async () => {
    const results = [];

    const task1 = stateLock.withLock("resource-1", async () => {
      results.push("task1-start");
      await new Promise((resolve) => setTimeout(resolve, 50));
      results.push("task1-end");
    });

    const task2 = stateLock.withLock("resource-2", async () => {
      results.push("task2-start");
      await new Promise((resolve) => setTimeout(resolve, 50));
      results.push("task2-end");
    });

    await Promise.all([task1, task2]);

    // Both tasks should run concurrently
    expect(results.includes("task1-start")).toBe(true);
    expect(results.includes("task2-start")).toBe(true);
  });

  it("should report locked keys correctly", async () => {
    const lock1 = stateLock.acquire("key-1");

    expect(stateLock.isLocked("key-1")).toBe(true);
    expect(stateLock.isLocked("key-2")).toBe(false);
    expect(stateLock.getLockedKeys()).toContain("key-1");

    const release1 = await lock1;
    release1();

    expect(stateLock.isLocked("key-1")).toBe(false);
  });
});

describe("PaymentProcessor - Deduplication", () => {
  let processor;

  beforeEach(() => {
    processor = new PaymentProcessor();
  });

  afterEach(async () => {
    await processor.cleanup();
  });

  it("should prevent duplicate processing", async () => {
    let processCount = 0;

    const process1 = processor.processPayment("payment-1", async () => {
      processCount++;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return "result-1";
    });

    // Try to process same payment concurrently
    const process2 = processor.processPayment("payment-1", async () => {
      processCount++;
      return "result-2";
    });

    const [result1, result2] = await Promise.all([process1, process2]);

    // Only one should have processed
    expect(processCount).toBe(1);
    expect(result1.success).toBe(true);
    expect(result2.skipped).toBe(true);
  });

  it("should allow processing different payments concurrently", async () => {
    let processCount = 0;

    const process1 = processor.processPayment("payment-1", async () => {
      processCount++;
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const process2 = processor.processPayment("payment-2", async () => {
      processCount++;
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    await Promise.all([process1, process2]);

    expect(processCount).toBe(2);
  });

  it("should handle errors gracefully", async () => {
    const result = await processor.processPayment("payment-1", async () => {
      throw new Error("Processing failed");
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Processing failed");

    // Should allow retrying after error
    const retryResult = await processor.processPayment("payment-1", async () => {
      return "success";
    });

    expect(retryResult.success).toBe(true);
  });

  it("should process batch with parallelism control", async () => {
    const payments = Array.from({ length: 10 }, (_, i) => ({
      id: `payment-${i}`,
      amount: 100,
    }));

    let maxConcurrent = 0;
    let currentConcurrent = 0;

    const results = await processor.processBatch(
      payments,
      async (payment) => {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
        await new Promise((resolve) => setTimeout(resolve, 10));
        currentConcurrent--;
        return payment.id;
      },
      { maxConcurrent: 3 }
    );

    expect(results.length).toBe(10);
    expect(maxConcurrent).toBeLessThanOrEqual(3);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Integration Tests
// ══════════════════════════════════════════════════════════════════════════════

describe("LedgerMonitorContext - Integration", () => {
  let context;

  beforeEach(() => {
    context = createLedgerMonitorContext();
  });

  afterEach(async () => {
    await context.cleanup();
  });

  it("should provide all required utilities", () => {
    expect(context.resourceManager).toBeDefined();
    expect(context.stateLock).toBeDefined();
    expect(context.paymentProcessor).toBeDefined();
    expect(context.safeGet).toBeDefined();
    expect(context.validateLedgerData).toBeDefined();
    expect(context.cleanup).toBeDefined();
    expect(context.getStats).toBeDefined();
  });

  it("should track stats correctly", () => {
    const stats = context.getStats();
    expect(stats.resources).toBeDefined();
    expect(stats.processor).toBeDefined();
  });

  it("should cleanup all resources", async () => {
    context.resourceManager.register("test-resource", () => {});
    
    const statsBefore = context.getStats();
    expect(statsBefore.resources.resources).toBeGreaterThan(0);

    await context.cleanup();

    const statsAfter = context.getStats();
    expect(statsAfter.resources.resources).toBe(0);
  });
});
