/**
 * websocket-relay-security.js
 *
 * Security primitives for the WebSocket relay:
 *   - Origin validation (whitelist)
 *   - Message size enforcement
 *   - JWT verification for relay connections
 *   - Input sanitization (unknown-field stripping + shape validation)
 *   - Audit logging
 */

import jwt from "jsonwebtoken";

// ─── Allowed message fields ───────────────────────────────────────────────────

/**
 * Fields that are permitted in an inbound relay message.
 * Any key not in this set is stripped by sanitizeRelayMessage().
 */
const ALLOWED_MESSAGE_FIELDS = new Set([
  "type",
  "payment_id",
  "event_type",
  "payload",
  "timestamp",
  "version",
]);

// ─── Origin validation ────────────────────────────────────────────────────────

/**
 * Validate that `origin` is present in `allowedOrigins`.
 *
 * Performs an exact, case-sensitive string match.  Wildcards are intentionally
 * not supported; each allowed origin must be listed explicitly to prevent
 * subdomain-takeover bypasses.
 *
 * @param {string}   origin          - The "Origin" header value from the WebSocket handshake
 * @param {string[]} allowedOrigins  - Whitelist of permitted origins
 * @returns {{ valid: boolean, reason?: string }}
 */
function validateOrigin(origin, allowedOrigins) {
  if (typeof origin !== "string" || origin.trim() === "") {
    return { valid: false, reason: "Origin header is missing or empty" };
  }

  if (!Array.isArray(allowedOrigins) || allowedOrigins.length === 0) {
    return { valid: false, reason: "No allowed origins configured" };
  }

  if (allowedOrigins.includes(origin)) {
    return { valid: true };
  }

  return { valid: false, reason: `Origin '${origin}' is not whitelisted` };
}

// ─── Message size limit ───────────────────────────────────────────────────────

/**
 * Throw if the serialised byte-length of `msg` exceeds `maxBytes`.
 *
 * WebSocket frames can be arbitrarily large; enforcing a maximum prevents
 * memory-exhaustion attacks from a single oversized message.
 *
 * @param {string|Buffer|object} msg      - The raw WebSocket message
 * @param {number}               maxBytes - Maximum allowed size in bytes (default 64 KiB)
 * @throws {Error} When the message exceeds the size limit
 */
function enforceMessageSizeLimit(msg, maxBytes = 65536) {
  let byteLength;

  if (Buffer.isBuffer(msg)) {
    byteLength = msg.length;
  } else if (typeof msg === "string") {
    byteLength = Buffer.byteLength(msg, "utf8");
  } else {
    // Serialise objects so we measure the on-wire size
    try {
      byteLength = Buffer.byteLength(JSON.stringify(msg), "utf8");
    } catch {
      throw new Error("Message cannot be serialised for size check");
    }
  }

  if (byteLength > maxBytes) {
    const err = new Error(
      `Message size ${byteLength} bytes exceeds limit of ${maxBytes} bytes`,
    );
    err.code = "MESSAGE_TOO_LARGE";
    err.byteLength = byteLength;
    err.maxBytes = maxBytes;
    throw err;
  }
}

// ─── JWT verification ─────────────────────────────────────────────────────────

/**
 * Verify a relay connection JWT.
 *
 * Wraps jsonwebtoken.verify() in a promise-friendly, error-normalising helper.
 * The algorithm is fixed to HS256 to prevent algorithm-confusion attacks
 * (e.g. 'none' or RS256-with-HMAC-public-key).
 *
 * @param {string} token  - The raw JWT string from the WebSocket sub-protocol or query param
 * @param {string} secret - HMAC secret used to sign the token
 * @returns {{ valid: boolean, payload?: object, reason?: string }}
 */
function verifyRelayToken(token, secret) {
  if (typeof token !== "string" || token.trim() === "") {
    return { valid: false, reason: "Token is missing or empty" };
  }

  if (typeof secret !== "string" || secret.trim() === "") {
    return { valid: false, reason: "Secret is missing or empty" };
  }

  try {
    const payload = jwt.verify(token, secret, { algorithms: ["HS256"] });
    return { valid: true, payload };
  } catch (err) {
    return { valid: false, reason: err.message };
  }
}

// ─── Input sanitization ───────────────────────────────────────────────────────

/**
 * Strip unknown fields and validate the shape of an inbound relay message.
 *
 * Returns a clean copy of the message containing only the fields listed in
 * ALLOWED_MESSAGE_FIELDS, so that unexpected keys never propagate further
 * into the relay pipeline.
 *
 * @param {any} msg - The parsed WebSocket message object
 * @returns {{ sanitized: object, warnings: string[] }}
 * @throws {Error} When `msg` is not a non-null object, or when required fields are missing
 */
function sanitizeRelayMessage(msg) {
  if (msg === null || typeof msg !== "object" || Array.isArray(msg)) {
    throw new Error("Relay message must be a non-null object");
  }

  const warnings = [];
  const sanitized = {};

  // Copy only allowed fields
  for (const [key, value] of Object.entries(msg)) {
    if (ALLOWED_MESSAGE_FIELDS.has(key)) {
      sanitized[key] = value;
    } else {
      warnings.push(`Unknown field stripped: '${key}'`);
    }
  }

  // Require at minimum a 'type' field
  if (typeof sanitized.type !== "string" || sanitized.type.trim() === "") {
    throw new Error("Relay message must include a non-empty 'type' field");
  }

  return { sanitized, warnings };
}

// ─── Audit logging ────────────────────────────────────────────────────────────

/**
 * Write a structured audit log entry for a relay security event.
 *
 * In production this would write to a dedicated audit sink (e.g. a DB table,
 * a remote log aggregator, or a write-only append log).  For now it emits a
 * structured JSON line to stdout so that log shippers can ingest it.
 *
 * @param {string} event    - Short event identifier, e.g. "connection.rejected"
 * @param {object} [metadata] - Additional context to include in the log entry
 * @param {object} [opts]
 * @param {Function} [opts.emit] - Injectable emitter; defaults to console.log (for testing)
 */
function auditRelayEvent(event, metadata = {}, opts = {}) {
  const emit = opts.emit || console.log;

  const entry = {
    audit: true,
    ts: new Date().toISOString(),
    event,
    ...metadata,
  };

  emit(JSON.stringify(entry));
}

export {
  validateOrigin,
  enforceMessageSizeLimit,
  verifyRelayToken,
  sanitizeRelayMessage,
  auditRelayEvent,
  ALLOWED_MESSAGE_FIELDS,
};
