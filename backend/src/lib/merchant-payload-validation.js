/**
 * merchant-payload-validation.js
 *
 * Payload sanitization and strict validation for the Merchant Settings &
 * API Key Service (issue #1482).
 *
 * Two layers, applied in this order on every settings / API-key route:
 *
 *   1. sanitizeMerchantPayload (middleware)
 *      - drops prototype-pollution keys (__proto__, constructor, prototype)
 *      - strips NUL and non-printable control characters from strings
 *      - enforces depth, key-count, array-length and string-length ceilings
 *        so a single request cannot force deep recursion or huge DB writes
 *
 *   2. Strict Zod schemas (via validateRequest)
 *      - `.strict()` objects: unknown keys are REJECTED, not silently ignored,
 *        so typos and mass-assignment attempts (e.g. `api_key`, `merchant_id`)
 *        fail loudly with 400 instead of being dropped or persisted
 *      - bounded numbers/dates (API-key expiry must be in the future and
 *        within MAX_API_KEY_LIFETIME_DAYS)
 *      - webhook custom headers reject CR/LF (header injection) and reserved
 *        system header names (signature/timestamp spoofing)
 */

import { z } from "zod";
import { logger } from "./logger.js";

export const SANITIZE_LIMITS = Object.freeze({
  maxDepth: 6,
  maxKeysPerObject: 50,
  maxArrayLength: 100,
  maxStringLength: 4096,
});

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

// C0 controls except \t \n \r, plus DEL. \r and \n are kept here so free-text
// fields remain usable; header values are rejected separately below.
// eslint-disable-next-line no-control-regex
const UNSAFE_CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export class PayloadSanitizationError extends Error {
  constructor(message, path) {
    super(message);
    this.name = "PayloadSanitizationError";
    this.status = 400;
    this.path = path;
  }
}

function formatPath(path) {
  return path.length === 0 ? "body" : path.join(".");
}

/**
 * Recursively sanitize an untrusted JSON payload.
 *
 * Returns a NEW value; the input is never mutated. Throws
 * PayloadSanitizationError when a structural limit is exceeded.
 *
 * @param {unknown} value
 * @param {Partial<typeof SANITIZE_LIMITS>} [limits]
 * @param {{ droppedKeys?: string[] }} [report]  Collects dropped key paths
 */
export function sanitizePayload(value, limits = {}, report = {}) {
  const opts = { ...SANITIZE_LIMITS, ...limits };
  const dropped = report.droppedKeys ?? (report.droppedKeys = []);

  function walk(node, depth, path) {
    if (typeof node === "string") {
      if (node.length > opts.maxStringLength) {
        throw new PayloadSanitizationError(
          `String at ${formatPath(path)} exceeds ${opts.maxStringLength} characters`,
          formatPath(path),
        );
      }
      return node.replace(UNSAFE_CONTROL_CHARS, "");
    }

    if (node === null || typeof node !== "object") {
      if (typeof node === "number" && !Number.isFinite(node)) {
        throw new PayloadSanitizationError(
          `Number at ${formatPath(path)} must be finite`,
          formatPath(path),
        );
      }
      return node;
    }

    if (depth >= opts.maxDepth) {
      throw new PayloadSanitizationError(
        `Payload nesting exceeds maximum depth of ${opts.maxDepth}`,
        formatPath(path),
      );
    }

    if (Array.isArray(node)) {
      if (node.length > opts.maxArrayLength) {
        throw new PayloadSanitizationError(
          `Array at ${formatPath(path)} exceeds ${opts.maxArrayLength} items`,
          formatPath(path),
        );
      }
      return node.map((item, index) => walk(item, depth + 1, [...path, index]));
    }

    const keys = Object.keys(node);
    if (keys.length > opts.maxKeysPerObject) {
      throw new PayloadSanitizationError(
        `Object at ${formatPath(path)} exceeds ${opts.maxKeysPerObject} keys`,
        formatPath(path),
      );
    }

    const out = {};
    for (const key of keys) {
      if (FORBIDDEN_KEYS.has(key)) {
        dropped.push(formatPath([...path, key]));
        continue;
      }
      const cleanKey = key.replace(UNSAFE_CONTROL_CHARS, "");
      if (cleanKey !== key || cleanKey.length === 0) {
        dropped.push(formatPath([...path, JSON.stringify(key)]));
        continue;
      }
      out[cleanKey] = walk(node[key], depth + 1, [...path, cleanKey]);
    }
    return out;
  }

  return walk(value, 0, []);
}

/**
 * Express middleware: sanitize req.body in place before schema validation.
 * Structural violations are rejected with 400; dropped keys are logged
 * (without values) so abuse attempts are observable.
 */
export function sanitizeMerchantPayload(req, res, next) {
  if (req.body === undefined || req.body === null) {
    return next();
  }

  const report = {};
  try {
    req.body = sanitizePayload(req.body, {}, report);
  } catch (err) {
    if (err instanceof PayloadSanitizationError) {
      logger.warn(
        { merchantId: req.merchant?.id, path: err.path, route: req.originalUrl },
        "Rejected merchant payload: sanitization limit exceeded",
      );
      return res.status(400).json({ error: "Validation failed", message: err.message });
    }
    return next(err);
  }

  if (report.droppedKeys.length > 0) {
    logger.warn(
      { merchantId: req.merchant?.id, droppedKeys: report.droppedKeys, route: req.originalUrl },
      "Dropped unsafe keys from merchant payload",
    );
  }
  return next();
}

// ---------------------------------------------------------------------------
// Strict schemas
// ---------------------------------------------------------------------------

export const MAX_GRACE_PERIOD_HOURS = 168;
export const MAX_API_KEY_LIFETIME_DAYS = 365;
/** Expiry must be at least this far in the future to avoid instant lock-out. */
export const MIN_API_KEY_EXPIRY_LEAD_MS = 60 * 1000;

const gracePeriodHoursSchema = z
  .number({ invalid_type_error: "grace_period_hours must be a number" })
  .int("grace_period_hours must be an integer")
  .min(0, "grace_period_hours must be >= 0")
  .max(MAX_GRACE_PERIOD_HOURS, `grace_period_hours must be <= ${MAX_GRACE_PERIOD_HOURS}`);

export const rotateApiKeySchema = z
  .object({ grace_period_hours: gracePeriodHoursSchema.optional() })
  .strict();

export const rotateWebhookSecretSchema = z
  .object({ grace_period_hours: gracePeriodHoursSchema.optional() })
  .strict();

/**
 * Validate an API key expiry timestamp and return it normalized to ISO-8601
 * UTC. Throws a 400 error on failure. Shared by the route schema and the
 * service layer (defense in depth for non-HTTP callers).
 *
 * @param {unknown} value
 * @param {number} [now=Date.now()]
 * @returns {string}
 */
export function normalizeApiKeyExpiry(value, now = Date.now()) {
  const fail = (message) => {
    const err = new Error(message);
    err.status = 400;
    throw err;
  };

  if (typeof value !== "string" || value.trim() === "") {
    fail("expires_at must be an ISO 8601 datetime string");
  }
  const parsed = z.string().datetime({ offset: true }).safeParse(value.trim());
  if (!parsed.success) {
    fail("expires_at must be an ISO 8601 datetime string");
  }

  const ts = Date.parse(value.trim());
  if (!Number.isFinite(ts)) {
    fail("expires_at must be a valid datetime");
  }
  if (ts < now + MIN_API_KEY_EXPIRY_LEAD_MS) {
    fail("expires_at must be at least 1 minute in the future");
  }
  if (ts > now + MAX_API_KEY_LIFETIME_DAYS * 24 * 60 * 60 * 1000) {
    fail(`expires_at must be within ${MAX_API_KEY_LIFETIME_DAYS} days`);
  }
  return new Date(ts).toISOString();
}

export const setApiKeyExpirySchema = z
  .object({
    expires_at: z.string({ required_error: "expires_at is required" }),
  })
  .strict()
  .transform((body, ctx) => {
    try {
      return { expires_at: normalizeApiKeyExpiry(body.expires_at) };
    } catch (err) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["expires_at"], message: err.message });
      return z.NEVER;
    }
  });

export const merchantSettingsSchema = z
  .object({
    send_success_emails: z.boolean({
      invalid_type_error: "send_success_emails must be a boolean",
    }).optional(),
  })
  .strict();

const HEADER_NAME_RE = /^[A-Za-z0-9\-_]{1,64}$/;
// Printable ASCII + tab only. Rejects CR/LF (response splitting / header
// injection) and non-ASCII that some HTTP stacks mangle.
const HEADER_VALUE_RE = /^[\t\x20-\x7E]{1,1024}$/;
export const MAX_CUSTOM_HEADERS = 20;

/**
 * Header names merchants may not set: signature/timestamp headers would let
 * a merchant spoof or confuse verification; transport headers could corrupt
 * the outbound request. Kept in sync with sanitizeCustomHeaders() in
 * webhooks.js, which silently drops them at send time.
 */
export const RESERVED_WEBHOOK_HEADERS = new Set([
  "content-type",
  "content-length",
  "transfer-encoding",
  "connection",
  "host",
  "user-agent",
  "pluto-signature",
  "stellar-signature",
  "pluto-timestamp",
  "stellar-timestamp",
]);

export const customHeadersSchema = z
  .record(
    z.string().regex(
      HEADER_NAME_RE,
      "Header names must be 1-64 characters: alphanumeric, hyphens, or underscores",
    ),
    z.string().regex(
      HEADER_VALUE_RE,
      "Header values must be 1-1024 printable ASCII characters with no line breaks",
    ),
  )
  .superRefine((headers, ctx) => {
    const names = Object.keys(headers);
    if (names.length > MAX_CUSTOM_HEADERS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `At most ${MAX_CUSTOM_HEADERS} custom headers are allowed`,
      });
    }
    const seen = new Set();
    for (const name of names) {
      const lower = name.toLowerCase();
      if (RESERVED_WEBHOOK_HEADERS.has(lower)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [name],
          message: `"${name}" is a reserved header and cannot be overridden`,
        });
      }
      if (seen.has(lower)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [name],
          message: `Duplicate header name "${name}" (header names are case-insensitive)`,
        });
      }
      seen.add(lower);
    }
  });

const ASSET_CODE_RE = /^[A-Za-z0-9]{1,12}$/;

export const paymentLimitsSchema = z
  .record(
    z.string().regex(ASSET_CODE_RE, "Asset codes must be 1-12 alphanumeric characters"),
    z
      .object({
        min: z.number().positive().finite().optional(),
        max: z.number().positive().finite().optional(),
      })
      .strict()
      .refine(
        (limits) =>
          limits.min === undefined || limits.max === undefined || limits.min <= limits.max,
        { message: "min must be less than or equal to max" },
      ),
  )
  .refine((limits) => Object.keys(limits).length <= 50, {
    message: "At most 50 asset limits may be configured",
  });
