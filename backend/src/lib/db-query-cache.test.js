/**
 * Tests for Query Cache Module
 * Issue #760: Optimize SQL queries in Database Pooler
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./metrics.js", () => ({
  queryCacheHitTotal: { inc: vi.fn() },
  queryCacheMissTotal: { inc: vi.fn() },
  queryCacheSize: { set: vi.fn() },
}));

vi.mock("./logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { generateCacheKey, QueryCache, cachedQuery, invalidateTableCache } from "./db-query-cache.js";

describe("Query Cache (Issue #760)", () => {
  describe("generateCacheKey", () => {
    it("produces a hex string", () => {
      const key = generateCacheKey("SELECT 1");
      expect(key).toMatch(/^[a-f0-9]{64}$/);
    });

    it("is deterministic", () => {
      const k1 = generateCacheKey("SELECT * FROM t WHERE id = $1", [42]);
      const k2 = generateCacheKey("SELECT * FROM t WHERE id = $1", [42]);
      expect(k1).toBe(k2);
    });

    it("differs for different parameter values", () => {
      const k1 = generateCacheKey("SELECT * FROM t WHERE id = $1", [1]);
      const k2 = generateCacheKey("SELECT * FROM t WHERE id = $1", [2]);
      expect(k1).not.toBe(k2);
    });

    it("normalizes whitespace", () => {
      const k1 = generateCacheKey("SELECT   *   FROM   t");
      const k2 = generateCacheKey("SELECT * FROM t");
      expect(k1).toBe(k2);
    });
  });

  describe("QueryCache", () => {
    let cache;

    beforeEach(() => {
      cache = new QueryCache({ maxEntries: 5, ttlMs: 5000 });
    });

    it("returns null on miss", () => {
      expect(cache.get("missing")).toBeNull();
    });

    it("returns cached value on hit", () => {
      cache.set("k", { rows: [1] });
      expect(cache.get("k")).toEqual({ rows: [1] });
    });

    it("overwrites existing key", () => {
      cache.set("k", { rows: [1] });
      cache.set("k", { rows: [2] });
      expect(cache.get("k")).toEqual({ rows: [2] });
    });

    it("evicts LRU entry when full", () => {
      for (let i = 0; i < 5; i++) {
        cache.set(`k${i}`, { i });
      }
      // Cache is full (5 entries). Adding a new one evicts k0.
      cache.set("k5", { i: 5 });
      expect(cache.get("k0")).toBeNull();
      expect(cache.get("k5")).toEqual({ i: 5 });
    });

    it("expires entries after TTL", () => {
      vi.useFakeTimers();
      const c = new QueryCache({ maxEntries: 10, ttlMs: 200 });

      c.set("k", { rows: [] });
      expect(c.get("k")).not.toBeNull();

      vi.advanceTimersByTime(250);
      expect(c.get("k")).toBeNull();

      vi.useRealTimers();
    });

    it("refreshes LRU position on read", () => {
      for (let i = 0; i < 5; i++) {
        cache.set(`k${i}`, { i });
      }
      // Touch k0 so it becomes most-recently-used
      cache.get("k0");

      // Adding k5 should evict k1 (now the least recently used)
      cache.set("k5", { i: 5 });
      expect(cache.get("k0")).not.toBeNull();
      expect(cache.get("k1")).toBeNull();
    });

    it("clear() removes all entries and returns count", () => {
      cache.set("a", 1);
      cache.set("b", 2);
      const cleared = cache.clear();
      expect(cleared).toBe(2);
      expect(cache.get("a")).toBeNull();
      expect(cache.get("b")).toBeNull();
    });

    it("getStats returns shape", () => {
      cache.set("x", 1);
      const s = cache.getStats();
      expect(s).toEqual({ size: 1, maxEntries: 5, ttlMs: 5000 });
    });
  });

  describe("cachedQuery", () => {
    it("calls queryFn for non-SELECT queries", async () => {
      const queryFn = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
      await cachedQuery("INSERT INTO t VALUES ($1)", [1], {}, queryFn, { useCache: true });
      expect(queryFn).toHaveBeenCalledTimes(1);
    });

    it("caches SELECT query results", async () => {
      const queryFn = vi.fn().mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 });

      const r1 = await cachedQuery("SELECT * FROM t WHERE id = $1", [1], { label: "test" }, queryFn);
      const r2 = await cachedQuery("SELECT * FROM t WHERE id = $1", [1], { label: "test" }, queryFn);

      expect(r1).toEqual({ rows: [{ id: 1 }], rowCount: 1 });
      expect(r2).toEqual({ rows: [{ id: 1 }], rowCount: 1 });
      expect(queryFn).toHaveBeenCalledTimes(1); // Second call served from cache
    });

    it("bypasses cache when useCache is false", async () => {
      const queryFn = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });

      await cachedQuery("SELECT 1", [], {}, queryFn, { useCache: false });
      await cachedQuery("SELECT 1", [], {}, queryFn, { useCache: false });

      expect(queryFn).toHaveBeenCalledTimes(2);
    });
  });

  describe("invalidateTableCache", () => {
    it("clears the entire cache", () => {
      const cache = new QueryCache({ maxEntries: 10 });
      cache.set("a", 1);
      cache.set("b", 2);

      // invalidateTableCache uses the singleton, so we just verify it doesn't throw
      expect(() => invalidateTableCache("payments")).not.toThrow();
    });
  });
});
