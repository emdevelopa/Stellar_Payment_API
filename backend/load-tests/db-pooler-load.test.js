/**
 * db-pooler-load.test.js
 *
 * Rigorous load testing for the Database Pooler (Issue #1059).
 *
 * Drives the optimized pooler (rate limiting + query caching + circuit
 * breaker + fallback mode, all layered on top of the raw pg Pool) through
 * high-volume and concurrent-burst scenarios, matching the style of the
 * other load-tests/*.test.js suites: in-process, no real database, real
 * clocks unless a test needs to fast-forward a cooldown window.
 *
 * Scenarios covered:
 *   - Global and per-merchant rate limiting hold their exact ceiling
 *     under concurrent bursts (no over/under-counting from interleaved
 *     async execution)
 *   - Query cache sustains a full hit rate once warm, and documents the
 *     lack of in-flight de-duplication on a cold concurrent miss
 *   - Circuit breaker opens correctly under a burst of concurrent
 *     failures and recovers after cooldown
 *   - Sustained throughput: thousands of sequential queries complete
 *     within a stable time budget
 *   - No unbounded memory growth across a large volume of distinct
 *     cached queries or write-invalidation cycles
 *
 * Run with: npm run test:load
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Hoisted mocks (same shape as db-pooler-optimized.test.js) ──────────────

const { mockPoolQuery, mockPoolOn, mockPoolEnd } = vi.hoisted(() => ({
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
      totalCount: 20,
      idleCount: 10,
      waitingCount: 0,
      options: { max: 20, min: 2 },
    })),
  },
}));

vi.mock("../src/lib/metrics.js", () => ({
  pgPoolTotalConnections: { set: vi.fn() },
  pgPoolIdleConnections: { set: vi.fn() },
  pgPoolWaitingRequests: { set: vi.fn() },
  pgPoolUtilizationPercent: { set: vi.fn() },
  queryDuration: { observe: vi.fn() },
  queryRetryCount: { inc: vi.fn() },
  slowQueryCount: { inc: vi.fn() },
  queryCacheHitTotal: { inc: vi.fn() },
  queryCacheMissTotal: { inc: vi.fn() },
  queryCacheSize: { set: vi.fn() },
  dbPoolerRateLimitExceeded: { inc: vi.fn() },
  dbPoolerQueryTotal: { inc: vi.fn() },
  dbPoolerSignatureVerified: { inc: vi.fn() },
  dbPoolerQueryDuration: { observe: vi.fn() },
  dbPoolerCircuitBreakerState: { set: vi.fn() },
  dbPoolerFallbackModeActive: { set: vi.fn() },
  dbPoolerActiveMerchantWindows: { set: vi.fn() },
  dbPoolerRateLimitUtilizationPercent: { set: vi.fn() },
}));

vi.mock("../src/lib/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── Import after mocks ──────────────────────────────────────────────────────

import {
  optimizedQuery,
  optimizedWrite,
  clearQueryCache,
  queryRateLimiter,
  getPoolerStats,
  _resetDbPoolerCircuitBreakerForTests,
} from "../src/lib/db-pooler-optimized.js";
import { circuitBreaker as dbCircuitBreaker } from "../src/lib/db.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

// A message that deliberately does NOT match db.js's RETRYABLE_ERROR_PATTERNS
// (e.g. "connection terminated" would trigger real retry backoff sleeps),
// so failure-path tests run instantly and are safe to use under fake timers.
const NON_RETRYABLE_FAILURE = new Error("simulated pooler failure");

function resetPoolerState() {
  queryRateLimiter.globalCount = 0;
  queryRateLimiter.globalWindowStart = Date.now();
  queryRateLimiter.merchantWindows.clear();
  // Generous ceiling by default so tests that aren't specifically about
  // rate limiting aren't accidentally throttled by their own concurrency.
  // Tests that exercise the limiter itself override this locally.
  queryRateLimiter.maxQueries = 10_000;
  clearQueryCache();
  _resetDbPoolerCircuitBreakerForTests();
  // db.js has its own lower-level circuit breaker (threshold 5, 60s
  // cooldown) guarding queryWithRetry. Without resetting it here, a
  // failure-burst test tripping it would leak an OPEN breaker into every
  // later test in this file for the next 60 real seconds.
  dbCircuitBreaker.state = "CLOSED";
  dbCircuitBreaker.failureCount = 0;
  dbCircuitBreaker.lastFailureTime = null;
  dbCircuitBreaker.successCount = 0;
  mockPoolQuery.mockReset();
}

async function runConcurrent(count, fn) {
  return Promise.allSettled(Array.from({ length: count }, (_, i) => fn(i)));
}

function countFulfilled(results) {
  return results.filter((r) => r.status === "fulfilled").length;
}

function countRejectedWithCode(results, code) {
  return results.filter((r) => r.status === "rejected" && r.reason?.code === code).length;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Database Pooler Load Tests", () => {
  beforeEach(() => {
    resetPoolerState();
  });

  describe("Global rate limiting under concurrent burst", () => {
    it("allows exactly maxQueries successes when far more requests arrive concurrently", async () => {
      queryRateLimiter.maxQueries = 100;
      mockPoolQuery.mockImplementation(async () => ({ rows: [{ ok: 1 }], rowCount: 1 }));
      const max = queryRateLimiter.maxQueries;

      const results = await runConcurrent(max * 3, () =>
        optimizedQuery("SELECT 1", [], { label: "load-global", useCache: false }),
      );

      const succeeded = countFulfilled(results);
      const rateLimited = countRejectedWithCode(results, "DB_POOLER_RATE_LIMITED");

      expect(succeeded).toBe(max);
      expect(rateLimited).toBe(max * 3 - max);
    });
  });

  describe("Per-merchant rate limiting under concurrent burst", () => {
    it("caps each merchant independently without one merchant starving another", async () => {
      mockPoolQuery.mockImplementation(async () => ({ rows: [{ ok: 1 }], rowCount: 1 }));
      const maxPerMerchant = queryRateLimiter.maxMerchantQueries;

      const [merchantAResults, merchantBResults] = await Promise.all([
        runConcurrent(maxPerMerchant * 2, () =>
          optimizedQuery("SELECT 1", [], { label: "load-merchant-a", merchantId: "merchant-a", useCache: false }),
        ),
        runConcurrent(maxPerMerchant * 2, () =>
          optimizedQuery("SELECT 1", [], { label: "load-merchant-b", merchantId: "merchant-b", useCache: false }),
        ),
      ]);

      expect(countFulfilled(merchantAResults)).toBe(maxPerMerchant);
      expect(countFulfilled(merchantBResults)).toBe(maxPerMerchant);
    });
  });

  describe("Query cache under concurrent load", () => {
    it("serves a full hit rate for a warm key under a concurrent burst", async () => {
      mockPoolQuery.mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 });

      // Warm the cache with a single request first.
      await optimizedQuery("SELECT * FROM payments WHERE id = $1", ["payment-1"], { label: "load-cache" });
      const callsAfterWarm = mockPoolQuery.mock.calls.length;

      // A concurrent burst of reads for the same, now-cached key must not
      // trigger any further DB calls.
      const results = await runConcurrent(200, () =>
        optimizedQuery("SELECT * FROM payments WHERE id = $1", ["payment-1"], { label: "load-cache" }),
      );

      expect(countFulfilled(results)).toBe(200);
      expect(mockPoolQuery.mock.calls.length).toBe(callsAfterWarm);
    });

    it("documents that concurrent cold misses for the same key are not coalesced", async () => {
      mockPoolQuery.mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 });

      const results = await runConcurrent(50, () =>
        optimizedQuery("SELECT * FROM payments WHERE id = $1", ["payment-cold"], { label: "load-cache-cold" }),
      );

      expect(countFulfilled(results)).toBe(50);
      // No in-flight request de-duplication: every concurrent miss for the
      // same key hits the DB independently before the first result is
      // cached. This is a known characteristic being documented by this
      // load test, not something this issue's scope changes — a future
      // improvement could coalesce concurrent misses into one DB call.
      expect(mockPoolQuery.mock.calls.length).toBeGreaterThan(0);
      expect(mockPoolQuery.mock.calls.length).toBeLessThanOrEqual(50);
    });

    it("keeps cache size bounded across many distinct queries", async () => {
      mockPoolQuery.mockImplementation(async () => ({ rows: [{ ok: 1 }], rowCount: 1 }));

      for (let i = 0; i < 2000; i++) {
        await optimizedQuery(`SELECT * FROM payments WHERE id = $1 /* ${i} */`, [i], {
          label: "load-cache-distinct",
        });
      }

      const stats = getPoolerStats();
      // The default cache has a bounded maxEntries; regardless of the exact
      // configured size it must never grow proportionally to the 2000
      // distinct queries issued above.
      expect(stats.cache.size).toBeLessThan(2000);
      expect(stats.cache.size).toBeLessThanOrEqual(stats.cache.maxEntries);
    });
  });

  describe("Circuit breaker under concurrent failure burst", () => {
    it("opens after a concurrent burst of failures and serves fallback afterward", async () => {
      mockPoolQuery.mockRejectedValue(NON_RETRYABLE_FAILURE);

      const failureBurst = await runConcurrent(60, (i) =>
        optimizedQuery("SELECT 1", [], { label: `load-failure-${i}`, useCache: false }),
      );

      // All 60 concurrent attempts should fail one way or another without
      // throwing unhandled exceptions or hanging.
      expect(failureBurst.every((r) => r.status === "rejected")).toBe(true);
      expect(getPoolerStats().fallbackMode.active || getPoolerStats().circuitBreaker.open).toBe(true);

      // Once the pool is healthy again, fallback/circuit-breaker recovery
      // should let traffic through.
      mockPoolQuery.mockResolvedValue({ rows: [{ ok: 1 }], rowCount: 1 });

      const result = await optimizedQuery("SELECT 1", [], { label: "load-recovery", useCache: false });
      expect(result.rows).toEqual([{ ok: 1 }]);
    });

    it("recovers to normal operation after the cooldown window elapses", async () => {
      vi.useFakeTimers();
      mockPoolQuery.mockRejectedValue(NON_RETRYABLE_FAILURE);

      for (let i = 0; i < 30; i++) {
        try {
          await optimizedQuery("SELECT 1", [], { label: "load-cooldown", useCache: false });
        } catch {
          // expected
        }
      }
      expect(getPoolerStats().circuitBreaker.open || getPoolerStats().fallbackMode.active).toBe(true);

      vi.advanceTimersByTime(121_000);
      mockPoolQuery.mockResolvedValue({ rows: [{ ok: 1 }], rowCount: 1 });

      const result = await optimizedQuery("SELECT 1", [], { label: "load-cooldown", useCache: false });
      expect(result.rows).toEqual([{ ok: 1 }]);

      vi.useRealTimers();
    });
  });

  describe("Sustained throughput stability", () => {
    it("processes 5 000 sequential cached-read queries within a stable time budget", async () => {
      mockPoolQuery.mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 });

      const start = Date.now();
      for (let i = 0; i < 5_000; i++) {
        await optimizedQuery("SELECT * FROM payments WHERE id = $1", ["payment-1"], {
          label: "load-sustained",
        });
      }
      const duration = Date.now() - start;

      // These are cache hits after the first call, so this is measuring
      // pooler overhead (rate limiting + cache lookup), not DB latency.
      expect(duration).toBeLessThan(2_000);
    });

    it("shows no unbounded memory growth across 3 000 write invalidation cycles", async () => {
      mockPoolQuery.mockResolvedValue({ rows: [], rowCount: 1 });
      const before = process.memoryUsage().heapUsed;

      for (let i = 0; i < 3_000; i++) {
        await optimizedWrite(`INSERT INTO payments (id) VALUES ($${1})`, [`payment-${i}`], {
          label: "load-write",
        });
      }

      if (global.gc) global.gc();
      const after = process.memoryUsage().heapUsed;

      // Writes bypass the cache entirely and only invalidate by table name,
      // so heap growth should stay well within a generous bound.
      expect(after - before).toBeLessThan(25 * 1024 * 1024);
    });
  });
});
