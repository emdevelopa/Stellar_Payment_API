import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { logger } from "./logger.js";
import {
  MAX_CUSTOM_HEADERS,
  PayloadSanitizationError,
  customHeadersSchema,
  merchantSettingsSchema,
  normalizeApiKeyExpiry,
  paymentLimitsSchema,
  rotateApiKeySchema,
  rotateWebhookSecretSchema,
  sanitizeMerchantPayload,
  sanitizePayload,
  setApiKeyExpirySchema,
} from "./merchant-payload-validation.js";
import { resolveMerchantSettings } from "./merchant-settings.js";
import { sanitizeCustomHeaders } from "./webhooks.js";

const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => vi.clearAllMocks());

describe("sanitizePayload (issue #1482)", () => {
  it("returns a structurally equal copy for clean input without mutating it", () => {
    const input = { a: 1, b: "x", c: [true, null, { d: 2 }] };
    const out = sanitizePayload(input);
    expect(out).toEqual(input);
    expect(out).not.toBe(input);
    expect(out.c).not.toBe(input.c);
  });

  it("drops prototype-pollution keys at every depth and reports them", () => {
    const input = JSON.parse(
      '{"__proto__":{"polluted":true},"constructor":{"prototype":{"x":1}},"nested":{"__proto__":{"y":1},"ok":1},"list":[{"prototype":1}]}',
    );
    const report = {};
    const out = sanitizePayload(input, {}, report);

    expect(out).toEqual({ nested: { ok: 1 }, list: [{}] });
    expect(Object.hasOwn(out, "__proto__")).toBe(false);
    expect({}.polluted).toBeUndefined();
    expect(Object.prototype.polluted).toBeUndefined();
    expect(report.droppedKeys).toEqual(
      expect.arrayContaining(["__proto__", "constructor", "nested.__proto__", "list.0.prototype"]),
    );
  });

  it("strips NUL and non-printable control characters but keeps tabs/newlines", () => {
    const out = sanitizePayload({ name: "Acme\u0000 Corp\u0007\u001b[31m", note: "line1\nline2\tend" });
    expect(out.name).toBe("Acme Corp[31m");
    expect(out.note).toBe("line1\nline2\tend");
  });

  it("drops keys that contain control characters", () => {
    const report = {};
    const out = sanitizePayload({ "bad\u0000key": 1, good: 2 }, {}, report);
    expect(out).toEqual({ good: 2 });
    expect(report.droppedKeys).toHaveLength(1);
  });

  it("rejects payloads nested beyond maxDepth", () => {
    let deep = { v: 1 };
    for (let i = 0; i < 10; i += 1) deep = { n: deep };
    expect(() => sanitizePayload(deep)).toThrow(PayloadSanitizationError);
  });

  it("rejects objects with too many keys", () => {
    const wide = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`k${i}`, i]));
    expect(() => sanitizePayload(wide)).toThrow(/exceeds 50 keys/);
  });

  it("rejects oversized arrays and strings", () => {
    expect(() => sanitizePayload({ a: new Array(101).fill(0) })).toThrow(/exceeds 100 items/);
    expect(() => sanitizePayload({ s: "x".repeat(4097) })).toThrow(/exceeds 4096 characters/);
  });

  it("rejects non-finite numbers", () => {
    expect(() => sanitizePayload({ n: Infinity })).toThrow(/must be finite/);
    expect(() => sanitizePayload({ n: NaN })).toThrow(/must be finite/);
  });

  it("passes primitives through", () => {
    expect(sanitizePayload(null)).toBeNull();
    expect(sanitizePayload(42)).toBe(42);
    expect(sanitizePayload(false)).toBe(false);
  });

  it("marks errors as HTTP 400 with the offending path", () => {
    try {
      sanitizePayload({ a: { b: "x".repeat(5000) } });
      throw new Error("expected to throw");
    } catch (err) {
      expect(err.status).toBe(400);
      expect(err.path).toBe("a.b");
    }
  });
});

describe("sanitizeMerchantPayload middleware", () => {
  function run(body) {
    const req = { body, merchant: { id: "m1" }, originalUrl: "/api/x" };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
    const next = vi.fn();
    sanitizeMerchantPayload(req, res, next);
    return { req, res, next };
  }

  it("replaces req.body with the sanitized copy and continues", () => {
    const { req, next } = run(JSON.parse('{"__proto__":{"x":1},"a":"b\\u0000"}'));
    expect(req.body).toEqual({ a: "b" });
    expect(next).toHaveBeenCalledWith();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ droppedKeys: ["__proto__"], merchantId: "m1" }),
      expect.any(String),
    );
  });

  it("responds 400 for structural violations without calling next", () => {
    const { res, next } = run({ s: "x".repeat(10_000) });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "Validation failed" }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("is a no-op for missing bodies", () => {
    const { next } = run(undefined);
    expect(next).toHaveBeenCalledWith();
  });

  it("does not log values of dropped keys (no secret leakage)", () => {
    run(JSON.parse('{"__proto__":{"api_key":"sk_live_secret"}}'));
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("sk_live_secret");
  });
});

describe("rotateApiKeySchema / rotateWebhookSecretSchema", () => {
  it.each([rotateApiKeySchema, rotateWebhookSecretSchema])("accepts empty and bounded bodies", (schema) => {
    expect(schema.parse({})).toEqual({});
    expect(schema.parse({ grace_period_hours: 0 })).toEqual({ grace_period_hours: 0 });
    expect(schema.parse({ grace_period_hours: 168 })).toEqual({ grace_period_hours: 168 });
  });

  it.each([
    { grace_period_hours: -1 },
    { grace_period_hours: 169 },
    { grace_period_hours: 1.5 },
    { grace_period_hours: "24" },
    { grace_period_hours: null },
    { grace_period_hours: 24, api_key: "sk_attacker" },
    { merchant_id: "someone-else" },
  ])("rejects %j", (body) => {
    expect(rotateApiKeySchema.safeParse(body).success).toBe(false);
    expect(rotateWebhookSecretSchema.safeParse(body).success).toBe(false);
  });
});

describe("normalizeApiKeyExpiry / setApiKeyExpirySchema", () => {
  const now = Date.parse("2026-01-01T00:00:00Z");

  it("normalizes offsets to UTC ISO-8601", () => {
    expect(normalizeApiKeyExpiry("2026-02-01T01:00:00+01:00", now)).toBe("2026-02-01T00:00:00.000Z");
  });

  it.each([
    ["past timestamp", "2025-12-31T00:00:00Z", /at least 1 minute in the future/],
    ["now (instant lock-out)", "2026-01-01T00:00:00Z", /at least 1 minute/],
    ["beyond 365 days", "2027-01-02T00:00:01Z", /within 365 days/],
    ["date without time", "2026-02-01", /ISO 8601/],
    ["garbage", "tomorrow", /ISO 8601/],
    ["empty", "   ", /ISO 8601/],
  ])("rejects %s", (_label, value, message) => {
    expect(() => normalizeApiKeyExpiry(value, now)).toThrow(message);
  });

  it("rejects non-strings with status 400", () => {
    for (const value of [undefined, null, 123, {}, []]) {
      try {
        normalizeApiKeyExpiry(value, now);
        throw new Error("expected to throw");
      } catch (err) {
        expect(err.status).toBe(400);
      }
    }
  });

  it("schema accepts a valid future expiry and returns the normalized value", () => {
    const future = new Date(Date.now() + 30 * DAY).toISOString();
    expect(setApiKeyExpirySchema.parse({ expires_at: future })).toEqual({
      expires_at: new Date(future).toISOString(),
    });
  });

  it("schema rejects unknown keys and missing expires_at", () => {
    const future = new Date(Date.now() + DAY).toISOString();
    expect(setApiKeyExpirySchema.safeParse({ expires_at: future, api_key: "x" }).success).toBe(false);
    expect(setApiKeyExpirySchema.safeParse({}).success).toBe(false);
  });

  it("schema reports the expiry rule on the expires_at path", () => {
    const res = setApiKeyExpirySchema.safeParse({ expires_at: "2000-01-01T00:00:00Z" });
    expect(res.success).toBe(false);
    expect(res.error.issues[0].path).toEqual(["expires_at"]);
  });
});

describe("merchantSettingsSchema", () => {
  it("accepts known settings", () => {
    expect(merchantSettingsSchema.parse({ send_success_emails: false })).toEqual({
      send_success_emails: false,
    });
    expect(merchantSettingsSchema.parse({})).toEqual({});
  });

  it("rejects unknown keys and wrong types", () => {
    expect(merchantSettingsSchema.safeParse({ send_success_emails: "yes" }).success).toBe(false);
    expect(merchantSettingsSchema.safeParse({ is_admin: true }).success).toBe(false);
  });
});

describe("resolveMerchantSettings hardening", () => {
  it("ignores inherited (prototype) values", () => {
    const proto = { send_success_emails: false };
    const input = Object.create(proto);
    expect(resolveMerchantSettings(input)).toEqual({ send_success_emails: true });
  });

  it("ignores arrays and unknown keys", () => {
    expect(resolveMerchantSettings([false])).toEqual({ send_success_emails: true });
    expect(resolveMerchantSettings({ send_success_emails: false, extra: 1 })).toEqual({
      send_success_emails: false,
    });
  });
});

describe("customHeadersSchema", () => {
  it("accepts safe headers", () => {
    expect(customHeadersSchema.parse({ "X-Tenant": "acme", Authorization: "Bearer abc" })).toEqual({
      "X-Tenant": "acme",
      Authorization: "Bearer abc",
    });
  });

  it.each([
    ["CRLF header injection", { "X-A": "ok\r\nX-Injected: 1" }],
    ["bare LF", { "X-A": "a\nb" }],
    ["non-ASCII value", { "X-A": "café" }],
    ["empty value", { "X-A": "" }],
    ["value too long", { "X-A": "x".repeat(1025) }],
    ["name with colon", { "X-A:": "v" }],
    ["name with space", { "X A": "v" }],
    ["name too long", { ["X".repeat(65)]: "v" }],
    ["reserved signature header", { "Pluto-Signature": "forged" }],
    ["reserved timestamp header", { "stellar-timestamp": "0" }],
    ["reserved host header", { Host: "evil.example" }],
    ["reserved content-length", { "Content-Length": "0" }],
    ["case-insensitive duplicates", { "X-Dup": "a", "x-dup": "b" }],
    ["non-string value", { "X-A": 1 }],
  ])("rejects %s", (_label, headers) => {
    expect(customHeadersSchema.safeParse(headers).success).toBe(false);
  });

  it(`rejects more than ${MAX_CUSTOM_HEADERS} headers`, () => {
    const many = Object.fromEntries(
      Array.from({ length: MAX_CUSTOM_HEADERS + 1 }, (_, i) => [`X-H${i}`, "v"]),
    );
    expect(customHeadersSchema.safeParse(many).success).toBe(false);
  });
});

describe("sanitizeCustomHeaders (send-time defense for legacy rows)", () => {
  it("drops CR/LF/NUL values and reserved transport headers", () => {
    expect(
      sanitizeCustomHeaders({
        "X-Ok": "fine",
        "X-Inject": "a\r\nX-Evil: 1",
        "X-Nul": "a\u0000b",
        Host: "evil.example",
        "Transfer-Encoding": "chunked",
        "PLUTO-Signature": "forged",
      }),
    ).toEqual({ "X-Ok": "fine" });
  });
});

describe("paymentLimitsSchema", () => {
  it("accepts valid limits", () => {
    expect(paymentLimitsSchema.parse({ USDC: { min: 1, max: 100 }, XLM: { max: 5 } })).toBeTruthy();
  });

  it.each([
    ["min greater than max", { USDC: { min: 10, max: 1 } }],
    ["negative min", { USDC: { min: -1 } }],
    ["unknown limit field", { USDC: { min: 1, cap: 5 } }],
    ["invalid asset code", { "US DC": { min: 1 } }],
    ["asset code too long", { ABCDEFGHIJKLM: { min: 1 } }],
    ["infinite max", { USDC: { max: Infinity } }],
  ])("rejects %s", (_label, limits) => {
    expect(paymentLimitsSchema.safeParse(limits).success).toBe(false);
  });

  it("rejects more than 50 configured assets", () => {
    const many = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`A${i}`, { min: 1 }]));
    expect(paymentLimitsSchema.safeParse(many).success).toBe(false);
  });
});
