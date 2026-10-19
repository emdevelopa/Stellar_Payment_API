import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockPoolQuery,
  mockPoolOn,
  mockPoolEnd,
} = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockPoolOn: vi.fn(),
  mockPoolEnd: vi.fn(),
}));

vi.mock("pg", () => ({
  default: {
    Pool: vi.fn(() => ({
      query: mockPoolQuery,
      on: mockPoolOn,
      end: mockPoolEnd,
      totalCount: 0,
      idleCount: 0,
      waitingCount: 0,
      options: { max: 20, min: 2 },
    })),
  },
}));

vi.mock("./metrics.js", () => ({
  pgPoolTotalConnections: { set: vi.fn() },
  pgPoolIdleConnections: { set: vi.fn() },
  pgPoolWaitingRequests: { set: vi.fn() },
  pgPoolUtilizationPercent: { set: vi.fn() },
}));

vi.mock("./logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { isRetryablePoolError, queryWithRetry } from "./db.js";
import { logger } from "./logger.js";

describe("db pool retry helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("classifies transient pool errors as retryable", () => {
    expect(isRetryablePoolError({ code: "57P01", message: "terminating connection" })).toBe(true);
    expect(isRetryablePoolError({ message: "Connection terminated unexpectedly" })).toBe(true);
    expect(isRetryablePoolError({ code: "23505", message: "duplicate key" })).toBe(false);
  });

  it("retries transient query failures and eventually succeeds", async () => {
    vi.useFakeTimers();

    const firstError = new Error("connection terminated");
    firstError.code = "57P01";

    mockPoolQuery
      .mockRejectedValueOnce(firstError)
      .mockResolvedValueOnce({ rows: [{ ok: true }] });

    const queryPromise = queryWithRetry("SELECT 1", [], {
      label: "health-probe",
      retryAttempts: 1,
      retryDelayMs: 5,
    });

    await vi.runAllTimersAsync();
    const result = await queryPromise;
    vi.useRealTimers();

    expect(mockPoolQuery).toHaveBeenCalledTimes(2);
    expect(result.rows).toEqual([{ ok: true }]);
  });

  it("fails fast on non-retryable query errors", async () => {
    const nonRetryable = new Error("duplicate key");
    nonRetryable.code = "23505";
    mockPoolQuery.mockRejectedValueOnce(nonRetryable);

    await expect(
      queryWithRetry("SELECT 1", [], {
        retryAttempts: 2,
      }),
    ).rejects.toThrow("duplicate key");

    expect(mockPoolQuery).toHaveBeenCalledTimes(1);
  });

  it("logs a structured warning with pool state when retrying (Issue #1057)", async () => {
    vi.useFakeTimers();

    const transient = new Error("connection terminated");
    transient.code = "57P01";

    mockPoolQuery
      .mockRejectedValueOnce(transient)
      .mockResolvedValueOnce({ rows: [{ ok: true }] });

    const queryPromise = queryWithRetry("SELECT 1", [], {
      label: "health-probe",
      retryAttempts: 1,
      retryDelayMs: 5,
    });

    await vi.runAllTimersAsync();
    await queryPromise;
    vi.useRealTimers();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "health-probe",
        attempt: 1,
        maxAttempts: 2,
        err: "connection terminated",
      }),
      "pg pool query failed, retrying",
    );
  });

  it("logs a structured error with pool and circuit breaker state on failure (Issue #1057)", async () => {
    const nonRetryable = new Error("duplicate key");
    nonRetryable.code = "23505";
    nonRetryable.severity = "ERROR";
    mockPoolQuery.mockRejectedValueOnce(nonRetryable);

    await expect(
      queryWithRetry("SELECT 1", [], { label: "insert-payment", retryAttempts: 1 }),
    ).rejects.toThrow("duplicate key");

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        err: "duplicate key",
        code: "23505",
        severity: "ERROR",
        label: "insert-payment",
        retryable: false,
        poolStats: expect.objectContaining({ maxConnections: 20 }),
        circuitBreakerState: expect.objectContaining({ state: expect.any(String) }),
      }),
      "Database pool error",
    );
  });
});
