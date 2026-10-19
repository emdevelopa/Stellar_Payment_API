import { beforeEach, describe, expect, it } from "vitest";
import {
  consumeAuditLogRateLimit,
  createAuditLogRateLimitKey,
  getAuditRateLimitStats,
  hashAuditPayload,
  resetAuditRateLimitStateForTests,
  sanitizeAuditKey,
  sanitizeAuditValue,
  signAuditPayload,
  validateAuditAction,
  verifyAuditSignature,
  verifyRowIntegrity,
  reconstructPayloadFromRow,
} from "./audit-security.js";

describe("audit-security", () => {
  beforeEach(() => {
    resetAuditRateLimitStateForTests();
  });

  it("sanitizes object values into deterministic strings", () => {
    const value = sanitizeAuditValue({ b: 2, a: 1 });
    expect(value).toBe('{"a":1,"b":2}');
  });

  it("preserves the timestamp when sanitizing a Date value (#1331)", () => {
    // Date has no own enumerable properties, so the generic object-serialization
    // path used to silently collapse any Date into "{}", losing the actual
    // value entirely — e.g. a profile-change audit event recording a
    // timestamp field change.
    const date = new Date("2026-01-01T12:00:00.000Z");
    expect(sanitizeAuditValue(date)).toBe('"2026-01-01T12:00:00.000Z"');
  });

  it("produces different hashes for payloads that differ only by Date value (#1331)", () => {
    const before = hashAuditPayload({ old_value: new Date("2026-01-01T00:00:00.000Z") });
    const after = hashAuditPayload({ old_value: new Date("2026-06-01T00:00:00.000Z") });
    expect(before).not.toBe(after);
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

  it("returns null signature when no secret is provided", () => {
    const payload = { merchant_id: "m1", action: "login" };
    const sig = signAuditPayload(payload, undefined);
    expect(sig).toBeNull();
  });

  // ── verifyAuditSignature (issue #769) ──────────────────────────────────────

  it("verifies a valid HMAC signature", () => {
    const secret = "test-secret";
    const payload = { merchant_id: "m1", action: "login", status: "success" };
    const signature = signAuditPayload(payload, secret);
    expect(verifyAuditSignature(payload, signature, secret)).toBe(true);
  });

  it("rejects a tampered payload signature", () => {
    const secret = "test-secret";
    const payload = { merchant_id: "m1", action: "login", status: "success" };
    const signature = signAuditPayload(payload, secret);
    const tampered = { ...payload, status: "failure" };
    expect(verifyAuditSignature(tampered, signature, secret)).toBe(false);
  });

  it("rejects a tampered signature string", () => {
    const secret = "test-secret";
    const payload = { merchant_id: "m1", action: "login" };
    const signature = signAuditPayload(payload, secret);
    const bad = signature.replace(/.$/, signature.endsWith("a") ? "b" : "a");
    expect(verifyAuditSignature(payload, bad, secret)).toBe(false);
  });

  it("returns false when signature is null", () => {
    const payload = { merchant_id: "m1", action: "login" };
    expect(verifyAuditSignature(payload, null, "secret")).toBe(false);
  });

  it("returns false when secret is not provided", () => {
    const payload = { merchant_id: "m1", action: "login" };
    expect(verifyAuditSignature(payload, "a".repeat(64))).toBe(false);
  });

  it("is resistant to length-extension by using timingSafeEqual", () => {
    // Signatures of different length must not throw; they return false
    const secret = "test-secret";
    const payload = { merchant_id: "m1", action: "login" };
    expect(verifyAuditSignature(payload, "short", secret)).toBe(false);
  });

  // ── validateAuditAction (issue #772) ──────────────────────────────────────

  it("accepts known allowed action values", () => {
    expect(validateAuditAction("login")).toBe(true);
    expect(validateAuditAction("update")).toBe(true);
    expect(validateAuditAction("payment_initiated")).toBe(true);
  });

  it("rejects unknown action values", () => {
    expect(validateAuditAction("DROP TABLE audit_logs")).toBe(false);
    expect(validateAuditAction("arbitrary_action")).toBe(false);
    expect(validateAuditAction("")).toBe(false);
  });

  it("is case-insensitive for action validation", () => {
    expect(validateAuditAction("LOGIN")).toBe(true);
    expect(validateAuditAction("Update")).toBe(true);
  });

  it("rejects null and undefined actions", () => {
    expect(validateAuditAction(null)).toBe(false);
    expect(validateAuditAction(undefined)).toBe(false);
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

  // ── security audit additions ──────────────────────────────────────────────

  it("handles circular references and deep structures in stableStringify safely", () => {
    const obj = {};
    obj.self = obj; // circular reference

    const result = hashAuditPayload(obj);
    expect(result).toMatch(/^[a-f0-9]{64}$/);

    const deepObj = {};
    let current = deepObj;
    for (let i = 0; i < 15; i += 1) {
      current.next = {};
      current = current.next;
    }
    const deepResult = hashAuditPayload(deepObj);
    expect(deepResult).toMatch(/^[a-f0-9]{64}$/);
  });

  it("prevents rate limit state OOM by evicting keys when size exceeds limit", () => {
    for (let i = 0; i < 10005; i += 1) {
      const key = `merchant:action:${i}`;
      consumeAuditLogRateLimit(key, {
        now: 1000,
        max: 5,
        windowMs: 60000,
      });
    }

    const lastKey = "merchant:action:last";
    const res = consumeAuditLogRateLimit(lastKey, {
      now: 70000,
      max: 5,
      windowMs: 60000,
    });
    expect(res.allowed).toBe(true);
  });

  it("proactively removes expired rate-limit entries before they accumulate", () => {
    consumeAuditLogRateLimit("stale-key", {
      now: 0,
      max: 2,
      windowMs: 100,
    });

    consumeAuditLogRateLimit("fresh-key", {
      now: 150,
      max: 2,
      windowMs: 100,
    });

    const stats = getAuditRateLimitStats({ now: 150 });
    expect(stats.totalKeys).toBe(1);
    expect(stats.activeWindows).toBe(1);
    expect(stats.expiredWindows).toBe(0);
  });

  it("reconstructs payloads and verifies row integrity correctly", () => {
    const secret = "test-secret-key";
    const row = {
      merchant_id: "merchant-1",
      action: "update",
      field_changed: "email",
      old_value: "a@b.com",
      new_value: "c@d.com",
      ip_address: "1.2.3.4",
      user_agent: "ua",
      payload_hash: null,
      signature: null,
    };

    const res1 = verifyRowIntegrity(row, secret);
    expect(res1.status).toBe("failed");
    expect(res1.reason).toBe("missing_hash");

    const payload = {
      merchant_id: "merchant-1",
      action: "update",
      field_changed: "email",
      old_value: "a@b.com",
      new_value: "c@d.com",
      ip_address: "1.2.3.4",
      user_agent: "ua",
    };
    row.payload_hash = hashAuditPayload(payload);
    const res2 = verifyRowIntegrity(row, secret);
    expect(res2.status).toBe("unsigned_verified");

    row.signature = signAuditPayload(payload, secret);
    const res3 = verifyRowIntegrity(row, secret);
    expect(res3.status).toBe("verified");

    row.payload_hash = "wrong-hash";
    const res4 = verifyRowIntegrity(row, secret);
    expect(res4.status).toBe("failed");
  });
});
