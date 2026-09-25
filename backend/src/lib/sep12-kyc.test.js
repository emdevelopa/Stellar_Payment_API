import { describe, it, expect, vi, beforeEach } from "vitest";
import * as StellarSdk from "stellar-sdk";
import { createHash } from "node:crypto";

// Replace the DB module entirely so no pg.Pool is created and queries are
// observable. isRetryablePoolError drives the error-recovery branch (#592).
vi.mock("./db.js", () => ({
  queryWithRetry: vi.fn(),
  isRetryablePoolError: vi.fn(() => false),
}));

import { queryWithRetry, isRetryablePoolError } from "./db.js";
import {
  buildSignaturePayload,
  verifyCustomerSignature,
  putCustomer,
  getCustomer,
  deleteCustomer,
  KycError,
} from "./sep12-kyc.js";

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function signRequest(keypair, { account, memo = "", timestamp, fields }) {
  const payload = buildSignaturePayload({ account, memo, timestamp, fields });
  const hash = createHash("sha256").update(payload).digest();
  return keypair.sign(hash).toString("base64");
}

const goodFields = {
  first_name: "Ada",
  last_name: "Lovelace",
  email_address: "ada@example.com",
};

beforeEach(() => {
  vi.clearAllMocks();
  isRetryablePoolError.mockReturnValue(false);
});

// ---------------------------------------------------------------------------
// #590 — signature verification
// ---------------------------------------------------------------------------

describe("verifyCustomerSignature (#590)", () => {
  it("accepts a valid signature from the account holder", () => {
    const kp = StellarSdk.Keypair.random();
    const account = kp.publicKey();
    const timestamp = nowSeconds();
    const signature = signRequest(kp, { account, timestamp, fields: goodFields });

    expect(
      verifyCustomerSignature({ account, timestamp, fields: goodFields, signature }),
    ).toEqual({ valid: true });
  });

  it("rejects a signature over tampered fields", () => {
    const kp = StellarSdk.Keypair.random();
    const account = kp.publicKey();
    const timestamp = nowSeconds();
    const signature = signRequest(kp, { account, timestamp, fields: goodFields });

    const result = verifyCustomerSignature({
      account,
      timestamp,
      fields: { ...goodFields, email_address: "attacker@example.com" },
      signature,
    });
    expect(result).toMatchObject({ valid: false, reason: "signature_mismatch" });
  });

  it("rejects a stale timestamp (replay protection)", () => {
    const kp = StellarSdk.Keypair.random();
    const account = kp.publicKey();
    const timestamp = nowSeconds() - 10_000;
    const signature = signRequest(kp, { account, timestamp, fields: goodFields });

    expect(
      verifyCustomerSignature({ account, timestamp, fields: goodFields, signature }),
    ).toMatchObject({ valid: false, reason: "stale_or_invalid_timestamp" });
  });

  it("rejects a signature from a different key", () => {
    const kp = StellarSdk.Keypair.random();
    const other = StellarSdk.Keypair.random();
    const account = kp.publicKey();
    const timestamp = nowSeconds();
    const signature = signRequest(other, { account, timestamp, fields: goodFields });

    expect(
      verifyCustomerSignature({ account, timestamp, fields: goodFields, signature }),
    ).toMatchObject({ valid: false, reason: "signature_mismatch" });
  });

  it("rejects when the signature is missing", () => {
    const kp = StellarSdk.Keypair.random();
    expect(
      verifyCustomerSignature({
        account: kp.publicKey(),
        timestamp: nowSeconds(),
        fields: goodFields,
        signature: "",
      }),
    ).toMatchObject({ valid: false, reason: "missing_signature_fields" });
  });
});

// ---------------------------------------------------------------------------
// putCustomer — upsert (#591), validation/security (#593), auth (#590)
// ---------------------------------------------------------------------------

describe("putCustomer", () => {
  it("upserts in a single parameterised round trip and returns status", async () => {
    const kp = StellarSdk.Keypair.random();
    const account = kp.publicKey();
    const timestamp = nowSeconds();
    const signature = signRequest(kp, { account, timestamp, fields: goodFields });

    queryWithRetry.mockResolvedValue({ rows: [{ id: "rec-1", status: "ACCEPTED" }] });

    const result = await putCustomer({ account, timestamp, signature, fields: goodFields });
    expect(result).toEqual({ id: "rec-1", status: "ACCEPTED" });

    expect(queryWithRetry).toHaveBeenCalledTimes(1);
    const [sql, params] = queryWithRetry.mock.calls[0];
    expect(sql).toContain("ON CONFLICT (stellar_account, memo)");
    // Parameterised: values are bound, not interpolated (#593 — SQLi safe).
    expect(params).toEqual([account, "", JSON.stringify(goodFields), "ACCEPTED", timestamp]);
  });

  it("rejects a stale write that loses the signed_at guard with 409", async () => {
    const kp = StellarSdk.Keypair.random();
    const account = kp.publicKey();
    const timestamp = nowSeconds();
    const signature = signRequest(kp, { account, timestamp, fields: goodFields });

    queryWithRetry.mockResolvedValue({ rows: [] });

    await expect(
      putCustomer({ account, timestamp, signature, fields: goodFields }),
    ).rejects.toMatchObject({ code: "STALE_REQUEST", httpStatus: 409 });
  });

  it("handles a null input and non-string memo without a TypeError", async () => {
    await expect(putCustomer(null)).rejects.toMatchObject({ httpStatus: 400 });
    const account = StellarSdk.Keypair.random().publicKey();
    await expect(putCustomer({ account, memo: ["x"] })).rejects.toMatchObject({
      code: "INVALID_MEMO",
    });
    await expect(getCustomer({ account, memo: { a: 1 } })).rejects.toMatchObject({
      code: "INVALID_MEMO",
    });
    expect(queryWithRetry).not.toHaveBeenCalled();
  });

  it("rejects an invalid signature with 401 and never touches the DB", async () => {
    const kp = StellarSdk.Keypair.random();
    const account = kp.publicKey();
    const timestamp = nowSeconds();

    await expect(
      putCustomer({ account, timestamp, signature: "AAAA", fields: goodFields }),
    ).rejects.toMatchObject({ code: "SIGNATURE_INVALID", httpStatus: 401 });
    expect(queryWithRetry).not.toHaveBeenCalled();
  });

  it("rejects unknown/invalid fields with 400", async () => {
    const kp = StellarSdk.Keypair.random();
    const account = kp.publicKey();
    const timestamp = nowSeconds();
    const fields = { email_address: "not-an-email" };
    const signature = signRequest(kp, { account, timestamp, fields });

    await expect(
      putCustomer({ account, timestamp, signature, fields }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", httpStatus: 400 });
    expect(queryWithRetry).not.toHaveBeenCalled();
  });

  it("rejects a malformed Stellar account with 400", async () => {
    await expect(
      putCustomer({ account: "not-a-key", timestamp: nowSeconds(), signature: "x", fields: {} }),
    ).rejects.toMatchObject({ code: "INVALID_ACCOUNT", httpStatus: 400 });
  });

  it("marks status NEEDS_INFO when core fields are missing", async () => {
    const kp = StellarSdk.Keypair.random();
    const account = kp.publicKey();
    const timestamp = nowSeconds();
    const fields = { first_name: "Ada" };
    const signature = signRequest(kp, { account, timestamp, fields });

    queryWithRetry.mockResolvedValue({ rows: [{ id: "rec-2", status: "NEEDS_INFO" }] });
    await putCustomer({ account, timestamp, signature, fields });
    expect(queryWithRetry.mock.calls[0][1][3]).toBe("NEEDS_INFO");
  });
});

// ---------------------------------------------------------------------------
// getCustomer / deleteCustomer
// ---------------------------------------------------------------------------

describe("getCustomer", () => {
  it("returns the mapped record on a hit", async () => {
    const kp = StellarSdk.Keypair.random();
    const account = kp.publicKey();
    queryWithRetry.mockResolvedValue({
      rows: [
        {
          id: "rec-1",
          stellar_account: account,
          memo: "",
          fields: goodFields,
          status: "ACCEPTED",
          created_at: "2026-05-27T00:00:00Z",
          updated_at: "2026-05-27T00:00:00Z",
        },
      ],
    });

    const result = await getCustomer({ account });
    expect(result).toMatchObject({ id: "rec-1", account, status: "ACCEPTED" });
    const [sql] = queryWithRetry.mock.calls[0];
    expect(sql).toContain("WHERE stellar_account = $1 AND memo = $2");
  });

  it("throws 404 when absent", async () => {
    const kp = StellarSdk.Keypair.random();
    queryWithRetry.mockResolvedValue({ rows: [] });
    await expect(getCustomer({ account: kp.publicKey() })).rejects.toMatchObject({
      code: "NOT_FOUND",
      httpStatus: 404,
    });
  });
});

describe("deleteCustomer", () => {
  it("returns deleted on a hit with valid signature", async () => {
    const kp = StellarSdk.Keypair.random();
    const account = kp.publicKey();
    const timestamp = nowSeconds();
    const signature = signRequest(kp, { account, timestamp, fields: {} });

    queryWithRetry.mockResolvedValue({ rows: [{ id: "rec-1" }] });
    await expect(deleteCustomer({ account, timestamp, signature })).resolves.toEqual({
      id: "rec-1",
      deleted: true,
    });
  });

  it("rejects delete without valid signature", async () => {
    const kp = StellarSdk.Keypair.random();
    const account = kp.publicKey();

    await expect(deleteCustomer({ account, timestamp: nowSeconds(), signature: "" })).rejects.toMatchObject({
      code: "SIGNATURE_INVALID",
      httpStatus: 401,
    });
    expect(queryWithRetry).not.toHaveBeenCalled();
  });

  it("throws 404 when absent", async () => {
    const kp = StellarSdk.Keypair.random();
    const account = kp.publicKey();
    const timestamp = nowSeconds();
    const signature = signRequest(kp, { account, timestamp, fields: {} });

    queryWithRetry.mockResolvedValue({ rows: [] });
    await expect(deleteCustomer({ account, timestamp, signature })).rejects.toMatchObject({
      code: "NOT_FOUND",
      httpStatus: 404,
    });
  });
});

// ---------------------------------------------------------------------------
// #592 — error recovery
// ---------------------------------------------------------------------------

describe("error recovery (#592)", () => {
  it("maps an exhausted transient DB failure to a retryable 503", async () => {
    const kp = StellarSdk.Keypair.random();
    isRetryablePoolError.mockReturnValue(true);
    queryWithRetry.mockRejectedValue(Object.assign(new Error("connection terminated"), { code: "08006" }));

    await expect(getCustomer({ account: kp.publicKey() })).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      httpStatus: 503,
      retryable: true,
    });
  });

  it("maps an unexpected DB failure to a non-leaky 500", async () => {
    const kp = StellarSdk.Keypair.random();
    isRetryablePoolError.mockReturnValue(false);
    queryWithRetry.mockRejectedValue(new Error("syntax error at or near"));

    await expect(getCustomer({ account: kp.publicKey() })).rejects.toMatchObject({
      code: "DB_ERROR",
      httpStatus: 500,
    });
  });
});
