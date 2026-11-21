import { describe, expect, it, vi } from "vitest";
import * as StellarSdk from "stellar-sdk";
import {
  amountsMatch,
  classifyAmount,
  isValidAssetCode,
  isValidStellarAccountId,
  isValidStellarPublicKey,
  isValidTransactionHash,
  resolveAsset,
  validateMemo,
} from "./validators.js";
import { verifyTransactionSignature } from "./signature-verification.js";

const NETWORK_PASSPHRASE = StellarSdk.Networks.TESTNET;

function makeTransaction(signer) {
  const destination = StellarSdk.Keypair.random();
  const transaction = new StellarSdk.TransactionBuilder(
    new StellarSdk.Account(signer.publicKey(), "1"),
    {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    }
  )
    .addOperation(
      StellarSdk.Operation.payment({
        destination: destination.publicKey(),
        asset: StellarSdk.Asset.native(),
        amount: "1",
      })
    )
    .setTimeout(60)
    .build();

  transaction.sign(signer);
  return transaction;
}

function makeHorizonClient(transaction, signers = []) {
  return {
    fetchTransaction: vi.fn().mockResolvedValue({
      envelope_xdr: transaction.toEnvelope().toXDR("base64"),
    }),
    loadAccount: vi.fn().mockResolvedValue({
      thresholds: { med_threshold: 1 },
      signers,
    }),
  };
}

describe("Stellar account and ledger-key validation against the real SDK", () => {
  const keypair = StellarSdk.Keypair.random();

  it("accepts valid Ed25519 account keys and rejects malformed or bad-checksum keys", () => {
    const publicKey = keypair.publicKey();
    const alteredChecksum = `${publicKey.slice(0, -1)}${
      publicKey.endsWith("A") ? "B" : "A"
    }`;

    expect(isValidStellarPublicKey(publicKey)).toBe(true);
    expect(isValidStellarPublicKey(` ${publicKey} `)).toBe(true);
    expect(isValidStellarAccountId(publicKey)).toBe(true);
    expect(isValidStellarAccountId(` ${publicKey} `)).toBe(true);

    for (const invalid of [
      null,
      undefined,
      12,
      "",
      "G".repeat(56),
      alteredChecksum,
    ]) {
      expect(isValidStellarPublicKey(invalid)).toBe(false);
      expect(isValidStellarAccountId(invalid)).toBe(false);
    }
    expect(isValidStellarPublicKey(keypair.secret())).toBe(false);
  });

  it("validates issuer-backed assets and native XLM using Stellar SDK objects", () => {
    const issuer = keypair.publicKey();
    const native = resolveAsset(" xlm ");
    const custom = resolveAsset("usdc", issuer);

    expect(native.isNative()).toBe(true);
    expect(custom.isNative()).toBe(false);
    expect(custom.getCode()).toBe("USDC");
    expect(custom.getIssuer()).toBe(issuer);
    expect(() => resolveAsset("USDC")).toThrow("Asset issuer is required");
    expect(() => resolveAsset("BAD-CODE", issuer)).toThrow("Asset code must");
    expect(() => resolveAsset("USDC", "G".repeat(56))).toThrow(
      "valid Stellar public key"
    );
  });

  it("covers asset-code and transaction-hash format boundaries", () => {
    expect(isValidAssetCode(" usd1 ")).toBe(true);
    expect(isValidAssetCode("A".repeat(12))).toBe(true);
    expect(isValidAssetCode("A".repeat(13))).toBe(false);
    expect(isValidAssetCode("USD-1")).toBe(false);
    expect(isValidAssetCode(null)).toBe(false);

    expect(isValidTransactionHash("a".repeat(64))).toBe(true);
    expect(isValidTransactionHash("A".repeat(64))).toBe(true);
    expect(isValidTransactionHash("g".repeat(64))).toBe(false);
    expect(isValidTransactionHash("a".repeat(63))).toBe(false);
    expect(isValidTransactionHash(null)).toBe(false);
  });

  it("validates memo encoding, unsigned 64-bit bounds, and hash formats", () => {
    expect(validateMemo("é".repeat(14), "text")).toEqual({ valid: true });
    expect(validateMemo("é".repeat(15), "text").valid).toBe(false);
    expect(validateMemo("18446744073709551615", "id")).toEqual({ valid: true });
    expect(validateMemo("18446744073709551616", "id").valid).toBe(false);
    expect(validateMemo("-1", "id").valid).toBe(false);
    expect(validateMemo("a".repeat(64), "hash")).toEqual({ valid: true });
    expect(validateMemo("a".repeat(63), "hash").valid).toBe(false);
    expect(validateMemo("18446744073709551615", "return")).toEqual({
      valid: true,
    });
    expect(validateMemo("nope", "return").valid).toBe(false);
    expect(validateMemo("memo", "unknown").valid).toBe(false);
    expect(validateMemo(123, "text")).toEqual({
      valid: false,
      error: "Memo must be a string",
    });
    expect(validateMemo("memo", 12)).toEqual({
      valid: false,
      error: "Memo type must be a string",
    });
  });

  it("classifies amounts and rejects invalid amount comparisons", () => {
    expect(classifyAmount("1", "1.0000001")).toBe("exact");
    expect(classifyAmount("1", "1.0000002")).toBe("overpaid");
    expect(classifyAmount("2", "1")).toBe("underpaid");
    expect(classifyAmount("1", "2")).toBe("overpaid");
    expect(classifyAmount("invalid", "2")).toBe("exact");
    expect(amountsMatch("1", "1.0000001")).toBe(true);
    expect(amountsMatch("1", "1.0000002")).toBe(false);
    expect(amountsMatch("invalid", "1")).toBe(false);
  });
});

describe("verifyTransactionSignature with real Ed25519 signatures", () => {
  it("accepts a signed transaction when its authorized signer meets threshold", async () => {
    const signer = StellarSdk.Keypair.random();
    const transaction = makeTransaction(signer);
    const horizonClient = makeHorizonClient(transaction, [
      { key: signer.publicKey(), weight: 1 },
    ]);

    const result = await verifyTransactionSignature(
      horizonClient,
      transaction.hash().toString("hex"),
      NETWORK_PASSPHRASE,
      { maxRetries: 0 }
    );

    expect(result).toMatchObject({
      valid: true,
      thresholdMet: true,
      signatureCount: 1,
    });
    expect(horizonClient.fetchTransaction).toHaveBeenCalledOnce();
    expect(horizonClient.loadAccount).toHaveBeenCalledWith(signer.publicKey());
  });

  it("rejects a valid signature whose signer is not authorized by the source account", async () => {
    const signer = StellarSdk.Keypair.random();
    const unauthorizedSigner = StellarSdk.Keypair.random();
    const transaction = makeTransaction(signer);
    const horizonClient = makeHorizonClient(transaction, [
      { key: unauthorizedSigner.publicKey(), weight: 1 },
    ]);

    const result = await verifyTransactionSignature(
      horizonClient,
      transaction.hash().toString("hex"),
      NETWORK_PASSPHRASE,
      { maxRetries: 0 }
    );

    expect(result.valid).toBe(false);
    expect(result.thresholdMet).toBe(false);
    expect(result.reason).toMatch(/insufficient signing weight/i);
  });

  it("rejects a tampered Ed25519 signature from an otherwise authorized signer", async () => {
    const signer = StellarSdk.Keypair.random();
    const transaction = makeTransaction(signer);
    const envelope = transaction.toEnvelope();
    const signature = envelope.v1().signatures()[0];
    const corruptedSignature = Buffer.from(signature.signature());
    corruptedSignature[0] ^= 0xff;
    signature.signature(corruptedSignature);

    const horizonClient = makeHorizonClient(transaction, [
      { key: signer.publicKey(), weight: 1 },
    ]);
    horizonClient.fetchTransaction.mockResolvedValue({
      envelope_xdr: envelope.toXDR("base64"),
    });

    const result = await verifyTransactionSignature(
      horizonClient,
      transaction.hash().toString("hex"),
      NETWORK_PASSPHRASE,
      { maxRetries: 0 }
    );

    expect(result.valid).toBe(false);
    expect(result.thresholdMet).toBe(false);
    expect(result.reason).toMatch(/insufficient signing weight/i);
  });

  it("returns sanitized failures for missing envelopes and Horizon outages", async () => {
    const missingEnvelope = await verifyTransactionSignature(
      { fetchTransaction: vi.fn().mockResolvedValue({}), loadAccount: vi.fn() },
      "a".repeat(64),
      NETWORK_PASSPHRASE,
      { maxRetries: 0 }
    );
    expect(missingEnvelope.valid).toBe(false);
    expect(missingEnvelope.reason).toMatch(/missing the envelope XDR/i);

    const horizonFailure = await verifyTransactionSignature(
      {
        fetchTransaction: vi
          .fn()
          .mockRejectedValue(new Error("private endpoint details")),
        loadAccount: vi.fn(),
      },
      "b".repeat(64),
      NETWORK_PASSPHRASE,
      { maxRetries: 0 }
    );
    expect(horizonFailure.valid).toBe(false);
    expect(horizonFailure.reason).toBe(
      "Failed to fetch transaction from Horizon"
    );
    expect(horizonFailure.reason).not.toContain("private endpoint details");
  });
});
