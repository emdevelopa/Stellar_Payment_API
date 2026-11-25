/**
 * Integration & Stress Test Suite
 * Issues #1429, #1430, #1431, #1432
 *
 * Covers:
 * - executeWithRetry: exponential backoff, jitter, non-transient bypass
 * - acquireLock / releaseLock / withLock: distributed locking primitives
 * - analyzePayment / analyzePaymentLocked: concurrent safety
 * - sanitizePayload / validatePayload: input hygiene and strict validation
 * - AuditCircuitBreaker.process(): end-to-end sanitize+validate+circuit pipeline
 *
 * Uses Jest (jest.config.js → babel-jest ESM transform).
 * Redis is mocked with an in-memory stand-in — no real connections required.
 */

// ---------------------------------------------------------------------------
// Fake Redis (inline stand-in — avoids importing the shared helper so this
// file is fully self-contained and runnable via `test:integration`)
// ---------------------------------------------------------------------------

function createFakeRedis({ latencyMs = 0, failWith = null } = {}) {
  const store = new Map();
  let _failWith = failWith;

  const live = (key) => {
    const entry = store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && Date.now() >= entry.expiresAt) {
      store.delete(key);
      return null;
    }
    return entry;
  };

  const client = {
    store,
    isOpen: true,
    setFailure(err) {
      _failWith = err;
    },
    async set(key, value, opts = {}) {
      if (latencyMs > 0) await new Promise((r) => setTimeout(r, latencyMs));
      if (_failWith) throw _failWith;
      if (opts.NX && live(key)) return null;
      let expiresAt = null;
      if (opts.EX) expiresAt = Date.now() + Number(opts.EX) * 1000;
      if (opts.PX) expiresAt = Date.now() + Number(opts.PX);
      store.set(key, { value: String(value), expiresAt });
      return "OK";
    },
    async get(key) {
      if (latencyMs > 0) await new Promise((r) => setTimeout(r, latencyMs));
      if (_failWith) throw _failWith;
      return live(key)?.value ?? null;
    },
    async del(key) {
      if (latencyMs > 0) await new Promise((r) => setTimeout(r, latencyMs));
      if (_failWith) throw _failWith;
      return store.delete(key) ? 1 : 0;
    },
    async sendCommand(args) {
      if (latencyMs > 0) await new Promise((r) => setTimeout(r, latencyMs));
      if (_failWith) throw _failWith;
      const [cmd, ...rest] = args;
      switch (String(cmd).toUpperCase()) {
        case "EVAL": {
          // Compare-and-delete Lua script
          const [, , key, token] = rest;
          const entry = live(key);
          if (entry && entry.value === token) {
            store.delete(key);
            return 1;
          }
          return 0;
        }
        case "GET":
          return live(rest[0])?.value ?? null;
        case "SET": {
          const [key, value, ...flags] = rest;
          const upper = flags.map((f) => String(f).toUpperCase());
          if (upper.includes("NX") && live(key)) return null;
          const exIdx = upper.indexOf("EX");
          const pxIdx = upper.indexOf("PX");
          let expiresAt = null;
          if (exIdx >= 0) expiresAt = Date.now() + Number(flags[exIdx + 1]) * 1000;
          if (pxIdx >= 0) expiresAt = Date.now() + Number(flags[pxIdx + 1]);
          store.set(key, { value: String(value), expiresAt });
          return "OK";
        }
        default:
          throw new Error(`fake-redis: unsupported command ${cmd}`);
      }
    },
  };

  return client;
}

// ---------------------------------------------------------------------------
// Module imports (dynamic so babel-jest handles ESM in Jest context)
// ---------------------------------------------------------------------------

let executeWithRetry,
  acquireLock,
  releaseLock,
  withLock,
  LockTimeoutError,
  analyzePayment,
  analyzePaymentLocked,
  resetMetrics;

let sanitizePayload, validatePayload, ValidationError, AuditCircuitBreaker, CircuitState;

beforeAll(async () => {
  ({
    executeWithRetry,
    acquireLock,
    releaseLock,
    withLock,
    LockTimeoutError,
    analyzePayment,
    analyzePaymentLocked,
    resetMetrics,
  } = await import("../../src/lib/fraud-detection-engine.js"));

  ({
    sanitizePayload,
    validatePayload,
    ValidationError,
    AuditCircuitBreaker,
    CircuitState,
  } = await import("../../src/lib/audit-circuit-breaker.js"));
});

// Silence logger output during tests
jest.mock("../../src/lib/logger.js", () => ({
  logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

jest.mock("../../src/lib/metrics.js", () => ({
  fraudDetectionRiskScore: { observe: jest.fn() },
  fraudDetectionAnomaliesDetected: { inc: jest.fn() },
  fraudDetectionPaymentsAnalyzed: { inc: jest.fn() },
  fraudDetectionBlockedPayments: { inc: jest.fn() },
  fraudDetectionHighRiskDetected: { inc: jest.fn() },
  fraudDetectionVelocityExceeded: { inc: jest.fn() },
  fraudDetectionGeographicAnomaly: { inc: jest.fn() },
  fraudDetectionMetadataAnomalies: { inc: jest.fn() },
  fraudDetectionCacheSize: { set: jest.fn() },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_RECIPIENT = "GBRPYHIL2CI3WHZDTOOQFC6EB4RBMAJVMBARWIOYBETLWGEFRES4KXO4";

function makePayment(overrides = {}) {
  return {
    id: `pay-${Math.random().toString(36).slice(2)}`,
    merchant_id: "merchant-test",
    recipient: VALID_RECIPIENT,
    asset: "USDC",
    amount: "100",
    status: "pending",
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeTransientError(status) {
  const err = new Error(`HTTP ${status}`);
  err.status = status;
  return err;
}

function makeNetworkError(code = "ECONNRESET") {
  const err = new Error(`Network error: ${code}`);
  err.code = code;
  return err;
}

// ---------------------------------------------------------------------------
// SECTION 1 — executeWithRetry
// ---------------------------------------------------------------------------

describe("executeWithRetry — retry logic", () => {
  beforeEach(() => {
    jest.useRealTimers();
  });

  // Test 1: succeeds on 2nd attempt after 1 transient failure
  it("succeeds on 2nd attempt after 1 transient failure", async () => {
    let calls = 0;
    const fn = jest.fn(async () => {
      calls++;
      if (calls === 1) throw makeTransientError(503);
      return "success";
    });

    const result = await executeWithRetry(fn, {
      maxRetries: 3,
      baseDelayMs: 1,
      maxDelayMs: 10,
      jitter: false,
    });

    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  // Test 2: throws after exhausting all retries
  it("throws after exhausting all retries", async () => {
    const fn = jest.fn(async () => {
      throw makeTransientError(503);
    });

    await expect(
      executeWithRetry(fn, { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 10, jitter: false }),
    ).rejects.toMatchObject({ status: 503 });

    // 1 initial + 3 retries = 4 total calls
    expect(fn).toHaveBeenCalledTimes(4);
  });

  // Test 3: does NOT retry on non-transient errors (4xx client errors)
  it("does NOT retry on non-transient errors (4xx)", async () => {
    const fn = jest.fn(async () => {
      throw makeTransientError(400);
    });

    await expect(
      executeWithRetry(fn, { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 10, jitter: false }),
    ).rejects.toMatchObject({ status: 400 });

    // Must not retry — exactly 1 call
    expect(fn).toHaveBeenCalledTimes(1);
  });

  // Test 4: backoff delay increases exponentially between retries
  it("backoff delay increases exponentially", async () => {
    const delays = [];
    const originalSetTimeout = global.setTimeout;
    // Spy on setTimeout to capture delays without actually waiting
    jest.spyOn(global, "setTimeout").mockImplementation((cb, ms) => {
      delays.push(ms);
      return originalSetTimeout(cb, 0); // execute immediately
    });

    let calls = 0;
    const fn = jest.fn(async () => {
      calls++;
      if (calls < 4) throw makeTransientError(503);
      return "done";
    });

    await executeWithRetry(fn, { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 10000, jitter: false });

    jest.restoreAllMocks();

    // Delays should be 100, 200, 400 (2^0 * 100, 2^1 * 100, 2^2 * 100)
    expect(delays.length).toBe(3);
    expect(delays[1]).toBeGreaterThan(delays[0]);
    expect(delays[2]).toBeGreaterThan(delays[1]);
    // Exact ratios for no-jitter exponential
    expect(delays[1] / delays[0]).toBeCloseTo(2, 0);
    expect(delays[2] / delays[1]).toBeCloseTo(2, 0);
  });

  // Test 5: jitter is applied when enabled
  it("jitter is applied when enabled", async () => {
    const delays = [];
    const originalSetTimeout = global.setTimeout;
    jest.spyOn(global, "setTimeout").mockImplementation((cb, ms) => {
      delays.push(ms);
      return originalSetTimeout(cb, 0);
    });

    let calls = 0;
    const fn = jest.fn(async () => {
      calls++;
      if (calls < 3) throw makeTransientError(503);
      return "done";
    });

    // Run multiple times to observe jitter variance
    await executeWithRetry(fn, { maxRetries: 2, baseDelayMs: 1000, maxDelayMs: 5000, jitter: true });

    jest.restoreAllMocks();

    // With jitter ±20%, delay should be within [800, 1200] for baseDelay 1000
    expect(delays.length).toBeGreaterThan(0);
    expect(delays[0]).toBeGreaterThanOrEqual(800);
    expect(delays[0]).toBeLessThanOrEqual(1200);
  });
});

// ---------------------------------------------------------------------------
// SECTION 2 — acquireLock / releaseLock / withLock
// ---------------------------------------------------------------------------

describe("Distributed Locking", () => {
  let redis;

  beforeEach(() => {
    redis = createFakeRedis();
  });

  // Test 6: lock acquisition succeeds when key is free
  it("lock acquisition succeeds when key is free", async () => {
    const result = await acquireLock("test-key", 5000, redis);
    expect(result.acquired).toBe(true);
    expect(result.lockKey).toBe("fraud:lock:test-key");
    expect(typeof result.token).toBe("string");
    expect(result.token.length).toBeGreaterThan(0);
  });

  // Test 7: lock acquisition fails/times out when key is already held
  it("times out when key is already held", async () => {
    // Pre-hold the lock
    await acquireLock("busy-key", 30000, redis);

    await expect(
      withLock("busy-key", 30000, () => Promise.resolve("should-not-run"), redis, {
        timeoutMs: 200,
        pollIntervalMs: 20,
      }),
    ).rejects.toBeInstanceOf(LockTimeoutError);
  });

  // Test 8: lock release only releases when token matches
  it("release only releases when token matches", async () => {
    const { acquired, lockKey, token } = await acquireLock("release-key", 10000, redis);
    expect(acquired).toBe(true);

    // Wrong token: should not release
    const releasedWithWrongToken = await releaseLock(lockKey, "wrong-token", redis);
    expect(releasedWithWrongToken).toBe(false);

    // Lock should still be held
    const retryAcquire = await acquireLock("release-key", 10000, redis);
    expect(retryAcquire.acquired).toBe(false);

    // Correct token: should release
    const releasedWithCorrectToken = await releaseLock(lockKey, token, redis);
    expect(releasedWithCorrectToken).toBe(true);

    // Lock should now be free
    const afterRelease = await acquireLock("release-key", 10000, redis);
    expect(afterRelease.acquired).toBe(true);
  });

  // Test 9: withLock releases lock even if fn throws
  it("withLock releases lock even if fn throws", async () => {
    const key = "throw-key";

    await expect(
      withLock(key, 5000, async () => {
        throw new Error("fn threw");
      }, redis),
    ).rejects.toThrow("fn threw");

    // Lock must be released now
    const reacquired = await acquireLock(key, 5000, redis);
    expect(reacquired.acquired).toBe(true);
  });

  // Test 10: Concurrent fraud checks serialized correctly via locking (5 concurrent calls)
  it("concurrent calls are serialized via locking (5 concurrent calls)", async () => {
    resetMetrics();
    const order = [];
    const key = "serialize-key";
    const ttl = 5000;

    const tasks = Array.from({ length: 5 }, (_, i) =>
      withLock(key, ttl, async () => {
        order.push(`start-${i}`);
        await new Promise((r) => setTimeout(r, 5)); // simulate work
        order.push(`end-${i}`);
        return i;
      }, redis),
    );

    const results = await Promise.all(tasks);

    // All 5 tasks must complete
    expect(results.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);

    // start/end must be interleaved properly — each start must be followed by
    // its own end before the next start (no two starts without a matching end)
    let inCriticalSection = false;
    for (const event of order) {
      if (event.startsWith("start-")) {
        expect(inCriticalSection).toBe(false); // no nested locks
        inCriticalSection = true;
      } else {
        expect(inCriticalSection).toBe(true);
        inCriticalSection = false;
      }
    }
  });
});

// ---------------------------------------------------------------------------
// SECTION 3 — Stress Tests
// ---------------------------------------------------------------------------

describe("Stress tests", () => {
  beforeEach(() => {
    resetMetrics();
  });

  // Test 11: 50 rapid sequential fraud evaluations complete without errors
  it("50 rapid sequential fraud evaluations complete without errors", async () => {
    const results = [];
    for (let i = 0; i < 50; i++) {
      const payment = makePayment({ id: `stress-seq-${i}`, amount: String(50 + i) });
      const result = analyzePayment(payment);
      expect(result).toHaveProperty("riskScore");
      expect(result).toHaveProperty("riskLevel");
      results.push(result);
    }
    expect(results).toHaveLength(50);
    expect(results.every((r) => typeof r.riskScore === "number")).toBe(true);
  });

  // Test 12: 20 concurrent fraud evaluations with overlapping locks resolve correctly
  it("20 concurrent fraud evaluations with overlapping locks resolve correctly", async () => {
    const redis = createFakeRedis();

    const tasks = Array.from({ length: 20 }, (_, i) => {
      const payment = makePayment({ id: `stress-conc-${i}`, merchant_id: `m-${i % 4}` });
      return analyzePaymentLocked(payment, redis, { ttlMs: 10000, timeoutMs: 15000, pollIntervalMs: 10 });
    });

    const results = await Promise.all(tasks);
    expect(results).toHaveLength(20);
    expect(results.every((r) => r && typeof r.riskScore === "number")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SECTION 4 — sanitizePayload
// ---------------------------------------------------------------------------

describe("sanitizePayload", () => {
  // Test 13: strips disallowed keys
  it("strips disallowed keys", () => {
    const payload = {
      event: "payment.created",
      timestamp: Date.now(),
      merchantId: "merchant-abc",
      unknownField: "should-be-stripped",
      anotherRogue: 42,
    };

    const clean = sanitizePayload(payload);
    expect(clean).not.toHaveProperty("unknownField");
    expect(clean).not.toHaveProperty("anotherRogue");
    expect(clean).toHaveProperty("event", "payment.created");
    expect(clean).toHaveProperty("merchantId", "merchant-abc");
  });

  // Test 14: truncates long strings
  it("truncates string values exceeding 1000 characters", () => {
    const longString = "a".repeat(1500);
    const payload = {
      event: "payment.created",
      timestamp: Date.now(),
      merchantId: "merchant-abc",
      errorMessage: longString,
    };

    const clean = sanitizePayload(payload);
    expect(clean.errorMessage.length).toBe(1000);
    expect(clean.errorMessage).toBe("a".repeat(1000));
  });

  // Test 15: redacts sensitive fields
  it("redacts sensitive fields", () => {
    const payload = {
      event: "auth.login",
      timestamp: Date.now(),
      merchantId: "merchant-abc",
      // These keys are sensitive — but some are not in the allowlist.
      // token IS in the allowlist for this test; others are stripped.
    };
    // Directly test the redaction via a field in the allowlist: token
    const payloadWithToken = { ...payload, token: "super-secret-jwt" };
    const clean = sanitizePayload(payloadWithToken);
    expect(clean.token).toBe("[REDACTED]");

    // Also verify that non-allowlisted sensitive-looking fields are stripped (not just redacted)
    const payloadWithPassword = { ...payload, password: "plaintext", secret: "mysecret" };
    const cleanPwd = sanitizePayload(payloadWithPassword);
    // password and secret are not in allowlist → stripped entirely
    expect(cleanPwd).not.toHaveProperty("password");
    expect(cleanPwd).not.toHaveProperty("secret");
  });

  // Test 16: blocks prototype pollution keys
  it("blocks prototype pollution keys (__proto__, constructor, prototype)", () => {
    // We cannot use { __proto__: ... } literal as it modifies the prototype.
    const payload = Object.create(null);
    payload.event = "payment.created";
    payload.timestamp = Date.now();
    payload.merchantId = "merchant-abc";

    // Manually set pollution keys
    Object.defineProperty(payload, "__proto__", { value: { injected: true }, enumerable: true });
    Object.defineProperty(payload, "constructor", { value: "evil", enumerable: true });
    Object.defineProperty(payload, "prototype", { value: "evil", enumerable: true });

    const clean = sanitizePayload(payload);
    expect(clean).not.toHaveProperty("__proto__");
    expect(clean).not.toHaveProperty("constructor");
    expect(clean).not.toHaveProperty("prototype");
    expect(clean).toHaveProperty("event");
  });
});

// ---------------------------------------------------------------------------
// SECTION 5 — validatePayload
// ---------------------------------------------------------------------------

describe("validatePayload", () => {
  const validPayload = {
    event: "payment.completed",
    timestamp: new Date().toISOString(),
    merchantId: "merchant-abc-123",
  };

  // Test 17: passes with valid payload
  it("passes with a valid payload", () => {
    expect(() => validatePayload(validPayload)).not.toThrow();
    expect(validatePayload(validPayload)).toBe(true);
  });

  // Test 18: throws ValidationError for missing required fields
  it("throws ValidationError for missing required fields", () => {
    // Missing event
    expect(() => validatePayload({ timestamp: Date.now(), merchantId: "m-1" })).toThrow(
      ValidationError,
    );
    expect(() => validatePayload({ timestamp: Date.now(), merchantId: "m-1" })).toThrow(
      /event/,
    );

    // Missing timestamp
    expect(() => validatePayload({ event: "x.y", merchantId: "m-1" })).toThrow(ValidationError);
    expect(() => validatePayload({ event: "x.y", merchantId: "m-1" })).toThrow(/timestamp/);

    // Missing merchantId
    expect(() => validatePayload({ event: "x.y", timestamp: Date.now() })).toThrow(ValidationError);
    expect(() => validatePayload({ event: "x.y", timestamp: Date.now() })).toThrow(/merchantId/);
  });

  // Test 19: throws ValidationError for invalid event string
  it("throws ValidationError for invalid event string", () => {
    // Contains space
    expect(() =>
      validatePayload({ ...validPayload, event: "bad event name" }),
    ).toThrow(ValidationError);

    // Too long (> 100 chars)
    expect(() =>
      validatePayload({ ...validPayload, event: "a".repeat(101) }),
    ).toThrow(ValidationError);

    // Empty string
    expect(() =>
      validatePayload({ ...validPayload, event: "" }),
    ).toThrow(ValidationError);

    // Contains special chars
    expect(() =>
      validatePayload({ ...validPayload, event: "bad/event!" }),
    ).toThrow(ValidationError);
  });

  // Test 20: throws ValidationError for invalid timestamp
  it("throws ValidationError for invalid timestamp", () => {
    // Random non-date string
    expect(() =>
      validatePayload({ ...validPayload, timestamp: "not-a-date" }),
    ).toThrow(ValidationError);

    // Object (wrong type)
    expect(() =>
      validatePayload({ ...validPayload, timestamp: {} }),
    ).toThrow(ValidationError);

    // Negative number
    expect(() =>
      validatePayload({ ...validPayload, timestamp: -1 }),
    ).toThrow(ValidationError);

    // Valid Unix timestamp (should NOT throw)
    expect(() =>
      validatePayload({ ...validPayload, timestamp: Date.now() }),
    ).not.toThrow();

    // Valid ISO string (should NOT throw)
    expect(() =>
      validatePayload({ ...validPayload, timestamp: new Date().toISOString() }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// SECTION 6 — Integration: sanitize + validate pipeline & AuditCircuitBreaker
// ---------------------------------------------------------------------------

describe("Integration — sanitize + validate pipeline", () => {
  // Test 21: rejects a malicious payload end-to-end
  it("sanitize + validate rejects a malicious payload end-to-end", () => {
    // Payload has: unknown keys, a __proto__ key, and a missing `event` field after sanitizing
    const malicious = {
      __proto__: { polluted: true },
      unknownKey: "rogue",
      timestamp: new Date().toISOString(),
      merchantId: "merchant-1",
      // `event` is intentionally omitted
    };

    const clean = sanitizePayload(malicious);

    // After sanitization, `event` is still missing → validatePayload should throw
    expect(() => validatePayload(clean)).toThrow(ValidationError);
    expect(() => validatePayload(clean)).toThrow(/event/);
  });

  // Test 22: valid audit events pass through the circuit breaker correctly
  it("valid audit events pass through the circuit breaker correctly", async () => {
    const cb = new AuditCircuitBreaker({ failureThreshold: 5, label: "test-cb" });
    const handler = jest.fn(async (payload) => ({ processed: true, event: payload.event }));

    const rawPayload = {
      event: "payment.confirmed",
      timestamp: new Date().toISOString(),
      merchantId: "merchant-xyz",
      userId: "user-123",
      unknownKey: "should-be-stripped",
    };

    const result = await cb.process(rawPayload, handler);

    expect(result).toEqual({ processed: true, event: "payment.confirmed" });
    expect(handler).toHaveBeenCalledTimes(1);

    // Handler should receive the sanitized payload (unknownKey stripped)
    const receivedPayload = handler.mock.calls[0][0];
    expect(receivedPayload).not.toHaveProperty("unknownKey");
    expect(receivedPayload).toHaveProperty("event", "payment.confirmed");
    expect(receivedPayload).toHaveProperty("merchantId", "merchant-xyz");

    // Circuit should remain CLOSED after a successful call
    expect(cb.state).toBe(CircuitState.CLOSED);
  });
});
