import { describe, it, expect, vi } from "vitest";

// Stub Supabase before importing webhooks so the missing-env-var guard doesn't fire.
vi.mock("../../src/lib/supabase.js", () => ({ supabase: {} }));

import { sanitizeCustomHeaders } from "../../src/lib/webhooks.js";

describe("sanitizeCustomHeaders", () => {
  it("returns empty object for null/undefined input", () => {
    expect(sanitizeCustomHeaders(null)).toEqual({});
    expect(sanitizeCustomHeaders(undefined)).toEqual({});
  });

  it("returns empty object for non-object input", () => {
    expect(sanitizeCustomHeaders("string")).toEqual({});
    expect(sanitizeCustomHeaders([])).toEqual({});
    expect(sanitizeCustomHeaders(42)).toEqual({});
  });

  it("passes through valid headers", () => {
    const result = sanitizeCustomHeaders({
      "X-My-Auth": "token123",
      "X-Source": "stellar-pay",
    });
    expect(result["X-My-Auth"]).toBe("token123");
    expect(result["X-Source"]).toBe("stellar-pay");
  });

  it("drops headers with unsafe names", () => {
    const result = sanitizeCustomHeaders({
      "X-Valid": "ok",
      "Bad Header!": "should-drop",
      "Also Bad<>": "drop",
    });
    expect(Object.keys(result)).toEqual(["X-Valid"]);
  });

  it("drops reserved system headers regardless of case", () => {
    const result = sanitizeCustomHeaders({
      "content-type": "text/plain",
      "User-Agent": "hacker",
      "STELLAR-SIGNATURE": "fake",
      "X-Custom": "keep",
    });
    expect(result).toEqual({ "X-Custom": "keep" });
  });

  it("drops headers with empty string values", () => {
    const result = sanitizeCustomHeaders({
      "X-Empty": "",
      "X-Keep": "value",
    });
    expect(result).toEqual({ "X-Keep": "value" });
  });

  it("drops headers with non-string values", () => {
    const result = sanitizeCustomHeaders({
      "X-Number": 123,
      "X-Bool": true,
      "X-String": "ok",
    });
    expect(result).toEqual({ "X-String": "ok" });
  });
});
