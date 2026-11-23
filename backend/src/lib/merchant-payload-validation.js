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
import { HEX_COLOR_REGEX } from "./branding.js";
import {
  merchantPayloadRejectionsTotal,
  merchantPayloadKeysDroppedTotal,
} from "./merchant-lifecycle-metrics.js";

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
 * Low-cardinality route label for metrics/logs. Route-level middleware sees
 * `req.route.path` (the pattern, e.g. "/merchant-branding"), never the raw
 * URL, so user input cannot mint new label values.
 */
export function merchantRouteLabel(req) {
  return typeof req?.route?.path === "string" ? req.route.path : "unknown";
}

function recordRejection(route, reason) {
  try {
    merchantPayloadRejectionsTotal.inc({ route, reason });
  } catch {
    // Metrics must never break the request path.
  }
}

/**
 * Express middleware: sanitize req.body in place before schema validation.
 * Structural violations are rejected with 400; dropped keys are logged
 * (without values) so abuse attempts are observable. Both are counted in
 * merchant_payload_rejections_total / merchant_payload_keys_dropped_total.
 */
export function sanitizeMerchantPayload(req, res, next) {
  if (req.body === undefined || req.body === null) {
    return next();
  }

  const route = merchantRouteLabel(req);
  const report = {};
  try {
    req.body = sanitizePayload(req.body, {}, report);
  } catch (err) {
    if (err instanceof PayloadSanitizationError) {
      recordRejection(route, "sanitize");
      logger.warn(
        { merchantId: req.merchant?.id, path: err.path, route },
        "Rejected merchant payload: sanitization limit exceeded",
      );
      return res.status(400).json({ error: "Validation failed", message: err.message });
    }
    return next(err);
  }

  if (report.droppedKeys.length > 0) {
    try {
      merchantPayloadKeysDroppedTotal.inc({ route }, report.droppedKeys.length);
    } catch {
      // ignore
    }
    logger.warn(
      { merchantId: req.merchant?.id, droppedKeys: report.droppedKeys, route },
      "Dropped unsafe keys from merchant payload",
    );
  }
  return next();
}

/**
 * Validate req.body / req.query / req.params against Zod schemas (#1769).
 *
 * Same 400 response contract as lib/validation.js#validateRequest (so
 * existing clients see no change), plus a `merchant_payload_rejections_total`
 * metric and a structured warning that records WHICH fields failed but never
 * their values (bodies can carry passwords and secrets).
 *
 * @param {{ body?: import("zod").ZodTypeAny, query?: import("zod").ZodTypeAny, params?: import("zod").ZodTypeAny }} schemas
 */
export function validateMerchantRequest(schemas) {
  return async function merchantRequestValidator(req, res, next) {
    try {
      if (schemas.body) req.body = await schemas.body.parseAsync(req.body ?? {});
      if (schemas.query) req.query = await schemas.query.parseAsync(req.query ?? {});
      if (schemas.params) req.params = await schemas.params.parseAsync(req.params ?? {});
      return next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        const route = merchantRouteLabel(req);
        recordRejection(route, "schema");
        logger.warn(
          {
            merchantId: req.merchant?.id,
            route,
            fields: [...new Set(error.issues.map((i) => i.path.join(".") || "body"))],
            codes: [...new Set(error.issues.map((i) => i.code))],
          },
          "Rejected merchant payload: schema validation failed",
        );
        return res.status(400).json({ error: "Validation failed", errors: error.format() });
      }
      return next(error);
    }
  };
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

// ---------------------------------------------------------------------------
// Merchant Onboarding and Key Lifecycle Route schemas (#1769)
// ---------------------------------------------------------------------------

/**
 * Credential routes (rotate-key, regenerate-webhook-secret, generate-api-key,
 * webhook-settings/verify) take no input. Rejecting any body stops clients
 * from believing a field like `api_key` or `expires_at` was honoured.
 */
export const emptyBodySchema = z.object({}).strict();

/** bcrypt only hashes the first 72 bytes; longer input is silently ignored. */
export const MAX_PASSWORD_BYTES = 72;
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_EMAIL_LENGTH = 254; // RFC 5321 path limit
export const MAX_BUSINESS_NAME_LENGTH = 120;
export const MAX_URL_LENGTH = 2048;

// eslint-disable-next-line no-control-regex
const ANY_CONTROL_CHAR = /[\u0000-\u001F\u007F]/;
// Characters that would break out of an HTML attribute or text node.
const HTML_META_CHARS = /[<>"'`]/;

const emailSchema = (field) =>
  z
    .string({
      required_error: `${field} is required`,
      invalid_type_error: `${field} must be a string`,
    })
    .trim()
    .min(1, `${field} is required`)
    .max(MAX_EMAIL_LENGTH, `${field} must be at most ${MAX_EMAIL_LENGTH} characters`)
    .email(`Invalid ${field} format`)
    // Emails are case-insensitive in practice; storing them lower-cased
    // closes the "A@x.com" / "a@x.com" duplicate-account gap, because the
    // registration lock and the existence check now see the same value.
    .transform((value) => value.toLowerCase());

export const merchantPasswordSchema = z
  .string({
    required_error: "password is required",
    invalid_type_error: "password must be a string",
  })
  .min(MIN_PASSWORD_LENGTH, `password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  .refine(
    (value) => Buffer.byteLength(value, "utf8") <= MAX_PASSWORD_BYTES,
    `password must be at most ${MAX_PASSWORD_BYTES} bytes`,
  );

const businessNameSchema = z
  .string({ invalid_type_error: "business_name must be a string" })
  .trim()
  .max(MAX_BUSINESS_NAME_LENGTH, `business_name must be at most ${MAX_BUSINESS_NAME_LENGTH} characters`)
  .refine((value) => !ANY_CONTROL_CHAR.test(value), "business_name must not contain control characters")
  .refine((value) => !HTML_META_CHARS.test(value), "business_name must not contain < > \" ' or `")
  .transform((value) => (value === "" ? undefined : value));

/**
 * An outbound HTTPS URL a merchant controls (webhook endpoint).
 * Embedded credentials are rejected: they would be stored and logged in
 * plain text and sent to every redirect target.
 */
export const merchantWebhookUrlSchema = z
  .string({
    required_error: "webhook_url is required",
    invalid_type_error: "webhook_url must be a string",
  })
  .trim()
  .max(MAX_URL_LENGTH, `webhook_url must be at most ${MAX_URL_LENGTH} characters`)
  .url("webhook_url must be a valid URL")
  .superRefine((value, ctx) => {
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      return; // .url() already reported it
    }
    if (parsed.protocol !== "https:") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "webhook_url must use HTTPS" });
    }
    if (parsed.username || parsed.password) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "webhook_url must not contain embedded credentials",
      });
    }
  });

const DATA_IMAGE_URI = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

/**
 * Logo URLs are interpolated into the hosted checkout page and receipt
 * e-mails. Only `https:` URLs and base64 raster data URIs are accepted;
 * `javascript:`, `data:text/html`, SVG (which can carry script) and any
 * value containing HTML meta characters are rejected.
 */
export const logoUrlSchema = z
  .string({ invalid_type_error: "logo_url must be a string" })
  .trim()
  .refine((value) => !HTML_META_CHARS.test(value) && !ANY_CONTROL_CHAR.test(value), {
    message: "logo_url contains characters that are not allowed",
  })
  .refine(
    (value) => {
      if (value === "") return true;
      if (DATA_IMAGE_URI.test(value)) return true;
      if (value.length > MAX_URL_LENGTH) return false;
      try {
        const parsed = new URL(value);
        return parsed.protocol === "https:" && !parsed.username && !parsed.password;
      } catch {
        return false;
      }
    },
    { message: "logo_url must be an https:// URL or a base64 PNG/JPEG/GIF/WebP data URI" },
  )
  .transform((value) => (value === "" ? null : value));

const hexColor = (field) =>
  z
    .string({ invalid_type_error: `${field} must be a string` })
    .trim()
    .regex(HEX_COLOR_REGEX, `${field} must be a valid hex color`);

export const merchantBrandingSchema = z
  .object({
    primary_color: hexColor("primary_color").optional(),
    secondary_color: hexColor("secondary_color").optional(),
    background_color: hexColor("background_color").optional(),
    logo_url: logoUrlSchema.nullable().optional(),
  })
  .strict();

/**
 * Registration body. `.strict()` turns mass-assignment attempts
 * (`api_key`, `webhook_secret`, `id`, `password_hash`, ...) into a 400
 * instead of silently ignoring them.
 */
export const registerMerchantSchema = z
  .object({
    email: emailSchema("email"),
    password: merchantPasswordSchema,
    business_name: businessNameSchema.optional(),
    notification_email: z.preprocess(
      (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
      emailSchema("notification_email").optional(),
    ),
    branding_config: merchantBrandingSchema.optional(),
    merchant_settings: merchantSettingsSchema.optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const testWebhookRequestSchema = z
  .object({ webhook_url: merchantWebhookUrlSchema })
  .strict();

/** Upper bound on the receiver's response body echoed back by /test-webhook. */
export const MAX_TEST_WEBHOOK_BODY_CHARS = 2048;

/**
 * Clip and strip control characters from a third-party response body before
 * it is returned to the caller.
 */
export function clipEchoedBody(body, max = MAX_TEST_WEBHOOK_BODY_CHARS) {
  if (body === null || body === undefined) return null;
  const text = typeof body === "string" ? body : JSON.stringify(body);
  const clean = text.replace(UNSAFE_CONTROL_CHARS, "");
  return clean.length > max ? `${clean.slice(0, max)}…[truncated]` : clean;
}
