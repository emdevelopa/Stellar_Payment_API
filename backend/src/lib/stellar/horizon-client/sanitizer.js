/**
 * Horizon Client Sanitizer
 *
 * Payload sanitization and strict validation for the Retry Manager
 * (issue #1437).
 *
 * Everything the retry manager receives from callers (operation name, retry
 * schedule, log context) and everything it echoes back (Horizon URL, error
 * detail returned by Horizon) can end up in logs, Prometheus labels and API
 * error messages. This module makes sure that data is:
 *   - well-formed  (strict validation, fail fast with a typed error),
 *   - bounded      (key counts and string lengths are capped),
 *   - safe         (secrets redacted, control characters stripped, URL
 *                   credentials and query strings removed).
 */

/** Error code for invalid input passed to the retry manager. */
export const HORIZON_VALIDATION_ERROR = "HORIZON_CLIENT_VALIDATION_ERROR";

export const MAX_RETRY_ATTEMPTS = 10;
export const MAX_RETRY_DELAY_MS = 60_000;
export const MAX_CONTEXT_KEYS = 16;
export const MAX_CONTEXT_VALUE_LENGTH = 256;
export const MAX_ERROR_DETAIL_LENGTH = 512;
export const REDACTED = "[REDACTED]";

// Operation names become Prometheus label values and log fields.
const OPERATION_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const CONTEXT_KEY_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;
const SENSITIVE_KEY_PATTERN =
  /(secret|seed|password|passphrase|token|private|signature|authorization|api[_-]?key|mnemonic|cookie)/i;
// Stellar secret seeds: "S" + 55 base32 characters.
const STELLAR_SECRET_PATTERN = /\bS[A-Z2-7]{55}\b/g;
// Bearer / basic credentials that sometimes leak into error text.
const AUTH_HEADER_PATTERN = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_PATTERN = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g;

/**
 * Build a typed validation error.
 */
export function createValidationError(message, validationType) {
  const error = new TypeError(message);
  error.code = HORIZON_VALIDATION_ERROR;
  error.validationType = validationType;
  error.status = 500;
  return error;
}

/**
 * Remove control characters, redact secrets and cap the length of a string.
 */
export function sanitizeString(value, maxLength = MAX_CONTEXT_VALUE_LENGTH) {
  const text = String(value ?? "")
    .replace(CONTROL_CHARS_PATTERN, " ")
    .replace(STELLAR_SECRET_PATTERN, REDACTED)
    .replace(AUTH_HEADER_PATTERN, `$1 ${REDACTED}`)
    .trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function stringifyValue(value) {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  const type = typeof value;
  if (type === "string") return value;
  if (type === "number" || type === "boolean" || type === "bigint") return String(value);
  if (type === "function" || type === "symbol") return `[${type}]`;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "Invalid Date" : value.toISOString();
  try {
    return JSON.stringify(value, (_key, nested) => (typeof nested === "bigint" ? String(nested) : nested));
  } catch {
    return "[unserializable]";
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Turn arbitrary caller context into a small, flat, log-safe object.
 *
 *   - Non plain-object input becomes {}.
 *   - Keys that are not simple identifiers (or "__proto__"-style keys) are dropped.
 *   - At most MAX_CONTEXT_KEYS keys are kept.
 *   - Values under sensitive keys are replaced with "[REDACTED]".
 *   - Every other value is stringified, stripped of control characters,
 *     scrubbed of secret seeds and truncated.
 *
 * @param {unknown} context
 * @returns {Record<string, string>}
 */
export function sanitizeContext(context) {
  if (!isPlainObject(context)) return {};
  const sanitized = Object.create(null);
  let kept = 0;
  for (const key of Object.keys(context)) {
    if (kept >= MAX_CONTEXT_KEYS) break;
    if (!CONTEXT_KEY_PATTERN.test(key) || key === "__proto__" || key === "constructor" || key === "prototype") {
      continue;
    }
    sanitized[key] = SENSITIVE_KEY_PATTERN.test(key)
      ? REDACTED
      : sanitizeString(stringifyValue(context[key]));
    kept += 1;
  }
  return { ...sanitized };
}

/**
 * Strip credentials, query string and fragment from the Horizon URL before it
 * is used in a log line or error message.
 */
export function sanitizeHorizonUrl(url) {
  if (typeof url !== "string" || url.trim() === "") return "[unknown-horizon-url]";
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "[invalid-horizon-url]";
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return sanitizeString(`${parsed.protocol}//${parsed.host}${path}`);
  } catch {
    return "[invalid-horizon-url]";
  }
}

/**
 * Sanitize an error detail / message coming back from Horizon or the network
 * layer before it is surfaced to API clients or logs.
 */
export function sanitizeErrorDetail(detail) {
  return sanitizeString(stringifyValue(detail), MAX_ERROR_DETAIL_LENGTH);
}

/**
 * Validate an operation name used for metrics labels and logs.
 *
 * @throws {TypeError} code HORIZON_CLIENT_VALIDATION_ERROR
 */
export function validateOperationName(operationName) {
  if (typeof operationName !== "string" || !OPERATION_NAME_PATTERN.test(operationName)) {
    throw createValidationError(
      "Horizon client operation name must match /^[A-Za-z][A-Za-z0-9_]{0,63}$/",
      "operation_name",
    );
  }
  return operationName;
}

/**
 * Validate the operation callback.
 *
 * @throws {TypeError} code HORIZON_CLIENT_VALIDATION_ERROR
 */
export function validateOperation(operation) {
  if (typeof operation !== "function") {
    throw createValidationError("Horizon client operation must be a function", "operation");
  }
  return operation;
}

/**
 * Validate a retry schedule and return a frozen copy of it.
 *
 * @param {unknown} retryDelays
 * @returns {ReadonlyArray<number>}
 * @throws {TypeError} code HORIZON_CLIENT_VALIDATION_ERROR
 */
export function validateRetryDelays(retryDelays) {
  if (!Array.isArray(retryDelays)) {
    throw createValidationError("retryDelays must be an array of milliseconds", "retry_delays");
  }
  if (retryDelays.length > MAX_RETRY_ATTEMPTS) {
    throw createValidationError(
      `retryDelays allows at most ${MAX_RETRY_ATTEMPTS} retries`,
      "retry_delays",
    );
  }
  for (const delay of retryDelays) {
    if (!Number.isInteger(delay) || delay < 0 || delay > MAX_RETRY_DELAY_MS) {
      throw createValidationError(
        `retryDelays entries must be integers between 0 and ${MAX_RETRY_DELAY_MS}`,
        "retry_delays",
      );
    }
  }
  return Object.freeze([...retryDelays]);
}
