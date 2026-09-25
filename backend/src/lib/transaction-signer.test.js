/**
 * Tests for cryptographic signature verification in the Transaction Signer
 * Issue #630 — Add cryptographic signature verification to Transaction Signer
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockTxCall, mockLoadAccount, mockVerify } = vi.hoisted(() => ({
  mockTxCall: vi.fn(),
  mockLoadAccount: vi.fn(),
  mockVerify: vi.fn(),
}));

vi.mock("stellar-sdk", () => {
  // Minimal Keypair mock that supports hint + verify
  const MockKeypair = {
    fromPublicKey: vi.fn((pk) => ({
      signatureHint: vi.fn(() => Buffer.from([0xde, 0xad, 0xbe, 0xef])),
      verify: mockVerify,
    })),
  };

  // Minimal Transaction mock
  const MockTransaction = vi.fn((xdr, passphrase) => ({
    source: "GABC123",
    hash: vi.fn(() => Buffer.from("txhashbytes")),
    signatures: [
      {
        hint: vi.fn(() => Buffer.from([0xde, 0xad, 0xbe, 0xef])),
        signature: vi.fn(() => Buffer.from("sigbytes")),
      },
    ],
  }));

  const MockServer = vi.fn(() => ({
    transactions: () => ({
      transaction: () => ({ call: mockTxCall }),
    }),
    loadAccount: mockLoadAccount,
    payments: () => ({
      forAccount: () => ({
        order: () => ({
          limit: () => ({ call: vi.fn().mockResolvedValue({ records: [] }) }),
        }),
      }),
    }),
    feeStats: vi.fn().mockResolvedValue({
      last_ledger_base_fee: "100",
      fee_charged: { mode: "100", p50: "100" },
      max_fee: { mode: "100" },
    }),
  }));

  const MockAsset = vi.fn((code, issuer) => ({ isNative: () => false, code, issuer }));
  MockAsset.native = vi.fn(() => ({ isNative: () => true }));

  return {
    Asset: MockAsset,
    Horizon: { Server: MockServer },
    Transaction: MockTransaction,
    Keypair: MockKeypair,
    Networks: { TESTNET: "Test SDF Network ; September 2015", PUBLIC: "Public Global Stellar Network ; September 2015" },
    TransactionBuilder: vi.fn(() => ({
      addOperation: vi.fn().mockReturnThis(),
      addMemo: vi.fn().mockReturnThis(),
      setTimeout: vi.fn().mockReturnThis(),
      build: vi.fn(() => ({
        toXDR: vi.fn(() => "xdr-string"),
        hash: vi.fn(() => Buffer.from("hash")),
      })),
    })),
    Operation: { payment: vi.fn() },
    Memo: { text: vi.fn() },
    BASE_FEE: "100",
  };
});

import { verifyTransactionSignature } from "./stellar.js";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("verifyTransactionSignature — cryptographic verification (Issue #630)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Input validation ────────────────────────────────────────────────────────

  describe("input validation", () => {
    it("returns valid=false for null txHash", async () => {
      const result = await verifyTransactionSignature(null);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/invalid transaction hash/i);
    });

    it("returns valid=false for empty string txHash", async () => {
      const result = await verifyTransactionSignature("");
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/invalid transaction hash/i);
    });

    it("returns valid=false for non-string txHash", async () => {
      const result = await verifyTransactionSignature(12345);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/invalid transaction hash/i);
    });
  });

  // ── Horizon fetch failure ───────────────────────────────────────────────────

  describe("Horizon fetch failure", () => {
    it("returns valid=false when Horizon returns 404", async () => {
      mockTxCall.mockRejectedValue({ response: { status: 404 } });

      const result = await verifyTransactionSignature("tx-not-found");
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/failed to fetch/i);
      expect(result.signatureCount).toBe(0);
    });

    it("returns valid=false on network error", async () => {
      mockTxCall.mockRejectedValue(new Error("ECONNREFUSED"));

      const result = await verifyTransactionSignature("tx-net-err");
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/failed to fetch/i);
    });

    it("returns valid=false on Horizon 500", async () => {
      mockTxCall.mockRejectedValue({ response: { status: 500 } });

      const result = await verifyTransactionSignature("tx-500");
      expect(result.valid).toBe(false);
    });
  });

  // ── XDR parse failure ───────────────────────────────────────────────────────

  describe("XDR parse failure", () => {
    it("returns valid=false when XDR cannot be parsed", async () => {
      mockTxCall.mockResolvedValue({ envelope_xdr: "bad-xdr" });

      // Make Transaction constructor throw
      const { Transaction } = await import("stellar-sdk");
      Transaction.mockImplementationOnce(() => {
        throw new Error("Invalid XDR");
      });

      const result = await verifyTransactionSignature("tx-bad-xdr");
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/failed to parse/i);
    });
  });

  // ── No signatures ───────────────────────────────────────────────────────────

  describe("no signatures in envelope", () => {
    it("returns valid=false when envelope has no signatures", async () => {
      mockTxCall.mockResolvedValue({ envelope_xdr: "valid-xdr" });

      const { Transaction } = await import("stellar-sdk");
      Transaction.mockImplementationOnce(() => ({
        source: "GABC123",
        hash: vi.fn(() => Buffer.from("txhashbytes")),
        signatures: [], // empty
      }));

      const result = await verifyTransactionSignature("tx-no-sigs");
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/no signatures/i);
      expect(result.signatureCount).toBe(0);
    });
  });

  // ── Account load failure ────────────────────────────────────────────────────

  describe("account load failure", () => {
    it("returns valid=false when source account cannot be loaded", async () => {
      mockTxCall.mockResolvedValue({ envelope_xdr: "valid-xdr" });
      mockLoadAccount.mockRejectedValue(new Error("account not found"));

      const result = await verifyTransactionSignature("tx-no-account");
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/could not load source account/i);
    });
  });

  // ── Successful single-sig verification ──────────────────────────────────────

  describe("successful single-sig verification", () => {
    it("returns valid=true when signature passes Ed25519 check and weight meets threshold", async () => {
      mockTxCall.mockResolvedValue({ envelope_xdr: "valid-xdr" });
      mockLoadAccount.mockResolvedValue({
        thresholds: { med_threshold: 1 },
        signers: [{ key: "GABC123", weight: 1 }],
      });
      mockVerify.mockReturnValue(true);

      const result = await verifyTransactionSignature("tx-valid");
      expect(result.valid).toBe(true);
      expect(result.thresholdMet).toBe(true);
      expect(result.signatureCount).toBe(1);
    });

    it("returns valid=true when threshold is 0 (any valid sig suffices)", async () => {
      mockTxCall.mockResolvedValue({ envelope_xdr: "valid-xdr" });
      mockLoadAccount.mockResolvedValue({
        thresholds: { med_threshold: 0 },
        signers: [{ key: "GABC123", weight: 1 }],
      });
      mockVerify.mockReturnValue(true);

      const result = await verifyTransactionSignature("tx-zero-threshold");
      expect(result.valid).toBe(true);
      expect(result.thresholdMet).toBe(true);
    });
  });

  // ── Security & Replay Prevention ────────────────────────────────────────────

  describe("security & replay prevention", () => {
    it("returns valid=false when the same signature is duplicated to artificially inflate weight", async () => {
      mockTxCall.mockResolvedValue({ envelope_xdr: "valid-xdr" });
      mockLoadAccount.mockResolvedValue({
        thresholds: { med_threshold: 2 },
        signers: [{ key: "GABC123", weight: 1 }],
      });
      
      const { Transaction } = await import("stellar-sdk");
      Transaction.mockImplementationOnce(() => ({
        source: "GABC123",
        hash: vi.fn(() => Buffer.from("txhashbytes")),
        signatures: [
          {
            hint: vi.fn(() => Buffer.from([0xde, 0xad, 0xbe, 0xef])),
            signature: vi.fn(() => Buffer.from("sigbytes")),
          },
          {
            hint: vi.fn(() => Buffer.from([0xde, 0xad, 0xbe, 0xef])),
            signature: vi.fn(() => Buffer.from("sigbytes")),
          },
        ],
      }));
      mockVerify.mockReturnValue(true);

      const result = await verifyTransactionSignature("tx-replay");
      expect(result.valid).toBe(false);
      expect(result.thresholdMet).toBe(false);
      expect(result.reason).toMatch(/insufficient signing weight/i);
    });
  });

  // ── Insufficient weight ─────────────────────────────────────────────────────

  describe("insufficient signing weight", () => {
    it("returns valid=false when accumulated weight is below medium threshold", async () => {
      mockTxCall.mockResolvedValue({ envelope_xdr: "valid-xdr" });
      mockLoadAccount.mockResolvedValue({
        thresholds: { med_threshold: 3 },
        signers: [{ key: "GABC123", weight: 1 }],
      });
      mockVerify.mockReturnValue(true);

      const result = await verifyTransactionSignature("tx-low-weight");
      expect(result.valid).toBe(false);
      expect(result.thresholdMet).toBe(false);
      expect(result.reason).toMatch(/insufficient signing weight/i);
    });

    it("returns valid=false when signature does not match any known signer", async () => {
      mockTxCall.mockResolvedValue({ envelope_xdr: "valid-xdr" });
      mockLoadAccount.mockResolvedValue({
        thresholds: { med_threshold: 1 },
        signers: [{ key: "GABC123", weight: 1 }],
      });
      // Ed25519 verify returns false — signature is invalid
      mockVerify.mockReturnValue(false);

      const result = await verifyTransactionSignature("tx-bad-sig");
      expect(result.valid).toBe(false);
      expect(result.thresholdMet).toBe(false);
    });
  });

  // ── Multi-sig detection ─────────────────────────────────────────────────────

  describe("multi-sig detection", () => {
    it("sets isMultiSig=true when account has multiple signers", async () => {
      mockTxCall.mockResolvedValue({ envelope_xdr: "valid-xdr" });
      mockLoadAccount.mockResolvedValue({
        thresholds: { med_threshold: 2 },
        signers: [
          { key: "GABC123", weight: 1 },
          { key: "GDEF456", weight: 1 },
        ],
      });
      mockVerify.mockReturnValue(true);

      const result = await verifyTransactionSignature("tx-multisig");
      expect(result.isMultiSig).toBe(true);
    });

    it("sets isMultiSig=false for single-signer account with threshold 1", async () => {
      mockTxCall.mockResolvedValue({ envelope_xdr: "valid-xdr" });
      mockLoadAccount.mockResolvedValue({
        thresholds: { med_threshold: 1 },
        signers: [{ key: "GABC123", weight: 1 }],
      });
      mockVerify.mockReturnValue(true);

      const result = await verifyTransactionSignature("tx-single");
      expect(result.isMultiSig).toBe(false);
    });
  });

  // ── Result shape ────────────────────────────────────────────────────────────

  describe("result shape", () => {
    it("always returns an object with valid, reason, isMultiSig, signatureCount, thresholdMet", async () => {
      mockTxCall.mockRejectedValue(new Error("network error"));

      const result = await verifyTransactionSignature("tx-shape-check");
      expect(result).toHaveProperty("valid");
      expect(result).toHaveProperty("reason");
      expect(result).toHaveProperty("isMultiSig");
      expect(result).toHaveProperty("signatureCount");
      expect(result).toHaveProperty("thresholdMet");
    });
  });
});
