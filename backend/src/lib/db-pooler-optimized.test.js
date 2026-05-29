/**
 * Tests for Optimized Database Pooler Module
 * Issues #758, #759, #760
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

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
      totalCount: 5,
      idleCount: 2,
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
  queryDuration: { observe: vi.fn() },
  queryRetryCount: { inc: vi.fn() },
  slowQueryCount: { inc: vi.fn() },
  queryCacheHitTotal: { inc: vi.fn() },
  queryCacheMissTotal: { inc: vi.fn() },
  queryCacheSize: { set: vi.fn() },
  dbPoolerRateLimitExceeded: { inc: vi.fn() },
  dbPoolerQueryTotal: { inc: vi.fn() },
  dbPoolerSignatureVerified: { inc: vi.fn() },
}));

vi.mock("./logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import {
  signQuery,
  verifyQuerySignature,
  hashQueryResult,
  optimizedQuery,
  optimizedWrite,
  getPoolerStats,
  clearQueryCache,
  queryRateLimiter,
} from "./db-pooler-optimized.js";
import { generateCacheKey, QueryCache } from "./db-query-cache.js";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Database Pooler - Query Cache (Issue #760)", () => {
  describe("generateCacheKey", () => {
    it("generates deterministic keys for same input", () => {
      const key1 = generateCacheKey("SELECT * FROM payments", ["active"]);
      const key2 = generateCacheKey("SELECT * FROM payments", ["active"]);
      expect(key1).toBe(key2);
    });

    it("generates different keys for different queries", () => {
      const key1 = generateCacheKey("SELECT * FROM payments");
      const key2 = generateCacheKey("SELECT * FROM merchants");
      expect(key1).not.toBe(key2);
    });

    it("generates different keys for different parameters", () => {
      const key1 = generateCacheKey("SELECT * FROM payments WHERE id = $1", ["id-1"]);
      const key2 = generateCacheKey("SELECT * FROM payments WHERE id = $1", ["id-2"]);
      expect(key1).not.toBe(key2);
    });

    it("normalizes whitespace in queries", () => {
      const key1 = generateCacheKey("SELECT  *  FROM  payments");
      const key2 = generateCacheKey("SELECT * FROM payments");
      expect(key1).toBe(key2);
    });
  });

  describe("QueryCache", () => {
    let cache;

    beforeEach(() => {
      cache = new QueryCache({ maxEntries: 3, ttlMs: 1000 });
    });

    it("stores and retrieves values", () => {
      const key = "test-key";
      const value = { rows: [{ id: 1 }] };

      cache.set(key, value);
      expect(cache.get(key)).toEqual(value);
    });

    it("returns null for cache misses", () => {
      expect(cache.get("nonexistent")).toBeNull();
    });

    it("evicts oldest entries when at capacity", () => {
      cache.set("key1", { rows: [] });
      cache.set("key2", { rows: [] });
      cache.set("key3", { rows: [] });

      // At capacity, adding key4 should evict key1
      cache.set("key4", { rows: [] });

      expect(cache.get("key1")).toBeNull();
      expect(cache.get("key4")).toEqual({ rows: [] });
    });

    it("expires entries after TTL", () => {
      vi.useFakeTimers();
      const shortTtlCache = new QueryCache({ maxEntries: 10, ttlMs: 100 });

      shortTtlCache.set("key", { rows: [] });
      expect(shortTtlCache.get("key")).not.toBeNull();

      vi.advanceTimersByTime(150);
      expect(shortTtlCache.get("key")).toBeNull();

      vi.useRealTimers();
    });

    it("moves accessed entries to most-recently-used position", () => {
      cache.set("key1", { rows: [] });
      cache.set("key2", { rows: [] });
      cache.set("key3", { rows: [] });

      // Access key1 to make it most recently used
      cache.get("key1");

      // Adding key4 should now evict key2 (oldest unused)
      cache.set("key4", { rows: [] });

      expect(cache.get("key1")).not.toBeNull();
      expect(cache.get("key2")).toBeNull();
    });

    it("clears all entries", () => {
      cache.set("key1", { rows: [] });
      cache.set("key2", { rows: [] });

      const cleared = cache.clear();
      expect(cleared).toBe(2);
      expect(cache.get("key1")).toBeNull();
      expect(cache.get("key2")).toBeNull();
    });

    it("returns correct stats", () => {
      cache.set("key1", { rows: [] });
      const stats = cache.getStats();

      expect(stats.size).toBe(1);
      expect(stats.maxEntries).toBe(3);
      expect(stats.ttlMs).toBe(1000);
    });
  });
});

describe("Database Pooler - Signature Verification (Issue #759)", () => {
  describe("signQuery", () => {
    it("returns null when signing secret is not configured", () => {
      // DB_POOLER_SIGNING_SECRET is not set in test env
      const sig = signQuery("SELECT 1");
      expect(sig).toBeNull();
    });
  });

  describe("verifyQuerySignature", () => {
    it("returns true when signing is disabled (no secret)", () => {
      expect(verifyQuerySignature("SELECT 1", [], null)).toBe(true);
    });

    it("returns true when signing is disabled (any signature)", () => {
      expect(verifyQuerySignature("SELECT 1", [], "fake-sig")).toBe(true);
    });
  });

  describe("hashQueryResult", () => {
    it("generates consistent hashes for same result", () => {
      const result = { rows: [{ id: 1, name: "test" }] };
      const hash1 = hashQueryResult(result);
      const hash2 = hashQueryResult(result);
      expect(hash1).toBe(hash2);
    });

    it("generates different hashes for different results", () => {
      const hash1 = hashQueryResult({ rows: [{ id: 1 }] });
      const hash2 = hashQueryResult({ rows: [{ id: 2 }] });
      expect(hash1).not.toBe(hash2);
    });

    it("generates a SHA-256 hex string", () => {
      const hash = hashQueryResult({ rows: [] });
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });
});

describe("Database Pooler - Rate Limiting (Issue #758)", () => {
  beforeEach(() => {
    // Reset the rate limiter state
    queryRateLimiter.globalCount = 0;
    queryRateLimiter.globalWindowStart = Date.now();
    queryRateLimiter.merchantWindows.clear();
  });

  it("allows queries under the limit", () => {
    const result = queryRateLimiter.checkLimit();
    expect(result.allowed).toBe(true);
  });

  it("rejects queries when global limit is exceeded", () => {
    queryRateLimiter.globalCount = queryRateLimiter.maxQueries;
    const result = queryRateLimiter.checkLimit();
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Global query rate limit exceeded");
  });

  it("rejects queries when merchant limit is exceeded", () => {
    const merchantId = "merchant-1";
    queryRateLimiter.merchantWindows.set(merchantId, {
      windowStart: Date.now(),
      count: queryRateLimiter.maxMerchantQueries,
    });

    const result = queryRateLimiter.checkLimit(merchantId);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Merchant query rate limit exceeded");
  });

  it("resets window after expiry", () => {
    vi.useFakeTimers();

    queryRateLimiter.globalCount = queryRateLimiter.maxQueries;
    expect(queryRateLimiter.checkLimit().allowed).toBe(false);

    // Advance past window
    vi.advanceTimersByTime(queryRateLimiter.windowMs + 1);
    expect(queryRateLimiter.checkLimit().allowed).toBe(true);

    vi.useRealTimers();
  });

  it("records queries correctly", () => {
    queryRateLimiter.recordQuery();
    expect(queryRateLimiter.globalCount).toBe(1);

    queryRateLimiter.recordQuery("merchant-1");
    expect(queryRateLimiter.globalCount).toBe(2);
    expect(queryRateLimiter.merchantWindows.get("merchant-1").count).toBe(1);
  });

  it("returns correct stats", () => {
    queryRateLimiter.recordQuery();
    const stats = queryRateLimiter.getStats();

    expect(stats.globalCount).toBe(1);
    expect(stats.maxQueries).toBeGreaterThan(0);
    expect(stats.windowMs).toBeGreaterThan(0);
  });
});

describe("Database Pooler - Optimized Query (Integration)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryRateLimiter.globalCount = 0;
    queryRateLimiter.globalWindowStart = Date.now();
    queryRateLimiter.merchantWindows.clear();
    clearQueryCache();
  });

  it("executes SELECT queries successfully", async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 });

    const result = await optimizedQuery(
      "SELECT * FROM payments WHERE id = $1",
      ["payment-1"],
      { label: "test-select" },
    );

    expect(result.rows).toEqual([{ id: 1 }]);
    expect(mockPoolQuery).toHaveBeenCalledTimes(1);
  });

  it("caches SELECT query results", async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 });

    // First call - cache miss
    await optimizedQuery(
      "SELECT * FROM payments WHERE id = $1",
      ["payment-1"],
      { label: "test-cache" },
    );

    // Second call - should be cached
    const result = await optimizedQuery(
      "SELECT * FROM payments WHERE id = $1",
      ["payment-1"],
      { label: "test-cache" },
    );

    expect(result.rows).toEqual([{ id: 1 }]);
    // Only one actual DB call due to caching
    expect(mockPoolQuery).toHaveBeenCalledTimes(1);
  });

  it("does not cache INSERT/UPDATE/DELETE queries", async () => {
    mockPoolQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    await optimizedWrite(
      "INSERT INTO payments (id) VALUES ($1)",
      ["payment-1"],
      { label: "test-insert" },
    );

    await optimizedWrite(
      "INSERT INTO payments (id) VALUES ($1)",
      ["payment-1"],
      { label: "test-insert" },
    );

    // Both calls should hit the database
    expect(mockPoolQuery).toHaveBeenCalledTimes(2);
  });

  it("throws rate limit error when limit exceeded", async () => {
    queryRateLimiter.globalCount = queryRateLimiter.maxQueries;

    await expect(
      optimizedQuery("SELECT 1", [], { label: "test-rate-limit" }),
    ).rejects.toThrow("Global query rate limit exceeded");
  });
});

describe("Database Pooler - getPoolerStats", () => {
  it("returns comprehensive pooler statistics", () => {
    const stats = getPoolerStats();

    expect(stats).toHaveProperty("pool");
    expect(stats).toHaveProperty("cache");
    expect(stats).toHaveProperty("rateLimiter");
    expect(stats).toHaveProperty("signingEnabled");
    expect(typeof stats.signingEnabled).toBe("boolean");
  });
});
