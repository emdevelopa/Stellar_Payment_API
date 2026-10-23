/**
 * api-gateway-payload-validation.js
 *
 * Payload sanitization and strict validation for the API Gateway Signature
 * Verifier (api-gateway-signature.js).
 *
 * Unlike merchant-payload-validation.js, nothing here rewrites the request
 * body: the signature is an HMAC over the exact body, so stripping or
 * normalizing it before verification would break legitimate signatures.
 * Instead, input that cannot be signed unambiguously is REJECTED, and
 * sanitization is applied to what we log.
 *
 *   1. validateSignatureRequestParts
 *      - method must be a known HTTP method (no CR/LF smuggling into the
 *        newline-delimited canonical payload)
 *      - path must start with "/", be bounded in length and contain no
 *        control characters
 *      - timestamp / signature headers are length-bounded before any regex
 *        runs on them
 *
 *   2. validateSignatureBody
 *      - only JSON-safe values: values JSON.stringify would silently drop or
 *        rewrite (undefined, NaN, Infinity, functions, BigInt, Dates, Buffers)
 *        are rejected so two different bodies can never share a signature
 *      - prototype-pollution keys (__proto__, constructor, prototype) are
 *        rejected before the body reaches any route handler
 *      - depth and total node count are bounded so verification cannot be
 *        used to force deep recursion or excessive hashing work
 *
 *   3. resolveSignatureToleranceSeconds
 *      - a non-numeric, zero or negative tolerance would make the timestamp
 *        window check always pass (|delta| > NaN is false), so invalid values
 *        fall back to the default and large values are capped
 *
 *   4. sanitizeForLog
 *      - strips control characters and truncates attacker-controlled values
 *        before they are written to structured logs (log injection / log
 *        flooding)
 */

import { logger } from "./logger.js";

export const DEFAULT_SIGNATURE_TOLERANCE_SECONDS = 300;
/** Upper bound on the accepted clock-skew window. Larger windows weaken replay protection. */
export const MAX_SIGNATURE_TOLERANCE_SECONDS = 3600;

export const GATEWAY_VALIDATION_LIMITS = Object.freeze({
  maxPathLength: 2048,
  // Unix seconds fit in 10 digits until the year 2286; allow a little headroom.
  maxTimestampLength: 12,
  // "sha256=" + 64 hex chars, plus surrounding whitespace the verifier trims.
  maxSignatureHeaderLength: 128,
  maxBodyDepth: 20,
  maxBodyNodes: 10000,
  maxLogValueLength: 80,
});

export const ALLOWED_SIGNATURE_METHODS = Object.freeze(
  new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]),
);

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_GLOBAL = /[\u0000-\u001F\u007F]/g;

export const GATEWAY_VALIDATION_CODES = Object.freeze({
  INVALID_REQUEST: "API_GATEWAY_INVALID_REQUEST",
  INVALID_PAYLOAD: "API_GATEWAY_INVALID_PAYLOAD",
});

function invalid(code, reason, detail) {
  return { valid: false, code, reason, ...(detail && { detail }) };
}

/**
 * Make an untrusted value safe to include in a structured log entry.
 * Strings have control characters replaced and are truncated; other values
 * are reduced to their type so objects/arrays are never dumped wholesale.
 *
 * @param {unknown} value
 * @param {number} [maxLength]
 * @returns {string|number|boolean|null|undefined}
 */
export function sanitizeForLog(value, maxLength = GATEWAY_VALIDATION_LIMITS.maxLogValueLength) {
  if (value === null || value === undefined) return value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value !== "string") return `[${Array.isArray(value) ? "array" : typeof value}]`;

  const cleaned = value.replace(CONTROL_CHARS_GLOBAL, "?");
  return cleaned.length > maxLength
    ? `${cleaned.slice(0, maxLength)}…(+${cleaned.length - maxLength} chars)`
    : cleaned;
}

/**
 * Validate the request line and signature headers before they are used to
 * build the canonical payload.
 *
 * `method` and `path` may be omitted by callers that sign internally
 * generated requests; they then default to GET and "/" exactly as the
 * canonical payload builder does.
 *
 * @returns {{ valid: true } | { valid: false, code: string, reason: string, detail?: string }}
 */
export function validateSignatureRequestParts({ method, path, timestampHeader, signatureHeader }) {
  const { INVALID_REQUEST } = GATEWAY_VALIDATION_CODES;

  if (method !== undefined && method !== null) {
    if (typeof method !== "string" || !ALLOWED_SIGNATURE_METHODS.has(method.toUpperCase())) {
      return invalid(INVALID_REQUEST, "Unsupported HTTP method for signed request", "method");
    }
  }

  if (path !== undefined && path !== null) {
    if (typeof path !== "string" || !path.startsWith("/")) {
      return invalid(INVALID_REQUEST, "Request path must be a string starting with '/'", "path");
    }
    if (path.length > GATEWAY_VALIDATION_LIMITS.maxPathLength) {
      return invalid(INVALID_REQUEST, "Request path exceeds maximum length", "path");
    }
    if (CONTROL_CHARS.test(path)) {
      return invalid(INVALID_REQUEST, "Request path contains control characters", "path");
    }
  }

  if (
    timestampHeader !== undefined &&
    timestampHeader !== null &&
    (typeof timestampHeader !== "string" && typeof timestampHeader !== "number")
  ) {
    return invalid(INVALID_REQUEST, "Missing or invalid x-api-timestamp header", "timestamp");
  }
  if (String(timestampHeader ?? "").trim().length > GATEWAY_VALIDATION_LIMITS.maxTimestampLength) {
    return invalid(INVALID_REQUEST, "Missing or invalid x-api-timestamp header", "timestamp");
  }

  if (signatureHeader !== undefined && signatureHeader !== null) {
    if (typeof signatureHeader !== "string") {
      return invalid(INVALID_REQUEST, "Missing or invalid x-api-signature header", "signature");
    }
    if (signatureHeader.length > GATEWAY_VALIDATION_LIMITS.maxSignatureHeaderLength) {
      return invalid(INVALID_REQUEST, "Missing or invalid x-api-signature header", "signature");
    }
  }

  return { valid: true };
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Strictly validate a request body before it is hashed for signing.
 *
 * Accepts `undefined` (no body) and any JSON-safe value. Iterative rather
 * than recursive so a hostile body cannot overflow the stack.
 *
 * @param {unknown} body
 * @returns {{ valid: true } | { valid: false, code: string, reason: string, detail?: string }}
 */
export function validateSignatureBody(body) {
  const { INVALID_PAYLOAD } = GATEWAY_VALIDATION_CODES;
  const { maxBodyDepth, maxBodyNodes } = GATEWAY_VALIDATION_LIMITS;

  if (body === undefined) return { valid: true };

  const stack = [{ value: body, depth: 0, at: "body" }];
  let nodes = 0;

  while (stack.length > 0) {
    const { value, depth, at } = stack.pop();

    nodes += 1;
    if (nodes > maxBodyNodes) {
      return invalid(INVALID_PAYLOAD, "Request body is too large to verify", "body");
    }

    if (value === null || typeof value === "string" || typeof value === "boolean") continue;

    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        return invalid(INVALID_PAYLOAD, "Request body contains a non-finite number", at);
      }
      continue;
    }

    const isArray = Array.isArray(value);
    if (!isArray && !isPlainObject(value)) {
      // undefined, functions, symbols, BigInt, Date, Buffer, Map, class instances…
      return invalid(INVALID_PAYLOAD, "Request body contains a value that is not valid JSON", at);
    }

    if (depth >= maxBodyDepth) {
      return invalid(INVALID_PAYLOAD, "Request body exceeds maximum nesting depth", at);
    }

    if (isArray) {
      for (let i = 0; i < value.length; i++) {
        stack.push({ value: value[i], depth: depth + 1, at: `${at}[${i}]` });
      }
      continue;
    }

    for (const key of Object.keys(value)) {
      if (FORBIDDEN_KEYS.has(key)) {
        return invalid(INVALID_PAYLOAD, "Request body contains a forbidden key", sanitizeForLog(`${at}.${key}`));
      }
      stack.push({ value: value[key], depth: depth + 1, at: `${at}.${key}` });
    }
  }

  return { valid: true };
}

/**
 * Resolve the accepted timestamp skew, in seconds.
 *
 * Invalid values (non-numeric, NaN, zero, negative) fall back to the default
 * with a warning; values above MAX_SIGNATURE_TOLERANCE_SECONDS are capped.
 *
 * @param {unknown} [raw] - defaults to API_GATEWAY_SIGNATURE_TOLERANCE_SECONDS
 * @returns {number}
 */
export function resolveSignatureToleranceSeconds(
  raw = process.env.API_GATEWAY_SIGNATURE_TOLERANCE_SECONDS,
) {
  if (raw === undefined || raw === null || raw === "") {
    return DEFAULT_SIGNATURE_TOLERANCE_SECONDS;
  }

  const value = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isFinite(value) || value <= 0) {
    logger.warn(
      { configured: sanitizeForLog(String(raw)), fallback: DEFAULT_SIGNATURE_TOLERANCE_SECONDS },
      "Invalid API gateway signature tolerance; using default",
    );
    return DEFAULT_SIGNATURE_TOLERANCE_SECONDS;
  }

  if (value > MAX_SIGNATURE_TOLERANCE_SECONDS) {
    logger.warn(
      { configured: value, max: MAX_SIGNATURE_TOLERANCE_SECONDS },
      "API gateway signature tolerance exceeds maximum; capping",
    );
    return MAX_SIGNATURE_TOLERANCE_SECONDS;
  }

  return value;
}
