/**
 * Robust three-state Circuit Breaker for the Audit Logger (issue #771).
 * Supports CLOSED, OPEN, and HALF_OPEN states following Drips Wave standards.
 *
 * Enhanced in issue #1432 with:
 * - sanitizePayload() — allowlist filtering, string truncation, sensitive field
 *   redaction, and prototype-pollution protection.
 * - validatePayload() — strict field-level validation with descriptive errors.
 */

// ---------------------------------------------------------------------------
// Issue #1432 — Payload Sanitization and Strict Validation
// ---------------------------------------------------------------------------

/**
 * Fields that are allowed through sanitization. Any key not in this list is
 * stripped from the payload before processing.
 *
 * @type {Set<string>}
 */
const PAYLOAD_ALLOWLIST = new Set([
  "event",
  "timestamp",
  "merchantId",
  "userId",
  "sessionId",
  "paymentId",
  "amount",
  "asset",
  "status",
  "metadata",
  "ipAddress",
  "userAgent",
  "requestId",
  "correlationId",
  "source",
  "action",
  "result",
  "errorCode",
  "errorMessage",
]);

/**
 * Field names whose values must be redacted (replaced with "[REDACTED]").
 * Matched case-insensitively against each key.
 *
 * @type {RegExp}
 */
const SENSITIVE_FIELD_PATTERN = /^(password|secret|token|apikey|privatekey|authorization)$/i;

/**
 * Keys that indicate prototype-pollution attempts and must be blocked.
 *
 * @type {Set<string>}
 */
const PROTOTYPE_POLLUTION_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Maximum allowed string value length before truncation. */
const MAX_STRING_LENGTH = 1000;

/**
 * Custom error thrown when payload validation fails.
 */
export class ValidationError extends Error {
  /**
   * @param {string} field  - The name of the field that failed validation.
   * @param {string} reason - Human-readable explanation of the failure.
   */
  constructor(field, reason) {
    super(`Validation failed for field "${field}": ${reason}`);
    this.name = "ValidationError";
    this.field = field;
    this.reason = reason;
  }
}

/**
 * Returns a sanitized copy of `payload` by:
 * 1. Stripping keys not present in PAYLOAD_ALLOWLIST.
 * 2. Truncating string values longer than MAX_STRING_LENGTH characters.
 * 3. Removing fields whose key names indicate prototype-pollution attempts.
 * 4. Redacting sensitive fields (password, secret, token, apiKey, privateKey,
 *    authorization) by replacing their values with "[REDACTED]".
 *
 * This function does **not** mutate the original payload.
 *
 * @param {object} payload - Raw incoming payload object.
 * @returns {object} Clean, sanitized copy.
 */
export function sanitizePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }

  const clean = {};

  for (const key of Object.keys(payload)) {
    // 1. Block prototype-pollution keys
    if (PROTOTYPE_POLLUTION_KEYS.has(key)) {
      continue;
    }

    // 2. Strip keys not in the allowlist
    if (!PAYLOAD_ALLOWLIST.has(key)) {
      continue;
    }

    const value = payload[key];

    // 3. Redact sensitive fields
    if (SENSITIVE_FIELD_PATTERN.test(key)) {
      clean[key] = "[REDACTED]";
      continue;
    }

    // 4. Truncate long strings
    if (typeof value === "string" && value.length > MAX_STRING_LENGTH) {
      clean[key] = value.slice(0, MAX_STRING_LENGTH);
      continue;
    }

    clean[key] = value;
  }

  return clean;
}

/**
 * Validates that `payload` satisfies all required field constraints.
 *
 * Rules:
 * - `event`      — required, non-empty string matching `/^[a-zA-Z0-9._:-]{1,100}$/`
 * - `timestamp`  — required, valid ISO 8601 string **or** finite Unix epoch number
 * - `merchantId` — required, non-empty string (UUID or alphanumeric, max 128 chars)
 *
 * @param {object} payload - Payload to validate (typically already sanitized).
 * @returns {true} Returns `true` when all checks pass.
 * @throws {ValidationError} When any required field is missing or invalid.
 */
export function validatePayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new ValidationError("payload", "must be a non-null object");
  }

  // --- event ---
  if (payload.event === undefined || payload.event === null) {
    throw new ValidationError("event", "required field is missing");
  }
  if (typeof payload.event !== "string" || payload.event.trim() === "") {
    throw new ValidationError("event", "must be a non-empty string");
  }
  if (!/^[a-zA-Z0-9._:-]{1,100}$/.test(payload.event)) {
    throw new ValidationError(
      "event",
      "must match /^[a-zA-Z0-9._:-]{1,100}$/ (only alphanumeric, dot, underscore, colon, or hyphen; 1–100 chars)",
    );
  }

  // --- timestamp ---
  if (payload.timestamp === undefined || payload.timestamp === null) {
    throw new ValidationError("timestamp", "required field is missing");
  }
  if (typeof payload.timestamp === "number") {
    if (!Number.isFinite(payload.timestamp) || payload.timestamp < 0) {
      throw new ValidationError("timestamp", "numeric Unix epoch must be a finite non-negative number");
    }
  } else if (typeof payload.timestamp === "string") {
    const parsed = Date.parse(payload.timestamp);
    if (Number.isNaN(parsed)) {
      throw new ValidationError("timestamp", "string timestamp must be a valid ISO 8601 date");
    }
  } else {
    throw new ValidationError("timestamp", "must be a valid ISO 8601 string or Unix epoch number");
  }

  // --- merchantId ---
  if (payload.merchantId === undefined || payload.merchantId === null) {
    throw new ValidationError("merchantId", "required field is missing");
  }
  if (typeof payload.merchantId !== "string" || payload.merchantId.trim() === "") {
    throw new ValidationError("merchantId", "must be a non-empty string");
  }
  if (payload.merchantId.length > 128) {
    throw new ValidationError("merchantId", "must not exceed 128 characters");
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(payload.merchantId)) {
    throw new ValidationError(
      "merchantId",
      "must be alphanumeric (letters, digits, hyphens, or underscores only)",
    );
  }

  return true;
}

// ---------------------------------------------------------------------------
// Circuit Breaker
// ---------------------------------------------------------------------------

export const CircuitState = {
  CLOSED: "CLOSED",
  OPEN: "OPEN",
  HALF_OPEN: "HALF_OPEN",
};

export class AuditCircuitBreaker {
  constructor({
    failureThreshold = 5,
    resetTimeoutMs = 60000,
    halfOpenRequired = 2,
    label = "circuit-breaker",
    onClose = null,
    onOpen = null,
    onHalfOpen = null,
  } = {}) {
    this.failureThreshold = failureThreshold;
    this.resetTimeoutMs = resetTimeoutMs;
    this.halfOpenRequired = halfOpenRequired;
    this.label = label;
    this.onClose = onClose;
    this.onOpen = onOpen;
    this.onHalfOpen = onHalfOpen;

    this.state = CircuitState.CLOSED;
    this.failures = 0;
    this.openedAt = null;
    this.halfOpenSuccesses = 0;
  }

  isOpen(now = Date.now()) {
    if (this.state === CircuitState.OPEN) {
      if (now - this.openedAt >= this.resetTimeoutMs) {
        this.state = CircuitState.HALF_OPEN;
        this.halfOpenSuccesses = 0;
        console.info(`[${this.label}] Circuit breaker transitioned to HALF_OPEN — allowing trial requests`);
        if (typeof this.onHalfOpen === "function") {
          this.onHalfOpen();
        }
        return false;
      }
      return true;
    }
    return false;
  }

  recordSuccess() {
    if (this.state === CircuitState.HALF_OPEN) {
      this.halfOpenSuccesses += 1;
      if (this.halfOpenSuccesses >= this.halfOpenRequired) {
        this.state = CircuitState.CLOSED;
        this.failures = 0;
        this.halfOpenSuccesses = 0;
        console.info(`[${this.label}] Circuit breaker CLOSED — service recovered`);
        if (typeof this.onClose === "function") {
          this.onClose();
        }
      }
    } else {
      this.failures = 0;
    }
  }

  recordFailure(now = Date.now()) {
    this.failures += 1;
    // In HALF_OPEN, any failure immediately trips back to OPEN.
    // In CLOSED, failureThreshold consecutive failures trip to OPEN.
    if (this.state === CircuitState.HALF_OPEN || this.failures >= this.failureThreshold) {
      this.state = CircuitState.OPEN;
      this.openedAt = now;
      this.halfOpenSuccesses = 0;
      console.warn(
        `[${this.label}] Circuit breaker opened after ${this.failures} failures. DB writes suspended for ${this.resetTimeoutMs}ms.`,
      );
      if (typeof this.onOpen === "function") {
        this.onOpen();
      }
    }
  }

  /**
   * Processes an incoming audit event payload through the sanitize → validate
   * pipeline and then runs `handler` if the circuit is CLOSED or HALF_OPEN.
   *
   * @param {object}   rawPayload - Raw event payload (untrusted).
   * @param {Function} handler    - Async function to call with the clean payload.
   * @returns {Promise<unknown>}  Result of `handler`, or null if circuit is OPEN.
   * @throws {ValidationError}   When the payload fails validation.
   */
  async process(rawPayload, handler) {
    // Apply sanitize → validate pipeline at the entry point
    const clean = sanitizePayload(rawPayload);
    validatePayload(clean);

    if (this.isOpen()) {
      return null; // Circuit is open; drop the event
    }

    try {
      const result = await handler(clean);
      this.recordSuccess();
      return result;
    } catch (err) {
      this.recordFailure();
      throw err;
    }
  }

  reset() {
    this.state = CircuitState.CLOSED;
    this.failures = 0;
    this.openedAt = null;
    this.halfOpenSuccesses = 0;
  }
}
