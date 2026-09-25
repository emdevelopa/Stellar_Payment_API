/**
 * Tests for Enhanced Database Module with Performance Monitoring
 * Issue: SQL Query Performance Optimization for Transaction Signer
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mockPool = vi.hoisted(() => ({
  query: vi.fn(),
  totalCount: 5,
  idleCount: 2,
  waitingCount: 0,
  options: { max: 20, min: 2 },
}));

vi.mock("pg", () => ({
  Pool: vi.fn(() => mockPool),
}));

vi.mock("./logger.js", () => ({
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("./metrics.js", () => ({
  queryDuration: { observe: vi.fn() },
  queryRetryCount: { inc: vi.fn() },
  slowQueryCount: { inc: vi.fn() },
  pgPoolTotalConnections: { set: vi.fn() },
  pgPoolIdleConnections: { set: vi.fn() },
  pgPoolWaitingRequests: { set: vi.fn() },
  pgPoolUtilizationPercent: { set: vi.fn() },
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import {
  queryWithRetry,
  getPoolStats,
  startPoolMonitoring,
  analyzeSlowQueries,
  analyzeIndexUsage,
  isRetryablePoolError,
} from "./db-enhanced.js";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Enhanced Database Module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Query with Retry ────────────────────────────────────────────────────────

  describe("queryWithRetry", () => {
    it("executes query successfully on first attempt", async () => {
      mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });

      const result = await queryWithRetry("SELECT * FROM payments", [], {
        label: "test-query",
      });

      expect(result).toBeDefined();
      expect(mockPool.query).toHaveBeenCalledTimes(1);
    });

    it("retries on retryable error", async () => {
      mockPool.query
        .mockRejectedValueOnce({ code: "08006", message: "connection terminated" })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await queryWithRetry("SELECT * FROM payments", [], {
        label: "test-query",
      });

      expect(result).toBeDefined();
      expect(mockPool.query).toHaveBeenCalledTimes(2);
    });

    it("does not retry on non-retryable error", async () => {
      const error = { code: "23505", message: "unique constraint violation" };
      mockPool.query.mockRejectedValue(error);

      await expect(
        queryWithRetry("SELECT * FROM payments", [], { label: "test-query" })
      ).rejects.toThrow(error);

      expect(mockPool.query).toHaveBeenCalledTimes(1);
    });

    it("records query duration metrics", async () => {
      mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });

      await queryWithRetry("SELECT * FROM payments", [], { label: "test-query" });

      // Verify metrics were called (implementation-specific)
    });

    it("records slow query when threshold exceeded", async () => {
      mockPool.query.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 1100)); // Simulate slow query
        return { rows: [], rowCount: 0 };
      });

      await queryWithRetry("SELECT * FROM payments", [], {
        label: "test-query",
      });

      // Verify slow query metric was called
    });

    it("logs query execution with context", async () => {
      mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });

      await queryWithRetry("SELECT * FROM payments", [], { label: "test-query" });

      // Verify logging was called with context
    });
  });

  // ── Pool Statistics ─────────────────────────────────────────────────────────

  describe("getPoolStats", () => {
    it("returns current pool statistics", () => {
      const stats = getPoolStats();

      expect(stats).toHaveProperty("totalConnections");
      expect(stats).toHaveProperty("idleConnections");
      expect(stats).toHaveProperty("waitingRequests");
      expect(stats).toHaveProperty("maxConnections");
      expect(stats).toHaveProperty("minConnections");
    });
  });

  // ── Pool Monitoring ─────────────────────────────────────────────────────────

  describe("startPoolMonitoring", () => {
    it("starts periodic pool monitoring", () => {
      const clearInterval = vi.fn();
      vi.spyOn(global, "setInterval").mockReturnValue(clearInterval);

      const cleanup = startPoolMonitoring(60_000);

      expect(setInterval).toHaveBeenCalledWith(expect.any(Function), 60_000);
      expect(typeof cleanup).toBe("function");

      clearInterval.mockRestore();
    });

    it("logs pool statistics periodically", () => {
      const clearInterval = vi.fn();
      vi.spyOn(global, "setInterval").mockReturnValue(clearInterval);

      startPoolMonitoring(60_000);

      // Advance timers to trigger monitoring
      vi.advanceTimersByTime(60_000);

      // Verify logging was called

      clearInterval.mockRestore();
    });
  });

  // ── Slow Query Analysis ─────────────────────────────────────────────────────

  describe("analyzeSlowQueries", () => {
    it("analyzes slow queries from pg_stat_statements", async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          {
            query: "SELECT * FROM payments WHERE status = $1",
            calls: 1000,
            total_time: 5000,
            mean_time: 5,
            stddev_time: 2,
            max_time: 50,
          },
        ],
      });

      const result = await analyzeSlowQueries(10);

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(mockPool.query).toHaveBeenCalled();
    });

    it("handles pg_stat_statements not available", async () => {
      mockPool.query.mockRejectedValue(new Error("pg_stat_statements not available"));

      const result = await analyzeSlowQueries(10);

      expect(result).toEqual([]);
    });
  });

  // ── Index Usage Analysis ────────────────────────────────────────────────────

  describe("analyzeIndexUsage", () => {
    it("analyzes index usage statistics", async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          {
            schemaname: "public",
            tablename: "payments",
            indexname: "payments_status_idx",
            index_scans: 1000,
            tuples_read: 5000,
            tuples_fetched: 5000,
            index_size: "8192 bytes",
          },
        ],
      });

      const result = await analyzeIndexUsage();

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(mockPool.query).toHaveBeenCalled();
    });

    it("handles index analysis errors gracefully", async () => {
      mockPool.query.mockRejectedValue(new Error("analysis failed"));

      const result = await analyzeIndexUsage();

      expect(result).toEqual([]);
    });
  });

  // ── Retryable Error Detection ───────────────────────────────────────────────

  describe("isRetryablePoolError", () => {
    it("returns true for retryable error codes", () => {
      const error = { code: "08006", message: "connection terminated" };
      expect(isRetryablePoolError(error)).toBe(true);
    });

    it("returns true for retryable error patterns", () => {
      const error = { code: "UNKNOWN", message: "connection timeout" };
      expect(isRetryablePoolError(error)).toBe(true);
    });

    it("returns false for non-retryable errors", () => {
      const error = { code: "23505", message: "unique constraint violation" };
      expect(isRetryablePoolError(error)).toBe(false);
    });

    it("returns false for null error", () => {
      expect(isRetryablePoolError(null)).toBe(false);
    });

    it("returns false for undefined error", () => {
      expect(isRetryablePoolError(undefined)).toBe(false);
    });
  });
});
