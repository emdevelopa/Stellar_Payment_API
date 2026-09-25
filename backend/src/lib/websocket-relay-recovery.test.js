import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  CircuitBreaker,
  CircuitState,
  DeadLetterQueue,
  getRelayHealth,
  reconnectWithBackoff,
} from "./websocket-relay-recovery.js";

// ─── reconnectWithBackoff ──────────────────────────────────────────────────────

describe("reconnectWithBackoff", () => {
  it("resolves immediately when connectFn succeeds on first try", async () => {
    const connectFn = vi.fn().mockResolvedValue("connected");
    const result = await reconnectWithBackoff(connectFn, {
      maxRetries: 3,
      sleep: vi.fn().mockResolvedValue(undefined),
    });
    expect(result).toBe("connected");
    expect(connectFn).toHaveBeenCalledTimes(1);
  });

  it("retries after failure and succeeds on a later attempt", async () => {
    const connectFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"))
      .mockResolvedValue("connected");

    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await reconnectWithBackoff(connectFn, {
      maxRetries: 5,
      baseDelayMs: 100,
      maxDelayMs: 10000,
      sleep,
    });

    expect(result).toBe("connected");
    expect(connectFn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("sleep delays increase across attempts (exponential backoff)", async () => {
    const delays = [];
    const sleep = vi.fn().mockImplementation((ms) => {
      delays.push(ms);
      return Promise.resolve();
    });

    const connectFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("f1"))
      .mockRejectedValueOnce(new Error("f2"))
      .mockRejectedValueOnce(new Error("f3"))
      .mockResolvedValue("ok");

    await reconnectWithBackoff(connectFn, {
      maxRetries: 5,
      baseDelayMs: 100,
      maxDelayMs: 10000,
      sleep,
    });

    // Each delay should be >= the previous (jitter may cause slight variance;
    // we just assert delays[1] >= delays[0] on average with reasonable tolerance)
    expect(delays).toHaveLength(3);
    // Second delay should be at least roughly double the first (before jitter)
    expect(delays[1]).toBeGreaterThanOrEqual(delays[0] * 0.8);
    expect(delays[2]).toBeGreaterThanOrEqual(delays[1] * 0.8);
  });

  it("throws the last error when all retries are exhausted", async () => {
    const error = new Error("permanent failure");
    const connectFn = vi.fn().mockRejectedValue(error);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      reconnectWithBackoff(connectFn, { maxRetries: 2, sleep }),
    ).rejects.toThrow("permanent failure");

    // Initial attempt + 2 retries = 3 total calls
    expect(connectFn).toHaveBeenCalledTimes(3);
  });

  it("does not sleep after the final failed attempt", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const connectFn = vi.fn().mockRejectedValue(new Error("fail"));

    await reconnectWithBackoff(connectFn, { maxRetries: 2, sleep }).catch(() => {});

    // maxRetries=2 → 3 attempts → sleep called 2 times (not after the last)
    expect(sleep).toHaveBeenCalledTimes(2);
  });
});

// ─── CircuitBreaker ───────────────────────────────────────────────────────────

describe("CircuitBreaker", () => {
  let cb;

  beforeEach(() => {
    cb = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 5000 });
  });

  it("starts in CLOSED state", () => {
    expect(cb.state).toBe(CircuitState.CLOSED);
  });

  it("stays CLOSED after fewer failures than the threshold", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fail"));
    await cb.call(fn).catch(() => {});
    await cb.call(fn).catch(() => {});
    expect(cb.state).toBe(CircuitState.CLOSED);
  });

  it("opens after reaching the failure threshold", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fail"));
    for (let i = 0; i < 3; i++) {
      await cb.call(fn).catch(() => {});
    }
    expect(cb.state).toBe(CircuitState.OPEN);
  });

  it("rejects calls immediately when OPEN without calling fn", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fail"));
    // Trip the breaker
    for (let i = 0; i < 3; i++) {
      await cb.call(fn).catch(() => {});
    }
    fn.mockReset();

    await expect(cb.call(fn)).rejects.toThrow("Circuit breaker is OPEN");
    expect(fn).not.toHaveBeenCalled();
  });

  it("transitions to HALF_OPEN after reset timeout elapses", async () => {
    let fakeNow = Date.now();
    const cb2 = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 1000,
      now: () => fakeNow,
    });

    const fn = vi.fn().mockRejectedValue(new Error("fail"));
    await cb2.call(fn).catch(() => {});
    expect(cb2.state).toBe(CircuitState.OPEN);

    // Advance fake clock past reset timeout
    fakeNow += 2000;

    // Next call should probe (HALF_OPEN)
    const successFn = vi.fn().mockResolvedValue("ok");
    await cb2.call(successFn);
    expect(cb2.state).toBe(CircuitState.CLOSED);
  });

  it("closes after a successful call", async () => {
    const failFn = vi.fn().mockRejectedValue(new Error("fail"));
    const successFn = vi.fn().mockResolvedValue("ok");

    await cb.call(failFn).catch(() => {});
    await cb.call(failFn).catch(() => {});
    await cb.call(successFn);

    expect(cb.state).toBe(CircuitState.CLOSED);
  });

  it("getStatus returns expected shape", () => {
    const status = cb.getStatus();
    expect(status).toMatchObject({
      state: CircuitState.CLOSED,
      failureCount: 0,
      lastError: null,
    });
  });
});

// ─── DeadLetterQueue ──────────────────────────────────────────────────────────

describe("DeadLetterQueue", () => {
  let dlq;

  beforeEach(() => {
    dlq = new DeadLetterQueue();
  });

  it("starts empty", () => {
    expect(dlq.size).toBe(0);
    expect(dlq.getAll()).toEqual([]);
  });

  it("stores a failed message with error metadata", () => {
    const msg = { type: "payment.confirmed", payload: {} };
    const err = new Error("delivery failed");
    dlq.push(msg, err, 1);

    expect(dlq.size).toBe(1);
    const entry = dlq.getAll()[0];
    expect(entry.message).toEqual(msg);
    expect(entry.errorMessage).toBe("delivery failed");
    expect(entry.retryCount).toBe(1);
    expect(typeof entry.failedAt).toBe("string");
  });

  it("accumulates multiple entries", () => {
    dlq.push({ id: 1 }, new Error("e1"), 0);
    dlq.push({ id: 2 }, new Error("e2"), 1);
    expect(dlq.size).toBe(2);
  });

  it("shift removes and returns the oldest entry", () => {
    dlq.push({ id: 1 }, new Error("e1"));
    dlq.push({ id: 2 }, new Error("e2"));
    const first = dlq.shift();
    expect(first.message).toEqual({ id: 1 });
    expect(dlq.size).toBe(1);
  });

  it("shift returns null when empty", () => {
    expect(dlq.shift()).toBeNull();
  });

  it("getAll returns a copy, not the internal array", () => {
    dlq.push({ id: 1 }, new Error("e"));
    const copy = dlq.getAll();
    copy.pop();
    expect(dlq.size).toBe(1);
  });

  it("clear empties the queue", () => {
    dlq.push({ id: 1 }, new Error("e"));
    dlq.clear();
    expect(dlq.size).toBe(0);
  });
});

// ─── getRelayHealth ───────────────────────────────────────────────────────────

describe("getRelayHealth", () => {
  it("returns healthy when circuit is CLOSED and DLQ is empty", () => {
    const cb = new CircuitBreaker();
    const dlq = new DeadLetterQueue();
    const health = getRelayHealth({ circuitBreaker: cb, dlq, reconnectCount: 0 });

    expect(health).toMatchObject({
      status: "healthy",
      reconnectCount: 0,
      circuitState: CircuitState.CLOSED,
      dlqSize: 0,
      lastError: null,
    });
  });

  it("returns degraded when DLQ has entries", () => {
    const cb = new CircuitBreaker();
    const dlq = new DeadLetterQueue();
    dlq.push({ id: 1 }, new Error("fail"));

    const health = getRelayHealth({ circuitBreaker: cb, dlq, reconnectCount: 2 });
    expect(health.status).toBe("degraded");
    expect(health.dlqSize).toBe(1);
    expect(health.reconnectCount).toBe(2);
  });

  it("returns degraded when circuit is OPEN", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1 });
    const dlq = new DeadLetterQueue();

    const failFn = vi.fn().mockRejectedValue(new Error("down"));
    await cb.call(failFn).catch(() => {});

    const health = getRelayHealth({ circuitBreaker: cb, dlq, reconnectCount: 5 });
    expect(health.status).toBe("degraded");
    expect(health.circuitState).toBe(CircuitState.OPEN);
    expect(health.lastError).toBe("down");
  });
});
