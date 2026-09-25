import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockLoadAccount, mockStrictReceivePaths, mockStrictReceivePathsBuilder } = vi.hoisted(
  () => ({
    mockLoadAccount: vi.fn(),
    mockStrictReceivePaths: vi.fn(),
    mockStrictReceivePathsBuilder: vi.fn(),
  }),
);

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
import * as metrics from "./metrics.js";

describe("findStrictReceivePaths metrics recording", () => {
  const sourceAccount =
    "GDRXE2BQUC3AZGSQK6X4Q6X6ZJ4P4K5WRGQKZ7VYI3XU4Q2YOMF4XG4D";
  const issuer = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadAccount.mockResolvedValue({ id: sourceAccount });
  });

  it("records success metrics when a path is found", async () => {
    const quoteSpy = vi.spyOn(metrics.exchangeRateQuoteRequests, "inc");
    const durationSpy = vi.spyOn(metrics.exchangeRateQuoteDuration, "observe");
    const horizonSpy = vi.spyOn(metrics.exchangeRateHorizonCalls, "inc");
    const accountSpy = vi.spyOn(metrics.exchangeRateSourceAccountValidation, "inc");

    mockStrictReceivePaths.mockResolvedValue({
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

    await findStrictReceivePaths({
      sourceAccount,
      destAssetCode: "USDC",
      destAssetIssuer: issuer,
      destAmount: "25",
      sourceAssetCode: "XLM",
      sourceAssetIssuer: null,
    });

    expect(accountSpy).toHaveBeenCalledWith({ result: "valid" });
    expect(horizonSpy).toHaveBeenCalledWith({
      operation: "strict_receive_paths",
      status: "success",
    });
    expect(quoteSpy).toHaveBeenCalledWith({
      source_asset: "XLM",
      dest_asset: "USDC",
      result: "success",
    });
    expect(durationSpy).toHaveBeenCalledWith(
      { source_asset: "XLM", dest_asset: "USDC", result: "success" },
      expect.any(Number),
    );
  });

  it("records not_found metric when no path exists", async () => {
    const quoteSpy = vi.spyOn(metrics.exchangeRateQuoteRequests, "inc");
    const durationSpy = vi.spyOn(metrics.exchangeRateQuoteDuration, "observe");

    mockStrictReceivePaths.mockResolvedValue({ records: [] });

    const result = await findStrictReceivePaths({
      sourceAccount,
      destAssetCode: "USDC",
      destAssetIssuer: issuer,
      destAmount: "25",
      sourceAssetCode: "XLM",
      sourceAssetIssuer: null,
    });

    expect(result).toBeNull();
    expect(quoteSpy).toHaveBeenCalledWith({
      source_asset: "XLM",
      dest_asset: "USDC",
      result: "not_found",
    });
    expect(durationSpy).toHaveBeenCalledWith(
      { source_asset: "XLM", dest_asset: "USDC", result: "not_found" },
      expect.any(Number),
    );
  });

  it("records error metric when Horizon call fails", async () => {
    const quoteSpy = vi.spyOn(metrics.exchangeRateQuoteRequests, "inc");
    const durationSpy = vi.spyOn(metrics.exchangeRateQuoteDuration, "observe");
    const horizonSpy = vi.spyOn(metrics.exchangeRateHorizonCalls, "inc");

    mockStrictReceivePaths.mockRejectedValue(new Error("Horizon timeout"));

    await expect(
      findStrictReceivePaths({
        sourceAccount,
        destAssetCode: "USDC",
        destAssetIssuer: issuer,
        destAmount: "25",
        sourceAssetCode: "XLM",
        sourceAssetIssuer: null,
      }),
    ).rejects.toThrow();

    expect(horizonSpy).toHaveBeenCalledWith({
      operation: "strict_receive_paths",
      status: "error",
    });
    expect(quoteSpy).toHaveBeenCalledWith({
      source_asset: "XLM",
      dest_asset: "USDC",
      result: "error",
    });
    expect(durationSpy).toHaveBeenCalledWith(
      { source_asset: "XLM", dest_asset: "USDC", result: "error" },
      expect.any(Number),
    );
  });

  it("skips source account validation when no sourceAccount provided", async () => {
    const accountSpy = vi.spyOn(metrics.exchangeRateSourceAccountValidation, "inc");

    mockStrictReceivePaths.mockResolvedValue({
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

    await findStrictReceivePaths({
      destAssetCode: "USDC",
      destAssetIssuer: issuer,
      destAmount: "25",
      sourceAssetCode: "XLM",
      sourceAssetIssuer: null,
    });

    expect(accountSpy).toHaveBeenCalledWith({ result: "skipped" });
    expect(mockLoadAccount).not.toHaveBeenCalled();
  });
});
