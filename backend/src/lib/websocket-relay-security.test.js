import { describe, it, expect, vi } from "vitest";
import jwt from "jsonwebtoken";
import {
  validateOrigin,
  enforceMessageSizeLimit,
  verifyRelayToken,
  sanitizeRelayMessage,
  auditRelayEvent,
} from "./websocket-relay-security.js";

// ─── validateOrigin ───────────────────────────────────────────────────────────

describe("validateOrigin", () => {
  const allowed = ["https://app.example.com", "https://dashboard.example.com"];

  it("accepts an origin that is in the whitelist", () => {
    expect(validateOrigin("https://app.example.com", allowed)).toMatchObject({
      valid: true,
    });
  });

  it("rejects an origin not in the whitelist", () => {
    const result = validateOrigin("https://evil.example.com", allowed);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("not whitelisted");
  });

  it("rejects an empty origin string", () => {
    expect(validateOrigin("", allowed).valid).toBe(false);
  });

  it("rejects a null/undefined origin", () => {
    expect(validateOrigin(null, allowed).valid).toBe(false);
    expect(validateOrigin(undefined, allowed).valid).toBe(false);
  });

  it("rejects when allowedOrigins is empty", () => {
    expect(validateOrigin("https://app.example.com", []).valid).toBe(false);
  });

  it("is case-sensitive — does not accept wrong casing", () => {
    expect(validateOrigin("HTTPS://APP.EXAMPLE.COM", allowed).valid).toBe(false);
  });

  it("rejects a subdomain not on the whitelist", () => {
    expect(validateOrigin("https://sub.app.example.com", allowed).valid).toBe(false);
  });
});

// ─── enforceMessageSizeLimit ──────────────────────────────────────────────────

describe("enforceMessageSizeLimit", () => {
  it("does not throw for a message within the limit", () => {
    expect(() => enforceMessageSizeLimit("hello", 100)).not.toThrow();
  });

  it("throws when a string message exceeds the limit", () => {
    const big = "x".repeat(10);
    expect(() => enforceMessageSizeLimit(big, 5)).toThrow("exceeds limit");
  });

  it("throws when a Buffer message exceeds the limit", () => {
    const buf = Buffer.alloc(200);
    expect(() => enforceMessageSizeLimit(buf, 100)).toThrow("exceeds limit");
  });

  it("throws when a JSON-serialised object exceeds the limit", () => {
    const obj = { data: "x".repeat(200) };
    expect(() => enforceMessageSizeLimit(obj, 10)).toThrow("exceeds limit");
  });

  it("does not throw for exactly the limit size", () => {
    const msg = "x".repeat(5);
    expect(() => enforceMessageSizeLimit(msg, 5)).not.toThrow();
  });

  it("attaches code and byteLength to the thrown error", () => {
    try {
      enforceMessageSizeLimit("hello world", 3);
    } catch (err) {
      expect(err.code).toBe("MESSAGE_TOO_LARGE");
      expect(err.byteLength).toBeGreaterThan(3);
      expect(err.maxBytes).toBe(3);
    }
  });

  it("uses 65536 as the default limit", () => {
    const small = "small";
    expect(() => enforceMessageSizeLimit(small)).not.toThrow();
  });
});

// ─── verifyRelayToken ─────────────────────────────────────────────────────────

describe("verifyRelayToken", () => {
  const secret = "test-secret-key";

  it("returns valid: true with payload for a good token", () => {
    const token = jwt.sign({ sub: "relay-client", role: "relay" }, secret, {
      algorithm: "HS256",
      expiresIn: "1h",
    });
    const result = verifyRelayToken(token, secret);
    expect(result.valid).toBe(true);
    expect(result.payload.sub).toBe("relay-client");
  });

  it("returns valid: false for a token signed with a wrong secret", () => {
    const token = jwt.sign({ sub: "attacker" }, "wrong-secret", { algorithm: "HS256" });
    const result = verifyRelayToken(token, secret);
    expect(result.valid).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it("returns valid: false for an expired token", () => {
    const token = jwt.sign({ sub: "relay-client" }, secret, {
      algorithm: "HS256",
      expiresIn: -1,
    });
    const result = verifyRelayToken(token, secret);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/expired/i);
  });

  it("returns valid: false for a malformed token string", () => {
    const result = verifyRelayToken("not.a.real.jwt", secret);
    expect(result.valid).toBe(false);
  });

  it("returns valid: false when token is empty", () => {
    expect(verifyRelayToken("", secret).valid).toBe(false);
  });

  it("returns valid: false when secret is empty", () => {
    const token = jwt.sign({ sub: "x" }, secret, { algorithm: "HS256" });
    expect(verifyRelayToken(token, "").valid).toBe(false);
  });
});

// ─── sanitizeRelayMessage ─────────────────────────────────────────────────────

describe("sanitizeRelayMessage", () => {
  it("returns the message unchanged when all fields are allowed", () => {
    const msg = { type: "payment.confirmed", payment_id: "abc123", payload: {} };
    const { sanitized, warnings } = sanitizeRelayMessage(msg);
    expect(sanitized).toMatchObject(msg);
    expect(warnings).toHaveLength(0);
  });

  it("strips unknown fields", () => {
    const msg = {
      type: "payment.confirmed",
      payment_id: "abc",
      __proto__: "attack",
      injected: "bad",
    };
    const { sanitized, warnings } = sanitizeRelayMessage(msg);
    expect(sanitized).not.toHaveProperty("injected");
    expect(warnings.some((w) => w.includes("injected"))).toBe(true);
  });

  it("throws when the message is not an object", () => {
    expect(() => sanitizeRelayMessage("string")).toThrow();
    expect(() => sanitizeRelayMessage(42)).toThrow();
    expect(() => sanitizeRelayMessage(null)).toThrow();
    expect(() => sanitizeRelayMessage([])).toThrow();
  });

  it("throws when the 'type' field is missing", () => {
    expect(() => sanitizeRelayMessage({ payment_id: "abc" })).toThrow(
      /type/i,
    );
  });

  it("throws when 'type' is an empty string", () => {
    expect(() => sanitizeRelayMessage({ type: "" })).toThrow();
  });

  it("includes warning messages for each stripped field", () => {
    const msg = { type: "relay.send", unknownA: 1, unknownB: 2 };
    const { warnings } = sanitizeRelayMessage(msg);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain("unknownA");
    expect(warnings[1]).toContain("unknownB");
  });
});

// ─── auditRelayEvent ──────────────────────────────────────────────────────────

describe("auditRelayEvent", () => {
  it("calls the emit function with a JSON string", () => {
    const emit = vi.fn();
    auditRelayEvent("connection.rejected", { origin: "https://evil.com" }, { emit });
    expect(emit).toHaveBeenCalledTimes(1);
    const logLine = emit.mock.calls[0][0];
    const parsed = JSON.parse(logLine);
    expect(parsed.audit).toBe(true);
    expect(parsed.event).toBe("connection.rejected");
    expect(parsed.origin).toBe("https://evil.com");
    expect(typeof parsed.ts).toBe("string");
  });

  it("works without metadata", () => {
    const emit = vi.fn();
    auditRelayEvent("token.verified", undefined, { emit });
    const parsed = JSON.parse(emit.mock.calls[0][0]);
    expect(parsed.event).toBe("token.verified");
  });
});
