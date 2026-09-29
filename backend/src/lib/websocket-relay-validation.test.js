import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import {
  sanitizeRelayString,
  sanitizeRelayPayload,
  sanitizeOutboundPayload,
  relayPayloadByteLength,
  validateInboundRelayEvent,
  createRelayGuard,
  RelayValidationError,
  RELAY_PAYLOAD_LIMITS,
  RELAY_ERROR_EVENT,
  DEFAULT_MAX_VIOLATIONS,
} from "./websocket-relay-validation.js";

const MERCHANT_ID = "3f1c2b4a-8d6e-4f7a-9b0c-1d2e3f4a5b6c";
const PAYMENT_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";

// ─── sanitizeRelayString ──────────────────────────────────────────────────────

describe("sanitizeRelayString", () => {
  it("removes C0/C1 control characters but keeps tab, newline and CR", () => {
    expect(sanitizeRelayString("a\u0000b\u0007c\u001Fd\u007Fe\u0085f")).toBe("abcdef");
    expect(sanitizeRelayString("line1\nline2\tx\r")).toBe("line1\nline2\tx\r");
  });

  it("removes bidi override characters used for text spoofing", () => {
    expect(sanitizeRelayString("pay‮moc.live")).toBe("paymoc.live");
    expect(sanitizeRelayString("⁦x⁩")).toBe("x");
  });

  it("normalises to NFC", () => {
    expect(sanitizeRelayString("é")).toBe("é");
  });
});

// ─── sanitizeRelayPayload ─────────────────────────────────────────────────────

describe("sanitizeRelayPayload", () => {
  it("returns an equal deep copy for clean input", () => {
    const input = { a: 1, b: "x", c: [true, null, { d: 2.5 }] };
    const out = sanitizeRelayPayload(input);
    expect(out).toEqual(input);
    expect(out).not.toBe(input);
    expect(out.c).not.toBe(input.c);
  });

  it("strips prototype-pollution keys at every depth", () => {
    const input = JSON.parse(
      '{"__proto__":{"polluted":true},"nested":{"constructor":{"prototype":{"x":1}},"prototype":1,"ok":1}}',
    );
    const out = sanitizeRelayPayload(input);
    expect(Object.keys(out)).toEqual(["nested"]);
    expect(out.nested).toEqual({ ok: 1 });
    expect({}.polluted).toBeUndefined();
  });

  it("strips keys that only become forbidden after sanitization", () => {
    const out = sanitizeRelayPayload({ ["__pro\u0000to__"]: { x: 1 }, ["\u0000"]: 1 });
    expect(out).toEqual({});
  });

  it("sanitizes strings inside objects and arrays", () => {
    expect(sanitizeRelayPayload({ s: "a\u0000b", arr: ["‮c"] })).toEqual({
      s: "ab",
      arr: ["c"],
    });
  });

  it("drops undefined, function and symbol values; arrays get null", () => {
    const out = sanitizeRelayPayload({
      u: undefined,
      f: () => {},
      s: Symbol("x"),
      arr: [undefined, () => {}],
      keep: 0,
    });
    expect(out).toEqual({ keep: 0, arr: [null, null] });
  });

  it("converts dates to ISO strings and rejects invalid dates", () => {
    const d = new Date("2026-01-01T00:00:00.000Z");
    expect(sanitizeRelayPayload({ d })).toEqual({ d: "2026-01-01T00:00:00.000Z" });
    expect(() => sanitizeRelayPayload({ d: new Date("nope") })).toThrow(RelayValidationError);
  });

  it.each([
    ["NaN", { n: NaN }, "INVALID_NUMBER"],
    ["Infinity", { n: Infinity }, "INVALID_NUMBER"],
    ["BigInt", { n: 1n }, "UNSUPPORTED_TYPE"],
    ["Buffer", { b: Buffer.from("x") }, "UNSUPPORTED_TYPE"],
    ["ArrayBuffer", { b: new ArrayBuffer(2) }, "UNSUPPORTED_TYPE"],
  ])("rejects %s values", (_label, input, code) => {
    expect(() => sanitizeRelayPayload(input)).toThrow(expect.objectContaining({ code }));
  });

  it("rejects circular references", () => {
    const a = { b: {} };
    a.b.a = a;
    expect(() => sanitizeRelayPayload(a)).toThrow(
      expect.objectContaining({ code: "CIRCULAR_REFERENCE" }),
    );
  });

  it("allows the same object to appear twice in sibling positions", () => {
    const shared = { x: 1 };
    expect(sanitizeRelayPayload({ a: shared, b: shared })).toEqual({ a: { x: 1 }, b: { x: 1 } });
  });

  it("enforces maximum depth", () => {
    let deep = {};
    const root = deep;
    for (let i = 0; i < RELAY_PAYLOAD_LIMITS.maxDepth + 1; i++) {
      deep.next = {};
      deep = deep.next;
    }
    expect(() => sanitizeRelayPayload(root)).toThrow(
      expect.objectContaining({ code: "PAYLOAD_TOO_DEEP" }),
    );
    expect(() => sanitizeRelayPayload({ a: { b: {} } }, { maxDepth: 3 })).not.toThrow();
  });

  it("enforces key, array and string limits", () => {
    const manyKeys = Object.fromEntries(
      Array.from({ length: RELAY_PAYLOAD_LIMITS.maxKeys + 1 }, (_, i) => [`k${i}`, i]),
    );
    expect(() => sanitizeRelayPayload(manyKeys)).toThrow(
      expect.objectContaining({ code: "TOO_MANY_KEYS" }),
    );
    expect(() =>
      sanitizeRelayPayload({ a: new Array(RELAY_PAYLOAD_LIMITS.maxArrayLength + 1).fill(0) }),
    ).toThrow(expect.objectContaining({ code: "ARRAY_TOO_LONG" }));
    expect(() =>
      sanitizeRelayPayload({ s: "x".repeat(RELAY_PAYLOAD_LIMITS.maxStringLength + 1) }),
    ).toThrow(expect.objectContaining({ code: "STRING_TOO_LONG" }));
  });

  it("returns an object without an inherited prototype-pollution surface", () => {
    const out = sanitizeRelayPayload(JSON.parse('{"__proto__":{"admin":true}}'));
    expect(out.admin).toBeUndefined();
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
  });
});

// ─── relayPayloadByteLength ───────────────────────────────────────────────────

describe("relayPayloadByteLength", () => {
  it("measures UTF-8 serialised bytes", () => {
    expect(relayPayloadByteLength({ a: "é" })).toBe(Buffer.byteLength('{"a":"é"}'));
  });

  it("throws RelayValidationError on unserialisable input", () => {
    const a = {};
    a.self = a;
    expect(() => relayPayloadByteLength(a)).toThrow(
      expect.objectContaining({ code: "UNSERIALIZABLE" }),
    );
  });
});

// ─── validateInboundRelayEvent ────────────────────────────────────────────────

describe("validateInboundRelayEvent", () => {
  it.each([
    ["join:merchant", { merchant_id: MERCHANT_ID }],
    ["join:checkout", { payment_id: PAYMENT_ID }],
    ["leave:checkout", { payment_id: PAYMENT_ID }],
  ])("accepts a valid %s payload", (event, payload) => {
    expect(validateInboundRelayEvent(event, payload)).toEqual({ ok: true, data: payload });
  });

  it("lower-cases and trims UUIDs so room names are canonical", () => {
    const result = validateInboundRelayEvent("join:merchant", {
      merchant_id: `  ${MERCHANT_ID.toUpperCase()} `,
    });
    expect(result).toEqual({ ok: true, data: { merchant_id: MERCHANT_ID } });
  });

  it("rejects unknown events", () => {
    const result = validateInboundRelayEvent("admin:broadcast", {});
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("UNKNOWN_EVENT");
  });

  it("does not treat Object.prototype keys as registered events", () => {
    expect(validateInboundRelayEvent("toString", {}).error.code).toBe("UNKNOWN_EVENT");
    expect(validateInboundRelayEvent("__proto__", {}).error.code).toBe("UNKNOWN_EVENT");
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a string", PAYMENT_ID],
    ["a number", 42],
    ["an array", [PAYMENT_ID]],
  ])("rejects %s payload", (_label, payload) => {
    const result = validateInboundRelayEvent("join:checkout", payload);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("INVALID_PAYLOAD");
  });

  it("rejects unknown keys (strict schema)", () => {
    const result = validateInboundRelayEvent("join:checkout", {
      payment_id: PAYMENT_ID,
      room: "merchant:someone-else",
    });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("VALIDATION_FAILED");
  });

  it.each([
    ["missing", {}],
    ["empty", { merchant_id: "" }],
    ["non-string", { merchant_id: 123 }],
    ["non-UUID", { merchant_id: "not-a-uuid" }],
    ["room injection", { merchant_id: `${MERCHANT_ID}:admin` }],
    ["nested object", { merchant_id: { $ne: null } }],
  ])("rejects a %s merchant_id", (_label, payload) => {
    const result = validateInboundRelayEvent("join:merchant", payload);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("VALIDATION_FAILED");
    expect(result.error.issues[0].path).toBe("merchant_id");
  });

  it("strips control characters before validating", () => {
    const result = validateInboundRelayEvent("join:checkout", {
      payment_id: `${PAYMENT_ID}\u0000`,
    });
    expect(result).toEqual({ ok: true, data: { payment_id: PAYMENT_ID } });
  });

  it("ignores __proto__ smuggling rather than failing the strict check", () => {
    const payload = JSON.parse(`{"payment_id":"${PAYMENT_ID}","__proto__":{"x":1}}`);
    expect(validateInboundRelayEvent("join:checkout", payload)).toEqual({
      ok: true,
      data: { payment_id: PAYMENT_ID },
    });
  });

  it("rejects payloads larger than the byte limit before deep inspection", () => {
    const result = validateInboundRelayEvent("join:checkout", {
      payment_id: PAYMENT_ID,
      pad: "x".repeat(RELAY_PAYLOAD_LIMITS.maxBytes),
    });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("maps sanitization failures to their error code", () => {
    const circular = { payment_id: PAYMENT_ID };
    circular.self = circular;
    expect(validateInboundRelayEvent("join:checkout", circular).error.code).toBe(
      "UNSERIALIZABLE",
    );
    expect(
      validateInboundRelayEvent("join:checkout", { payment_id: PAYMENT_ID, n: 1n }).error.code,
    ).toBe("UNSERIALIZABLE");
  });

  it("does not echo the raw payload back in the error", () => {
    const secret = "sk_live_should_not_be_echoed";
    const result = validateInboundRelayEvent("join:merchant", { merchant_id: secret });
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});

// ─── sanitizeOutboundPayload ──────────────────────────────────────────────────

describe("sanitizeOutboundPayload", () => {
  it("sanitizes emitted payloads and serialises dates", () => {
    const out = sanitizeOutboundPayload({
      id: PAYMENT_ID,
      memo: "hello‮evil",
      confirmed_at: new Date("2026-01-01T00:00:00.000Z"),
      extra: undefined,
    });
    expect(out).toEqual({
      id: PAYMENT_ID,
      memo: "helloevil",
      confirmed_at: "2026-01-01T00:00:00.000Z",
    });
  });

  it("uses more generous limits than inbound validation", () => {
    const long = "x".repeat(RELAY_PAYLOAD_LIMITS.maxStringLength + 1);
    expect(sanitizeOutboundPayload({ s: long }).s).toBe(long);
  });
});

// ─── createRelayGuard ─────────────────────────────────────────────────────────

class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.id = "socket-1";
    this.sent = [];
    this.disconnected = false;
    this.anyListeners = [];
  }

  onAny(listener) {
    this.anyListeners.push(listener);
  }

  // Mirrors socket.io: catch-all listeners run before the event's own listeners
  receive(event, ...args) {
    for (const listener of this.anyListeners) listener(event, ...args);
    super.emit(event, ...args);
  }

  emit(event, ...args) {
    this.sent.push([event, ...args]);
    return true;
  }

  disconnect(close) {
    this.disconnected = close;
  }
}

describe("createRelayGuard", () => {
  let socket;
  let logger;

  beforeEach(() => {
    socket = new FakeSocket();
    logger = { warn: vi.fn(), error: vi.fn() };
  });

  it("passes validated data to the handler", () => {
    const guard = createRelayGuard(socket, { logger });
    const handler = vi.fn();
    guard.on("join:merchant", handler);

    socket.receive("join:merchant", { merchant_id: MERCHANT_ID.toUpperCase() });

    expect(handler).toHaveBeenCalledWith({ merchant_id: MERCHANT_ID }, undefined);
    expect(socket.sent).toEqual([]);
    expect(guard.violations()).toBe(0);
  });

  it("forwards the ack callback to the handler", () => {
    const guard = createRelayGuard(socket, { logger });
    const handler = vi.fn((_data, ack) => ack({ ok: true }));
    const ack = vi.fn();
    guard.on("join:checkout", handler);

    socket.receive("join:checkout", { payment_id: PAYMENT_ID }, ack);

    expect(ack).toHaveBeenCalledWith({ ok: true });
  });

  it("does not crash on a missing payload (previous destructuring TypeError)", () => {
    const guard = createRelayGuard(socket, { logger });
    const handler = vi.fn();
    guard.on("join:merchant", handler);

    expect(() => socket.receive("join:merchant")).not.toThrow();
    expect(() => socket.receive("join:merchant", null)).not.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });

  it("emits relay:error and logs without the raw payload on invalid input", () => {
    const guard = createRelayGuard(socket, { logger });
    const handler = vi.fn();
    guard.on("join:merchant", handler);

    socket.receive("join:merchant", { merchant_id: "secret-token-value" });

    expect(handler).not.toHaveBeenCalled();
    expect(socket.sent).toHaveLength(1);
    const [event, body] = socket.sent[0];
    expect(event).toBe(RELAY_ERROR_EVENT);
    expect(body).toMatchObject({
      ok: false,
      event: "join:merchant",
      error: { code: "VALIDATION_FAILED" },
    });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("secret-token-value");
  });

  it("replies through the ack callback instead of relay:error when provided", () => {
    const guard = createRelayGuard(socket, { logger });
    guard.on("join:checkout", vi.fn());
    const ack = vi.fn();

    socket.receive("join:checkout", { payment_id: 1 }, ack);

    expect(ack).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, error: expect.objectContaining({ code: "VALIDATION_FAILED" }) }),
    );
    expect(socket.sent).toEqual([]);
  });

  it("rejects events that have no registered handler", () => {
    const guard = createRelayGuard(socket, { logger });
    guard.on("join:merchant", vi.fn());

    socket.receive("admin:broadcast", { anything: true });

    expect(socket.sent[0][1]).toMatchObject({
      event: "admin:broadcast",
      error: { code: "UNKNOWN_EVENT" },
    });
    expect(guard.violations()).toBe(1);
  });

  it("does not double-count registered events via the catch-all listener", () => {
    const guard = createRelayGuard(socket, { logger });
    guard.on("join:merchant", vi.fn());

    socket.receive("join:merchant", { merchant_id: "bad" });

    expect(guard.violations()).toBe(1);
    expect(socket.sent).toHaveLength(1);
  });

  it("disconnects the socket after maxViolations invalid events", () => {
    const guard = createRelayGuard(socket, { logger, maxViolations: 3 });
    guard.on("join:checkout", vi.fn());

    socket.receive("join:checkout", {});
    socket.receive("join:checkout", {});
    expect(socket.disconnected).toBe(false);
    socket.receive("join:checkout", {});

    expect(socket.disconnected).toBe(true);
    expect(guard.violations()).toBe(3);
  });

  it("defaults maxViolations to DEFAULT_MAX_VIOLATIONS", () => {
    const guard = createRelayGuard(socket, { logger });
    guard.on("join:checkout", vi.fn());

    for (let i = 0; i < DEFAULT_MAX_VIOLATIONS - 1; i++) socket.receive("join:checkout", {});
    expect(socket.disconnected).toBe(false);
    socket.receive("join:checkout", {});
    expect(socket.disconnected).toBe(true);
  });

  it("contains handler exceptions and reports INTERNAL_ERROR", () => {
    const guard = createRelayGuard(socket, { logger });
    guard.on("join:checkout", () => {
      throw new Error("boom");
    });

    expect(() => socket.receive("join:checkout", { payment_id: PAYMENT_ID })).not.toThrow();
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(socket.sent[0][1]).toMatchObject({ error: { code: "INTERNAL_ERROR" } });
    expect(guard.violations()).toBe(0);
  });

  it("refuses to register a handler for an event without a schema", () => {
    const guard = createRelayGuard(socket, { logger });
    expect(() => guard.on("custom:event", vi.fn())).toThrow(/No relay schema/);
  });

  it("works on sockets without onAny", () => {
    const bare = new FakeSocket();
    bare.onAny = undefined;
    const guard = createRelayGuard(bare, { logger });
    const handler = vi.fn();
    guard.on("join:checkout", handler);
    bare.receive = (event, ...args) => EventEmitter.prototype.emit.call(bare, event, ...args);

    bare.receive("join:checkout", { payment_id: PAYMENT_ID });
    expect(handler).toHaveBeenCalled();
  });
});
