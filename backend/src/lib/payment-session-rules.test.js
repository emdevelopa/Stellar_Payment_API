import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./stellar.js", () => ({
  isValidStellarPublicKey: vi.fn((value) =>
    typeof value === "string" && /^G[A-Z2-7]{55}$/.test(value)
  ),
}));

vi.mock("../constants/assetConstants.js", () => ({
  resolveAssetIssuer: vi.fn((_asset, issuer) => issuer || null),
}));

import {
  resolveAndValidateIssuer,
  validatePerAssetLimits,
  validateAllowedIssuers,
} from "./payment-session-rules.js";

const VALID_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const OTHER_ISSUER = "GA5XIGA5C7FBPTVQ3CWHKNC7D2ZBHB24G3KUJG5WZ6S4EYWSSBFVL45T";

describe("resolveAndValidateIssuer (issue #1087)", () => {
  it("accepts XLM without an issuer", () => {
    const { assetIssuer, rejection } = resolveAndValidateIssuer("XLM", null);
    expect(assetIssuer).toBeNull();
    expect(rejection).toBeNull();
  });

  it("accepts a valid issuer for a non-native asset", () => {
    const { assetIssuer, rejection } = resolveAndValidateIssuer("USDC", VALID_ISSUER);
    expect(assetIssuer).toBe(VALID_ISSUER);
    expect(rejection).toBeNull();
  });

  it("rejects non-native asset without an issuer", () => {
    const { assetIssuer, rejection } = resolveAndValidateIssuer("USDC", null);
    expect(assetIssuer).toBeNull();
    expect(rejection).toEqual({
      reason: "missing_issuer",
      message: "asset_issuer is required for non-native assets",
    });
  });

  it("rejects a malformed issuer key", () => {
    const { rejection } = resolveAndValidateIssuer("USDC", "not-a-key");
    expect(rejection).toEqual({
      reason: "invalid_issuer",
      message: "asset_issuer must be a valid Stellar public key",
    });
  });

  it("ignores issuer validation entirely for XLM even when garbage is passed", () => {
    const { assetIssuer, rejection } = resolveAndValidateIssuer("XLM", "@@bad");
    expect(rejection).toBeNull();
    // Legacy behavior: raw value passes through for XLM
    expect(assetIssuer).toBe("@@bad");
  });
});

describe("validatePerAssetLimits (issue #1087)", () => {
  it("returns null when the merchant has no limits object", () => {
    expect(
      validatePerAssetLimits({ rawAsset: "XLM", amount: 1, paymentLimits: null })
    ).toBeNull();
    expect(
      validatePerAssetLimits({ rawAsset: "XLM", amount: 1, paymentLimits: undefined })
    ).toBeNull();
  });

  it("returns null when the asset has no configured limit entry", () => {
    expect(
      validatePerAssetLimits({
        rawAsset: "USDC",
        amount: 10,
        paymentLimits: { XLM: { min: 1 } },
      })
    ).toBeNull();
  });

  it("rejects amounts below the minimum with delta details", () => {
    const rejection = validatePerAssetLimits({
      rawAsset: "USDC",
      amount: 0.5,
      paymentLimits: { USDC: { min: 1 } },
    });
    expect(rejection.reason).toBe("below_min");
    expect(rejection.message).toBe("Amount is below the minimum for USDC");
    expect(rejection.details.min).toBe(1);
    expect(rejection.details.delta).toBeCloseTo(0.5, 7);
  });

  it("rejects amounts above the maximum with delta details", () => {
    const rejection = validatePerAssetLimits({
      rawAsset: "USDC",
      amount: 150,
      paymentLimits: { USDC: { max: 100 } },
    });
    expect(rejection.reason).toBe("above_max");
    expect(rejection.details.max).toBe(100);
    expect(rejection.details.delta).toBeCloseTo(50, 7);
  });

  it("accepts boundary amounts equal to min and max", () => {
    const limits = { USDC: { min: 1, max: 100 } };
    expect(
      validatePerAssetLimits({ rawAsset: "USDC", amount: 1, paymentLimits: limits })
    ).toBeNull();
    expect(
      validatePerAssetLimits({ rawAsset: "USDC", amount: 100, paymentLimits: limits })
    ).toBeNull();
  });

  it("rounds deltas to 7 decimal places like legacy formatting", () => {
    const rejection = validatePerAssetLimits({
      rawAsset: "USDC",
      amount: 99.9999999999,
      paymentLimits: { USDC: { max: 100 } },
    });
    expect(rejection).toBeNull(); // below max
    const over = validatePerAssetLimits({
      rawAsset: "USDC",
      amount: 100.00000000001,
      paymentLimits: { USDC: { max: 100 } },
    });
    expect(over.details.delta).toBe(0);
  });
});

describe("validateAllowedIssuers (issue #1087)", () => {
  it("skips enforcement for XLM regardless of allowlist", () => {
    expect(
      validateAllowedIssuers({
        asset: "XLM",
        assetIssuer: null,
        allowedIssuers: [VALID_ISSUER],
      })
    ).toBeNull();
  });

  it("permits everything when no allowlist is configured", () => {
    expect(
      validateAllowedIssuers({ asset: "USDC", assetIssuer: VALID_ISSUER })
    ).toBeNull();
    expect(
      validateAllowedIssuers({
        asset: "USDC",
        assetIssuer: VALID_ISSUER,
        allowedIssuers: [],
      })
    ).toBeNull();
    expect(
      validateAllowedIssuers({
        asset: "USDC",
        assetIssuer: VALID_ISSUER,
        allowedIssuers: "garbage",
      })
    ).toBeNull();
  });

  it("accepts an allowlisted issuer", () => {
    expect(
      validateAllowedIssuers({
        asset: "USDC",
        assetIssuer: VALID_ISSUER,
        allowedIssuers: [VALID_ISSUER],
      })
    ).toBeNull();
  });

  it("rejects a non-allowlisted issuer", () => {
    const rejection = validateAllowedIssuers({
      asset: "USDC",
      assetIssuer: OTHER_ISSUER,
      allowedIssuers: [VALID_ISSUER],
    });
    expect(rejection).toEqual({
      reason: "issuer_not_allowed",
      message: "asset_issuer is not in the merchant's list of allowed issuers",
    });
  });

  it("rejects when the issuer resolved to null under an active allowlist", () => {
    const rejection = validateAllowedIssuers({
      asset: "USDC",
      assetIssuer: null,
      allowedIssuers: [VALID_ISSUER],
    });
    expect(rejection.reason).toBe("issuer_not_allowed");
  });
});
