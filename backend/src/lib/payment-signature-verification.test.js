import { describe, it, expect, beforeEach, vi } from "vitest";

const {
  mockVerifyTransactionSignature,
  mockSignatureVerificationTotal,
  mockSignatureVerificationDuration,
  mockSignatureVerificationReplayAttempts,
} = vi.hoisted(() => ({
  mockVerifyTransactionSignature: vi.fn(),
  mockSignatureVerificationTotal: { inc: vi.fn() },
  mockSignatureVerificationDuration: { observe: vi.fn() },
  mockSignatureVerificationReplayAttempts: { inc: vi.fn() },
}));

vi.mock("./stellar.js", () => ({
  verifyTransactionSignature: mockVerifyTransactionSignature,
}));

vi.mock("./metrics.js", () => ({
  signatureVerificationTotal: mockSignatureVerificationTotal,
  signatureVerificationDuration: mockSignatureVerificationDuration,
  signatureVerificationReplayAttempts: mockSignatureVerificationReplayAttempts,
}));

vi.mock("./logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  signPaymentPayload,
  verifyPaymentPayloadSignature,
  signRequestTimestamp,
  verifyRequestTimestamp,
  computeTransactionHash,
  verifyReplayProtection,
  verifyPaymentTransactionSignature,
  clearSignatureCache,
  paymentSignatureVerifier,
} from "./payment-signature-verification.js";

const TEST_SECRET = "whsec_test1234567890abcdef1234567890ab";

describe("payment-signature-verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSignatureCache();
  });

  describe("signPayload / verifyPayload", () => {
    it("signs a payload and verifies it successfully", () => {
      const payload = { payment_id: "pay_1", amount: 10.5 };
      const signature = signPaymentPayload(payload, TEST_SECRET);

      expect(signature).toMatch(/^[a-f0-9]{64}$/);
      expect(verifyPaymentPayloadSignature(payload, signature, TEST_SECRET)).toBe(true);
    });

    it("rejects invalid signature", () => {
      const payload = { payment_id: "pay_1" };
      const signature = signPaymentPayload(payload, TEST_SECRET);

      expect(verifyPaymentPayloadSignature(payload, "invalid_sig", TEST_SECRET)).toBe(false);
    });

    it("rejects wrong secret", () => {
      const payload = { payment_id: "pay_1" };
      const signature = signPaymentPayload(payload, TEST_SECRET);

      expect(verifyPaymentPayloadSignature(payload, signature, "wrong_secret")).toBe(false);
    });

    it("handles sha256= prefix in signature", () => {
      const payload = { payment_id: "pay_1" };
      const signature = signPaymentPayload(payload, TEST_SECRET);

      expect(verifyPaymentPayloadSignature(payload, `sha256=${signature}`, TEST_SECRET)).toBe(true);
    });

    it("rejects missing parameters", () => {
      expect(verifyPaymentPayloadSignature(null, "sig", TEST_SECRET)).toBe(false);
      expect(verifyPaymentPayloadSignature({}, null, TEST_SECRET)).toBe(false);
      expect(verifyPaymentPayloadSignature({}, "sig", null)).toBe(false);
    });

    it("throws when signing without secret", () => {
      expect(() => signPaymentPayload({}, null)).toThrow("Signing secret is required");
    });

    it("handles string payload", () => {
      const payload = "raw body string";
      const signature = signPaymentPayload(payload, TEST_SECRET);

      expect(verifyPaymentPayloadSignature(payload, signature, TEST_SECRET)).toBe(true);
    });
  });

  describe("signTimestamp / verifyTimestamp", () => {
    it("signs and verifies a timestamp within tolerance", () => {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signature = signRequestTimestamp(timestamp, TEST_SECRET);

      expect(signature).toMatch(/^[a-f0-9]{64}$/);
      expect(verifyRequestTimestamp(timestamp, signature, TEST_SECRET, 300)).toBe(true);
    });

    it("rejects expired timestamp", () => {
      const oldTimestamp = Math.floor(Date.now() / 1000 - 600).toString();
      const signature = signRequestTimestamp(oldTimestamp, TEST_SECRET);

      expect(verifyRequestTimestamp(oldTimestamp, signature, TEST_SECRET, 300)).toBe(false);
    });

    it("rejects invalid timestamp", () => {
      const signature = signRequestTimestamp("12345", TEST_SECRET);
      expect(verifyRequestTimestamp("not_a_number", signature, TEST_SECRET)).toBe(false);
    });
  });

  describe("computeTransactionHash", () => {
    it("produces consistent SHA-256 hashes", () => {
      const payload = { id: "pay_1", amount: 10 };
      const hash1 = computeTransactionHash(payload);
      const hash2 = computeTransactionHash(payload);

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    });

    it("produces different hashes for different payloads", () => {
      const hash1 = computeTransactionHash({ id: "pay_1" });
      const hash2 = computeTransactionHash({ id: "pay_2" });

      expect(hash1).not.toBe(hash2);
    });
  });

  describe("verifyReplayProtection", () => {
    it("allows first occurrence of a transaction", () => {
      expect(verifyReplayProtection("tx_1", "merchant_1")).toBe(true);
    });

    it("blocks duplicate transaction within window", () => {
      verifyReplayProtection("tx_1", "merchant_1");
      expect(verifyReplayProtection("tx_1", "merchant_1")).toBe(false);
      expect(mockSignatureVerificationReplayAttempts.inc).toHaveBeenCalled();
    });

    it("allows same tx_hash for different merchants", () => {
      verifyReplayProtection("tx_1", "merchant_1");
      expect(verifyReplayProtection("tx_1", "merchant_2")).toBe(true);
    });
  });

  describe("verifyPaymentTransactionSignature", () => {
    it("returns error for invalid txHash", async () => {
      const result = await verifyPaymentTransactionSignature(null);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe("Invalid transaction hash provided");
    });

    it("calls verifyTransactionSignature and normalizes result", async () => {
      mockVerifyTransactionSignature.mockResolvedValue({
        valid: true,
        reason: "passed",
        isMultiSig: false,
        signatureCount: 1,
        thresholdMet: true,
      });

      const result = await verifyPaymentTransactionSignature("tx_hash_123");

      expect(result.valid).toBe(true);
      expect(result.cached).toBe(false);
      expect(mockVerifyTransactionSignature).toHaveBeenCalledWith("tx_hash_123");
    });

    it("returns cached result on second call", async () => {
      mockVerifyTransactionSignature.mockResolvedValue({
        valid: true,
        reason: "passed",
        isMultiSig: false,
        signatureCount: 1,
        thresholdMet: true,
      });

      await verifyPaymentTransactionSignature("tx_hash_123");
      const result = await verifyPaymentTransactionSignature("tx_hash_123");

      expect(result.cached).toBe(true);
      expect(mockVerifyTransactionSignature).toHaveBeenCalledTimes(1);
    });

    it("handles legacy boolean result", async () => {
      mockVerifyTransactionSignature.mockResolvedValue(true);

      const result = await verifyPaymentTransactionSignature("tx_hash_456");

      expect(result.valid).toBe(true);
    });

    it("handles verification errors gracefully", async () => {
      mockVerifyTransactionSignature.mockRejectedValue(new Error("Horizon unavailable"));

      const result = await verifyPaymentTransactionSignature("tx_hash_789");

      expect(result.valid).toBe(false);
      expect(result.reason).toContain("Verification error");
    });
  });

  describe("paymentSignatureVerifier facade", () => {
    it("exposes all expected methods", () => {
      expect(typeof paymentSignatureVerifier.verifyTransaction).toBe("function");
      expect(typeof paymentSignatureVerifier.verifyPayload).toBe("function");
      expect(typeof paymentSignatureVerifier.verifyTimestamp).toBe("function");
      expect(typeof paymentSignatureVerifier.signPayload).toBe("function");
      expect(typeof paymentSignatureVerifier.signTimestamp).toBe("function");
      expect(typeof paymentSignatureVerifier.computeHash).toBe("function");
      expect(typeof paymentSignatureVerifier.checkReplay).toBe("function");
      expect(typeof paymentSignatureVerifier.invalidateCache).toBe("function");
      expect(typeof paymentSignatureVerifier.clearCache).toBe("function");
    });
  });
});
