import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SIGNATURE_TOLERANCE_SECONDS,
  GATEWAY_VALIDATION_CODES,
  GATEWAY_VALIDATION_LIMITS,
  MAX_SIGNATURE_TOLERANCE_SECONDS,
  resolveSignatureToleranceSeconds,
  sanitizeForLog,
  validateSignatureBody,
  validateSignatureRequestParts,
} from "./api-gateway-payload-validation.js";

vi.mock("./logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const VALID_PARTS = {
  method: "POST",
  path: "/api/payments?limit=10",
  timestampHeader: "1713916800",
  signatureHeader: `sha256=${"a".repeat(64)}`,
};

function nest(depth) {
  let value = { leaf: true };
  for (let i = 0; i < depth; i++) value = { child: value };
  return value;
}

describe("sanitizeForLog", () => {
  it("replaces control characters so log lines cannot be forged", () => {
    expect(sanitizeForLog("abc\r\nINFO forged entry")).toBe("abc??INFO forged entry");
    expect(sanitizeForLog("a\u0000b\u001bc\u007f")).toBe("a?b?c?");
  });

  it("truncates long values and reports how much was cut", () => {
    const result = sanitizeForLog("x".repeat(100), 10);
    expect(result).toBe(`${"x".repeat(10)}…(+90 chars)`);
  });

  it("reduces non-string values to their type instead of dumping them", () => {
    expect(sanitizeForLog({ secret: "s" })).toBe("[object]");
    expect(sanitizeForLog(["a"])).toBe("[array]");
    expect(sanitizeForLog(() => {})).toBe("[function]");
  });

  it("passes through primitives and nullish values unchanged", () => {
    expect(sanitizeForLog(42)).toBe(42);
    expect(sanitizeForLog(false)).toBe(false);
    expect(sanitizeForLog(null)).toBeNull();
    expect(sanitizeForLog(undefined)).toBeUndefined();
  });
});

describe("validateSignatureRequestParts", () => {
  const { INVALID_REQUEST } = GATEWAY_VALIDATION_CODES;

  it("accepts a well-formed request", () => {
    expect(validateSignatureRequestParts(VALID_PARTS)).toEqual({ valid: true });
  });

  it("accepts lowercase methods and omitted method/path (canonical defaults)", () => {
    expect(validateSignatureRequestParts({ ...VALID_PARTS, method: "post" }).valid).toBe(true);
    expect(validateSignatureRequestParts({ ...VALID_PARTS, method: undefined, path: undefined }).valid).toBe(true);
  });

  it.each([
    ["unknown verb", "TRACE"],
    ["CR/LF injection", "POST\n/api/admin"],
    ["non-string", 123],
    ["empty string", ""],
  ])("rejects method: %s", (_label, method) => {
    const result = validateSignatureRequestParts({ ...VALID_PARTS, method });
    expect(result).toMatchObject({ valid: false, code: INVALID_REQUEST, detail: "method" });
  });

  it.each([
    ["relative path", "api/payments"],
    ["absolute URL", "https://evil.example/api"],
    ["newline injection", "/api/payments\n1713916800"],
    ["NUL byte", "/api/pay\u0000ments"],
    ["non-string", ["/api"]],
    ["too long", `/${"a".repeat(GATEWAY_VALIDATION_LIMITS.maxPathLength)}`],
  ])("rejects path: %s", (_label, path) => {
    const result = validateSignatureRequestParts({ ...VALID_PARTS, path });
    expect(result).toMatchObject({ valid: false, code: INVALID_REQUEST, detail: "path" });
  });

  it("rejects oversized or non-string timestamp headers before parsing", () => {
    expect(
      validateSignatureRequestParts({ ...VALID_PARTS, timestampHeader: "1".repeat(13) }),
    ).toMatchObject({ valid: false, detail: "timestamp" });
    expect(
      validateSignatureRequestParts({ ...VALID_PARTS, timestampHeader: { n: 1 } }),
    ).toMatchObject({ valid: false, detail: "timestamp" });
  });

  it("accepts numeric timestamps (internal callers)", () => {
    expect(validateSignatureRequestParts({ ...VALID_PARTS, timestampHeader: 1713916800 }).valid).toBe(true);
  });

  it("rejects oversized or non-string signature headers", () => {
    expect(
      validateSignatureRequestParts({ ...VALID_PARTS, signatureHeader: `sha256=${"a".repeat(200)}` }),
    ).toMatchObject({ valid: false, detail: "signature" });
    expect(
      validateSignatureRequestParts({ ...VALID_PARTS, signatureHeader: ["sha256=a", "sha256=b"] }),
    ).toMatchObject({ valid: false, detail: "signature" });
  });

  it("leaves missing headers to the verifier's existing format checks", () => {
    expect(
      validateSignatureRequestParts({ ...VALID_PARTS, timestampHeader: undefined, signatureHeader: undefined }).valid,
    ).toBe(true);
  });
});

describe("validateSignatureBody", () => {
  const { INVALID_PAYLOAD } = GATEWAY_VALIDATION_CODES;

  it.each([
    ["no body", undefined],
    ["null", null],
    ["empty object", {}],
    ["typical payment", { amount: 12.5, asset: "USDC", memo: "order #1", tags: ["a", "b"], meta: { ok: true } }],
    ["array root", [1, "two", null]],
    ["string root", "raw"],
    ["null-prototype object", Object.assign(Object.create(null), { a: 1 })],
  ])("accepts %s", (_label, body) => {
    expect(validateSignatureBody(body)).toEqual({ valid: true });
  });

  it.each([
    ["__proto__", JSON.parse('{"a":{"__proto__":{"isAdmin":true}}}'), "body.a.__proto__"],
    ["constructor", { constructor: { prototype: {} } }, "body.constructor"],
    ["prototype", { items: [{ prototype: 1 }] }, "body.items[0].prototype"],
  ])("rejects prototype-pollution key %s and reports where", (_label, body, at) => {
    expect(validateSignatureBody(body)).toMatchObject({ valid: false, code: INVALID_PAYLOAD, detail: at });
  });

  it.each([
    ["NaN (serializes as null)", { amount: NaN }],
    ["Infinity", { amount: Infinity }],
    ["nested undefined (dropped by JSON)", { a: undefined }],
    ["function", { fn: () => {} }],
    ["BigInt", { n: BigInt(1) }],
    ["Date", { at: new Date(0) }],
    ["Buffer", { data: Buffer.from("x") }],
    ["Map", { m: new Map() }],
    ["symbol", { s: Symbol("x") }],
  ])("rejects values JSON would silently rewrite: %s", (_label, body) => {
    expect(validateSignatureBody(body)).toMatchObject({ valid: false, code: INVALID_PAYLOAD });
  });

  it("enforces the maximum nesting depth", () => {
    const { maxBodyDepth } = GATEWAY_VALIDATION_LIMITS;
    expect(validateSignatureBody(nest(maxBodyDepth - 1)).valid).toBe(true);
    expect(validateSignatureBody(nest(maxBodyDepth + 1))).toMatchObject({
      valid: false,
      reason: expect.stringMatching(/depth/),
    });
  });

  it("handles extremely deep bodies without overflowing the stack", () => {
    expect(() => validateSignatureBody(nest(100000))).not.toThrow();
    expect(validateSignatureBody(nest(100000)).valid).toBe(false);
  });

  it("enforces the maximum node count", () => {
    const big = { items: new Array(GATEWAY_VALIDATION_LIMITS.maxBodyNodes).fill(1) };
    expect(validateSignatureBody(big)).toMatchObject({ valid: false, reason: expect.stringMatching(/too large/) });
  });

  it("rejects circular structures (via the node limit) instead of looping forever", () => {
    const circular = { a: 1 };
    circular.self = circular;
    expect(validateSignatureBody(circular).valid).toBe(false);
  });
});

describe("resolveSignatureToleranceSeconds", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the default when unset or empty", () => {
    expect(resolveSignatureToleranceSeconds(undefined)).toBe(DEFAULT_SIGNATURE_TOLERANCE_SECONDS);
    expect(resolveSignatureToleranceSeconds("")).toBe(DEFAULT_SIGNATURE_TOLERANCE_SECONDS);
  });

  it("accepts valid numbers and numeric strings", () => {
    expect(resolveSignatureToleranceSeconds(120)).toBe(120);
    expect(resolveSignatureToleranceSeconds(" 60 ")).toBe(60);
  });

  it.each([["abc"], [NaN], [0], [-30], ["Infinity"]])(
    "falls back to the default for invalid value %s",
    (raw) => {
      expect(resolveSignatureToleranceSeconds(raw)).toBe(DEFAULT_SIGNATURE_TOLERANCE_SECONDS);
    },
  );

  it("caps excessively large windows", () => {
    expect(resolveSignatureToleranceSeconds(86400)).toBe(MAX_SIGNATURE_TOLERANCE_SECONDS);
  });

  it("reads API_GATEWAY_SIGNATURE_TOLERANCE_SECONDS by default", () => {
    vi.stubEnv("API_GATEWAY_SIGNATURE_TOLERANCE_SECONDS", "45");
    expect(resolveSignatureToleranceSeconds()).toBe(45);
    vi.stubEnv("API_GATEWAY_SIGNATURE_TOLERANCE_SECONDS", "not-a-number");
    expect(resolveSignatureToleranceSeconds()).toBe(DEFAULT_SIGNATURE_TOLERANCE_SECONDS);
  });
});
