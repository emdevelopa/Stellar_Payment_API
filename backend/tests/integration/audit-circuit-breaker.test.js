/**
 * Integration tests for the Audit Circuit Breaker module (Issue #1436).
 *
 * Uses Vitest (NOT jest). Mocks db.js, audit-replay.js, and redis.
 *
 * Coverage:
 *  1.  Full state machine transitions: CLOSED → OPEN → HALF_OPEN → CLOSED
 *  2.  Prometheus metrics are emitted on each transition
 *  3.  execute() retries with exponential backoff on retryable errors
 *  4.  execute() throws CircuitOpenError when circuit is open
 *  5.  Fallback log is written when circuit is open
 *  6.  DistributedAuditCircuitBreakerLock.executeWithLock() — lock acquired and released
 *  7.  DistributedAuditCircuitBreakerLock falls back gracefully if Redis unavailable
 *  8.  syncState() reconciles from Redis
 *  9.  AuditWriterQueue with maxConcurrency > 1 runs operations concurrently
 * 10.  Queue drops writes when full and increments droppedCount
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";

// ── Hoisted mocks (must be declared before any imports of the mocked modules) ─

const { mockQuery, mockIsRetryablePoolError, mockReplayFallbackLogs } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockIsRetryablePoolError: vi.fn().mockReturnValue(false),
  mockReplayFallbackLogs: vi.fn().mockResolvedValue(),
}));

vi.mock("../../../src/lib/db.js", () => ({
  pool: { query: mockQuery },
  isRetryablePoolError: mockIsRetryablePoolError,
}));

vi.mock("../../../src/lib/audit-replay.js", () => ({
  replayFallbackLogs: mockReplayFallbackLogs,
}));

// ── Import under test (after mocks) ─────────────────────────────────────────

import {
  AuditCircuitBreaker,
  CircuitOpenError,
  CircuitState,
} from "../../../src/lib/audit-circuit-breaker.js";
import { DistributedAuditCircuitBreakerLock } from "../../../src/lib/audit-circuit-breaker-lock.js";
import { AuditWriterQueue } from "../../../src/lib/audit-writer-queue.js";
import { createAuditWriter } from "../../../src/lib/audit-writer.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeBreaker(overrides = {}) {
  return new AuditCircuitBreaker({
    failureThreshold: 3,
    resetTimeoutMs: 1000,
    halfOpenRequired: 2,
    label: `test-${Math.random().toString(36).slice(2)}`,
    maxRetries: 2,
    retryBaseDelayMs: 1, // Keep tests fast
    ...overrides,
  });
}

function makeRedis(overrides = {}) {
  const store = new Map();
  return {
    isOpen: true,
    set: vi.fn(async (key, value, ...args) => {
      // Handle SET NX PX
      const nxIdx = args.findIndex((a) => a === "NX");
      if (nxIdx !== -1) {
        if (store.has(key)) return null; // NX: only set if absent
        store.set(key, value);
        return "OK";
      }
      store.set(key, value);
      return "OK";
    }),
    get: vi.fn(async (key) => store.get(key) ?? null),
    del: vi.fn(async (key) => {
      const existed = store.has(key);
      store.delete(key);
      return existed ? 1 : 0;
    }),
    eval: vi.fn(async (script, opts) => {
      // Minimal Lua emulation for the release-lock script.
      const key = opts.keys[0];
      const owner = opts.arguments[0];
      if (store.get(key) === owner) {
        store.delete(key);
        return 1;
      }
      return 0;
    }),
    _store: store,
    ...overrides,
  };
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockQuery.mockReset();
  mockIsRetryablePoolError.mockReset().mockReturnValue(false);
  mockReplayFallbackLogs.mockClear();
  vi.restoreAllMocks();
});

// ── 1. Full state machine transitions: CLOSED → OPEN → HALF_OPEN → CLOSED ───

describe("1. Full state machine transitions", () => {
  it("starts CLOSED, opens after failureThreshold, transitions to HALF_OPEN, then CLOSED", () => {
    const cb = makeBreaker({ failureThreshold: 3, resetTimeoutMs: 1000, halfOpenRequired: 2 });
    const onOpen = vi.fn();
    const onHalfOpen = vi.fn();
    const onClose = vi.fn();
    cb.onOpen = onOpen;
    cb.onHalfOpen = onHalfOpen;
    cb.onClose = onClose;

    expect(cb.state).toBe(CircuitState.CLOSED);
    expect(cb.isOpen()).toBe(false);

    cb.recordFailure();
    cb.recordFailure();
    expect(cb.state).toBe(CircuitState.CLOSED);

    cb.recordFailure();
    expect(cb.state).toBe(CircuitState.OPEN);
    expect(cb.isOpen()).toBe(true);
    expect(onOpen).toHaveBeenCalledOnce();

    // Timeout not elapsed → still OPEN
    const now = Date.now();
    expect(cb.isOpen(now)).toBe(true);

    // Timeout elapsed → HALF_OPEN
    expect(cb.isOpen(now + 1001)).toBe(false);
    expect(cb.state).toBe(CircuitState.HALF_OPEN);
    expect(onHalfOpen).toHaveBeenCalledOnce();

    // 1st success in HALF_OPEN
    cb.recordSuccess();
    expect(cb.state).toBe(CircuitState.HALF_OPEN);
    expect(onClose).not.toHaveBeenCalled();

    // 2nd success → CLOSED
    cb.recordSuccess();
    expect(cb.state).toBe(CircuitState.CLOSED);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("HALF_OPEN → OPEN on failure, then recovers again", () => {
    const cb = makeBreaker({ failureThreshold: 3, resetTimeoutMs: 500, halfOpenRequired: 1 });

    cb.recordFailure(); cb.recordFailure(); cb.recordFailure();
    const openedAt = cb.openedAt;
    expect(cb.state).toBe(CircuitState.OPEN);

    cb.isOpen(openedAt + 600); // → HALF_OPEN
    expect(cb.state).toBe(CircuitState.HALF_OPEN);

    cb.recordFailure(); // → back to OPEN
    expect(cb.state).toBe(CircuitState.OPEN);

    cb.isOpen(cb.openedAt + 600); // → HALF_OPEN again
    cb.recordSuccess(); // → CLOSED (halfOpenRequired = 1)
    expect(cb.state).toBe(CircuitState.CLOSED);
  });

  it("reset() forces CLOSED from OPEN", () => {
    const cb = makeBreaker();
    cb.recordFailure(); cb.recordFailure(); cb.recordFailure();
    expect(cb.state).toBe(CircuitState.OPEN);
    cb.reset();
    expect(cb.state).toBe(CircuitState.CLOSED);
    expect(cb.failures).toBe(0);
    expect(cb.openedAt).toBeNull();
  });
});

// ── 2. Prometheus metrics emitted on each transition ─────────────────────────

describe("2. Prometheus metrics emitted on transitions", () => {
  it("getMetrics() returns a registry with circuit-breaker counters and gauges", async () => {
    const registry = AuditCircuitBreaker.getMetrics();
    expect(registry).toBeDefined();

    const metrics = await registry.getMetricsAsJSON();
    const names = metrics.map((m) => m.name);

    expect(names).toContain("audit_circuit_breaker_state");
    expect(names).toContain("audit_circuit_breaker_transitions_total");
    expect(names).toContain("audit_circuit_breaker_failures_total");
    expect(names).toContain("audit_circuit_breaker_successes_total");
    expect(names).toContain("audit_circuit_breaker_open_duration_seconds");
    expect(names).toContain("audit_circuit_breaker_health_check_total");
    expect(names).toContain("audit_circuit_breaker_retry_attempt_total");
  });
});

// ── 3. execute() retries with exponential backoff ────────────────────────────

describe("3. execute() retries with exponential backoff", () => {
  it("retries up to maxRetries times, then succeeds on the last attempt", async () => {
    const cb = makeBreaker({ failureThreshold: 10, maxRetries: 3, retryBaseDelayMs: 1 });
    let callCount = 0;
    const fn = vi.fn(async () => {
      callCount++;
      if (callCount < 3) throw new Error("transient error");
      return "ok";
    });

    const result = await cb.execute(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(cb.state).toBe(CircuitState.CLOSED);
  });

  it("exhausts retries, records failure, and re-throws last error", async () => {
    const cb = makeBreaker({ failureThreshold: 10, maxRetries: 2, retryBaseDelayMs: 1 });
    const fn = vi.fn(async () => {
      throw new Error("persistent error");
    });

    await expect(cb.execute(fn)).rejects.toThrow("persistent error");
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
    expect(cb.failures).toBeGreaterThan(0);
  });

  it("respects retryableErrors filter — non-matching errors are not retried", async () => {
    const cb = makeBreaker({ failureThreshold: 10, maxRetries: 3, retryBaseDelayMs: 1 });
    const fn = vi.fn(async () => {
      throw new Error("auth_denied: not retryable");
    });

    await expect(
      cb.execute(fn, { retryableErrors: ["connection timeout"] }),
    ).rejects.toThrow("auth_denied");

    // Should NOT retry — only called once.
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries matching retryableErrors substring", async () => {
    const cb = makeBreaker({ failureThreshold: 10, maxRetries: 2, retryBaseDelayMs: 1 });
    let attempts = 0;
    const fn = vi.fn(async () => {
      attempts++;
      if (attempts < 2) throw new Error("connection timeout: retry me");
      return "recovered";
    });

    const result = await cb.execute(fn, { retryableErrors: ["connection timeout"] });
    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

// ── 4. execute() throws CircuitOpenError when circuit is open ─────────────────

describe("4. execute() throws CircuitOpenError when circuit is OPEN", () => {
  it("rejects immediately without calling fn when circuit is OPEN", async () => {
    const cb = makeBreaker({ failureThreshold: 1, retryBaseDelayMs: 1 });
    cb.recordFailure(); // trip
    expect(cb.state).toBe(CircuitState.OPEN);

    const fn = vi.fn(async () => "should not be called");
    await expect(cb.execute(fn)).rejects.toThrow(CircuitOpenError);
    expect(fn).not.toHaveBeenCalled();
  });

  it("CircuitOpenError has code CIRCUIT_OPEN", async () => {
    const cb = makeBreaker({ failureThreshold: 1, retryBaseDelayMs: 1 });
    cb.recordFailure();

    const err = await cb.execute(async () => {}).catch((e) => e);
    expect(err).toBeInstanceOf(CircuitOpenError);
    expect(err.code).toBe("CIRCUIT_OPEN");
  });
});

// ── 5. Fallback log written when circuit is open ──────────────────────────────

describe("5. Fallback log written when circuit is open", () => {
  it("writes to fallback file when circuit is OPEN in createAuditWriter", async () => {
    const appendSpy = vi.spyOn(fs, "appendFileSync").mockImplementation(() => {});
    vi.spyOn(fs, "existsSync").mockReturnValue(true);

    mockQuery.mockRejectedValue(new Error("DB down"));
    mockIsRetryablePoolError.mockReturnValue(false);

    const writer = createAuditWriter({ source: "test_fb", label: `fb-${Math.random()}` });

    // Trip the circuit
    for (let i = 0; i < 5; i++) {
      await writer.write("INSERT INTO t VALUES ($1)", ["v"], { action: "test" });
    }

    const stateBefore = writer.getState();
    expect(stateBefore.open).toBe(true);

    // With circuit open, subsequent writes should use the fallback log
    await writer.write("INSERT INTO t VALUES ($1)", ["v2"], { action: "fallback_test" });

    expect(appendSpy).toHaveBeenCalled();
  });
});

// ── 6. DistributedAuditCircuitBreakerLock — lock acquired and released ────────

describe("6. DistributedAuditCircuitBreakerLock.executeWithLock()", () => {
  it("acquires and releases the lock around a successful fn call", async () => {
    const cb = makeBreaker();
    const redis = makeRedis();
    const lock = new DistributedAuditCircuitBreakerLock({
      circuitBreaker: cb,
      redisClient: redis,
      lockTtlMs: 1000,
    });

    const fn = vi.fn(async () => "result");
    const result = await lock.executeWithLock(fn, "op-1");

    expect(result).toBe("result");
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringContaining("audit:circuit-breaker:lock"),
      "op-1",
      "NX",
      "PX",
      1000,
    );
    // Lock should be released (key removed from store)
    expect(redis._store.has(lock.lockKey)).toBe(false);
  });

  it("releases lock even when fn throws", async () => {
    const cb = makeBreaker();
    const redis = makeRedis();
    const lock = new DistributedAuditCircuitBreakerLock({ circuitBreaker: cb, redisClient: redis });

    const fn = vi.fn(async () => {
      throw new Error("fn error");
    });

    await expect(lock.executeWithLock(fn, "op-err")).rejects.toThrow("fn error");
    expect(redis._store.has(lock.lockKey)).toBe(false);
  });

  it("throws LOCK_NOT_ACQUIRED when lock is already held", async () => {
    const cb = makeBreaker();
    const redis = makeRedis();
    const lock = new DistributedAuditCircuitBreakerLock({ circuitBreaker: cb, redisClient: redis });

    // Pre-populate lock as if another holder owns it
    redis._store.set(lock.lockKey, "other-owner");

    await expect(lock.executeWithLock(async () => {}, "my-op")).rejects.toMatchObject({
      code: "LOCK_NOT_ACQUIRED",
    });
  });
});

// ── 7. DistributedAuditCircuitBreakerLock graceful Redis fallback ─────────────

describe("7. DistributedAuditCircuitBreakerLock — graceful Redis fallback", () => {
  it("proceeds without lock when redis.set throws", async () => {
    const cb = makeBreaker();
    const redis = makeRedis({
      isOpen: true,
      set: vi.fn(async () => {
        throw new Error("Redis unavailable");
      }),
      eval: vi.fn(async () => 0),
    });
    const lock = new DistributedAuditCircuitBreakerLock({ circuitBreaker: cb, redisClient: redis });

    const fn = vi.fn(async () => "fallback-ok");
    const result = await lock.executeWithLock(fn, "op-fallback");
    expect(result).toBe("fallback-ok");
  });

  it("proceeds when redisClient is null (no Redis configured)", async () => {
    const cb = makeBreaker();
    const lock = new DistributedAuditCircuitBreakerLock({
      circuitBreaker: cb,
      redisClient: null,
    });

    const fn = vi.fn(async () => "no-redis");
    const result = await lock.executeWithLock(fn, "op-no-redis");
    expect(result).toBe("no-redis");
  });

  it("proceeds when redisClient.isOpen is false", async () => {
    const cb = makeBreaker();
    const redis = makeRedis({ isOpen: false });
    const lock = new DistributedAuditCircuitBreakerLock({ circuitBreaker: cb, redisClient: redis });

    const fn = vi.fn(async () => "disconnected-redis");
    const result = await lock.executeWithLock(fn, "op-disconnected");
    expect(result).toBe("disconnected-redis");
    // redis.set should NOT be called (Redis unavailable)
    expect(redis.set).not.toHaveBeenCalled();
  });
});

// ── 8. syncState() reconciles from Redis ─────────────────────────────────────

describe("8. syncState() reconciles local state from Redis", () => {
  it("sets local state to OPEN when Redis reports OPEN", async () => {
    const cb = makeBreaker();
    expect(cb.state).toBe(CircuitState.CLOSED);

    const redis = makeRedis();
    const lock = new DistributedAuditCircuitBreakerLock({ circuitBreaker: cb, redisClient: redis });

    // Publish OPEN state from a "remote" instance
    const remotePayload = JSON.stringify({
      state: CircuitState.OPEN,
      failures: 5,
      openedAt: Date.now(),
      halfOpenSuccesses: 0,
    });
    redis._store.set(lock._stateKey, remotePayload);

    await lock.syncState(redis);
    expect(cb.state).toBe(CircuitState.OPEN);
  });

  it("sets local to HALF_OPEN when remote is HALF_OPEN and local is OPEN", async () => {
    const cb = makeBreaker();
    cb.state = CircuitState.OPEN;
    cb.openedAt = Date.now() - 5000;

    const redis = makeRedis();
    const lock = new DistributedAuditCircuitBreakerLock({ circuitBreaker: cb, redisClient: redis });

    const remotePayload = JSON.stringify({
      state: CircuitState.HALF_OPEN,
      halfOpenSuccesses: 1,
    });
    redis._store.set(lock._stateKey, remotePayload);

    await lock.syncState(redis);
    expect(cb.state).toBe(CircuitState.HALF_OPEN);
  });

  it("does not override CLOSED local state when remote is CLOSED", async () => {
    const cb = makeBreaker();
    expect(cb.state).toBe(CircuitState.CLOSED);

    const redis = makeRedis();
    const lock = new DistributedAuditCircuitBreakerLock({ circuitBreaker: cb, redisClient: redis });

    redis._store.set(lock._stateKey, JSON.stringify({ state: CircuitState.CLOSED, failures: 0 }));

    await lock.syncState(redis);
    expect(cb.state).toBe(CircuitState.CLOSED); // unchanged
  });

  it("returns null when Redis has no state for this circuit", async () => {
    const cb = makeBreaker();
    const redis = makeRedis();
    const lock = new DistributedAuditCircuitBreakerLock({ circuitBreaker: cb, redisClient: redis });

    const result = await lock.syncState(redis);
    expect(result).toBeNull();
  });
});

// ── 9. AuditWriterQueue with maxConcurrency > 1 runs operations concurrently ──

describe("9. AuditWriterQueue with maxConcurrency > 1", () => {
  it("runs up to maxConcurrency operations in parallel", async () => {
    const concurrency = 3;
    const queue = new AuditWriterQueue({ maxConcurrency: concurrency, label: "conc-test" });

    let maxObserved = 0;
    let activeNow = 0;
    const results = [];

    const ops = Array.from({ length: 6 }, (_, i) =>
      queue.enqueue(async () => {
        activeNow++;
        if (activeNow > maxObserved) maxObserved = activeNow;
        // Small async yield so multiple ops can overlap
        await new Promise((r) => setTimeout(r, 5));
        activeNow--;
        results.push(i);
        return i;
      }),
    );

    await Promise.all(ops);
    expect(maxObserved).toBeLessThanOrEqual(concurrency);
    expect(maxObserved).toBeGreaterThan(1); // actually ran concurrently
    expect(results).toHaveLength(6);
  });

  it("setMaxConcurrency() can be called after construction", async () => {
    const queue = new AuditWriterQueue({ label: "dyn-conc" });
    expect(queue.getStats().maxConcurrency).toBe(1);
    queue.setMaxConcurrency(4);
    expect(queue.getStats().maxConcurrency).toBe(4);
  });
});

// ── 10. Queue drops writes when full and increments droppedCount ──────────────

describe("10. Queue drops writes when full", () => {
  it("throws when queue is at maxQueueSize and increments droppedCount", async () => {
    const queue = new AuditWriterQueue({ maxQueueSize: 2, label: "drop-test" });

    // Block the queue with a long-running op so items accumulate
    let unblock;
    const blocker = new Promise((r) => { unblock = r; });

    const p1 = queue.enqueue(async () => { await blocker; return 1; });
    const p2 = queue.enqueue(async () => 2);
    const p3 = queue.enqueue(async () => 3);

    // queue now has 2 items (p2 and p3 are queued, p1 is processing)
    // Attempting a 3rd enqueue should drop
    await expect(queue.enqueue(async () => 4)).rejects.toThrow("Audit write queue full");
    expect(queue.droppedCount).toBe(1);

    // Clean up
    unblock();
    await Promise.allSettled([p1, p2, p3]);
  });
});
