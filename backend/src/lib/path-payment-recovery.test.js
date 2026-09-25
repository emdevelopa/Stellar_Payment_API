import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockLoadAccount,
  mockStrictReceivePaths,
  mockStrictReceivePathsBuilder,
} = vi.hoisted(() => ({
  mockLoadAccount: vi.fn(),
  mockStrictReceivePaths: vi.fn(),
  mockStrictReceivePathsBuilder: vi.fn(),
}));

vi.mock("stellar-sdk", () => {
  const MockAsset = vi.fn((code, issuer) => ({
    isNative: () => false,
    getCode: () => code,
    getIssuer: () => issuer,
    code,
    issuer,
  }));
  MockAsset.native = vi.fn(() => ({
    isNative: () => true,
    getCode: () => "XLM",
    getIssuer: () => undefined,
  }));

  mockStrictReceivePathsBuilder.mockImplementation(() => ({
    call: mockStrictReceivePaths,
  }));

  return {
    Asset: MockAsset,
    StrKey: {
      isValidEd25519PublicKey: (value) =>
        typeof value === "string" && value.startsWith("G") && value.length === 56,
    },
    Horizon: {
      Server: vi.fn(() => ({
        loadAccount: mockLoadAccount,
        strictReceivePaths: mockStrictReceivePathsBuilder,
      })),
    },
  };
});

import { findStrictReceivePaths } from "./stellar.js";

describe("findStrictReceivePaths", () => {
  const sourceAccount =
    "GDRXE2BQUC3AZGSQK6X4Q6X6ZJ4P4K5WRGQKZ7VYI3XU4Q2YOMF4XG4D";
  const issuer = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadAccount.mockResolvedValue({ id: sourceAccount });
  });

  it("retries transient Horizon quote failures before succeeding", async () => {
    vi.useFakeTimers();
    mockStrictReceivePaths
      .mockRejectedValueOnce({ response: { status: 429 }, message: "rate limited" })
      .mockResolvedValueOnce({
        records: [
          {
            source_amount: "60.1250000",
            source_asset_type: "native",
            source_asset_issuer: null,
            destination_amount: "25.0000000",
            path: [],
          },
        ],
      });

    const quotePromise = findStrictReceivePaths({
      sourceAccount,
      destAssetCode: "USDC",
      destAssetIssuer: issuer,
      destAmount: "25",
      sourceAssetCode: "XLM",
      sourceAssetIssuer: null,
    });

    await vi.runAllTimersAsync();
    const result = await quotePromise;
    vi.useRealTimers();

    expect(mockLoadAccount).toHaveBeenCalledWith(sourceAccount);
    expect(mockStrictReceivePaths).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      source_amount: "60.1250000",
      source_asset_code: "XLM",
      source_asset_issuer: null,
      destination_amount: "25.0000000",
      path: [],
    });
  });

  it("rejects malformed path quotes returned by Horizon", async () => {
    mockStrictReceivePaths.mockResolvedValueOnce({
      records: [
        {
          source_amount: "0",
          source_asset_type: "native",
          source_asset_issuer: null,
          destination_amount: "25.0000000",
          path: [],
        },
      ],
    });

    await expect(
      findStrictReceivePaths({
        sourceAccount,
        destAssetCode: "USDC",
        destAssetIssuer: issuer,
        destAmount: "25",
        sourceAssetCode: "XLM",
        sourceAssetIssuer: null,
      }),
    ).rejects.toMatchObject({
      status: 502,
      message: "Horizon returned an invalid path payment quote",
    });
  });
});
