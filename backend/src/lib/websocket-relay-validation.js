/**
 * websocket-relay-validation.js
 *
 * Payload sanitization and strict validation for the Socket.IO relay (issue #1452).
 *
 *   - sanitizeRelayPayload(): deep, JSON-safe clone that strips prototype-pollution
 *     keys and control characters and enforces depth / size limits
 *   - validateInboundRelayEvent(): allow-listed inbound events, each checked
 *     against a strict zod schema (unknown keys rejected, IDs must be UUIDs)
 *   - sanitizeOutboundPayload(): same deep sanitization for server → client emits
 *   - createRelayGuard(): per-socket wrapper that validates every inbound event,
 *     reports errors to the client, logs them, and disconnects repeat offenders
 */

import { z } from "zod";

// ─── Limits ───────────────────────────────────────────────────────────────────

export const RELAY_PAYLOAD_LIMITS = Object.freeze({
  maxBytes: 4096,
  maxDepth: 8,
  maxKeys: 64,
  maxArrayLength: 256,
  maxStringLength: 2048,
});

/** Invalid events tolerated per socket before it is disconnected. */
export const DEFAULT_MAX_VIOLATIONS = 10;

/** Event name used to report validation failures back to the client. */
export const RELAY_ERROR_EVENT = "relay:error";

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

// C0/C1 control characters (except \t \n \r) and Unicode bidi overrides, which
// can be used to spoof text rendered in dashboards and logs.
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F‪-‮⁦-⁩]/g;

// ─── Errors ───────────────────────────────────────────────────────────────────

export class RelayValidationError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "RelayValidationError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

// ─── Deep sanitization ────────────────────────────────────────────────────────

/**
 * Strip unsafe characters from a string and normalise it to NFC.
 *
 * @param {string} value
 * @returns {string}
 */
export function sanitizeRelayString(value) {
  return value.normalize("NFC").replace(UNSAFE_CHARS_RE, "");
}

/**
 * Return a sanitized, JSON-safe deep copy of `value`.
 *
 * - Keys `__proto__`, `constructor` and `prototype` are dropped.
 * - Strings are NFC-normalised and stripped of control / bidi characters.
 * - `undefined`, functions and symbols are dropped (as JSON.stringify would).
 * - Dates become ISO strings; non-finite numbers, BigInts, binary data and
 *   circular references are rejected.
 * - Depth, key count, array length and string length are bounded.
 *
 * @param {any} value
 * @param {Partial<typeof RELAY_PAYLOAD_LIMITS>} [limits]
 * @returns {any}
 * @throws {RelayValidationError}
 */
export function sanitizeRelayPayload(value, limits = {}) {
  const opts = { ...RELAY_PAYLOAD_LIMITS, ...limits };
  return sanitizeNode(value, opts, 0, new WeakSet(), "$");
}

function sanitizeNode(value, opts, depth, seen, path) {
  if (value === null) return null;

  switch (typeof value) {
    case "string":
      if (value.length > opts.maxStringLength) {
        throw new RelayValidationError(
          "STRING_TOO_LONG",
          `String at ${path} exceeds ${opts.maxStringLength} characters`,
        );
      }
      return sanitizeRelayString(value);
    case "number":
      if (!Number.isFinite(value)) {
        throw new RelayValidationError("INVALID_NUMBER", `Non-finite number at ${path}`);
      }
      return value;
    case "boolean":
      return value;
    case "undefined":
    case "function":
    case "symbol":
      return undefined;
    case "bigint":
      throw new RelayValidationError("UNSUPPORTED_TYPE", `BigInt at ${path} is not allowed`);
    default:
      break;
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new RelayValidationError("INVALID_DATE", `Invalid date at ${path}`);
    }
    return value.toISOString();
  }

  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    throw new RelayValidationError("UNSUPPORTED_TYPE", `Binary data at ${path} is not allowed`);
  }

  if (depth >= opts.maxDepth) {
    throw new RelayValidationError(
      "PAYLOAD_TOO_DEEP",
      `Payload exceeds maximum nesting depth of ${opts.maxDepth}`,
    );
  }

  if (seen.has(value)) {
    throw new RelayValidationError("CIRCULAR_REFERENCE", `Circular reference at ${path}`);
  }
  seen.add(value);

  try {
    if (Array.isArray(value)) {
      if (value.length > opts.maxArrayLength) {
        throw new RelayValidationError(
          "ARRAY_TOO_LONG",
          `Array at ${path} exceeds ${opts.maxArrayLength} items`,
        );
      }
      return value.map((item, i) => {
        const clean = sanitizeNode(item, opts, depth + 1, seen, `${path}[${i}]`);
        return clean === undefined ? null : clean;
      });
    }

    const keys = Object.keys(value);
    if (keys.length > opts.maxKeys) {
      throw new RelayValidationError(
        "TOO_MANY_KEYS",
        `Object at ${path} exceeds ${opts.maxKeys} keys`,
      );
    }

    const out = {};
    for (const rawKey of keys) {
      const key = sanitizeRelayString(rawKey);
      if (FORBIDDEN_KEYS.has(key) || key === "") continue;
      const clean = sanitizeNode(value[rawKey], opts, depth + 1, seen, `${path}.${key}`);
      if (clean !== undefined) out[key] = clean;
    }
    return out;
  } finally {
    seen.delete(value);
  }
}

/**
 * Byte length of `value` once serialised for the wire.
 *
 * @param {any} value
 * @returns {number}
 * @throws {RelayValidationError} When the value cannot be serialised
 */
export function relayPayloadByteLength(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
  } catch {
    throw new RelayValidationError("UNSERIALIZABLE", "Payload cannot be serialised");
  }
}

// ─── Inbound event schemas ────────────────────────────────────────────────────

const uuid = (field) =>
  z
    .string({
      required_error: `${field} is required`,
      invalid_type_error: `${field} must be a string`,
    })
    .trim()
    .uuid(`${field} must be a valid UUID`)
    .transform((v) => v.toLowerCase());

/**
 * Strict schemas for every inbound event the relay accepts. Any event not
 * listed here is rejected, and unknown keys inside a payload are rejected
 * rather than silently ignored.
 */
export const INBOUND_EVENT_SCHEMAS = Object.freeze({
  "join:merchant": z.object({ merchant_id: uuid("merchant_id") }).strict(),
  "join:checkout": z.object({ payment_id: uuid("payment_id") }).strict(),
  "leave:checkout": z.object({ payment_id: uuid("payment_id") }).strict(),
});

/**
 * Sanitize and strictly validate an inbound relay event.
 *
 * @param {string} event   - Socket.IO event name
 * @param {any}    payload - First argument sent with the event
 * @param {object} [opts]
 * @param {Record<string, import("zod").ZodTypeAny>} [opts.schemas]
 * @param {Partial<typeof RELAY_PAYLOAD_LIMITS>}     [opts.limits]
 * @returns {{ ok: true, data: object } | { ok: false, error: { code: string, message: string, issues?: object[] } }}
 */
export function validateInboundRelayEvent(event, payload, opts = {}) {
  const schemas = opts.schemas ?? INBOUND_EVENT_SCHEMAS;
  const limits = { ...RELAY_PAYLOAD_LIMITS, ...opts.limits };

  if (typeof event !== "string" || !Object.hasOwn(schemas, event)) {
    return fail("UNKNOWN_EVENT", "Event is not supported by the relay");
  }

  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return fail("INVALID_PAYLOAD", "Payload must be a JSON object");
  }

  let sanitized;
  try {
    const byteLength = relayPayloadByteLength(payload);
    if (byteLength > limits.maxBytes) {
      return fail(
        "PAYLOAD_TOO_LARGE",
        `Payload size ${byteLength} bytes exceeds limit of ${limits.maxBytes} bytes`,
      );
    }
    sanitized = sanitizeRelayPayload(payload, limits);
  } catch (err) {
    if (err instanceof RelayValidationError) return fail(err.code, err.message);
    throw err;
  }

  const parsed = schemas[event].safeParse(sanitized);
  if (!parsed.success) {
    return fail(
      "VALIDATION_FAILED",
      "Payload failed validation",
      parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }

  return { ok: true, data: parsed.data };
}

function fail(code, message, issues) {
  return { ok: false, error: issues ? { code, message, issues } : { code, message } };
}

// ─── Outbound sanitization ────────────────────────────────────────────────────

const OUTBOUND_LIMITS = Object.freeze({
  maxDepth: 10,
  maxKeys: 256,
  maxArrayLength: 1000,
  maxStringLength: 16384,
});

/**
 * Sanitize a payload before it is emitted to clients, so that data sourced
 * from Horizon or merchant metadata cannot inject prototype keys, control
 * characters or non-JSON values into dashboards.
 *
 * @param {object} payload
 * @param {Partial<typeof RELAY_PAYLOAD_LIMITS>} [limits]
 * @returns {object}
 * @throws {RelayValidationError}
 */
export function sanitizeOutboundPayload(payload, limits = {}) {
  return sanitizeRelayPayload(payload, { ...OUTBOUND_LIMITS, ...limits });
}

// ─── Socket guard ─────────────────────────────────────────────────────────────

/**
 * Create a per-socket guard that validates every inbound event before its
 * handler runs.
 *
 * On a validation failure the guard:
 *   1. logs a warning (event name, error code, socket id — never the raw payload),
 *   2. replies via the ack callback if one was supplied, otherwise emits
 *      `relay:error` to the socket,
 *   3. counts a violation and disconnects the socket once `maxViolations` is reached.
 *
 * Events that have no registered handler are also counted as violations.
 *
 * @param {import("socket.io").Socket} socket
 * @param {object} [opts]
 * @param {{ warn: Function, error: Function }} [opts.logger]
 * @param {number} [opts.maxViolations]
 * @param {Record<string, import("zod").ZodTypeAny>} [opts.schemas]
 * @param {Partial<typeof RELAY_PAYLOAD_LIMITS>} [opts.limits]
 * @returns {{ on: (event: string, handler: (data: object, ack?: Function) => void) => void, violations: () => number }}
 */
export function createRelayGuard(socket, opts = {}) {
  const logger = opts.logger ?? console;
  const maxViolations = opts.maxViolations ?? DEFAULT_MAX_VIOLATIONS;
  const schemas = opts.schemas ?? INBOUND_EVENT_SCHEMAS;
  const handled = new Set();
  let violations = 0;

  const reject = (event, error, ack) => {
    violations += 1;
    logger.warn(
      { socketId: socket.id, event, code: error.code, violations },
      "WebSocket relay: rejected inbound event",
    );

    const body = { ok: false, event, error };
    if (typeof ack === "function") {
      ack(body);
    } else {
      socket.emit(RELAY_ERROR_EVENT, body);
    }

    if (violations >= maxViolations) {
      logger.warn(
        { socketId: socket.id, violations },
        "WebSocket relay: disconnecting socket after repeated invalid events",
      );
      socket.disconnect(true);
    }
  };

  if (typeof socket.onAny === "function") {
    socket.onAny((event, ...args) => {
      if (handled.has(event)) return;
      const ack = typeof args[args.length - 1] === "function" ? args[args.length - 1] : undefined;
      reject(
        typeof event === "string" ? event : String(event),
        { code: "UNKNOWN_EVENT", message: "Event is not supported by the relay" },
        ack,
      );
    });
  }

  return {
    on(event, handler) {
      if (!Object.hasOwn(schemas, event)) {
        throw new Error(`No relay schema registered for event '${event}'`);
      }
      handled.add(event);

      socket.on(event, (...args) => {
        const ack = typeof args[args.length - 1] === "function" ? args.pop() : undefined;
        const result = validateInboundRelayEvent(event, args[0], {
          schemas,
          limits: opts.limits,
        });

        if (!result.ok) {
          reject(event, result.error, ack);
          return;
        }

        try {
          handler(result.data, ack);
        } catch (err) {
          logger.error({ err, socketId: socket.id, event }, "WebSocket relay: handler failed");
          const body = {
            ok: false,
            event,
            error: { code: "INTERNAL_ERROR", message: "Failed to process event" },
          };
          if (typeof ack === "function") ack(body);
          else socket.emit(RELAY_ERROR_EVENT, body);
        }
      });
    },
    violations: () => violations,
  };
}
