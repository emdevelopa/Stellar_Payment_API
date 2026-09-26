/**
 * payment-session-rules.js
 *
 * Shared business-rule validation for payment session creation (issue #1087).
 *
 * This logic previously lived duplicated in two places with subtly different
 * response handling but identical rule ordering:
 *
 *   - src/routes/payments.js  → createSession (responds 400 JSON + metrics)
 *   - src/services/paymentService.js → createPaymentSession (throws err.status)
 *
 * Both call sites now evaluate the SAME pure functions here and map the
 * resulting rejection descriptor to their own transport (HTTP response vs
 * thrown error). The rules and their order are:
 *
 *   1. Issuer presence   – non-native assets must carry an asset_issuer
 *   2. Issuer format     – must be a valid Stellar public key (G...)
 *   3. Per-asset limits  – merchant-configured min/max for the asset
 *   4. Allowed issuers   – merchant allowlist (when non-empty)
 *
 * Payload sanitization and strict validation (issue #1447) run BEFORE those
 * business rules:
 *
 *   0a. sanitizeSessionPayload – rejects non-object bodies and prototype
 *       pollution keys, strips control / bidi / zero-width characters from
 *       string fields, NFC-normalizes them and enforces field length caps.
 *   0b. validateSessionAsset   – asset code must be 1-12 alphanumerics.
 *   0c. validateSessionAmount  – finite, positive, <= 7 decimal places and
 *       within Stellar's int64 stroop range.
 *
 * The module is intentionally free of I/O, logging and metrics so it can be
 * unit-tested exhaustively and safely reused. Metrics, logging and health
 * telemetry live in payment-session-validator.js (issue #1448).
 */

import { isValidStellarPublicKey } from "./stellar.js";
import { resolveAssetIssuer } from "../constants/assetConstants.js";

/** Largest amount representable on Stellar: (2^63 - 1) stroops. */
const MAX_STELLAR_AMOUNT = 922337203685.4775807;

/** Stellar amounts carry at most 7 decimal places (1 stroop = 1e-7). */
const STELLAR_AMOUNT_DECIMALS = 7;

const ASSET_CODE_PATTERN = /^[A-Z0-9]{1,12}$/;

/** Keys that can mutate an object's prototype chain when copied/merged. */
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Nested objects deeper than this are not walked for forbidden keys. */
const MAX_INSPECTION_DEPTH = 8;

/**
 * Maximum lengths (in UTF-16 code units, after sanitization) for free-form
 * string fields on a payment session. Generous enough for legitimate use,
 * tight enough to stop oversized values reaching the database or the hosted
 * checkout page.
 */
const SESSION_FIELD_MAX_LENGTHS = Object.freeze({
  asset: 12,
  asset_issuer: 56,
  recipient: 256,
  description: 1000,
  message: 28,
  memo: 64,
  memo_type: 16,
  webhook_url: 2048,
  client_id: 128,
});

const REQUIRED_STRING_FIELDS = new Set(["asset", "recipient"]);

// C0/C1 control characters (TAB/LF/CR included — none of these fields are
// multi-line), and DEL.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;
// Bidirectional overrides/isolates ("Trojan Source") that can make the
// description or memo render differently from what is stored.
const BIDI_CONTROL_CHARS = /[\u202A-\u202E\u2066-\u2069\u200E\u200F]/g;
// Zero-width characters used to disguise look-alike values.
const ZERO_WIDTH_CHARS = /[\u200B-\u200D\u2060\uFEFF]/g;

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Collect the paths of prototype-pollution keys anywhere in `value`.
 * Walks own enumerable keys only (JSON.parse creates `__proto__` as an own
 * property, so it is visible here) and stops at MAX_INSPECTION_DEPTH.
 */
function findForbiddenKeys(value, path = "", depth = 0, found = []) {
  if (value === null || typeof value !== "object" || depth > MAX_INSPECTION_DEPTH) {
    return found;
  }
  for (const key of Object.keys(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (FORBIDDEN_KEYS.has(key)) {
      found.push(childPath);
      continue;
    }
    findForbiddenKeys(value[key], childPath, depth + 1, found);
  }
  return found;
}

/**
 * Clean a single string value.
 * @returns {{ value: string, changed: boolean, hadBidi: boolean }}
 */
function sanitizeSessionString(raw) {
  const hadBidi = BIDI_CONTROL_CHARS.test(raw);
  BIDI_CONTROL_CHARS.lastIndex = 0;
  const value = raw
    .normalize("NFC")
    .replace(BIDI_CONTROL_CHARS, "")
    .replace(ZERO_WIDTH_CHARS, "")
    .replace(CONTROL_CHARS, "")
    .trim();
  return { value, changed: value !== raw, hadBidi };
}

/**
 * Sanitize a payment session request body (issue #1447).
 *
 * Never mutates the input. Returns a shallow copy in which every known string
 * field has been cleaned; non-string values are left for strict validation.
 *
 * @param {unknown} body
 * @returns {{
 *   payload: object|null,
 *   modifiedFields: string[],
 *   suspicious: string[],
 *   rejection: {reason: string, message: string, details?: object}|null,
 * }}
 */
function sanitizeSessionPayload(body) {
  if (!isPlainObject(body)) {
    return {
      payload: null,
      modifiedFields: [],
      suspicious: ["malformed_payload"],
      rejection: {
        reason: "malformed_payload",
        message: "Payment session payload must be a JSON object",
      },
    };
  }

  const forbidden = findForbiddenKeys(body);
  if (forbidden.length > 0) {
    return {
      payload: null,
      modifiedFields: [],
      suspicious: ["forbidden_key"],
      rejection: {
        reason: "forbidden_key",
        message: "Payment session payload contains a forbidden key",
        details: { fields: forbidden },
      },
    };
  }

  const payload = { ...body };
  const modifiedFields = [];
  const suspicious = new Set();

  for (const [field, maxLength] of Object.entries(SESSION_FIELD_MAX_LENGTHS)) {
    if (typeof payload[field] !== "string") {
      continue;
    }

    const { value, changed, hadBidi } = sanitizeSessionString(payload[field]);
    if (hadBidi) {
      suspicious.add("bidi_control");
    }
    if (changed) {
      modifiedFields.push(field);
    }

    if (value.length > maxLength) {
      suspicious.add("oversized_field");
      return {
        payload: null,
        modifiedFields,
        suspicious: [...suspicious],
        rejection: {
          reason: "field_too_long",
          message: `${field} must be at most ${maxLength} characters`,
          details: { field, max_length: maxLength },
        },
      };
    }

    // Optional fields that sanitize down to nothing are treated as absent;
    // required ones stay "" so strict validation rejects them explicitly.
    payload[field] =
      value === "" && !REQUIRED_STRING_FIELDS.has(field) ? undefined : value;
  }

  return {
    payload,
    modifiedFields,
    suspicious: [...suspicious],
    rejection: null,
  };
}

/**
 * Strict asset-code validation (issue #1447).
 * @param {unknown} asset Normalized (uppercase) asset code
 * @returns {{reason:"invalid_asset", message}|null}
 */
function validateSessionAsset(asset) {
  if (typeof asset !== "string" || !ASSET_CODE_PATTERN.test(asset)) {
    return {
      reason: "invalid_asset",
      message: "asset must be 1-12 alphanumeric characters",
    };
  }
  return null;
}

/**
 * Strict amount validation (issue #1447). Rejects values Stellar cannot
 * represent so they fail here rather than at transaction build time.
 *
 * @param {unknown} amount
 * @returns {{reason:"invalid_amount", message}|null}
 */
function validateSessionAmount(amount) {
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    return {
      reason: "invalid_amount",
      message: "Amount must be a positive number",
    };
  }

  if (amount > MAX_STELLAR_AMOUNT) {
    return {
      reason: "invalid_amount",
      message: `Amount must not exceed ${MAX_STELLAR_AMOUNT}`,
    };
  }

  if (Number(amount.toFixed(STELLAR_AMOUNT_DECIMALS)) !== amount) {
    return {
      reason: "invalid_amount",
      message: `Amount must have at most ${STELLAR_AMOUNT_DECIMALS} decimal places`,
    };
  }

  return null;
}

/**
 * Coerce a merchant-configured limit bound to a finite number.
 * Returns undefined for absent or unusable values (NaN, objects, ...).
 */
function toFiniteBound(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : undefined;
}

/**
 * Report problems with a merchant's payment_limits entry for `rawAsset`
 * without changing validation outcome. Used by the validator to surface
 * misconfiguration through metrics/logs (issue #1448).
 *
 * @returns {string[]} anomaly kinds: "invalid_min" | "invalid_max" | "min_greater_than_max"
 */
function inspectPaymentLimitsConfig({ rawAsset, paymentLimits }) {
  if (!paymentLimits || typeof paymentLimits !== "object") {
    return [];
  }
  if (!Object.hasOwn(paymentLimits, rawAsset)) {
    return [];
  }
  const assetLimits = paymentLimits[rawAsset];
  if (!assetLimits || typeof assetLimits !== "object") {
    return ["invalid_entry"];
  }

  const anomalies = [];
  const min = toFiniteBound(assetLimits.min);
  const max = toFiniteBound(assetLimits.max);
  if (assetLimits.min !== undefined && assetLimits.min !== null && min === undefined) {
    anomalies.push("invalid_min");
  }
  if (assetLimits.max !== undefined && assetLimits.max !== null && max === undefined) {
    anomalies.push("invalid_max");
  }
  if (min !== undefined && max !== undefined && min > max) {
    anomalies.push("min_greater_than_max");
  }
  return anomalies;
}

/**
 * Resolve and validate the asset issuer for a payment session.
 *
 * @param {string} asset       Normalized (uppercase) asset code
 * @param {string|null} rawIssuer Raw asset_issuer supplied by the client
 * @returns {{ assetIssuer: string|null, rejection: null }}
 *   | {{ assetIssuer: null, rejection: {reason, message} }}
 */
function resolveAndValidateIssuer(asset, rawIssuer) {
  const assetIssuer = resolveAssetIssuer(asset, rawIssuer);

  if (asset !== "XLM" && !assetIssuer) {
    return {
      assetIssuer: null,
      rejection: {
        reason: "missing_issuer",
        message: "asset_issuer is required for non-native assets",
      },
    };
  }

  if (asset !== "XLM" && !isValidStellarPublicKey(assetIssuer)) {
    return {
      assetIssuer: null,
      rejection: {
        reason: "invalid_issuer",
        message: "asset_issuer must be a valid Stellar public key",
      },
    };
  }

  return { assetIssuer, rejection: null };
}

/**
 * Enforce per-asset min/max payment limits configured on the merchant.
 *
 * Lookup uses the RAW asset string exactly as the legacy implementations did
 * (`payment_limits[body.asset]`) so existing merchant configs keep working
 * regardless of casing.
 *
 * @param {object} params
 * @param {string} params.rawAsset     Asset code as sent by the client
 * @param {number} params.amount       Requested amount
 * @param {object|null} params.paymentLimits Merchant payment_limits object
 * @returns {{reason:"below_min"|"above_max", message, details}|null}
 */
function validatePerAssetLimits({ rawAsset, amount, paymentLimits }) {
  if (!paymentLimits || typeof paymentLimits !== "object") {
    return null;
  }

  // Own-property lookup only: an asset code such as "constructor" must never
  // resolve to something inherited from Object.prototype.
  if (typeof rawAsset !== "string" || !Object.hasOwn(paymentLimits, rawAsset)) {
    return null;
  }
  const assetLimits = paymentLimits[rawAsset];
  if (!assetLimits || typeof assetLimits !== "object") {
    return null;
  }

  // Non-numeric bounds are ignored here and reported separately by
  // inspectPaymentLimitsConfig so they can be alerted on.
  const min = toFiniteBound(assetLimits.min);
  const max = toFiniteBound(assetLimits.max);

  if (min !== undefined && amount < min) {
    return {
      reason: "below_min",
      message: `Amount is below the minimum for ${rawAsset}`,
      details: {
        min,
        delta: Number((min - amount).toFixed(7)),
      },
    };
  }

  if (max !== undefined && amount > max) {
    return {
      reason: "above_max",
      message: `Amount exceeds the maximum for ${rawAsset}`,
      details: {
        max,
        delta: Number((amount - max).toFixed(7)),
      },
    };
  }

  return null;
}

/**
 * Enforce the merchant's issuer allowlist. An empty/absent allowlist permits
 * any (already format-validated) issuer.
 *
 * @param {object} params
 * @param {string} params.asset             Normalized asset code
 * @param {string|null} params.assetIssuer  Resolved issuer
 * @param {string[]|undefined} params.allowedIssuers Merchant allowlist
 * @returns {{reason:"issuer_not_allowed", message}|null}
 */
function validateAllowedIssuers({ asset, assetIssuer, allowedIssuers }) {
  if (
    asset === "XLM" ||
    !Array.isArray(allowedIssuers) ||
    allowedIssuers.length === 0
  ) {
    return null;
  }

  const allowed = allowedIssuers.filter((issuer) => typeof issuer === "string");
  if (!assetIssuer || !allowed.includes(assetIssuer)) {
    return {
      reason: "issuer_not_allowed",
      message: "asset_issuer is not in the merchant's list of allowed issuers",
    };
  }

  return null;
}

export {
  MAX_STELLAR_AMOUNT,
  SESSION_FIELD_MAX_LENGTHS,
  sanitizeSessionPayload,
  validateSessionAsset,
  validateSessionAmount,
  inspectPaymentLimitsConfig,
  resolveAndValidateIssuer,
  validatePerAssetLimits,
  validateAllowedIssuers,
};
