/**
 * Cryptographic signature verification for fee-bump transactions in the
 * Ledger Monitor (Issue #908).
 *
 * The Ledger Monitor verifies the signature of every matched on-chain
 * transaction before confirming a payment. Fee-bump envelopes
 * (CAP-15) cannot be parsed by the plain `Transaction` constructor, so before
 * this fix the monitor rejected every fee-bumped payment. These tests use the
 * real Stellar SDK to build genuinely signed envelopes and assert the inner
 * transaction's signatures are verified (mocking only the Horizon server).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as StellarSdk from "stellar-sdk";

const { mockTxCall, mockLoadAccount } = vi.hoisted(() => ({
  mockTxCall: vi.fn(),
  mockLoadAccount: vi.fn(),
}));

// Mock ONLY the Horizon server; keep all SDK crypto (Transaction, Keypair,
// FeeBumpTransaction, TransactionBuilder, …) real.
vi.mock("stellar-sdk", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    Horizon: {
      ...actual.Horizon,
      Server: vi.fn(() => ({
        transactions: () => ({ transaction: () => ({ call: mockTxCall }) }),
        loadAccount: mockLoadAccount,
      })),
    },
  };
});

import { verifyTransactionSignature } from "./stellar.js";

const NET = StellarSdk.Networks.TESTNET;

/** Build a single-payment transaction from `sourceKp`. */
function buildInner(sourceKp) {
  const account = new StellarSdk.Account(sourceKp.publicKey(), "10");
  return new StellarSdk.TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: NET,
  })
    .addOperation(
      StellarSdk.Operation.payment({
        destination: StellarSdk.Keypair.random().publicKey(),
        asset: StellarSdk.Asset.native(),
        amount: "5",
      }),
    )
    .setTimeout(0)
    .build();
}

/** Horizon loadAccount stub exposing `signerKp` as the sole weight-1 signer. */
function accountWithSigner(signerKp) {
  return {
    signers: [{ key: signerKp.publicKey(), weight: 1 }],
    thresholds: { low_threshold: 0, med_threshold: 1, high_threshold: 1 },
  };
}

describe("verifyTransactionSignature — fee-bump support (Issue #908)", () => {
  beforeEach(() => {
    mockTxCall.mockReset();
    mockLoadAccount.mockReset();
  });

  it("verifies a correctly-signed fee-bump transaction via its inner tx", async () => {
    const payerKp = StellarSdk.Keypair.random();
    const feeKp = StellarSdk.Keypair.random();

    const inner = buildInner(payerKp);
    inner.sign(payerKp); // the payment authorisation
    const feeBump = StellarSdk.TransactionBuilder.buildFeeBumpTransaction(
      feeKp,
      "200",
      inner,
      NET,
    );
    feeBump.sign(feeKp);

    mockTxCall.mockResolvedValue({
      envelope_xdr: feeBump.toEnvelope().toXDR("base64"),
    });
    mockLoadAccount.mockResolvedValue(accountWithSigner(payerKp));

    const result = await verifyTransactionSignature("a".repeat(64));

    expect(result.valid).toBe(true);
    expect(result.isFeeBump).toBe(true);
    expect(result.thresholdMet).toBe(true);
    // The source account loaded for weight checks must be the INNER payer,
    // not the fee payer.
    expect(mockLoadAccount).toHaveBeenCalledWith(payerKp.publicKey());
  });

  it("rejects a fee-bump whose inner transaction is signed by the wrong key", async () => {
    const payerKp = StellarSdk.Keypair.random();
    const attackerKp = StellarSdk.Keypair.random();
    const feeKp = StellarSdk.Keypair.random();

    const inner = buildInner(payerKp);
    inner.sign(attackerKp); // NOT an authorised signer of the payer account
    const feeBump = StellarSdk.TransactionBuilder.buildFeeBumpTransaction(
      feeKp,
      "200",
      inner,
      NET,
    );
    feeBump.sign(feeKp);

    mockTxCall.mockResolvedValue({
      envelope_xdr: feeBump.toEnvelope().toXDR("base64"),
    });
    mockLoadAccount.mockResolvedValue(accountWithSigner(payerKp));

    const result = await verifyTransactionSignature("b".repeat(64));

    expect(result.valid).toBe(false);
    expect(result.thresholdMet).toBe(false);
  });

  it("rejects a fee-bump whose inner transaction is unsigned", async () => {
    const payerKp = StellarSdk.Keypair.random();
    const feeKp = StellarSdk.Keypair.random();

    const inner = buildInner(payerKp); // never signed
    const feeBump = StellarSdk.TransactionBuilder.buildFeeBumpTransaction(
      feeKp,
      "200",
      inner,
      NET,
    );
    feeBump.sign(feeKp);

    mockTxCall.mockResolvedValue({
      envelope_xdr: feeBump.toEnvelope().toXDR("base64"),
    });
    mockLoadAccount.mockResolvedValue(accountWithSigner(payerKp));

    const result = await verifyTransactionSignature("c".repeat(64));

    expect(result.valid).toBe(false);
  });

  it("still verifies a normal (non-fee-bump) signed transaction", async () => {
    const payerKp = StellarSdk.Keypair.random();
    const inner = buildInner(payerKp);
    inner.sign(payerKp);

    mockTxCall.mockResolvedValue({
      envelope_xdr: inner.toEnvelope().toXDR("base64"),
    });
    mockLoadAccount.mockResolvedValue(accountWithSigner(payerKp));

    const result = await verifyTransactionSignature("d".repeat(64));

    expect(result.valid).toBe(true);
    expect(result.isFeeBump).toBe(false);
  });
});
