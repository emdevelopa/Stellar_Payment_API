import { beforeEach, describe, expect, it } from "vitest";
import {
  consumeAuditLogRateLimit,
  createAuditLogRateLimitKey,
  hashAuditPayload,
  resetAuditRateLimitStateForTests,
  sanitizeAuditKey,
  sanitizeAuditValue,
  signAuditPayload,
} from "./audit-security.js";

describe("audit-security", () => {
  beforeEach(() => {
    resetAuditRateLimitStateForTests();
  });

  it("sanitizes object values into deterministic strings", () => {
    const value = sanitizeAuditValue({ b: 2, a: 1 });
    expect(value).toBe('{"a":1,"b":2}');
  });

  it("redacts sensitive audit field names", () => {
    expect(sanitizeAuditKey("api_key")).toBe("[REDACTED]");
    expect(sanitizeAuditKey("notification_email")).toBe("notification_email");
  });

  it("produces deterministic payload hashes", () => {
    const payload = { merchant_id: "m1", action: "login", status: "success" };
    expect(hashAuditPayload(payload)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashAuditPayload(payload)).toBe(hashAuditPayload(payload));
  });

  it("creates an HMAC signature when secret is provided", () => {
    const payload = { merchant_id: "m1", action: "update" };
    const signature = signAuditPayload(payload, "audit-secret");

    expect(signature).toMatch(/^[a-f0-9]{64}$/);
  });

  it("enforces per-key rate limiting in a fixed window", () => {
    const key = createAuditLogRateLimitKey({
      merchantId: "m1",
      action: "login",
      ipAddress: "127.0.0.1",
    });

    const first = consumeAuditLogRateLimit(key, {
      now: 1000,
      max: 2,
      windowMs: 60_000,
    });
    const second = consumeAuditLogRateLimit(key, {
      now: 1001,
      max: 2,
      windowMs: 60_000,
    });
    const third = consumeAuditLogRateLimit(key, {
      now: 1002,
      max: 2,
      windowMs: 60_000,
    });

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(third.allowed).toBe(false);
  });
});
