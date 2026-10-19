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
  MAX_STELLAR_AMOUNT,
  SESSION_FIELD_MAX_LENGTHS,
  sanitizeSessionPayload,
  validateSessionAsset,
  validateSessionAmount,
  inspectPaymentLimitsConfig,
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

describe("sanitizeSessionPayload (issue #1447)", () => {
  const base = { amount: 10, asset: "USDC", asset_issuer: VALID_ISSUER, recipient: VALID_ISSUER };

  it("returns an equal copy for a clean payload without mutating the input", () => {
    const input = { ...base, description: "Order #42" };
    const result = sanitizeSessionPayload(input);
    expect(result.rejection).toBeNull();
    expect(result.payload).toEqual(input);
    expect(result.payload).not.toBe(input);
    expect(result.modifiedFields).toEqual([]);
    expect(result.suspicious).toEqual([]);
  });

  it.each([null, undefined, "string", 42, [], [base], new Date()])(
    "rejects non-plain-object body %#",
    (body) => {
      const result = sanitizeSessionPayload(body);
      expect(result.payload).toBeNull();
      expect(result.rejection.reason).toBe("malformed_payload");
      expect(result.suspicious).toContain("malformed_payload");
    },
  );

  it("accepts null-prototype objects", () => {
    const body = Object.assign(Object.create(null), base);
    expect(sanitizeSessionPayload(body).rejection).toBeNull();
  });

  it("rejects a top-level __proto__ key created by JSON.parse", () => {
    const body = JSON.parse(`{"amount":1,"asset":"XLM","recipient":"x","__proto__":{"polluted":true}}`);
    const result = sanitizeSessionPayload(body);
    expect(result.rejection.reason).toBe("forbidden_key");
    expect(result.rejection.details.fields).toEqual(["__proto__"]);
    expect(result.suspicious).toEqual(["forbidden_key"]);
    expect({}.polluted).toBeUndefined();
  });

  it("reports nested forbidden key paths (metadata, branding, arrays)", () => {
    const body = {
      ...base,
      metadata: { a: { constructor: { prototype: {} } } },
      branding_overrides: JSON.parse(`{"__proto__":{}}`),
      tags: [{ prototype: 1 }],
    };
    const result = sanitizeSessionPayload(body);
    expect(result.rejection.details.fields).toEqual([
      "metadata.a.constructor",
      "branding_overrides.__proto__",
      "tags.0.prototype",
    ]);
  });

  it("does not walk beyond the inspection depth limit", () => {
    let deep = { __proto_safe: true };
    let cursor = deep;
    for (let i = 0; i < 20; i++) {
      cursor.next = {};
      cursor = cursor.next;
    }
    cursor.constructor = {}; // own key, far below the depth cap
    expect(() => sanitizeSessionPayload({ ...base, metadata: deep })).not.toThrow();
  });

  it("strips control, zero-width and bidi characters and records the fields", () => {
    const result = sanitizeSessionPayload({
      ...base,
      description: "Pay\u0000 now\u200B\u202E gnp.exe",
      client_id: "abc\t\n",
    });
    expect(result.rejection).toBeNull();
    expect(result.payload.description).toBe("Pay now gnp.exe");
    expect(result.payload.client_id).toBe("abc");
    expect(result.modifiedFields).toEqual(["description", "client_id"]);
    expect(result.suspicious).toEqual(["bidi_control"]);
  });

  it("NFC-normalizes strings so look-alike encodings compare equal", () => {
    const decomposed = "Cafe\u0301";
    const result = sanitizeSessionPayload({ ...base, description: decomposed });
    expect(result.payload.description).toBe("Caf\u00e9");
    expect(result.modifiedFields).toContain("description");
  });

  it("drops optional fields that sanitize to empty, keeps required ones as empty", () => {
    const result = sanitizeSessionPayload({
      ...base,
      recipient: "\u200B",
      description: " \u0007 ",
    });
    expect(result.payload.recipient).toBe("");
    expect(result.payload.description).toBeUndefined();
  });

  it("leaves non-string values untouched for strict validation to judge", () => {
    const result = sanitizeSessionPayload({ ...base, amount: "10", description: 5 });
    expect(result.payload.amount).toBe("10");
    expect(result.payload.description).toBe(5);
  });

  it.each(Object.entries(SESSION_FIELD_MAX_LENGTHS))(
    "rejects %s longer than %i characters",
    (field, max) => {
      const result = sanitizeSessionPayload({ ...base, [field]: "A".repeat(max + 1) });
      expect(result.rejection).toEqual({
        reason: "field_too_long",
        message: `${field} must be at most ${max} characters`,
        details: { field, max_length: max },
      });
      expect(result.suspicious).toContain("oversized_field");
    },
  );

  it("measures length after stripping, so padding with invisible chars cannot bypass or trip the cap", () => {
    const max = SESSION_FIELD_MAX_LENGTHS.client_id;
    const padded = "A".repeat(max) + "\u200B".repeat(50);
    expect(sanitizeSessionPayload({ ...base, client_id: padded }).rejection).toBeNull();
  });
});

describe("validateSessionAsset (issue #1447)", () => {
  it.each(["XLM", "USDC", "A", "ABCDEFGHIJKL", "USD1"])("accepts %s", (asset) => {
    expect(validateSessionAsset(asset)).toBeNull();
  });

  it.each(["", "ABCDEFGHIJKLM", "US-DC", "US DC", "usdc", "ÜSDC", null, 1, undefined])(
    "rejects %j",
    (asset) => {
      expect(validateSessionAsset(asset)).toEqual({
        reason: "invalid_asset",
        message: "asset must be 1-12 alphanumeric characters",
      });
    },
  );
});

describe("validateSessionAmount (issue #1447)", () => {
  it.each([0.0000001, 1, 10.5, 1234567.1234567, MAX_STELLAR_AMOUNT])("accepts %d", (amount) => {
    expect(validateSessionAmount(amount)).toBeNull();
  });

  it.each([0, -1, NaN, Infinity, -Infinity, "10", null, undefined, {}])(
    "rejects non-positive / non-numeric %j",
    (amount) => {
      expect(validateSessionAmount(amount)?.message).toBe("Amount must be a positive number");
    },
  );

  it("rejects amounts above the int64 stroop range", () => {
    expect(validateSessionAmount(MAX_STELLAR_AMOUNT * 2)?.message).toMatch(/must not exceed/);
    expect(validateSessionAmount(1e21)?.reason).toBe("invalid_amount");
  });

  it("rejects more than 7 decimal places, including float artifacts", () => {
    expect(validateSessionAmount(0.00000001)?.message).toMatch(/7 decimal places/);
    expect(validateSessionAmount(0.1 + 0.2)?.message).toMatch(/7 decimal places/);
  });
});

describe("inspectPaymentLimitsConfig (issue #1448)", () => {
  it("reports nothing for valid, absent or unrelated config", () => {
    expect(inspectPaymentLimitsConfig({ rawAsset: "USDC", paymentLimits: null })).toEqual([]);
    expect(inspectPaymentLimitsConfig({ rawAsset: "USDC", paymentLimits: { XLM: { min: "x" } } })).toEqual([]);
    expect(inspectPaymentLimitsConfig({ rawAsset: "USDC", paymentLimits: { USDC: { min: 1, max: "5" } } })).toEqual([]);
  });

  it("flags non-numeric bounds, inverted ranges and malformed entries", () => {
    expect(inspectPaymentLimitsConfig({ rawAsset: "USDC", paymentLimits: { USDC: { min: "abc", max: {} } } }))
      .toEqual(["invalid_min", "invalid_max"]);
    expect(inspectPaymentLimitsConfig({ rawAsset: "USDC", paymentLimits: { USDC: { min: 10, max: 1 } } }))
      .toEqual(["min_greater_than_max"]);
    expect(inspectPaymentLimitsConfig({ rawAsset: "USDC", paymentLimits: { USDC: 5 } }))
      .toEqual(["invalid_entry"]);
  });

  it("ignores inherited properties", () => {
    expect(inspectPaymentLimitsConfig({ rawAsset: "constructor", paymentLimits: {} })).toEqual([]);
  });
});

describe("validatePerAssetLimits hardening (issue #1447)", () => {
  it("never resolves limits from Object.prototype", () => {
    for (const rawAsset of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      expect(validatePerAssetLimits({ rawAsset, amount: 1, paymentLimits: {} })).toBeNull();
    }
  });

  it("coerces numeric-string bounds (legacy configs) and ignores unusable ones", () => {
    expect(
      validatePerAssetLimits({ rawAsset: "USDC", amount: 0.5, paymentLimits: { USDC: { min: "1" } } })?.reason,
    ).toBe("below_min");
    expect(
      validatePerAssetLimits({ rawAsset: "USDC", amount: 0.5, paymentLimits: { USDC: { min: "abc", max: null } } }),
    ).toBeNull();
  });

  it("ignores non-object asset entries", () => {
    expect(validatePerAssetLimits({ rawAsset: "USDC", amount: 1, paymentLimits: { USDC: 5 } })).toBeNull();
  });
});

describe("validateAllowedIssuers hardening (issue #1447)", () => {
  it("ignores non-string allowlist entries rather than matching them", () => {
    const rejection = validateAllowedIssuers({
      asset: "USDC",
      assetIssuer: VALID_ISSUER,
      allowedIssuers: [{ toString: () => VALID_ISSUER }, 42, null],
    });
    expect(rejection?.reason).toBe("issuer_not_allowed");
  });
});
