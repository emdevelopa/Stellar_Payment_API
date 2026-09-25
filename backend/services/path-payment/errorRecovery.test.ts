import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  ErrorRecovery,
  CircuitState,
  ErrorCategory,
  createPaymentProcessorRecovery,
  createHorizonRecovery,
  createDatabaseRecovery,
} from "./errorRecovery.js";

function makeOperation(results: Array<"ok" | Error>) {
  let i = 0;
  return vi.fn(async () => {
    const r = results[i++];
    if (r === "ok") return "success";
    throw r;
  });
}

function transientError(message = "connection reset") {
  return Object.assign(new Error(message), { status: 503 });
}

function permanentError(message = "invalid_signature") {
  return Object.assign(new Error(message), { reason: "invalid_signature" });
}

function rateLimitError() {
  return Object.assign(new Error("rate limited"), { code: "429" });
}

describe("ErrorRecovery", () => {
  let recovery: ErrorRecovery;

  beforeEach(() => {
    vi.useFakeTimers();
    recovery = new ErrorRecovery({
      maxRetries: 2,
      failureThreshold: 3,
      resetTimeoutMs: 5_000,
      baseDelayMs: 10,
      maxDelayMs: 100,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    recovery.reset();
  });

  describe("successful execution", () => {
    it("returns the operation result on first try", async () => {
      const op = makeOperation(["ok"]);
      const result = await recovery.executeWithRetry(op);
      expect(result).toBe("success");
      expect(op).toHaveBeenCalledTimes(1);
    });

    it("records metrics for successful operations", async () => {
      await recovery.executeWithRetry(makeOperation(["ok"]));
      const metrics = recovery.getMetrics();
      expect(metrics.totalAttempts).toBe(1);
      expect(metrics.successCount).toBe(1);
      expect(metrics.failureCount).toBe(0);
    });
  });

  describe("retry behaviour", () => {
    it("retries transient errors and succeeds", async () => {
      const op = makeOperation([transientError(), transientError(), "ok"]);
      const resultPromise = recovery.executeWithRetry(op);
      await vi.runAllTimersAsync();
      const result = await resultPromise;
      expect(result).toBe("success");
      expect(op).toHaveBeenCalledTimes(3);
    });

    it("does not retry permanent errors", async () => {
      const err = permanentError();
      const op = makeOperation([err]);
      await expect(recovery.executeWithRetry(op)).rejects.toThrow("invalid_signature");
      expect(op).toHaveBeenCalledTimes(1);
    });

    it("does not retry auth errors", async () => {
      const authErr = Object.assign(new Error("unauthorized"), { status: 401 });
      const op = makeOperation([authErr]);
      await expect(recovery.executeWithRetry(op)).rejects.toBeDefined();
      expect(op).toHaveBeenCalledTimes(1);
    });

    it("retries rate-limited errors", async () => {
      const op = makeOperation([rateLimitError(), "ok"]);
      const resultPromise = recovery.executeWithRetry(op);
      await vi.runAllTimersAsync();
      const result = await resultPromise;
      expect(result).toBe("success");
      expect(op).toHaveBeenCalledTimes(2);
    });

    it("throws after exhausting maxRetries", async () => {
      const op = makeOperation([
        transientError(),
        transientError(),
        transientError(),
        transientError(),
      ]);
      const p = recovery.executeWithRetry(op);
      await vi.runAllTimersAsync();
      await expect(p).rejects.toBeDefined();
      expect(op).toHaveBeenCalledTimes(3);
    });
  });

  describe("circuit breaker", () => {
    it("starts CLOSED", () => {
      expect(recovery.getState()).toBe(CircuitState.CLOSED);
    });

    it("trips to OPEN after failureThreshold permanent failures", async () => {
      for (let i = 0; i < 3; i++) {
        await expect(
          recovery.executeWithRetry(makeOperation([permanentError()]))
        ).rejects.toBeDefined();
      }
      expect(recovery.getState()).toBe(CircuitState.OPEN);
    });

    it("rejects immediately when OPEN without calling the operation", async () => {
      for (let i = 0; i < 3; i++) {
        await expect(
          recovery.executeWithRetry(makeOperation([permanentError()]))
        ).rejects.toBeDefined();
      }
      const op = vi.fn(async () => "success");
      await expect(recovery.executeWithRetry(op)).rejects.toMatchObject({
        circuitBreakerOpen: true,
      });
      expect(op).not.toHaveBeenCalled();
    });

    it("transitions from OPEN to HALF_OPEN after resetTimeout", async () => {
      for (let i = 0; i < 3; i++) {
        await expect(
          recovery.executeWithRetry(makeOperation([permanentError()]))
        ).rejects.toBeDefined();
      }
      expect(recovery.getState()).toBe(CircuitState.OPEN);
      vi.advanceTimersByTime(5_001);
      expect(recovery.getState()).toBe(CircuitState.HALF_OPEN);
    });

    it("closes circuit after enough successes in HALF_OPEN", async () => {
      for (let i = 0; i < 3; i++) {
        await expect(
          recovery.executeWithRetry(makeOperation([permanentError()]))
        ).rejects.toBeDefined();
      }
      vi.advanceTimersByTime(5_001);
      expect(recovery.getState()).toBe(CircuitState.HALF_OPEN);

      await recovery.executeWithRetry(makeOperation(["ok"]));
      await recovery.executeWithRetry(makeOperation(["ok"]));
      expect(recovery.getState()).toBe(CircuitState.CLOSED);
    });

    it("trips back to OPEN if failure occurs in HALF_OPEN", async () => {
      for (let i = 0; i < 3; i++) {
        await expect(
          recovery.executeWithRetry(makeOperation([permanentError()]))
        ).rejects.toBeDefined();
      }
      vi.advanceTimersByTime(5_001);
      await expect(
        recovery.executeWithRetry(makeOperation([permanentError()]))
      ).rejects.toBeDefined();
      expect(recovery.getState()).toBe(CircuitState.OPEN);
    });

    it("increments circuitBreakerTrips metric", async () => {
      for (let i = 0; i < 3; i++) {
        await expect(
          recovery.executeWithRetry(makeOperation([permanentError()]))
        ).rejects.toBeDefined();
      }
      expect(recovery.getMetrics().circuitBreakerTrips).toBe(1);
    });

    it("reset() clears circuit state", async () => {
      for (let i = 0; i < 3; i++) {
        await expect(
          recovery.executeWithRetry(makeOperation([permanentError()]))
        ).rejects.toBeDefined();
      }
      recovery.reset();
      expect(recovery.getState()).toBe(CircuitState.CLOSED);
    });
  });

  describe("metrics", () => {
    it("tracks lastFailureTime and lastSuccessTime", async () => {
      vi.setSystemTime(1_000_000);
      const op = makeOperation([transientError(), "ok"]);
      const p = recovery.executeWithRetry(op);
      await vi.runAllTimersAsync();
      await p;
      const m = recovery.getMetrics();
      expect(m.lastFailureTime).toBeGreaterThan(0);
      expect(m.lastSuccessTime).toBeGreaterThan(0);
    });
  });
});

describe("factory helpers", () => {
  it("createPaymentProcessorRecovery returns an ErrorRecovery", () => {
    const r = createPaymentProcessorRecovery();
    expect(r).toBeInstanceOf(ErrorRecovery);
    expect(r.getState()).toBe(CircuitState.CLOSED);
  });

  it("createHorizonRecovery returns an ErrorRecovery", () => {
    const r = createHorizonRecovery();
    expect(r).toBeInstanceOf(ErrorRecovery);
  });

  it("createDatabaseRecovery returns an ErrorRecovery", () => {
    const r = createDatabaseRecovery();
    expect(r).toBeInstanceOf(ErrorRecovery);
  });

  it("factory options are merged over defaults", () => {
    const r = createPaymentProcessorRecovery({ maxRetries: 10 });
    expect(r).toBeInstanceOf(ErrorRecovery);
  });
});
