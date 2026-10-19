/**
 * Tests for Ledger Monitor security helpers (ledger-monitor-security.js).
 *
 * Focus: validatePaymentRecord must treat the native asset (XLM / "native")
 * as not requiring an issuer (Issue #910 — enhance error recovery / security
 * integrity for the Ledger Monitor). Previously native XLM payments were
 * rejected for a "missing" issuer, so the poller skipped every native payment.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

vi.mock("./logger.js", () => ({
  logger: mockLogger,
}));

import {
  validatePaymentRecord,
  sanitizePaymentMetadata,
  isValidTransactionHash,
  isNativeAsset,
  auditPaymentAnomaly,
} from "./ledger-monitor-security.js";

const RECIPIENT = "GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI";
const ISSUER = "GCEZWKCA5VLDNRLN3RPRJMR3PXJHUWB2TVXVDZQEQ3GTKEX2OQ2BYE4Z";

function nativePayment(overrides = {}) {
  return {
    id: "pay-001",
    recipient: RECIPIENT,
    amount: "10.0000000",
    asset: "XLM",
    asset_issuer: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("isNativeAsset", () => {
  it("recognises XLM and native in any case", () => {
    expect(isNativeAsset("XLM")).toBe(true);
    expect(isNativeAsset("xlm")).toBe(true);
    expect(isNativeAsset(" Native ")).toBe(true);
    expect(isNativeAsset("native")).toBe(true);
  });

  it("rejects issued asset codes and non-strings", () => {
    expect(isNativeAsset("USDC")).toBe(false);
    expect(isNativeAsset(null)).toBe(false);
    expect(isNativeAsset(undefined)).toBe(false);
    expect(isNativeAsset(123)).toBe(false);
  });
});

describe("validatePaymentRecord — native asset handling", () => {
  it("accepts a native XLM payment with a null issuer", () => {
    expect(validatePaymentRecord(nativePayment())).toEqual({ valid: true });
  });

  it("accepts asset 'native' with a null issuer", () => {
    expect(
      validatePaymentRecord(nativePayment({ asset: "native" })),
    ).toEqual({ valid: true });
  });

  it("accepts lowercase 'xlm' with a null issuer", () => {
    expect(validatePaymentRecord(nativePayment({ asset: "xlm" }))).toEqual({
      valid: true,
    });
  });

  it("still requires a valid issuer for non-native assets", () => {
    const result = validatePaymentRecord(
      nativePayment({ asset: "USDC", asset_issuer: null }),
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/asset_issuer/);
  });

  it("accepts a non-native asset with a valid issuer", () => {
    expect(
      validatePaymentRecord(nativePayment({ asset: "USDC", asset_issuer: ISSUER })),
    ).toEqual({ valid: true });
  });
});

describe("validatePaymentRecord — field guards", () => {
  it("rejects an invalid recipient address", () => {
    const result = validatePaymentRecord(nativePayment({ recipient: "GABC" }));
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/recipient/);
  });

  it("rejects a non-positive amount", () => {
    expect(validatePaymentRecord(nativePayment({ amount: "0" })).valid).toBe(false);
    expect(validatePaymentRecord(nativePayment({ amount: "-5" })).valid).toBe(false);
  });

  it("rejects a null payment record", () => {
    expect(validatePaymentRecord(null).valid).toBe(false);
  });
});

describe("sanitizePaymentMetadata", () => {
  it("drops keys not on the allowlist", () => {
    const out = sanitizePaymentMetadata({ order_id: "x", evil: "drop" });
    expect(out).toEqual({ order_id: "x" });
  });

  it("returns an empty object for non-object input", () => {
    expect(sanitizePaymentMetadata(null)).toEqual({});
    expect(sanitizePaymentMetadata("nope")).toEqual({});
    expect(sanitizePaymentMetadata([1, 2])).toEqual({});
  });
});

describe("isValidTransactionHash", () => {
  it("accepts a 64-char hex string", () => {
    expect(isValidTransactionHash("a".repeat(64))).toBe(true);
  });

  it("rejects malformed hashes", () => {
    expect(isValidTransactionHash("tx-abc")).toBe(false);
    expect(isValidTransactionHash("a".repeat(63))).toBe(false);
    expect(isValidTransactionHash(null)).toBe(false);
  });

  it("accepts uppercase hex", () => {
    expect(isValidTransactionHash("A".repeat(64))).toBe(true);
    expect(isValidTransactionHash("F".repeat(64))).toBe(true);
  });

  it("rejects strings with non-hex characters", () => {
    expect(isValidTransactionHash("g".repeat(64))).toBe(false);
    expect(isValidTransactionHash("z".repeat(64))).toBe(false);
  });
});

describe("auditPaymentAnomaly", () => {
  beforeEach(() => {
    mockLogger.warn.mockClear();
  });

  it("does not warn for a normal payment", () => {
    auditPaymentAnomaly(nativePayment({ amount: "10.0000000" }));
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it("warns for a large amount over 100000", () => {
    auditPaymentAnomaly(nativePayment({ amount: "100001" }));
    expect(mockLogger.warn).toHaveBeenCalledOnce();
    const [{ flags }] = mockLogger.warn.mock.calls[0];
    expect(flags.some((f) => f.type === "large_amount")).toBe(true);
  });

  it("warns for memo containing control characters", () => {
    auditPaymentAnomaly(nativePayment({ memo: "hello\x00world" }));
    expect(mockLogger.warn).toHaveBeenCalledOnce();
    const [{ flags }] = mockLogger.warn.mock.calls[0];
    expect(flags.some((f) => f.type === "memo_control_chars")).toBe(true);
  });

  it("warns for memo containing SQL injection characters", () => {
    auditPaymentAnomaly(nativePayment({ memo: "pay'me--now" }));
    expect(mockLogger.warn).toHaveBeenCalledOnce();
    const [{ flags }] = mockLogger.warn.mock.calls[0];
    expect(flags.some((f) => f.type === "memo_sql_chars")).toBe(true);
  });

  it("warns for a payment created more than 20 hours ago", () => {
    const oldDate = new Date(Date.now() - 21 * 60 * 60 * 1000).toISOString();
    auditPaymentAnomaly(nativePayment({ created_at: oldDate }));
    expect(mockLogger.warn).toHaveBeenCalledOnce();
    const [{ flags }] = mockLogger.warn.mock.calls[0];
    expect(flags.some((f) => f.type === "stale_payment")).toBe(true);
  });

  it("warns for metadata with unknown keys", () => {
    auditPaymentAnomaly(nativePayment({ metadata: { evil_key: "injected" } }));
    expect(mockLogger.warn).toHaveBeenCalledOnce();
    const [{ flags }] = mockLogger.warn.mock.calls[0];
    expect(flags.some((f) => f.type === "metadata_unknown_keys")).toBe(true);
  });

  it("does not warn for metadata with only allowlisted keys", () => {
    auditPaymentAnomaly(nativePayment({ metadata: { order_id: "ord-001", note: "thanks" } }));
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it("collects multiple anomaly flags in a single warn call", () => {
    const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    auditPaymentAnomaly(nativePayment({ amount: "200000", memo: "'; DROP--", created_at: oldDate }));
    expect(mockLogger.warn).toHaveBeenCalledOnce();
    const [{ flags }] = mockLogger.warn.mock.calls[0];
    expect(flags.length).toBeGreaterThanOrEqual(3);
  });
});

describe("validatePaymentRecord — edge cases", () => {
  it("rejects a payment with a future created_at more than 1 hour ahead", () => {
    const futureDate = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const result = validatePaymentRecord(nativePayment({ created_at: futureDate }));
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/future/i);
  });

  it("accepts a payment with a slightly future created_at within the 1-hour tolerance", () => {
    const slightlyFuture = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    expect(validatePaymentRecord(nativePayment({ created_at: slightlyFuture })).valid).toBe(true);
  });

  it("rejects a payment with a non-string id", () => {
    expect(validatePaymentRecord(nativePayment({ id: 123 })).valid).toBe(false);
  });

  it("rejects a payment with an empty string id", () => {
    expect(validatePaymentRecord(nativePayment({ id: "   " })).valid).toBe(false);
  });

  it("rejects memo that is not a string", () => {
    const result = validatePaymentRecord(nativePayment({ memo: 12345 }));
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/memo/i);
  });

  it("accepts a payment with no memo (undefined)", () => {
    const p = nativePayment();
    delete p.memo;
    expect(validatePaymentRecord(p).valid).toBe(true);
  });
});

describe("sanitizePaymentMetadata — extended cases", () => {
  it("preserves all allowlisted keys", () => {
    const input = {
      order_id: "o1",
      customer_id: "c1",
      reference: "ref",
      invoice_id: "inv",
      external_id: "ext",
      failure_reason: "underpayment",
      expected_amount: 10,
      received_amount: 9,
      shortfall: 1,
      excess: 0,
      overpayment: false,
      note: "ok",
    };
    const out = sanitizePaymentMetadata(input);
    expect(Object.keys(out)).toHaveLength(Object.keys(input).length);
  });

  it("drops nested objects", () => {
    const out = sanitizePaymentMetadata({ order_id: "x", nested: { deep: "val" } });
    expect(out).not.toHaveProperty("nested");
    expect(out).toHaveProperty("order_id", "x");
  });

  it("truncates string values exceeding 500 characters", () => {
    const long = "a".repeat(600);
    const out = sanitizePaymentMetadata({ note: long });
    expect(out.note).toHaveLength(500);
  });

  it("passes through numeric and boolean values unchanged", () => {
    const out = sanitizePaymentMetadata({ expected_amount: 99.5, overpayment: true });
    expect(out.expected_amount).toBe(99.5);
    expect(out.overpayment).toBe(true);
  });

  it("handles null values in allowlisted keys", () => {
    const out = sanitizePaymentMetadata({ order_id: null });
    expect(out).toHaveProperty("order_id", null);
  });
});
