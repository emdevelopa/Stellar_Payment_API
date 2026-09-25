/**
 * trustline-manager-load.test.js
 *
 * Rigorous load testing for the Trustline Manager (issue #1044).
 *
 * The Trustline Manager has no HTTP surface of its own — signature
 * verification, rate-limit violation tracking, circuit-breaker recovery and
 * optimized queries are exercised through in-process calls from routes and
 * pollers — so, mirroring the Audit Logger and Database Pooler load suites,
 * these scenarios drive the manager's public API directly with every external
 * boundary mocked (DB, Horizon, Redis rate-limit store).
 *
 * Scenarios:
 *   1. High-volume concurrent signature verifications (unique tx hashes)
 *   2. Verification cache absorbs repeated verification storms
 *   3. Rate-limit violation tracking at scale stays bounded and accurate
 *   4. Circuit breaker opens under sustained concurrent failures and
 *      short-circuits once open
 *   5. Recovery metrics stay bounded under a sustained success/failure mix
 *   6. Dead-letter queue stays bounded under sustained terminal failures
 *   7. Optimized trustline queries sustain concurrent merchant loads
 *
 * Run with: npm run test:load -- trustline-manager
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Hoisted mocks (same shape as trustline-manager.test.js) ────────────────

const {
  mockQueryWithRetry,
  mockVerifyTransactionSignature,
  mockWithHorizonRetry,
  mockStellarTransaction,
} = vi.hoisted(() => ({
  mockQueryWithRetry: vi.fn(),
  mockVerifyTransactionSignature: vi.fn(),
  mockWithHorizonRetry: vi.fn(),
  mockStellarTransaction: vi.fn(),
}));

vi.mock("stellar-sdk", () => ({
  Horizon: { Server: vi.fn() },
  Networks: {
    PUBLIC: "Public Global Stellar Network ; September 2015",
    TESTNET: "Test SDF Network ; September 2015",
  },
  Transaction: mockStellarTransaction,
}));

vi.mock("../src/lib/db.js", () => ({ queryWithRetry: mockQueryWithRetry }));

vi.mock("../src/lib/stellar.js", () => ({
  verifyTransactionSignature: mockVerifyTransactionSignature,
  withHorizonRetry: mockWithHorizonRetry,
  isValidStellarAccountId: vi.fn(() => true),
  isValidAssetCode: vi.fn(() => true),
}));

vi.mock("../src/lib/rate-limit.js", () => ({
  createRedisRateLimitStore: vi.fn(),
  RATE_LIMIT_REDIS_PREFIX: "rl:",
}));

vi.mock("../src/lib/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("express-rate-limit", () => ({
  default: vi.fn(),
  ipKeyGenerator: vi.fn((ip) => ip),
}));

// ── Import after mocks ──────────────────────────────────────────────────────

import {
  TrustlineErrorRecovery,
  TrustlineQueryOptimizer,
  TrustlineRateLimiter,
  TrustlineSignatureVerifier,
} from "../src/lib/trustline-manager.js";
import {
  recordTrustlineSignatureVerification,
  resetTrustlineManagerMetrics,
} from "../src/lib/trustline-manager-metrics.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

async function runConcurrent(count, fn) {
  return Promise.all(Array.from({ length: count }, (_, i) => fn(i)));
}

function mockValidTransaction() {
  mockVerifyTransactionSignature.mockResolvedValue({
    valid: true,
    reason: "Signature verification passed",
    isMultiSig: false,
    signatureCount: 1,
    thresholdMet: true,
  });
  mockWithHorizonRetry.mockResolvedValue({ envelope_xdr: "mock_xdr" });
  mockStellarTransaction.mockImplementation(() => ({
    operations: [
      {
        type: "changeTrust",
        asset: {
          isNative: () => false,
          getCode: () => "USDC",
          getIssuer: () =>
            "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
        },
        limit: "1000",
      },
    ],
  }));
}

describe("Trustline Manager Load Tests", () => {
  beforeEach(() => {
    mockQueryWithRetry.mockReset();
    mockVerifyTransactionSignature.mockReset();
    mockWithHorizonRetry.mockReset();
    mockStellarTransaction.mockReset();
    TrustlineErrorRecovery.resetCircuitBreaker();
    TrustlineErrorRecovery.drainDeadLetterQueue();
    TrustlineRateLimiter.resetViolationMetrics();
    resetTrustlineManagerMetrics();
  });

  describe("High-volume signature verifications", () => {
    it("handles 300 concurrent verifications for unique transactions", async () => {
      mockValidTransaction();

      const start = Date.now();
      const results = await runConcurrent(300, (i) =>
        new TrustlineSignatureVerifier().verifyTrustlineSignature(`load-tx-${i}`),
      );
      const duration = Date.now() - start;

      expect(results.every((r) => r.valid)).toBe(true);
      expect(mockVerifyTransactionSignature).toHaveBeenCalledTimes(300);
      expect(duration).toBeLessThan(2000);
    });

    it("serves repeated verification storms from cache without extra Horizon work", async () => {
      mockValidTransaction();
      const verifier = new TrustlineSignatureVerifier();
      const txHash = "storm-tx-hash";

      // Warm the cache with a single completed verification first.
      await verifier.verifyTrustlineSignature(txHash);
      expect(mockVerifyTransactionSignature).toHaveBeenCalledTimes(1);

      const start = Date.now();
      await runConcurrent(500, () =>
        verifier.verifyTrustlineSignature(txHash),
      );
      const duration = Date.now() - start;

      // Every storm call is served from the in-memory cache.
      expect(mockVerifyTransactionSignature).toHaveBeenCalledTimes(1);
      expect(duration).toBeLessThan(1000);

      const text = await trustlineManagerRegister.metrics();
      expect(text).toContain('trustline_signature_verifications_total{outcome="valid"} 1');
      expect(text).toContain(
        "trustline_signature_verification_cache_hits_total",
      );
    });

    it("keeps the verification cache bounded across a 1200-hash flood", async () => {
      mockValidTransaction();
      const verifier = new TrustlineSignatureVerifier();

      for (let i = 0; i < 1200; i++) {
        await verifier.verifyTrustlineSignature(`flood-tx-${i}`);
      }

      expect(verifier.verificationCache.size).toBeLessThanOrEqual(1000);
    });
  });

  describe("Rate-limit violation tracking under load", () => {
    it("tracks 2000 violations across 50 keys with bounded memory and exact counts", async () => {
      const start = Date.now();
      await runConcurrent(2000, (i) => {
        TrustlineRateLimiter.recordViolation(
          `trustline:ops:merchant:load-${i % 50}`,
        );
      });
      const duration = Date.now() - start;

      const metrics = TrustlineRateLimiter.getRateLimitViolationMetrics();
      expect(Object.keys(metrics)).toHaveLength(50);
      for (const key of Object.values(metrics)) {
        expect(key.count).toBe(40);
      }
      expect(duration).toBeLessThan(1000);
    });

    it("records verification outcomes through the granular metrics series", async () => {
      for (let i = 0; i < 100; i++) {
        recordTrustlineSignatureVerification("valid", 0.01);
      }

      const text = await trustlineManagerRegister.metrics();
      expect(text).toContain(
        'trustline_signature_verifications_total{outcome="valid"} 100',
      );
    });
  });

  describe("Circuit breaker under sustained failures", () => {
    it("opens after sustained terminal failures and short-circuits subsequent calls", async () => {
      const context = "load-cb-terminal";
      const authError = new Error("auth failed");
      authError.status = 401; // non-retryable → no retry backoff sleeps

      // Trip the breaker (threshold 5) with concurrent terminal failures.
      await Promise.allSettled(
        Array.from({ length: 10 }, () =>
          TrustlineErrorRecovery.executeWithRecovery(
            async () => {
              throw authError;
            },
            context,
            { maxAttempts: 1 },
          ),
        ),
      );

      expect(TrustlineErrorRecovery.isCircuitBreakerOpen(context)).toBe(true);

      // Once open, a burst of rejections must short-circuit quickly.
      const start = Date.now();
      const rejections = await Promise.allSettled(
        Array.from({ length: 500 }, () =>
          TrustlineErrorRecovery.executeWithRecovery(
            async () => "should-never-run",
            context,
          ),
        ),
      );
      const duration = Date.now() - start;

      expect(rejections.every((r) => r.status === "rejected")).toBe(true);
      expect(duration).toBeLessThan(1000);
    });

  it("recovers successfully after the breaker closes", async () => {
    const context = "load-cb-recover";
    const failing = new Error("db down");
    failing.status = 503;

    await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        TrustlineErrorRecovery.executeWithRecovery(
          async () => {
            throw failing;
          },
          context,
          { maxAttempts: 1 },
        ),
      ),
    );
    expect(TrustlineErrorRecovery.isCircuitBreakerOpen(context)).toBe(true);

    // Fast-forward past the open window so the next call is a half-open probe.
    const state = TrustlineErrorRecovery._getState(context);
    state.lastFailureTime = Date.now() - 31_000;

    // A real success closes the breaker again.
    const ok = await TrustlineErrorRecovery.executeWithRecovery(
      async () => "healthy",
      context,
    );
    expect(ok).toBe("healthy");
    expect(TrustlineErrorRecovery.isCircuitBreakerOpen(context)).toBe(false);
  });
  });

  describe("Recovery metrics under sustained mixed outcomes", () => {
    it("processes 600 mixed outcomes with a bounded rolling window", async () => {
      const context = "load-metrics-mix";
      const outcomes = [];
      for (let i = 0; i < 600; i++) {
        const success = i % 3 !== 0; // 400 success / 200 failure
        outcomes.push(success);
        TrustlineErrorRecovery["_updateRecoveryMetrics"](context, success);
      }

      const snapshot = TrustlineErrorRecovery.getAllRecoveryMetrics();
      const metrics = snapshot[context];
      expect(metrics.successCount).toBe(400);
      expect(metrics.failureCount).toBe(200);
      expect(metrics.recentOperations).toBe(100); // rolling window is capped

      const rate = TrustlineErrorRecovery.getRecoverySuccessRate(context);
      expect(rate).toBeCloseTo(66.67, 1);
    });
  });

  describe("Dead-letter queue under sustained terminal failures", () => {
    it("stays bounded at 100 entries while absorbing 150 terminal failures", async () => {
      const authError = new Error("auth failed");
      authError.status = 401;

      await Promise.allSettled(
        Array.from({ length: 150 }, (i) =>
          TrustlineErrorRecovery.executeWithRecovery(
            async () => {
              throw authError;
            },
            `load-dlq-${i}`,
            { maxAttempts: 1 },
          ),
        ),
      );

      const dlq = TrustlineErrorRecovery.getDeadLetterQueue();
      expect(dlq).toHaveLength(100);
      expect(dlq.every((entry) => entry.errorType === "auth_error")).toBe(true);

      expect(TrustlineErrorRecovery.drainDeadLetterQueue()).toHaveLength(100);
      expect(TrustlineErrorRecovery.getDeadLetterQueue()).toHaveLength(0);
    });
  });

  describe("Optimized trustline queries under concurrent load", () => {
    it("sustains 200 concurrent merchant asset/stat queries", async () => {
      mockQueryWithRetry.mockResolvedValue({
        rows: [{ id: "merchant-1", allowed_issuers: [], payment_limits: {} }],
      });

      const start = Date.now();
      const [assets, stats] = await Promise.all([
        runConcurrent(100, (i) =>
          TrustlineQueryOptimizer.getMerchantAllowedAssets(`merchant-${i}`),
        ),
        runConcurrent(100, (i) =>
          TrustlineQueryOptimizer.getPaymentStatsByAsset(
            `merchant-${i}`,
            "24 hours",
          ),
        ),
      ]);
      const duration = Date.now() - start;

      expect(assets.every((r) => r.rows)).toBe(true);
      expect(stats.every((r) => r.rows)).toBe(true);
      expect(mockQueryWithRetry).toHaveBeenCalledTimes(200);
      expect(duration).toBeLessThan(2000);
    });

    it("keeps per-query latency stable across sequential 30-day statistic batches", async () => {
      mockQueryWithRetry.mockResolvedValue({ rows: [] });

      const batchDurations = [];
      for (let batch = 0; batch < 5; batch += 1) {
        const start = Date.now();
        await runConcurrent(50, (i) =>
          TrustlineQueryOptimizer.getTrustlineHealthMetrics(
            `merchant-batch${batch}-${i}`,
          ),
        );
        batchDurations.push(Date.now() - start);
      }

      expect(mockQueryWithRetry).toHaveBeenCalledTimes(250);
      expect(Math.max(...batchDurations)).toBeLessThan(1500);
    });
  });
});
