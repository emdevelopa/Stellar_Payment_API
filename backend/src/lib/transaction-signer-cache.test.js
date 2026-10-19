/**
 * Tests for Transaction Signer Verification Cache (Issue #1075)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("./logger.js", () => ({ logger: mockLogger }));

vi.mock("./metrics.js", () => ({
  txSignatureCacheHits: { inc: vi.fn() },
  txSignatureCacheMisses: { inc: vi.fn() },
  txSignatureCacheSize: { set: vi.fn() },
  txSignatureVerificationTotal: { inc: vi.fn() },
  txSignatureVerificationLatency: { startTimer: vi.fn(() => vi.fn()) },
  txSignatureVerificationErrors: { inc: vi.fn() },
  txSignatureReplayAttempts: { inc: vi.fn() },
  txSignatureValidationFailures: { inc: vi.fn() },
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import {
  TransactionSignerCache,
  getTransactionSignerCache,
  resetTransactionSignerCacheForTest,
} from "./transaction-signer-cache.js";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("TransactionSignerCache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetTransactionSignerCacheForTest();
  });

  // ── Basic operations ────────────────────────────────────────────────────────

  describe("basic get/set operations", () => {
    it("returns null on cache miss", async () => {
      const cache = new TransactionSignerCache();
      const result = await cache.get("a".repeat(64));
      expect(result).toEqual({ result: null, hit: false });
    });

    it("returns cached result on cache hit", async () => {
      const cache = new TransactionSignerCache();
      const txHash = "a".repeat(64);
      const verificationResult = {
        valid: true,
        reason: "ok",
        isMultiSig: false,
        signatureCount: 1,
        thresholdMet: true,
      };

      await cache.set(txHash, verificationResult, true);
      const result = await cache.get(txHash);

      expect(result.hit).toBe(true);
      expect(result.result).toEqual(verificationResult);
    });

    it("caches invalid (negative) results with shorter TTL", async () => {
      const cache = new TransactionSignerCache({
        validTtlMs: 100_000,
        invalidTtlMs: 50, // 50ms
      });
      const txHash = "b".repeat(64);
      const invalidResult = { valid: false, reason: "bad signature" };

      await cache.set(txHash, invalidResult, false);
      const hit1 = await cache.get(txHash);
      expect(hit1.hit).toBe(true);

      // Wait for invalid TTL to expire
      await new Promise((r) => setTimeout(r, 60));

      const hit2 = await cache.get(txHash);
      expect(hit2.hit).toBe(false);
    });

    it("valid entries respect their longer TTL", async () => {
      const cache = new TransactionSignerCache({
        validTtlMs: 100_000,
        invalidTtlMs: 100_000,
      });
      const txHash = "c".repeat(64);
      const validResult = { valid: true };

      await cache.set(txHash, validResult, true);
      // Immediately after set, should be a hit
      const hit = await cache.get(txHash);
      expect(hit.hit).toBe(true);
    });
  });

  // ── LRU eviction ────────────────────────────────────────────────────────────

  describe("LRU eviction", () => {
    it("evicts oldest entry when maxEntries is reached", async () => {
      const cache = new TransactionSignerCache({ maxEntries: 3 });

      await cache.set("a".repeat(64), { valid: true }, true);
      await cache.set("b".repeat(64), { valid: true }, true);
      await cache.set("c".repeat(64), { valid: true }, true);
      // Adding 4th should evict first
      await cache.set("d".repeat(64), { valid: true }, true);

      const hit1 = await cache.get("a".repeat(64));
      expect(hit1.hit).toBe(false); // evicted

      const hit2 = await cache.get("d".repeat(64));
      expect(hit2.hit).toBe(true); // most recent
    });

    it("LRU touch prevents eviction of recently accessed entries", async () => {
      const cache = new TransactionSignerCache({ maxEntries: 3 });

      await cache.set("a".repeat(64), { valid: true }, true);
      await cache.set("b".repeat(64), { valid: true }, true);
      await cache.set("c".repeat(64), { valid: true }, true);

      // Touch 'a' to make it most recently used
      await cache.get("a".repeat(64));

      // Adding 4th should evict 'b' (oldest untouched)
      await cache.set("d".repeat(64), { valid: true }, true);

      const hitA = await cache.get("a".repeat(64));
      expect(hitA.hit).toBe(true); // was touched, not evicted

      const hitB = await cache.get("b".repeat(64));
      expect(hitB.hit).toBe(false); // evicted
    });

    it("overwrites existing entry without growing beyond maxEntries", async () => {
      const cache = new TransactionSignerCache({ maxEntries: 3 });

      await cache.set("a".repeat(64), { valid: false }, false);
      await cache.set("a".repeat(64), { valid: true }, true); // overwrite

      expect(cache.memory.size).toBe(1);

      const hit = await cache.get("a".repeat(64));
      expect(hit.hit).toBe(true);
      expect(hit.result.valid).toBe(true);
    });
  });

  // ── Invalidation ────────────────────────────────────────────────────────────

  describe("invalidation", () => {
    it("invalidates a specific entry", async () => {
      const cache = new TransactionSignerCache();
      const txHash = "a".repeat(64);

      await cache.set(txHash, { valid: true }, true);
      await cache.invalidate(txHash);

      const hit = await cache.get(txHash);
      expect(hit.hit).toBe(false);
    });

    it("invalidates all entries when called without argument", async () => {
      const cache = new TransactionSignerCache();

      await cache.set("a".repeat(64), { valid: true }, true);
      await cache.set("b".repeat(64), { valid: true }, true);
      await cache.invalidate(null);

      expect(cache.memory.size).toBe(0);
    });
  });

  // ── Pruning ─────────────────────────────────────────────────────────────────

  describe("pruning", () => {
    it("prunes expired entries", async () => {
      const cache = new TransactionSignerCache({
        validTtlMs: 50,
        invalidTtlMs: 50,
      });

      await cache.set("a".repeat(64), { valid: true }, true);
      await cache.set("b".repeat(64), { valid: false }, false);

      await new Promise((r) => setTimeout(r, 60));

      const pruned = cache.prune();
      expect(pruned).toBe(2);
      expect(cache.memory.size).toBe(0);
    });

    it("does not prune non-expired entries", async () => {
      const cache = new TransactionSignerCache({
        validTtlMs: 100_000,
        invalidTtlMs: 100_000,
      });

      await cache.set("a".repeat(64), { valid: true }, true);

      const pruned = cache.prune();
      expect(pruned).toBe(0);
      expect(cache.memory.size).toBe(1);
    });
  });

  // ── Stats ───────────────────────────────────────────────────────────────────

  describe("stats", () => {
    it("tracks hit/miss rates correctly", async () => {
      const cache = new TransactionSignerCache();

      await cache.set("a".repeat(64), { valid: true }, true);
      await cache.get("a".repeat(64)); // hit
      await cache.get("b".repeat(64)); // miss

      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBe("50.0%");
    });
  });

  // ── Clear ───────────────────────────────────────────────────────────────────

  describe("clear", () => {
    it("resets all state including counters", async () => {
      const cache = new TransactionSignerCache();

      await cache.set("a".repeat(64), { valid: true }, true);
      await cache.get("a".repeat(64));
      await cache.get("b".repeat(64));

      await cache.clear();

      const stats = cache.getStats();
      expect(stats.size).toBe(0);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });
  });

  // ── Redis integration ──────────────────────────────────────────────────────

  describe("Redis integration", () => {
    it("falls back to memory when Redis GET fails", async () => {
      const mockRedis = {
        get: vi.fn().mockRejectedValue(new Error("Redis down")),
        set: vi.fn(),
        del: vi.fn(),
      };

      const cache = new TransactionSignerCache({ redisClient: mockRedis });
      const txHash = "a".repeat(64);

      const result = await cache.get(txHash);
      expect(result.hit).toBe(false);
      expect(cache.getStats().fallbacks).toBe(1);
    });

    it("falls back to memory when Redis SET fails", async () => {
      const mockRedis = {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockRejectedValue(new Error("Redis down")),
        del: vi.fn(),
      };

      const cache = new TransactionSignerCache({ redisClient: mockRedis });
      const txHash = "a".repeat(64);

      await cache.set(txHash, { valid: true }, true);

      // Should still be in memory
      const result = await cache.get(txHash);
      expect(result.hit).toBe(true);
      expect(cache.getStats().fallbacks).toBe(1);
    });

    it("retrieves from Redis on memory miss and rehydrates memory", async () => {
      const verificationResult = { valid: true, reason: "ok" };
      const mockRedis = {
        get: vi.fn().mockResolvedValue(JSON.stringify({ result: verificationResult, valid: true })),
        set: vi.fn(),
        del: vi.fn(),
      };

      const cache = new TransactionSignerCache({ redisClient: mockRedis });
      const txHash = "a".repeat(64);

      const result = await cache.get(txHash);
      expect(result.hit).toBe(true);
      expect(result.result).toEqual(verificationResult);

      // Now should hit memory
      const result2 = await cache.get(txHash);
      expect(result2.hit).toBe(true);
      expect(mockRedis.get).toHaveBeenCalledTimes(1); // only first call
    });

    it("saves to Redis on set with appropriate TTL", async () => {
      const mockRedis = {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue("OK"),
        del: vi.fn(),
      };

      const cache = new TransactionSignerCache({
        redisClient: mockRedis,
        redisTtlSeconds: 300,
      });

      await cache.set("a".repeat(64), { valid: true }, true);
      expect(mockRedis.set).toHaveBeenCalledWith(
        expect.stringContaining("ts_vcache:"),
        expect.any(String),
        { EX: 300 },
      );
    });

    it("uses shorter Redis TTL for invalid results", async () => {
      const mockRedis = {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue("OK"),
        del: vi.fn(),
      };

      const cache = new TransactionSignerCache({
        redisClient: mockRedis,
        redisTtlSeconds: 300,
      });

      await cache.set("a".repeat(64), { valid: false }, false);
      expect(mockRedis.set).toHaveBeenCalledWith(
        expect.stringContaining("ts_vcache:"),
        expect.any(String),
        { EX: 60 },
      );
    });
  });

  // ── Singleton ───────────────────────────────────────────────────────────────

  describe("getTransactionSignerCache singleton", () => {
    it("returns the same instance on repeated calls", () => {
      const cache1 = getTransactionSignerCache();
      const cache2 = getTransactionSignerCache();
      expect(cache1).toBe(cache2);
    });

    it("resetTransactionSignerCacheForTest creates a fresh instance", () => {
      const cache1 = getTransactionSignerCache();
      resetTransactionSignerCacheForTest();
      const cache2 = getTransactionSignerCache();
      expect(cache1).not.toBe(cache2);
    });
  });
});
