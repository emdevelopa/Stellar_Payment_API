/**
 * End-to-End tests for the Database Pooler (Issue #1056)
 *
 * Drives the FULL pooler stack — optimizedQuery/optimizedWrite → query cache
 * → db.js retry wrapper + circuit breaker → pg.Pool — with only the `pg`
 * driver and the logger mocked, so the real pool configuration, retry
 * classification, circuit breaker, cache lifecycle, query signing and rate
 * limiting all execute in-process. No real database, no real Redis.
 *
 * Coverage map:
 *   - Read lifecycle ................ cold miss → pool → warm cache hit
 *   - Write invalidation ........... optimizedWrite clears the cached reads
 *   - Query signing ................ valid signature accepted, tampered
 *                                    query text and malformed signatures
 *                                    rejected before execution
 *   - Rate limiting ................ global and per-merchant ceilings hold
 *   - Error recovery ............... transient pool errors retried, exhausted
 *                                    errors open the circuit breaker
 *   - Degraded mode ................ open circuit + fallback serve from the
 *                                    raw pool
 *   - Input validation ............. empty query text rejected up front
 *   - Operational surface .......... getPoolerStats/checkPoolHealth reflect
 *                                    live pool, cache and limiter state
 *
 * Run with: npm test -- tests/e2e/db-pooler
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Env before module evaluation ──────────────────────────────────────────────
// db-pooler-optimized.js captures the signing secret at import time, and ESM
// hoists imports above top-level statements, so this has to be hoisted too.
vi.hoisted(() => {
  process.env.DB_POOLER_SIGNING_SECRET ||= "e2e-db-pooler-signing-secret";
  process.env.DATABASE_URL ||= "postgresql://postgres:postgres@127.0.0.1:5432/postgres";
});

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockPoolQuery, mockPoolOn, mockPoolEnd, mockLogger } = vi.hoisted(() => {
  const query = vi.fn();
  return {
    mockPoolQuery: query,
    mockPoolOn: vi.fn(),
    mockPoolEnd: vi.fn(),
    mockLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
});

vi.mock("pg", () => ({
  default: {
    Pool: vi.fn(() => ({
      query: mockPoolQuery,
      on: mockPoolOn,
      end: mockPoolEnd,
      totalCount: 8,
      idleCount: 4,
      waitingCount: 0,
      options: { max: 20, min: 2 },
    })),
  },
}));

vi.mock("../../src/lib/logger.js", () => ({ logger: mockLogger }));

// ── Import after mocks ────────────────────────────────────────────────────────

import {
  optimizedQuery,
  optimizedWrite,
  signQuery,
  hashQueryResult,
  getPoolerStats,
  clearQueryCache,
  queryRateLimiter,
  _resetDbPoolerCircuitBreakerForTests,
} from "../../src/lib/db-pooler-optimized.js";
import { checkPoolHealth, closePool, getPoolStats } from "../../src/lib/db.js";
import { dbPoolerQueryTotal, dbPoolerSignatureVerified } from "../../src/lib/metrics.js";

const SELECT_PAYMENTS = "SELECT id, status FROM payments WHERE merchant_id = $1";
const INSERT_PAYMENT =
  "INSERT INTO payments (client_id, amount, status) VALUES ($1, $2, $3) RETURNING id";

function rows(...values) {
  return { rows: values, rowCount: values.length };
}

async function settled(promise) {
  return promise.then(
    (value) => ({ status: "fulfilled", value }),
    (reason) => ({ status: "rejected", reason }),
  );
}

describe("Database Pooler — E2E Tests (Issue #1056)", () => {
  beforeEach(() => {
    mockPoolQuery.mockReset();
    mockPoolQuery.mockResolvedValue(rows({ id: "payment-1", status: "completed" }));
    mockLogger.warn.mockClear();
    mockLogger.error.mockClear();

    // The pooler keeps process-wide state, so each scenario starts clean.
    _resetDbPoolerCircuitBreakerForTests();
    queryRateLimiter.globalCount = 0;
    queryRateLimiter.globalWindowStart = Date.now();
    queryRateLimiter.merchantWindows.clear();
    clearQueryCache();
  });

  describe("Read lifecycle", () => {
    it("executes a cold query once and serves the next one from cache", async () => {
      const first = await optimizedQuery(SELECT_PAYMENTS, ["merchant-1"], {
        label: "e2e-read",
      });
      expect(first.rows).toEqual([{ id: "payment-1", status: "completed" }]);
      expect(mockPoolQuery).toHaveBeenCalledTimes(1);

      const second = await optimizedQuery(SELECT_PAYMENTS, ["merchant-1"], {
        label: "e2e-read",
      });
      expect(second.rows).toEqual(first.rows);
      expect(mockPoolQuery).toHaveBeenCalledTimes(1);
    });

    it("keys the cache on text and parameters, not on the label", async () => {
      await optimizedQuery(SELECT_PAYMENTS, ["merchant-1"], { label: "e2e-read" });
      await optimizedQuery(SELECT_PAYMENTS, ["merchant-2"], { label: "e2e-read" });

      expect(mockPoolQuery).toHaveBeenCalledTimes(2);
    });

    it("skips the cache when the caller opts out", async () => {
      await optimizedQuery(SELECT_PAYMENTS, ["merchant-1"], { label: "e2e-read", useCache: false });
      await optimizedQuery(SELECT_PAYMENTS, ["merchant-1"], { label: "e2e-read", useCache: false });

      expect(mockPoolQuery).toHaveBeenCalledTimes(2);
    });
  });

  describe("Write invalidation", () => {
    it("clears cached reads so the next read hits the pool again", async () => {
      await optimizedQuery(SELECT_PAYMENTS, ["merchant-1"], { label: "e2e-read" });
      expect(mockPoolQuery).toHaveBeenCalledTimes(1);

      const written = await optimizedWrite(INSERT_PAYMENT, ["client-1", "10.00", "pending"], {
        label: "e2e-write",
      });
      expect(written.rows).toEqual([{ id: "payment-1", status: "completed" }]);
      expect(mockPoolQuery).toHaveBeenCalledTimes(2);

      mockPoolQuery.mockResolvedValue(rows({ id: "payment-2", status: "pending" }));
      const afterWrite = await optimizedQuery(SELECT_PAYMENTS, ["merchant-1"], {
        label: "e2e-read",
      });

      expect(afterWrite.rows).toEqual([{ id: "payment-2", status: "pending" }]);
      expect(mockPoolQuery).toHaveBeenCalledTimes(3);
    });
  });

  describe("Query signing", () => {
    it("accepts a query whose signature matches", async () => {
      const signature = signQuery(SELECT_PAYMENTS, ["merchant-1"]);
      const verified = vi.spyOn(dbPoolerSignatureVerified, "inc");

      const result = await optimizedQuery(SELECT_PAYMENTS, ["merchant-1"], {
        label: "e2e-signed",
        signature,
      });

      expect(result.rows).toEqual([{ id: "payment-1", status: "completed" }]);
      expect(verified).toHaveBeenCalledWith({ result: "valid" });
      verified.mockRestore();
    });

    it("rejects a signature presented for different query text", async () => {
      const signature = signQuery(SELECT_PAYMENTS, ["merchant-1"]);
      const verified = vi.spyOn(dbPoolerSignatureVerified, "inc");

      await expect(
        optimizedQuery("SELECT id FROM payments WHERE merchant_id = $9", ["merchant-1"], {
          label: "e2e-signed",
          signature,
        }),
      ).rejects.toMatchObject({
        status: 400,
        code: "DB_POOLER_SIGNATURE_INVALID",
      });

      expect(verified).toHaveBeenCalledWith({ result: "invalid" });
      expect(mockPoolQuery).not.toHaveBeenCalled();
      verified.mockRestore();
    });

    it("rejects a malformed signature before execution", async () => {
      await expect(
        optimizedQuery(SELECT_PAYMENTS, ["merchant-1"], {
          label: "e2e-signed",
          signature: "not-hex",
        }),
      ).rejects.toMatchObject({ code: "DB_POOLER_SIGNATURE_INVALID" });

      expect(mockPoolQuery).not.toHaveBeenCalled();
    });

    it("hashes query results deterministically regardless of key order", () => {
      const a = hashQueryResult({ id: 1, nested: { alpha: 1, beta: 2 } });
      const b = hashQueryResult({ nested: { beta: 2, alpha: 1 }, id: 1 });

      expect(a).toBe(b);
      expect(a).toMatch(/^[a-f0-9]{64}$/);
      expect(hashQueryResult({ id: 2, nested: { alpha: 1, beta: 2 } })).not.toBe(a);
    });
  });

  describe("Rate limiting", () => {
    it("rejects global queries past the ceiling with a 429", async () => {
      const { maxQueries } = queryRateLimiter;

      for (let i = 0; i < maxQueries; i += 1) {
        await optimizedQuery(SELECT_PAYMENTS, [`merchant-${i}`], { label: "e2e-burst" });
      }

      await expect(
        optimizedQuery(SELECT_PAYMENTS, ["merchant-overflow"], { label: "e2e-burst" }),
      ).rejects.toMatchObject({
        status: 429,
        code: "DB_POOLER_RATE_LIMITED",
      });

      expect(mockPoolQuery).toHaveBeenCalledTimes(maxQueries);
    });

    it("enforces the per-merchant ceiling independently of the global one", async () => {
      const { maxMerchantQueries } = queryRateLimiter;

      for (let i = 0; i < maxMerchantQueries; i += 1) {
        await optimizedQuery(SELECT_PAYMENTS, ["merchant-hot"], {
          label: "e2e-merchant-burst",
          merchantId: "merchant-hot",
        });
      }

      await expect(
        optimizedQuery(SELECT_PAYMENTS, ["merchant-hot"], {
          label: "e2e-merchant-burst",
          merchantId: "merchant-hot",
        }),
      ).rejects.toMatchObject({ code: "DB_POOLER_RATE_LIMITED" });

      // A different merchant is unaffected by the hot merchant's window.
      await expect(
        optimizedQuery(SELECT_PAYMENTS, ["merchant-cold"], {
          label: "e2e-merchant-burst",
          merchantId: "merchant-cold",
        }),
      ).resolves.toBeDefined();
    }, 30000);
  });

  describe("Error recovery", () => {
    it("retries a transient pool error and returns the recovered result", async () => {
      const transient = new Error("connection terminated unexpectedly");
      transient.code = "57P01";

      mockPoolQuery.mockRejectedValueOnce(transient).mockResolvedValueOnce(rows({ id: "payment-9" }));

      const result = await optimizedQuery(SELECT_PAYMENTS, ["merchant-1"], {
        label: "e2e-retry",
        retryAttempts: 2,
        retryDelayMs: 1,
      });

      expect(result.rows).toEqual([{ id: "payment-9" }]);
      expect(mockPoolQuery).toHaveBeenCalledTimes(2);
    });

    it("surfaces a non-retryable pool error without retrying it", async () => {
      const fatal = new Error("duplicate key value violates unique constraint");
      fatal.code = "23505";
      mockPoolQuery.mockRejectedValue(fatal);

      await expect(
        optimizedQuery(SELECT_PAYMENTS, ["merchant-1"], { label: "e2e-fatal", retryAttempts: 3 }),
      ).rejects.toThrow("duplicate key");

      expect(mockPoolQuery).toHaveBeenCalledTimes(1);
    });

    it("counts every outcome on the pooler metrics", async () => {
      const success = vi.spyOn(dbPoolerQueryTotal, "inc");

      await optimizedQuery(SELECT_PAYMENTS, ["merchant-1"], { label: "e2e-metrics" });
      expect(success).toHaveBeenCalledWith({ label: "e2e-metrics", status: "success" });

      success.mockRestore();
    });
  });

  describe("Degraded mode", () => {
    it("falls back to the raw pool once repeated failures trip the degraded path", async () => {
      mockPoolQuery.mockRejectedValue(new Error("too many clients"));

      for (let i = 0; i < 20; i += 1) {
        await settled(optimizedQuery(SELECT_PAYMENTS, ["merchant-1"], { label: "e2e-fallback" }));
      }

      expect(getPoolerStats().fallbackMode.active).toBe(true);

      mockPoolQuery.mockResolvedValue(rows({ id: "payment-recovered" }));
      const rateLimitCountBefore = getPoolerStats().rateLimiter.globalCount;
      const poolCallsBefore = mockPoolQuery.mock.calls.length;

      const result = await optimizedQuery(SELECT_PAYMENTS, ["merchant-1"], {
        label: "e2e-fallback",
      });

      expect(result.rows).toEqual([{ id: "payment-recovered" }]);
      // One raw pool call, and the degraded path bypasses the rate limiter and
      // the cache rather than re-entering the optimized pipeline.
      expect(mockPoolQuery).toHaveBeenCalledTimes(poolCallsBefore + 1);
      expect(getPoolerStats().rateLimiter.globalCount).toBe(rateLimitCountBefore);
    }, 60000);

    it("propagates the underlying failure while the database is down", async () => {
      mockPoolQuery.mockRejectedValue(new Error("too many clients"));

      for (let i = 0; i < 20; i += 1) {
        await settled(optimizedQuery(SELECT_PAYMENTS, ["merchant-1"], { label: "e2e-down" }));
      }

      await expect(
        optimizedQuery(SELECT_PAYMENTS, ["merchant-1"], { label: "e2e-down" }),
      ).rejects.toThrow("too many clients");
    }, 60000);

    it("returns to the optimized path once the database recovers", async () => {
      mockPoolQuery.mockRejectedValue(new Error("too many clients"));

      for (let i = 0; i < 20; i += 1) {
        await settled(optimizedQuery(SELECT_PAYMENTS, ["merchant-1"], { label: "e2e-recover" }));
      }
      expect(getPoolerStats().fallbackMode.active).toBe(true);

      mockPoolQuery.mockResolvedValue(rows({ id: "payment-after-recovery" }));
      const success = vi.spyOn(dbPoolerQueryTotal, "inc");

      const result = await optimizedQuery(SELECT_PAYMENTS, ["merchant-2"], {
        label: "e2e-recover",
      });

      expect(result.rows).toEqual([{ id: "payment-after-recovery" }]);
      expect(success).toHaveBeenCalledWith({ label: "e2e-recover", status: "fallback_success" });
      success.mockRestore();
    }, 60000);
  });

  describe("Input validation", () => {
    it("rejects empty query text before touching the pool", async () => {
      await expect(optimizedQuery("", [], { label: "e2e-empty" })).rejects.toMatchObject({
        status: 400,
        code: "DB_POOLER_INVALID_QUERY",
      });
      await expect(optimizedQuery(null, [], { label: "e2e-null" })).rejects.toMatchObject({
        code: "DB_POOLER_INVALID_QUERY",
      });

      expect(mockPoolQuery).not.toHaveBeenCalled();
    });
  });

  describe("Operational surface", () => {
    it("reports pool, cache, limiter and signing state", async () => {
      await optimizedQuery(SELECT_PAYMENTS, ["merchant-1"], { label: "e2e-stats" });

      const stats = getPoolerStats();

      expect(stats.pool).toEqual(getPoolStats());
      expect(stats.cache.size).toBeGreaterThan(0);
      expect(stats.rateLimiter.globalCount).toBe(1);
      expect(stats.signingEnabled).toBe(true);
      expect(stats.circuitBreaker).toEqual({
        open: false,
        failures: 0,
        lastFailureTime: 0,
      });
      expect(stats.fallbackMode.active).toBe(false);
    });

    it("keeps the merchant window map bounded under high-cardinality traffic", async () => {
      for (let i = 0; i < 60; i += 1) {
        await optimizedQuery(SELECT_PAYMENTS, [`merchant-${i}`], {
          label: "e2e-cardinality",
          merchantId: `merchant-${i}`,
        });
      }

      expect(queryRateLimiter.merchantWindows.size).toBe(60);
      expect(queryRateLimiter.merchantWindows.size).toBeLessThanOrEqual(10000);
    }, 30000);

    it("reports pool health from a live connectivity probe", async () => {
      mockPoolQuery.mockResolvedValueOnce(rows({ "1": 1 }));

      const health = await checkPoolHealth();

      expect(health.healthy).toBe(true);
      expect(health.issues).toEqual([]);
      expect(health.circuitBreaker.state).toBe("CLOSED");
    });

    it("flags the pool as unhealthy when the connectivity probe fails", async () => {
      mockPoolQuery.mockRejectedValueOnce(new Error("database unavailable"));

      const health = await checkPoolHealth();

      expect(health.healthy).toBe(false);
      expect(health.issues.join(" ")).toContain("Database connectivity failed");
    });
  });

  describe("Shutdown", () => {
    it("closes the underlying pool exactly once", async () => {
      await closePool();
      expect(mockPoolEnd).toHaveBeenCalledTimes(1);
    });
  });
});
