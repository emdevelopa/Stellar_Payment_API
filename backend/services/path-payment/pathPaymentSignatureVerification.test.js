import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockVerifyTransactionSignature, mockMetrics } = vi.hoisted(() => ({
  mockVerifyTransactionSignature: vi.fn(),
  mockMetrics: {
    signatureVerificationTotal: { inc: vi.fn() },
    signatureVerificationDuration: { observe: vi.fn() },
    signatureVerificationReplayAttempts: { inc: vi.fn() },
  },
}));

vi.mock("../../src/lib/stellar.js", () => ({
  verifyTransactionSignature: mockVerifyTransactionSignature,
}));

vi.mock("../../src/lib/metrics.js", () => ({
  signatureVerificationTotal: mockMetrics.signatureVerificationTotal,
  signatureVerificationDuration: mockMetrics.signatureVerificationDuration,
  signatureVerificationReplayAttempts: mockMetrics.signatureVerificationReplayAttempts,
}));

vi.mock("../../src/lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  signPaymentPayload,
  verifyPaymentPayloadSignature,
  verifyRequestTimestamp,
  signRequestTimestamp,
  computeTransactionHash,
  verifyReplayProtection,
  verifyPaymentTransactionSignature,
  invalidateSignatureCache,
  clearSignatureCache,
  paymentSignatureVerifier,
} from "../../src/lib/payment-signature-verification.js";

const SECRET = "test-secret-key-32-chars-minimum!!";
const TX_HASH = "a".repeat(64);

describe("signPaymentPayload / verifyPaymentPayloadSignature", () => {
  it("signs and verifies a string payload", () => {
    const payload = JSON.stringify({ amount: "10", asset: "USDC" });
    const sig = signPaymentPayload(payload, SECRET);
    expect(verifyPaymentPayloadSignature(payload, sig, SECRET)).toBe(true);
  });

  it("signs and verifies an object payload", () => {
    const payload = { amount: "10", asset: "USDC" };
    const sig = signPaymentPayload(payload, SECRET);
    expect(verifyPaymentPayloadSignature(payload, sig, SECRET)).toBe(true);
  });

  it("accepts sha256= prefixed signature", () => {
    const payload = "hello";
    const sig = `sha256=${signPaymentPayload(payload, SECRET)}`;
    expect(verifyPaymentPayloadSignature(payload, sig, SECRET)).toBe(true);
  });

  it("rejects a tampered signature", () => {
    const payload = "hello";
    const sig = signPaymentPayload(payload, SECRET);
    const tampered = sig.slice(0, -2) + "00";
    expect(verifyPaymentPayloadSignature(payload, tampered, SECRET)).toBe(false);
  });

  it("rejects a tampered payload", () => {
    const payload = "original";
    const sig = signPaymentPayload(payload, SECRET);
    expect(verifyPaymentPayloadSignature("tampered", sig, SECRET)).toBe(false);
  });

  it("rejects non-hex signatures", () => {
    expect(verifyPaymentPayloadSignature("data", "not-a-hex", SECRET)).toBe(false);
  });

  it("throws when secret is missing", () => {
    expect(() => signPaymentPayload("data", "")).toThrow();
  });

  it("returns false when payload, signature, or secret is missing", () => {
    expect(verifyPaymentPayloadSignature(null, "sig", SECRET)).toBe(false);
    expect(verifyPaymentPayloadSignature("data", null, SECRET)).toBe(false);
    expect(verifyPaymentPayloadSignature("data", "sig", null)).toBe(false);
  });
});

describe("verifyRequestTimestamp", () => {
  it("accepts a fresh timestamp", () => {
    const ts = Math.floor(Date.now() / 1000);
    const sig = signRequestTimestamp(ts, SECRET);
    expect(verifyRequestTimestamp(ts, sig, SECRET)).toBe(true);
  });

  it("rejects an expired timestamp", () => {
    const stale = Math.floor(Date.now() / 1000) - 400;
    const sig = signRequestTimestamp(stale, SECRET);
    expect(verifyRequestTimestamp(stale, sig, SECRET)).toBe(false);
  });

  it("accepts within custom tolerance", () => {
    const ts = Math.floor(Date.now() / 1000) - 10;
    const sig = signRequestTimestamp(ts, SECRET);
    expect(verifyRequestTimestamp(ts, sig, SECRET, 60)).toBe(true);
  });

  it("rejects non-numeric timestamp", () => {
    expect(verifyRequestTimestamp("abc", "sig", SECRET)).toBe(false);
  });

  it("returns false when any argument is missing", () => {
    expect(verifyRequestTimestamp(null, "sig", SECRET)).toBe(false);
    expect(verifyRequestTimestamp(Date.now(), null, SECRET)).toBe(false);
  });
});

describe("computeTransactionHash", () => {
  it("returns a 64-char hex string", () => {
    const hash = computeTransactionHash({ amount: "10", asset: "XLM" });
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is deterministic for the same input", () => {
    const payload = { amount: "5", asset: "USDC" };
    expect(computeTransactionHash(payload)).toBe(computeTransactionHash(payload));
  });

  it("differs for different inputs", () => {
    expect(computeTransactionHash({ a: 1 })).not.toBe(computeTransactionHash({ a: 2 }));
  });
});

describe("verifyReplayProtection", () => {
  beforeEach(() => {
    clearSignatureCache();
  });

  it("allows a tx hash the first time", () => {
    expect(verifyReplayProtection(TX_HASH, "merchant-1")).toBe(true);
  });

  it("rejects the same tx hash the second time (replay)", () => {
    verifyReplayProtection(TX_HASH, "merchant-1");
    expect(verifyReplayProtection(TX_HASH, "merchant-1")).toBe(false);
  });

  it("increments replay metric on replay attempt", () => {
    verifyReplayProtection(TX_HASH, "merchant-2");
    verifyReplayProtection(TX_HASH, "merchant-2");
    expect(mockMetrics.signatureVerificationReplayAttempts.inc).toHaveBeenCalled();
  });

  it("allows same tx hash for different merchants", () => {
    verifyReplayProtection(TX_HASH, "merchant-A");
    expect(verifyReplayProtection(TX_HASH, "merchant-B")).toBe(true);
  });
});

describe("verifyPaymentTransactionSignature", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSignatureCache();
  });

  it("returns invalid for missing tx hash", async () => {
    const result = await verifyPaymentTransactionSignature(null);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/Invalid/i);
  });

  it("returns invalid for non-string tx hash", async () => {
    const result = await verifyPaymentTransactionSignature(12345);
    expect(result.valid).toBe(false);
  });

  it("returns valid when verifyTransactionSignature returns true", async () => {
    mockVerifyTransactionSignature.mockResolvedValueOnce(true);
    const result = await verifyPaymentTransactionSignature(TX_HASH);
    expect(result.valid).toBe(true);
  });

  it("returns invalid when verifyTransactionSignature returns false", async () => {
    mockVerifyTransactionSignature.mockResolvedValueOnce(false);
    const result = await verifyPaymentTransactionSignature(TX_HASH);
    expect(result.valid).toBe(false);
  });

  it("returns structured result from verifyTransactionSignature", async () => {
    mockVerifyTransactionSignature.mockResolvedValueOnce({
      valid: true,
      isMultiSig: true,
      signatureCount: 2,
      thresholdMet: true,
    });
    const result = await verifyPaymentTransactionSignature(TX_HASH);
    expect(result.valid).toBe(true);
    expect(result.isMultiSig).toBe(true);
    expect(result.signatureCount).toBe(2);
    expect(result.cached).toBe(false);
  });

  it("caches results and returns cache hit on second call", async () => {
    mockVerifyTransactionSignature.mockResolvedValueOnce({ valid: true, isMultiSig: false, signatureCount: 1, thresholdMet: true });
    await verifyPaymentTransactionSignature(TX_HASH, { merchantId: "m1" });
    const cached = await verifyPaymentTransactionSignature(TX_HASH, { merchantId: "m1" });
    expect(cached.cached).toBe(true);
    expect(mockVerifyTransactionSignature).toHaveBeenCalledTimes(1);
  });

  it("skips cache when useCache=false", async () => {
    mockVerifyTransactionSignature.mockResolvedValue({ valid: true, isMultiSig: false, signatureCount: 1, thresholdMet: true });
    await verifyPaymentTransactionSignature(TX_HASH, { merchantId: "m2", useCache: false });
    await verifyPaymentTransactionSignature(TX_HASH, { merchantId: "m2", useCache: false });
    expect(mockVerifyTransactionSignature).toHaveBeenCalledTimes(2);
  });

  it("returns invalid and records error metric on unexpected throw", async () => {
    mockVerifyTransactionSignature.mockRejectedValueOnce(new Error("network down"));
    const result = await verifyPaymentTransactionSignature(TX_HASH);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/network down/);
    expect(mockMetrics.signatureVerificationTotal.inc).toHaveBeenCalledWith({ result: "error" });
  });

  it("respects invalidateSignatureCache", async () => {
    mockVerifyTransactionSignature.mockResolvedValue({ valid: true, isMultiSig: false, signatureCount: 1, thresholdMet: true });
    await verifyPaymentTransactionSignature(TX_HASH, { merchantId: "m3" });
    invalidateSignatureCache(TX_HASH, "m3");
    await verifyPaymentTransactionSignature(TX_HASH, { merchantId: "m3" });
    expect(mockVerifyTransactionSignature).toHaveBeenCalledTimes(2);
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
