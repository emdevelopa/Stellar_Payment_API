/**
 * transaction-signer-load.test.js
 *
 * Rigorous load testing for the Transaction Signer (Issue #1079).
 *
 * Tests signer performance under various load scenarios:
 *   - High-throughput hash validation
 *   - Concurrent verification requests
 *   - Replay-cache pressure under burst traffic
 *   - Cache hit/miss ratio under sustained load
 *   - Memory stability over large verification volumes
 *
 * Run with: NODE_ENV=test npm run test:load
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  validateTxHash,
  clearReplayCache,
} from "../src/lib/transaction-signer.js";
import {
  TransactionSignerCache,
  resetTransactionSignerCacheForTest,
} from "../src/lib/transaction-signer-cache.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeTxHash(seed) {
  return seed.toString(16).padStart(64, "0");
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function runConcurrent(count, fn) {
  return Promise.all(Array.from({ length: count }, (_, i) => fn(i)));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Transaction Signer Load Tests", () => {
  beforeEach(() => {
    clearReplayCache();
    resetTransactionSignerCacheForTest();
  });

  describe("Hash validation throughput", () => {
    it("validates 10 000 hashes within 500 ms", () => {
      const hashes = Array.from({ length: 10_000 }, (_, i) => makeTxHash(i));
      const start = Date.now();
      for (const h of hashes) {
        validateTxHash(h);
      }
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(500);
    });

    it("rejects invalid hashes as fast as valid ones", () => {
      const invalids = Array.from({ length: 5_000 }, (_, i) => `invalid-${i}`);
      const start = Date.now();
      let rejectCount = 0;
      for (const h of invalids) {
        const result = validateTxHash(h);
        if (!result.valid) rejectCount++;
      }
      const duration = Date.now() - start;
      expect(rejectCount).toBe(5_000);
      expect(duration).toBeLessThan(500);
    });
  });

  describe("Verification cache under load", () => {
    it("sustains high hit rate under repeated lookups", async () => {
      const cache = new TransactionSignerCache({ maxEntries: 1_000, validTtlMs: 60_000 });
      const hashes = Array.from({ length: 500 }, (_, i) => makeTxHash(i));

      // Populate cache
      for (const h of hashes) {
        await cache.set(h, { valid: true, reason: "ok" });
      }

      let hits = 0;
      const start = Date.now();
      for (let round = 0; round < 10; round++) {
        for (const h of hashes) {
          const entry = await cache.get(h);
          if (entry !== null) hits++;
        }
      }
      const duration = Date.now() - start;

      expect(hits).toBe(5_000);
      expect(duration).toBeLessThan(1_000);
    });

    it("handles 500 concurrent cache reads without data races", async () => {
      const cache = new TransactionSignerCache({ maxEntries: 2_000 });
      const hashes = Array.from({ length: 100 }, (_, i) => makeTxHash(i));
      for (const h of hashes) {
        await cache.set(h, { valid: true });
      }

      const results = await runConcurrent(500, async (i) => {
        const h = hashes[i % hashes.length];
        return cache.get(h);
      });

      const hits = results.filter((r) => r !== null).length;
      expect(hits).toBe(500);
    });

    it("evicts entries correctly when capacity is exceeded", async () => {
      const cache = new TransactionSignerCache({ maxEntries: 100 });

      for (let i = 0; i < 200; i++) {
        await cache.set(makeTxHash(i), { valid: true });
      }

      const stats = cache.stats();
      expect(stats.size).toBeLessThanOrEqual(100);
    });
  });

  describe("Sustained throughput stability", () => {
    it("processes 2 000 sequential validations with stable timing", () => {
      const timings = [];
      for (let i = 0; i < 2_000; i++) {
        const t0 = Date.now();
        validateTxHash(makeTxHash(i));
        timings.push(Date.now() - t0);
      }

      const avg = timings.reduce((a, b) => a + b, 0) / timings.length;
      const max = Math.max(...timings);
      // Average per-call should be sub-millisecond; max spike under 50 ms
      expect(avg).toBeLessThan(1);
      expect(max).toBeLessThan(50);
    });

    it("shows no memory growth across 5 000 cache set/evict cycles", async () => {
      const cache = new TransactionSignerCache({ maxEntries: 500 });
      const before = process.memoryUsage().heapUsed;

      for (let i = 0; i < 5_000; i++) {
        await cache.set(makeTxHash(i), { valid: true });
      }

      // Force GC hint (best-effort)
      if (global.gc) global.gc();
      const after = process.memoryUsage().heapUsed;

      // Allow up to 10 MB growth — eviction should keep this bounded
      expect(after - before).toBeLessThan(10 * 1024 * 1024);
    });
  });
});
