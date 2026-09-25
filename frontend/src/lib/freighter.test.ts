import { describe, it, expect, vi, beforeEach } from "vitest";
import { TransactionSignerError } from "./freighter";

// Mock external modules before importing the module under test
vi.mock("stellar-sdk", () => ({
  Horizon: {
    Server: vi.fn().mockImplementation(() => ({
      submitTransaction: vi.fn(),
    })),
  },
  TransactionBuilder: {
    fromXDR: vi.fn(),
  },
}));

vi.mock("@stellar/freighter-api", () => ({
  isAllowed: vi.fn(),
  getPublicKey: vi.fn(),
  signTransaction: vi.fn(),
}));

import * as freighterApi from "@stellar/freighter-api";
import * as StellarSdk from "stellar-sdk";
import {
  isFreighterAvailable,
  getFreighterPublicKey,
  signWithFreighter,
  submitTransaction,
} from "./freighter";

const mockIsAllowed = vi.mocked(freighterApi.isAllowed);
const mockGetPublicKey = vi.mocked(freighterApi.getPublicKey);
const mockSignTransaction = vi.mocked(freighterApi.signTransaction);
const mockFromXDR = vi.mocked(StellarSdk.TransactionBuilder.fromXDR);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isFreighterAvailable", () => {
  it("returns true when Freighter is allowed", async () => {
    mockIsAllowed.mockResolvedValue(true);
    expect(await isFreighterAvailable()).toBe(true);
  });

  it("returns false when Freighter throws", async () => {
    mockIsAllowed.mockRejectedValue(new Error("extension error"));
    expect(await isFreighterAvailable()).toBe(false);
  });
});

describe("getFreighterPublicKey", () => {
  it("throws WALLET_UNAVAILABLE when Freighter is not allowed", async () => {
    mockIsAllowed.mockResolvedValue(false);
    const err = await getFreighterPublicKey().catch((e) => e);
    expect(err).toBeInstanceOf(TransactionSignerError);
    expect(err.code).toBe("WALLET_UNAVAILABLE");
  });

  it("returns the public key when available", async () => {
    mockIsAllowed.mockResolvedValue(true);
    mockGetPublicKey.mockResolvedValue("GABC123");
    expect(await getFreighterPublicKey()).toBe("GABC123");
  });

  it("throws PUBLIC_KEY_FETCH_FAILED on getPublicKey error", async () => {
    mockIsAllowed.mockResolvedValue(true);
    mockGetPublicKey.mockRejectedValue(new Error("fetch failed"));
    const err = await getFreighterPublicKey().catch((e) => e);
    expect(err).toBeInstanceOf(TransactionSignerError);
    expect(err.code).toBe("PUBLIC_KEY_FETCH_FAILED");
  });
});

describe("signWithFreighter", () => {
  const XDR = "AAAA...validXDR";
  const PASSPHRASE = "Test SDF Network ; September 2015";

  it("throws INVALID_XDR when transactionXDR is empty", async () => {
    const err = await signWithFreighter("", PASSPHRASE).catch((e) => e);
    expect(err).toBeInstanceOf(TransactionSignerError);
    expect(err.code).toBe("INVALID_XDR");
  });

  it("throws WALLET_UNAVAILABLE when Freighter is not allowed", async () => {
    mockIsAllowed.mockResolvedValue(false);
    const err = await signWithFreighter(XDR, PASSPHRASE).catch((e) => e);
    expect(err).toBeInstanceOf(TransactionSignerError);
    expect(err.code).toBe("WALLET_UNAVAILABLE");
  });

  it("throws USER_REJECTED when user declines in Freighter", async () => {
    mockIsAllowed.mockResolvedValue(true);
    mockSignTransaction.mockRejectedValue(new Error("User declined signing"));
    const err = await signWithFreighter(XDR, PASSPHRASE).catch((e) => e);
    expect(err).toBeInstanceOf(TransactionSignerError);
    expect(err.code).toBe("USER_REJECTED");
  });

  it("returns signedXDR and publicKey on success", async () => {
    mockIsAllowed.mockResolvedValue(true);
    mockSignTransaction.mockResolvedValue("SIGNED_XDR");
    mockGetPublicKey.mockResolvedValue("GABC123");
    const result = await signWithFreighter(XDR, PASSPHRASE);
    expect(result).toEqual({ signedXDR: "SIGNED_XDR", publicKey: "GABC123" });
  });
});

describe("submitTransaction", () => {
  it("throws INVALID_XDR when signedXDR is empty", async () => {
    const err = await submitTransaction("", "https://horizon.stellar.org", "passphrase").catch((e) => e);
    expect(err).toBeInstanceOf(TransactionSignerError);
    expect(err.code).toBe("INVALID_XDR");
  });

  it("throws INVALID_XDR when XDR cannot be parsed", async () => {
    mockFromXDR.mockImplementation(() => { throw new Error("bad XDR"); });
    const err = await submitTransaction("BAD_XDR", "https://horizon.stellar.org", "passphrase").catch((e) => e);
    expect(err).toBeInstanceOf(TransactionSignerError);
    expect(err.code).toBe("INVALID_XDR");
  });

  it("returns hash on successful submission", async () => {
    const mockSubmit = vi.fn().mockResolvedValue({ hash: "abc123" });
    vi.mocked(StellarSdk.Horizon.Server).mockImplementation(() => ({ submitTransaction: mockSubmit }) as never);
    mockFromXDR.mockReturnValue({} as never);

    const result = await submitTransaction("VALID_XDR", "https://horizon.stellar.org", "passphrase");
    expect(result).toEqual({ hash: "abc123" });
  });

  it("throws SUBMISSION_FAILED when Horizon returns no hash", async () => {
    const mockSubmit = vi.fn().mockResolvedValue({ hash: undefined });
    vi.mocked(StellarSdk.Horizon.Server).mockImplementation(() => ({ submitTransaction: mockSubmit }) as never);
    mockFromXDR.mockReturnValue({} as never);

    const err = await submitTransaction("VALID_XDR", "https://horizon.stellar.org", "passphrase").catch((e) => e);
    expect(err).toBeInstanceOf(TransactionSignerError);
    expect(err.code).toBe("SUBMISSION_FAILED");
  });
});
