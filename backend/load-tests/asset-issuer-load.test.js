/**
 * asset-issuer-load.test.js
 *
 * Rigorous load testing for the Asset Issuer service (Issue #1054).
 *
 * The Asset Issuer module has no HTTP surface of its own for verification —
 * transactions are verified through direct in-process calls from the payment
 * and trustline flows — so, mirroring the Audit Logger load tests, these
 * scenarios drive the recovery/verification pipeline directly with the DB,
 * Horizon and rate-limit boundaries mocked. No real database, no real
 * Horizon, no real Redis.
 *
 * Scenarios:
 *   1. High-volume concurrent successful verifications
 *   2. Sustained multi-batch sequential throughput
 *   3. Circuit breaker opening under a concurrent failure burst
 *   4. Circuit breaker recovery (open -> half-open probe -> closed)
 *   5. Dead-letter queue churn under sustained non-retryable failures
 *   6. In-flight verification de-duplication under a same-key cold burst
 *   7. Verification cache hit rate once warm
 *   8. Per-context circuit breaker registry stays bounded
 *   9. Rate-limit key generation under a high-cardinality actor burst
 *
 * Run with: npm run test:load -- asset-issuer
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const {
  mockQueryWithRetry,
  mockVerifyTransactionSignature,
  mockWithHorizonRetry,
  mockStellarServer,
  mockRateLimit,
  mockIpKeyGenerator,
  mockLogger,
} = vi.hoisted(() => ({
  mockQueryWithRetry: vi.fn(),
  mockVerifyTransactionSignature: vi.fn(),
  mockWithHorizonRetry: vi.fn(),
  mockStellarServer: vi.fn().mockImplementation(() => ({
    loadAccount: vi.fn(),
    transactions: vi.fn().mockReturnThis(),
    transaction: vi.fn().mockReturnThis(),
    call: vi.fn(),
  })),
  mockRateLimit: vi.fn(() => (_req, _res, next) => next()),
  mockIpKeyGenerator: vi.fn(),
  mockLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../src/lib/db.js", () => ({ queryWithRetry: mockQueryWithRetry }));
vi.mock("../src/lib/stellar.js", () => ({
  verifyTransactionSignature: mockVerifyTransactionSignature,
  withHorizonRetry: mockWithHorizonRetry,
  isValidStellarAccountId: vi.fn().mockReturnValue(true),
  isValidAssetCode: vi.fn().mockReturnValue(true),
  isValidStellarPublicKey: vi.fn().mockReturnValue(true),
}));
vi.mock("stellar-sdk", () => ({
  Horizon: { Server: mockStellarServer },
  Networks: { PUBLIC: "public", TESTNET: "testnet" },
  Transaction: vi.fn().mockImplementation(() => ({ operations: [], signatures: [] })),
  Keypair: {
    fromPublicKey: vi.fn().mockReturnValue({ verify: vi.fn().mockReturnValue(true) }),
  },
}));
vi.mock("express-rate-limit", () => ({ default: mockRateLimit, ipKeyGenerator: mockIpKeyGenerator }));
vi.mock("../src/lib/logger.js", () => ({ logger: mockLogger }));
vi.mock("../src/lib/rate-limit.js", () => ({
  createRedisRateLimitStore: vi.fn(),
  RATE_LIMIT_REDIS_PREFIX: "rl:",
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import {
  AssetIssuerErrorRecovery,
  AssetIssuerRateLimiter,
  AssetIssuerSignatureVerifier,
  AssetIssuerQueryOptimizer,
  ASSET_ISSUER_RATE_LIMIT_MAX,
} from "../src/lib/asset-issuer.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function runConcurrent(count, fn) {
  return Promise.all(Array.from({ length: count }, (_, i) => fn(i)));
}

async function runConcurrentSettled(count, fn) {
  return Promise.allSettled(Array.from({ length: count }, (_, i) => fn(i)));
}

function nonRetryableError(message = "bad request") {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function validVerification() {
  return {
    valid: true,
    reason: "Signature verified",
    isMultiSig: false,
    signatureCount: 1,
    thresholdMet: true,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Asset Issuer Load Tests", () => {
  beforeEach(() => {
    mockQueryWithRetry.mockReset();
    mockVerifyTransactionSignature.mockReset();
    mockWithHorizonRetry.mockReset();
    mockStellarServer.mockClear();
    mockLogger.warn.mockClear();
    mockLogger.error.mockClear();

    mockQueryWithRetry.mockResolvedValue({ rows: [] });
    mockVerifyTransactionSignature.mockResolvedValue(validVerification());
    mockWithHorizonRetry.mockResolvedValue({ envelope_xdr: "AAAA...", source_account: "GBXX" });
    mockIpKeyGenerator.mockImplementation((ip) => ip);

    AssetIssuerErrorRecovery.resetCircuitBreaker();
    AssetIssuerErrorRecovery.drainDeadLetterQueue();
  });

  afterEach(() => {
    AssetIssuerErrorRecovery.resetCircuitBreaker();
    AssetIssuerErrorRecovery.drainDeadLetterQueue();
  });

  describe("High-volume concurrent verifications", () => {
    it("handles 500 concurrent successful verifications", async () => {
      const start = Date.now();
      const results = await runConcurrent(500, () =>
        AssetIssuerErrorRecovery.executeWithRecovery(
          async () => "verified",
          "load_concurrent_success",
        ),
      );
      const duration = Date.now() - start;

      expect(results).toHaveLength(500);
      expect(results.every((result) => result === "verified")).toBe(true);
      expect(duration).toBeLessThan(2000);
    });

    it("recovers every call from a burst of transient failures", async () => {
      let attempt = 0;
      const transientFailureBudget = 50;
      const operation = async () => {
        attempt += 1;
        if (attempt <= transientFailureBudget) {
          throw new Error("network timeout");
        }
        return "ok";
      };

      const results = await runConcurrent(200, () =>
        AssetIssuerErrorRecovery.executeWithRecovery(operation, "load_retry_storm", {
          maxAttempts: 3,
          timeoutMs: 5000,
        }),
      );

      expect(results.every((result) => result === "ok")).toBe(true);
      expect(attempt).toBeGreaterThanOrEqual(200);
    }, 30000);
  });

  describe("Sustained sequential throughput", () => {
    it("processes 10 sequential batches of 100 issuer stats with stable per-batch timing", async () => {
      const batchDurations = [];

      for (let batch = 0; batch < 10; batch += 1) {
        const start = Date.now();
        await runConcurrent(100, (i) =>
          AssetIssuerQueryOptimizer.getIssuerStats(`GBISSUER${batch}${i}`.slice(0, 56)),
        );
        batchDurations.push(Date.now() - start);
      }

      expect(mockQueryWithRetry).toHaveBeenCalledTimes(1000);
      expect(Math.max(...batchDurations)).toBeLessThan(2000);
    });
  });

  describe("Circuit breaker under load", () => {
    it("opens after the failure threshold and rejects further work", async () => {
      const failing = vi.fn().mockRejectedValue(nonRetryableError());

      await runConcurrentSettled(5, () =>
        AssetIssuerErrorRecovery.executeWithRecovery(failing, "load_cb_open"),
      );

      expect(AssetIssuerErrorRecovery.isCircuitBreakerOpen("load_cb_open")).toBe(true);

      const shortCircuited = vi.fn().mockResolvedValue("never reached");
      await expect(
        AssetIssuerErrorRecovery.executeWithRecovery(shortCircuited, "load_cb_open"),
      ).rejects.toThrow("Circuit breaker is open");
      expect(shortCircuited).not.toHaveBeenCalled();
    });

    it("serves a degraded response through the fallback while open", async () => {
      const failing = vi.fn().mockRejectedValue(nonRetryableError());

      await runConcurrentSettled(5, () =>
        AssetIssuerErrorRecovery.executeWithRecovery(failing, "load_cb_fallback"),
      );

      const fallback = vi.fn().mockResolvedValue({ degraded: true });
      const result = await AssetIssuerErrorRecovery.executeWithRecovery(
        vi.fn().mockResolvedValue("never reached"),
        "load_cb_fallback",
        { fallback },
      );

      expect(result).toEqual({ degraded: true });
      expect(fallback).toHaveBeenCalledTimes(1);
    });

    it("recovers to a closed circuit after the cooldown window", async () => {
      vi.useFakeTimers();
      try {
        const failing = vi.fn().mockRejectedValue(nonRetryableError());

        await runConcurrentSettled(5, () =>
          AssetIssuerErrorRecovery.executeWithRecovery(failing, "load_cb_recovery"),
        );
        expect(AssetIssuerErrorRecovery.isCircuitBreakerOpen("load_cb_recovery")).toBe(true);

        vi.setSystemTime(Date.now() + 31_000);

        const probe = vi.fn().mockResolvedValue("recovered");
        await expect(
          AssetIssuerErrorRecovery.executeWithRecovery(probe, "load_cb_recovery"),
        ).resolves.toBe("recovered");
        expect(AssetIssuerErrorRecovery.isCircuitBreakerOpen("load_cb_recovery")).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("Dead-letter queue under sustained failures", () => {
    it("caps the queue and evicts the oldest entry beyond capacity", async () => {
      const failing = (context) =>
        AssetIssuerErrorRecovery.executeWithRecovery(
          vi.fn().mockRejectedValue(nonRetryableError("schema conflict")),
          context,
        );

      for (let batch = 0; batch < 15; batch += 1) {
        await runConcurrentSettled(10, (i) => failing(`load_dlq_${batch}_${i}`));
      }

      const dlq = AssetIssuerErrorRecovery.getDeadLetterQueue();
      expect(dlq.length).toBe(100);
      expect(dlq[0].context).toBe("load_dlq_5_0");
      expect(dlq[dlq.length - 1].context).toBe("load_dlq_14_9");
    }, 60000);
  });

  describe("Verification cache and in-flight de-duplication", () => {
    it("collapses a concurrent cold burst for one transaction into a single lookup", async () => {
      const verifier = new AssetIssuerSignatureVerifier();

      const { Transaction } = await import("stellar-sdk");
      Transaction.mockImplementation(() => ({
        operations: [
          {
            type: "payment",
            asset: { isNative: () => false, getCode: () => "USDC", getIssuer: () => "GBXX" },
            amount: "100",
          },
        ],
      }));

      const results = await runConcurrent(100, () => verifier.verifyOperation("dedupe-tx"));

      expect(results).toHaveLength(100);
      for (const result of results) {
        expect(result.valid).toBe(true);
        expect(result.assetCode).toBe("USDC");
      }
      expect(mockVerifyTransactionSignature).toHaveBeenCalledTimes(1);
    });

    it("serves repeat verifications from the warm cache without new lookups", async () => {
      const verifier = new AssetIssuerSignatureVerifier();

      const { Transaction } = await import("stellar-sdk");
      Transaction.mockImplementation(() => ({
        operations: [
          {
            type: "payment",
            asset: { isNative: () => false, getCode: () => "USDC", getIssuer: () => "GBXX" },
            amount: "100",
          },
        ],
      }));

      await verifier.verifyOperation("warm-tx");
      const lookupsAfterCold = mockVerifyTransactionSignature.mock.calls.length;

      const results = await runConcurrent(200, () => verifier.verifyOperation("warm-tx"));

      expect(results.every((result) => result.valid)).toBe(true);
      expect(mockVerifyTransactionSignature).toHaveBeenCalledTimes(lookupsAfterCold);
    });
  });

  describe("Registry bounds", () => {
    it("keeps the per-context circuit breaker registry bounded under context churn", async () => {
      await Promise.all(
        Array.from({ length: 1500 }, (_, i) =>
          AssetIssuerErrorRecovery.executeWithRecovery(async () => i, `load_churn_${i}`),
        ),
      );

      const health = AssetIssuerErrorRecovery.getRecoveryHealth();
      expect(health.trackedContexts).toBeLessThanOrEqual(1000);
    });

    it("stays bounded across a large volume of verification cycles", async () => {
      const verifier = new AssetIssuerSignatureVerifier();

      const { Transaction } = await import("stellar-sdk");
      Transaction.mockImplementation(() => ({ operations: [] }));

      for (let batch = 0; batch < 20; batch += 1) {
        await runConcurrent(25, (i) => verifier.verifyOperation(`churn-${batch}-${i}`));
      }

      expect(verifier.verificationCache.size).toBeLessThanOrEqual(1000);
      expect(verifier.pendingVerifications.size).toBe(0);
    });
  });

  describe("Rate-limit key generation", () => {
    it("generates distinct, stable keys for a high-cardinality actor burst", () => {
      const keys = new Set();
      for (let i = 0; i < 2000; i += 1) {
        keys.add(AssetIssuerRateLimiter.getKey({ ip: `192.168.${Math.floor(i / 256)}.${i % 256}` }));
      }

      expect(keys.size).toBe(2000);
      expect([...keys].every((key) => key.startsWith("asset:issuer:ip:"))).toBe(true);
    });

    it("keeps the standard and burst tiers consistent per actor", () => {
      const req = { headers: { "x-api-key": "sk_live_load_test" }, ip: "1.2.3.4" };
      const standard = AssetIssuerRateLimiter.getKey(req);
      const burst = AssetIssuerRateLimiter.getBurstKey(req);

      expect(burst).toBe(`${standard}:burst`);
      expect(standard).toMatch(/^asset:issuer:api:[a-f0-9]{64}$/);
    });

    it("exposes the configured standard ceiling", () => {
      expect(ASSET_ISSUER_RATE_LIMIT_MAX).toBe(50);
    });
  });
});
