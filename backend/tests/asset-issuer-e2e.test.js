/**
 * End-to-end tests for the Asset Issuer module (#1051).
 *
 * Exercises the whole module through its public entry points -- the
 * `AssetIssuerManager` facade, the exported singleton and the rate-limit
 * factory -- rather than the individual unit tests in
 * `src/lib/asset-issuer.test.js`. Horizon, Postgres, Redis and the clock are
 * all mocked, so no network or database is required.
 *
 * Mirrors the layout and mocking style of `tests/sep12-kyc-e2e.test.js`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const {
  mockQueryWithRetry,
  mockVerifyTransactionSignature,
  mockWithHorizonRetry,
  mockLoadAccount,
  mockTransactionCall,
  mockLogger,
} = vi.hoisted(() => {
  const mockLoadAccount = vi.fn();
  const mockTransactionCall = vi.fn();
  return {
    mockQueryWithRetry: vi.fn(),
    mockVerifyTransactionSignature: vi.fn(),
    mockWithHorizonRetry: vi.fn(),
    mockLoadAccount,
    mockTransactionCall,
    mockLogger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
});

vi.mock("../src/lib/db.js", () => ({
  queryWithRetry: mockQueryWithRetry,
  pool: { query: vi.fn(), on: vi.fn(), end: vi.fn() },
  circuitBreaker: { state: "CLOSED", failureCount: 0 },
}));

vi.mock("../src/lib/stellar.js", () => ({
  verifyTransactionSignature: mockVerifyTransactionSignature,
  withHorizonRetry: mockWithHorizonRetry,
  isValidStellarAccountId: vi.fn().mockReturnValue(true),
  isValidAssetCode: vi.fn().mockReturnValue(true),
  isValidStellarPublicKey: vi.fn().mockReturnValue(true),
}));

vi.mock("stellar-sdk", () => ({
  Horizon: {
    Server: vi.fn(() => ({
      loadAccount: mockLoadAccount,
      transactions: () => ({ transaction: () => ({ call: mockTransactionCall }) }),
    })),
  },
  Networks: { PUBLIC: "public", TESTNET: "testnet" },
  Transaction: vi.fn(),
}));

vi.mock("../src/lib/logger.js", () => ({ logger: mockLogger }));

vi.mock("../src/lib/rate-limit.js", () => ({
  createRedisRateLimitStore: vi.fn(() => ({})),
  RATE_LIMIT_REDIS_PREFIX: "rl:",
}));

vi.mock("express-rate-limit", () => ({
  default: vi.fn(() => (_req, _res, next) => next()),
  ipKeyGenerator: vi.fn((ip) => ip),
}));

import { AssetIssuerManager, AssetIssuerErrorRecovery, assetIssuerManager, createAssetIssuerRateLimits } from "../src/lib/asset-issuer.js";
import { Transaction } from "stellar-sdk";

const ISSUER = "GBRPYHIL2CI3WHZKYYXY5UYSZES3IQNB54GQMVWHTFXNAXN3C5GKQCVX";
const TX_HASH = "a".repeat(64);

const usdcAsset = (issuer = ISSUER) => ({
  isNative: () => false,
  getCode: () => "USDC",
  getIssuer: () => issuer,
});

const validSignature = {
  valid: true,
  reason: "Signature verified",
  isMultiSig: false,
  signatureCount: 1,
  thresholdMet: true,
};

/** Horizon response shaped like a decoded transaction envelope. */
const horizonTx = { envelope_xdr: "AAAA...", source_account: ISSUER };

describe("Asset Issuer end-to-end (#1051)", () => {
  let manager;

  beforeEach(() => {
    manager = new AssetIssuerManager();
    AssetIssuerErrorRecovery.resetCircuitBreaker();
    manager.invalidateQueryCache();
    vi.clearAllMocks();
  });

  afterEach(() => {
    manager.invalidateQueryCache();
    vi.clearAllMocks();
  });

  describe("verification flow", () => {
    it("verifies a valid payment transaction end to end", async () => {
      mockVerifyTransactionSignature.mockResolvedValue(validSignature);
      mockWithHorizonRetry.mockResolvedValue(horizonTx);
      Transaction.mockImplementation(() => ({
        operations: [{ type: "payment", asset: usdcAsset(), amount: "100" }],
      }));

      const result = await manager.verifyAssetIssuerTransaction(TX_HASH, {
        expectedOperation: "payment",
        expectedAssetCode: "USDC",
        expectedAssetIssuer: ISSUER,
      });

      expect(result.valid).toBe(true);
      expect(result.assetIssuerSpecific).toBe(true);
      expect(result.assetCode).toBe("USDC");
      expect(result.assetIssuer).toBe(ISSUER);
      expect(result.operationType).toBe("payment");
    });

    it("rejects a transaction whose issuer does not match the expectation", async () => {
      mockVerifyTransactionSignature.mockResolvedValue(validSignature);
      mockWithHorizonRetry.mockResolvedValue(horizonTx);
      Transaction.mockImplementation(() => ({
        operations: [{ type: "payment", asset: usdcAsset("GOTHER"), amount: "100" }],
      }));

      const result = await manager.verifyAssetIssuerTransaction(TX_HASH, {
        expectedAssetIssuer: ISSUER,
      });

      expect(result.valid).toBe(false);
      expect(result.reason).toContain("Asset issuer mismatch");
    });

    it("rejects a transaction with no asset-related operations", async () => {
      mockVerifyTransactionSignature.mockResolvedValue(validSignature);
      mockWithHorizonRetry.mockResolvedValue(horizonTx);
      Transaction.mockImplementation(() => ({ operations: [{ type: "createAccount" }] }));

      const result = await manager.verifyAssetIssuerTransaction(TX_HASH);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain("No asset-related operations");
    });

    it("serves a repeated verification from the verification cache", async () => {
      mockVerifyTransactionSignature.mockResolvedValue(validSignature);
      mockWithHorizonRetry.mockResolvedValue(horizonTx);
      Transaction.mockImplementation(() => ({
        operations: [{ type: "payment", asset: usdcAsset(), amount: "100" }],
      }));

      await manager.verifyAssetIssuerTransaction(TX_HASH);
      await manager.verifyAssetIssuerTransaction(TX_HASH);

      expect(mockVerifyTransactionSignature).toHaveBeenCalledTimes(1);
    });
  });

  describe("on-chain issuer verification", () => {
    it("confirms an issuer that exists on Horizon", async () => {
      mockWithHorizonRetry.mockResolvedValue({ id: ISSUER });

      await expect(AssetIssuerErrorRecovery.verifyIssuerOnChain(ISSUER)).resolves.toBe(true);
    });

    it("returns false for an issuer Horizon does not know", async () => {
      const notFound = new Error("not found");
      notFound.status = 404;
      mockWithHorizonRetry.mockRejectedValue(notFound);

      await expect(AssetIssuerErrorRecovery.verifyIssuerOnChain(ISSUER)).resolves.toBe(false);
    });
  });

  describe("merchant issuer configuration", () => {
    it("returns health metrics alongside circuit breaker state", async () => {
      mockQueryWithRetry.mockResolvedValue({
        rows: [{ asset: "USDC", asset_issuer: ISSUER, total_payments: 10, failure_rate_percent: 0 }],
      });

      const config = await manager.getMerchantIssuerConfig("merchant-1");

      expect(config.healthMetrics).toHaveLength(1);
      expect(config.circuitBreakers).toBeDefined();
      expect(new Date(config.timestamp).toString()).not.toBe("Invalid Date");
    });

    it("serves a repeated configuration read from the query cache (#1050)", async () => {
      mockQueryWithRetry.mockResolvedValue({ rows: [] });

      await manager.getMerchantIssuerConfig("merchant-1");
      await manager.getMerchantIssuerConfig("merchant-1");

      expect(mockQueryWithRetry).toHaveBeenCalledTimes(1);
    });
  });

  describe("verification logging", () => {
    it("persists a verification record and invalidates the cached reads", async () => {
      mockQueryWithRetry.mockResolvedValue({ rows: [{ id: "v1" }] });
      mockVerifyTransactionSignature.mockResolvedValue(validSignature);
      mockWithHorizonRetry.mockResolvedValue(horizonTx);
      Transaction.mockImplementation(() => ({
        operations: [{ type: "payment", asset: usdcAsset(), amount: "100" }],
      }));

      const verification = await manager.verifyAssetIssuerTransaction(TX_HASH);
      expect(verification.valid).toBe(true);

      const logged = await manager.queryOptimizer.logAssetIssuerVerification({
        merchantId: "merchant-1",
        txHash: TX_HASH,
        assetCode: "USDC",
        assetIssuer: ISSUER,
        verification,
      });

      expect(logged.rows[0].id).toBe("v1");
      expect(mockQueryWithRetry).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO asset_issuer_verifications"),
        expect.arrayContaining(["merchant-1", "USDC", ISSUER]),
      );
    });

    it("refuses to log without a verification result", async () => {
      await expect(
        manager.queryOptimizer.logAssetIssuerVerification({ merchantId: "merchant-1", txHash: TX_HASH }),
      ).rejects.toThrow("requires a verification result");

      expect(mockQueryWithRetry).not.toHaveBeenCalled();
    });
  });

  describe("degradation and recovery", () => {
    it("falls back when the operation fails and the fallback succeeds", async () => {
      const clientError = new Error("bad request");
      clientError.status = 400;
      mockQueryWithRetry.mockRejectedValue(clientError);

      const result = await AssetIssuerErrorRecovery.executeWithRecovery(
        () => mockQueryWithRetry("SELECT 1", []),
        "e2e context",
        { fallback: () => Promise.resolve({ rows: [], degraded: true }) },
      );

      expect(result).toEqual({ rows: [], degraded: true });
    });

    it("opens the circuit after repeated failures and stops calling the database", async () => {
      const clientError = new Error("bad request");
      clientError.status = 400;
      mockQueryWithRetry.mockRejectedValue(clientError);

      for (let i = 0; i < 5; i++) {
        await expect(
          AssetIssuerErrorRecovery.executeWithRecovery(
            () => mockQueryWithRetry("SELECT 1", []),
            "circuit-e2e",
          ),
        ).rejects.toThrow();
      }

      expect(AssetIssuerErrorRecovery.isCircuitBreakerOpen("circuit-e2e")).toBe(true);

      const callsBefore = mockQueryWithRetry.mock.calls.length;
      await expect(
        AssetIssuerErrorRecovery.executeWithRecovery(
          () => mockQueryWithRetry("SELECT 1", []),
          "circuit-e2e",
        ),
      ).rejects.toThrow("Circuit breaker is open");

      // The open breaker short-circuits before any further database work.
      expect(mockQueryWithRetry.mock.calls.length).toBe(callsBefore);
    });

    it("records exhausted operations in the dead letter queue", async () => {
      const clientError = new Error("bad request");
      clientError.status = 400;
      mockQueryWithRetry.mockRejectedValue(clientError);

      await expect(
        AssetIssuerErrorRecovery.executeWithRecovery(
          () => mockQueryWithRetry("SELECT 1", []),
          "dlq-e2e",
        ),
      ).rejects.toThrow();

      const queue = manager.getDeadLetterQueue();
      expect(queue.some((entry) => entry.context === "dlq-e2e")).toBe(true);

      expect(manager.errorRecovery.drainDeadLetterQueue()).toHaveLength(queue.length);
      expect(manager.getDeadLetterQueue()).toHaveLength(0);
    });
  });

  describe("module surface", () => {
    it("exposes a ready-to-use singleton", async () => {
      mockQueryWithRetry.mockResolvedValue({ rows: [] });

      const config = await assetIssuerManager.getMerchantIssuerConfig("merchant-1");

      expect(config.healthMetrics).toEqual([]);
    });

    it("initialises and reports index creation", async () => {
      mockQueryWithRetry.mockResolvedValue({ rows: [] });

      const result = await manager.initialize();

      expect(result.success).toBe(true);
      expect(result.indexResults).toHaveLength(4);
    });

    it("builds rate limiters for a Redis-backed deployment", () => {
      const limits = createAssetIssuerRateLimits({ isOpen: true, sendCommand: vi.fn() });

      expect(limits.standard).toBeDefined();
      expect(limits.burst).toBeDefined();
    });

    it("keeps the verification cache bounded across many transactions (#1312)", async () => {
      mockVerifyTransactionSignature.mockResolvedValue(validSignature);
      mockWithHorizonRetry.mockResolvedValue(horizonTx);
      Transaction.mockImplementation(() => ({
        operations: [{ type: "payment", asset: usdcAsset(), amount: "100" }],
      }));

      for (let i = 0; i < 1100; i++) {
        await manager.verifyAssetIssuerTransaction(`${i}${TX_HASH}`);
      }

      const stats = manager.signatureVerifier.verificationCache;
      expect(stats.size).toBe(1000);
    });

    it("leaves no in-flight verification behind after each call (#1315)", async () => {
      mockVerifyTransactionSignature.mockResolvedValue(validSignature);
      mockWithHorizonRetry.mockResolvedValue(horizonTx);
      Transaction.mockImplementation(() => ({
        operations: [{ type: "payment", asset: usdcAsset(), amount: "100" }],
      }));

      await manager.verifyAssetIssuerTransaction(TX_HASH);

      expect(manager.signatureVerifier.pendingVerifications.size).toBe(0);
    });
  });
});
