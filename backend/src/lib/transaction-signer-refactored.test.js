/**
 * Tests for the refactored Transaction Signer module (Issue #1077)
 *
 * Covers the ReplayCache class, verifyTransactionSignatureSecure with caching,
 * and the validation/metrics helpers.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockVerifyTransactionSignature } = vi.hoisted(() => ({
  mockVerifyTransactionSignature: vi.fn(),
}));

vi.mock("./stellar.js", () => ({
  verifyTransactionSignature: (...args) => mockVerifyTransactionSignature(...args),
  findMatchingPayment: vi.fn(),
  findAnyRecentPayment: vi.fn(),
}));

vi.mock("./supabase.js", () => ({
  supabase: { from: vi.fn() },
}));

vi.mock("./stream-manager.js", () => ({
  streamManager: { notify: vi.fn() },
}));

vi.mock("./redis.js", () => ({
  connectRedisClient: vi.fn(async () => ({ isOpen: false })),
  invalidatePaymentCache: vi.fn(),
}));

vi.mock("./webhooks.js", () => ({
  sendWebhook: vi.fn(),
  isEventSubscribed: vi.fn(),
}));

vi.mock("./email.js", () => ({
  sendReceiptEmail: vi.fn(),
}));

vi.mock("./email-templates.js", () => ({
  renderReceiptEmail: vi.fn(),
}));

vi.mock("../webhooks/resolver.js", () => ({
  getPayloadForVersion: vi.fn(),
}));

const mockMetrics = vi.hoisted(() => ({
  txSignatureVerificationTotal: { inc: vi.fn() },
  txSignatureVerificationLatency: { startTimer: vi.fn(() => vi.fn()) },
  txSignatureVerificationErrors: { inc: vi.fn() },
  txSignatureReplayAttempts: { inc: vi.fn() },
  txSignatureCacheSize: { set: vi.fn() },
  txSignatureValidationFailures: { inc: vi.fn() },
}));

vi.mock("./metrics.js", () => mockMetrics);

vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("./transaction-signer-cache.js", () => {
  const cacheStore = new Map();
  const mockCache = {
    get: vi.fn(async (txHash) => {
      const entry = cacheStore.get(txHash);
      if (entry) return { result: entry.result, hit: true };
      return { result: null, hit: false };
    }),
    set: vi.fn(async (txHash, result, valid) => {
      cacheStore.set(txHash, { result, valid });
    }),
    invalidate: vi.fn(async (txHash) => {
      if (txHash) cacheStore.delete(txHash);
      else cacheStore.clear();
    }),
    prune: vi.fn(() => 0),
    clear: vi.fn(() => cacheStore.clear()),
    getStats: vi.fn(() => ({ size: cacheStore.size })),
  };
  return {
    getTransactionSignerCache: vi.fn(() => mockCache),
    resetTransactionSignerCacheForTest: vi.fn(() => cacheStore.clear()),
  };
});

// ── Import after mocks ────────────────────────────────────────────────────────

import {
  validateTxHash,
  verifyTransactionSignatureSecure,
  clearReplayCache,
} from "./transaction-signer.js";
import { resetTransactionSignerCacheForTest } from "./transaction-signer-cache.js";

const VALID_TX_HASH = "a".repeat(64);

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Transaction Signer — Refactored Module (Issue #1077)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearReplayCache();
    resetTransactionSignerCacheForTest();

    mockVerifyTransactionSignature.mockResolvedValue({
      valid: true,
      reason: "ok",
      isMultiSig: false,
      signatureCount: 1,
      thresholdMet: true,
    });
  });

  // ── validateTxHash ──────────────────────────────────────────────────────────

  describe("validateTxHash()", () => {
    it("returns valid=true for a proper 64-char hex string", () => {
      expect(validateTxHash(VALID_TX_HASH)).toEqual({ valid: true });
    });

    it("accepts uppercase hex", () => {
      expect(validateTxHash("A".repeat(64))).toEqual({ valid: true });
    });

    it("rejects null", () => {
      const result = validateTxHash(null);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/non-empty string/);
    });

    it("rejects empty string", () => {
      expect(validateTxHash("").valid).toBe(false);
    });

    it("rejects strings shorter than 64 chars", () => {
      expect(validateTxHash("abc123").valid).toBe(false);
    });

    it("rejects non-hex characters", () => {
      expect(validateTxHash("g".repeat(64)).valid).toBe(false);
    });
  });

  // ── ReplayCache (via verifyTransactionSignatureSecure) ──────────────────────

  describe("ReplayCache integration", () => {
    it("rejects duplicate verification requests within TTL", async () => {
      const res1 = await verifyTransactionSignatureSecure(VALID_TX_HASH);
      expect(res1.valid).toBe(true);

      // Replay should be detected
      const res2 = await verifyTransactionSignatureSecure(VALID_TX_HASH);
      expect(res2.valid).toBe(false);
      expect(res2.replay).toBe(true);
      expect(res2.reason).toMatch(/replay/);
      expect(mockMetrics.txSignatureReplayAttempts.inc).toHaveBeenCalled();
    });

    it("clearReplayCache resets state for re-verification", async () => {
      await verifyTransactionSignatureSecure(VALID_TX_HASH);
      clearReplayCache();

      // Should succeed again after clearing
      const res = await verifyTransactionSignatureSecure(VALID_TX_HASH);
      expect(res.valid).toBe(true);
    });

    it("allows different txHash values in sequence", async () => {
      const hash1 = "a".repeat(64);
      const hash2 = "b".repeat(64);

      const res1 = await verifyTransactionSignatureSecure(hash1);
      expect(res1.valid).toBe(true);

      const res2 = await verifyTransactionSignatureSecure(hash2);
      expect(res2.valid).toBe(true);
    });
  });

  // ── Cache integration ──────────────────────────────────────────────────────

  describe("Verification cache integration", () => {
    it("serves cached result without calling Horizon verifier again", async () => {
      const res1 = await verifyTransactionSignatureSecure(VALID_TX_HASH);
      expect(res1.valid).toBe(true);
      expect(mockVerifyTransactionSignature).toHaveBeenCalledTimes(1);

      clearReplayCache();

      const res2 = await verifyTransactionSignatureSecure(VALID_TX_HASH);
      expect(res2.valid).toBe(true);
      // Core verifier should NOT be called again (cache hit)
      expect(mockVerifyTransactionSignature).toHaveBeenCalledTimes(1);
    });
  });

  // ── Concurrency (Issues #1340, #1341) ───────────────────────────────────────

  describe("Concurrent duplicate requests", () => {
    it("dedupes concurrent verifications of the same txHash into a single core-verifier call", async () => {
      // Before the fix: the replay check and replay record are separated by
      // an async Horizon call, so two concurrent requests for the same hash
      // would both pass the "not yet replayed" check and both invoke the
      // core verifier independently.
      const results = await Promise.all([
        verifyTransactionSignatureSecure(VALID_TX_HASH),
        verifyTransactionSignatureSecure(VALID_TX_HASH),
        verifyTransactionSignatureSecure(VALID_TX_HASH),
      ]);

      for (const res of results) {
        expect(res.valid).toBe(true);
      }
      expect(mockVerifyTransactionSignature).toHaveBeenCalledTimes(1);
    });

    it("returns a consistent result to every concurrent caller, not divergent ones", async () => {
      const results = await Promise.all([
        verifyTransactionSignatureSecure(VALID_TX_HASH),
        verifyTransactionSignatureSecure(VALID_TX_HASH),
      ]);

      expect(results[0]).toBe(results[1]);
    });

    it("does not report a false replay between two concurrent requests for the same hash", async () => {
      // Neither concurrent call should see "replay: txHash was already
      // verified" — that would only be correct for a *second, later* request
      // after the first has actually completed and recorded the hash.
      const results = await Promise.all([
        verifyTransactionSignatureSecure(VALID_TX_HASH),
        verifyTransactionSignatureSecure(VALID_TX_HASH),
      ]);

      for (const res of results) {
        expect(res.replay).toBeFalsy();
      }
    });

    it("still runs a fresh verification for a later, non-concurrent request after the in-flight one resolves", async () => {
      await verifyTransactionSignatureSecure(VALID_TX_HASH);
      expect(mockVerifyTransactionSignature).toHaveBeenCalledTimes(1);

      clearReplayCache();
      resetTransactionSignerCacheForTest();

      await verifyTransactionSignatureSecure(VALID_TX_HASH);
      expect(mockVerifyTransactionSignature).toHaveBeenCalledTimes(2);
    });

    it("dedupes concurrent requests independently per distinct txHash", async () => {
      const otherHash = "b".repeat(64);

      await Promise.all([
        verifyTransactionSignatureSecure(VALID_TX_HASH),
        verifyTransactionSignatureSecure(otherHash),
      ]);

      expect(mockVerifyTransactionSignature).toHaveBeenCalledTimes(2);
    });
  });

  // ── Error handling ──────────────────────────────────────────────────────────

  describe("Error handling", () => {
    it("returns valid=false when core verifier throws", async () => {
      mockVerifyTransactionSignature.mockRejectedValue(new Error("Horizon down"));

      const res = await verifyTransactionSignatureSecure(VALID_TX_HASH);
      expect(res.valid).toBe(false);
      expect(res.reason).toMatch(/Horizon down/);
    });

    it("returns valid=false when verifier returns null", async () => {
      mockVerifyTransactionSignature.mockResolvedValue(null);

      const res = await verifyTransactionSignatureSecure(VALID_TX_HASH);
      expect(res.valid).toBe(false);
      expect(res.reason).toMatch(/verifier returned no result/);
    });

    it("returns valid=false when format validation fails", async () => {
      const res = await verifyTransactionSignatureSecure("invalid");
      expect(res.valid).toBe(false);
      expect(res.reason).toMatch(/64 lowercase hex/);
      expect(mockMetrics.txSignatureVerificationErrors.inc).toHaveBeenCalledWith({
        error_type: "validation_failure",
      });
    });

    it("records exception metrics when verifier throws", async () => {
      mockVerifyTransactionSignature.mockRejectedValue(new Error("crash"));

      await verifyTransactionSignatureSecure(VALID_TX_HASH);
      expect(mockMetrics.txSignatureVerificationErrors.inc).toHaveBeenCalledWith({
        error_type: "verification_exception",
      });
    });
  });

  // ── Metrics ─────────────────────────────────────────────────────────────────

  describe("Metrics recording", () => {
    it("records valid outcome metric on success", async () => {
      await verifyTransactionSignatureSecure(VALID_TX_HASH);
      expect(mockMetrics.txSignatureVerificationTotal.inc).toHaveBeenCalledWith({
        outcome: "valid",
      });
    });

    it("records invalid outcome metric on failure", async () => {
      mockVerifyTransactionSignature.mockResolvedValue({
        valid: false,
        reason: "bad sig",
      });

      await verifyTransactionSignatureSecure(VALID_TX_HASH);
      expect(mockMetrics.txSignatureVerificationTotal.inc).toHaveBeenCalledWith({
        outcome: "invalid",
      });
    });

    it("always calls the latency timer", async () => {
      await verifyTransactionSignatureSecure(VALID_TX_HASH);
      expect(mockMetrics.txSignatureVerificationLatency.startTimer).toHaveBeenCalled();
    });
  });
});
