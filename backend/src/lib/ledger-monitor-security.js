/**
 * Ledger Monitor Security Hardening — Issue #911
 *
 * Implements security controls for the Ledger Monitor (horizon-poller.js):
 * - Payment record validation before processing
 * - Metadata sanitization to prevent injection via DB-sourced fields
 * - Anomaly detection for suspicious payment patterns
 * - Structured audit events for security-relevant observations
 */

import { logger } from "./logger.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const STELLAR_ADDRESS_REGEX = /^G[A-Z2-7]{55}$/;
const STELLAR_TX_HASH_REGEX = /^[a-f0-9]{64}$/i;
const ASSET_CODE_REGEX = /^[A-Z0-9]{1,12}$/;

/**
 * Asset codes that represent the Stellar native asset (lumens). The rest of the
 * codebase stores the native asset as "XLM" with a null issuer (see
 * `resolveAsset` in stellar.js), so both spellings must be treated as native —
 * otherwise legitimate native payments are rejected for "missing" an issuer.
 */
const NATIVE_ASSET_CODES = new Set(["native", "xlm"]);

/**
 * @param {unknown} asset
 * @returns {boolean} true when `asset` denotes the native asset (XLM / native).
 */
export function isNativeAsset(asset) {
  return (
    typeof asset === "string" &&
    NATIVE_ASSET_CODES.has(asset.trim().toLowerCase())
  );
}

/** Maximum byte length for a Stellar text memo. */
const MAX_MEMO_TEXT_BYTES = 28;

/** Maximum number of keys allowed in payment metadata to prevent resource exhaustion. */
const MAX_METADATA_KEYS = 30;

/** Maximum character length for any single metadata string value. */
const MAX_METADATA_VALUE_LENGTH = 500;

/** Keys from payment metadata that are allowed through sanitization unchanged. */
export const METADATA_ALLOWLIST = new Set([
  "order_id",
  "customer_id",
  "reference",
  "invoice_id",
  "external_id",
  "failure_reason",
  "expected_amount",
  "received_amount",
  "shortfall",
  "excess",
  "overpayment",
  "note",
]);

/**
 * Age threshold (hours) above which a payment is considered stale and flagged
 * as an anomaly. Exported so horizon-poller.js can share the same value
 * rather than maintaining a separate hardcoded copy that can diverge (DI-05).
 */
export const STALE_PAYMENT_HOURS = 20;

// ── Payment Record Validation ─────────────────────────────────────────────────

/**
 * Validate a payment record fetched from the database before processing.
 *
 * Returns `{ valid: true }` when all fields pass, or
 * `{ valid: false, reason: string }` when validation fails.
 *
 * @param {object} payment
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validatePaymentRecord(payment) {
  if (!payment || typeof payment !== "object") {
    return { valid: false, reason: "payment record is null or not an object" };
  }

  // id
  if (typeof payment.id !== "string" || payment.id.trim() === "") {
    return { valid: false, reason: "payment.id is missing or not a string" };
  }

  // recipient — must be a valid Stellar public key
  if (typeof payment.recipient !== "string" || !STELLAR_ADDRESS_REGEX.test(payment.recipient)) {
    return {
      valid: false,
      reason: `payment.recipient is not a valid Stellar address: ${String(payment.recipient).slice(0, 20)}`,
    };
  }

  // amount — must be a finite positive number.
  // DI-04: payment.amount is stored in the DB as a string (e.g. "10.0000000").
  // Number() coerces empty strings and "0.00" to 0, which is falsy but would
  // pass a naive `> 0` check if the value were already a number. Explicitly
  // reject non-parseable strings and zero-value amounts to prevent a payment
  // with amount "0" from being processed and marking a DB row as confirmed.
  const rawAmount = payment.amount;
  if (
    rawAmount === null ||
    rawAmount === undefined ||
    rawAmount === "" ||
    (typeof rawAmount === "string" && rawAmount.trim() === "")
  ) {
    return { valid: false, reason: "payment.amount is missing or empty" };
  }
  const amount = Number(rawAmount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return {
      valid: false,
      reason: `payment.amount is not a positive finite number: ${rawAmount}`,
    };
  }

  // asset — must be the native asset (XLM / "native") or a valid asset code
  if (
    typeof payment.asset !== "string" ||
    (!isNativeAsset(payment.asset) && !ASSET_CODE_REGEX.test(payment.asset))
  ) {
    return {
      valid: false,
      reason: `payment.asset is not a valid asset code: ${String(payment.asset).slice(0, 20)}`,
    };
  }

  // asset_issuer — required for non-native assets, must be a Stellar address.
  // The native asset (XLM / "native") never has an issuer.
  if (!isNativeAsset(payment.asset)) {
    if (
      typeof payment.asset_issuer !== "string" ||
      !STELLAR_ADDRESS_REGEX.test(payment.asset_issuer)
    ) {
      return {
        valid: false,
        reason: `payment.asset_issuer is invalid for non-native asset: ${String(payment.asset_issuer).slice(0, 20)}`,
      };
    }
  }

  // memo — if present, must be a string within byte limits
  if (payment.memo !== null && payment.memo !== undefined) {
    if (typeof payment.memo !== "string") {
      return { valid: false, reason: "payment.memo is not a string" };
    }
    const memoBytes = Buffer.byteLength(payment.memo, "utf8");
    if (memoBytes > MAX_MEMO_TEXT_BYTES * 4) {
      // generous upper bound; Stellar SDK enforces exact limit at signing time
      return {
        valid: false,
        reason: `payment.memo exceeds maximum byte length: ${memoBytes}`,
      };
    }
  }

  // created_at — must be a parseable date string
  if (payment.created_at) {
    const ts = Date.parse(payment.created_at);
    if (!Number.isFinite(ts)) {
      return {
        valid: false,
        reason: `payment.created_at is not a valid date: ${payment.created_at}`,
      };
    }
    // Reject payments with a creation time more than 1 hour in the future
    if (ts > Date.now() + 60 * 60 * 1000) {
      return {
        valid: false,
        reason: `payment.created_at is suspiciously far in the future: ${payment.created_at}`,
      };
    }
  }

  return { valid: true };
}

// ── Metadata Sanitization ─────────────────────────────────────────────────────

/**
 * Sanitize payment metadata before merging into DB update payloads.
 *
 * - Drops keys not on the allowlist
 * - Truncates excessively long string values
 * - Caps total key count
 * - Removes any nested objects (flat map only)
 *
 * @param {unknown} metadata
 * @returns {Record<string, string | number | boolean | null>}
 */
export function sanitizePaymentMetadata(metadata) {
  if (metadata === null || metadata === undefined) return {};
  if (typeof metadata !== "object" || Array.isArray(metadata)) return {};

  const result = {};
  let keyCount = 0;

  for (const [key, value] of Object.entries(metadata)) {
    if (keyCount >= MAX_METADATA_KEYS) break;

    if (!METADATA_ALLOWLIST.has(key)) continue;

    if (value === null || value === undefined) {
      result[key] = null;
    } else if (typeof value === "boolean" || typeof value === "number") {
      result[key] = value;
    } else if (typeof value === "string") {
      result[key] = value.slice(0, MAX_METADATA_VALUE_LENGTH);
    } else {
      // Drop nested objects and arrays
      continue;
    }

    keyCount += 1;
  }

  return result;
}

// ── Anomaly Detection ─────────────────────────────────────────────────────────

/**
 * Detect anomalous patterns in a payment record that warrant a security log event.
 * This does not block processing — it only emits structured warning events.
 *
 * @param {object} payment
 */
export function auditPaymentAnomaly(payment) {
  const flags = [];

  // Unusually large amount
  const amount = Number(payment.amount);
  if (amount > 100_000) {
    flags.push({ type: "large_amount", amount });
  }

  // Memo contains control characters or looks like an injection attempt
  if (typeof payment.memo === "string") {
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(payment.memo)) {
      flags.push({ type: "memo_control_chars", memoLength: payment.memo.length });
    }
    if (payment.memo.includes("'") || payment.memo.includes('"') || payment.memo.includes("--")) {
      flags.push({ type: "memo_sql_chars" });
    }
  }

  // Payment is very old (should have been handled already)
  if (payment.created_at) {
    const ageHours = (Date.now() - Date.parse(payment.created_at)) / 3_600_000;
    if (ageHours > STALE_PAYMENT_HOURS) {
      flags.push({ type: "stale_payment", ageHours: Math.floor(ageHours) });
    }
  }

  // Metadata has unexpected keys (keys outside the allowlist survived validation)
  if (payment.metadata && typeof payment.metadata === "object") {
    const unknownKeys = Object.keys(payment.metadata).filter(
      (k) => !METADATA_ALLOWLIST.has(k),
    );
    if (unknownKeys.length > 0) {
      flags.push({ type: "metadata_unknown_keys", keys: unknownKeys.slice(0, 5) });
    }
  }

  if (flags.length > 0) {
    logger.warn(
      { paymentId: payment.id, merchantId: payment.merchant_id, flags },
      "Ledger Monitor security: anomalous payment pattern detected",
    );
  }
}

/**
 * Validate a transaction hash returned from Horizon before using it.
 *
 * @param {unknown} txHash
 * @returns {boolean}
 */
export function isValidTransactionHash(txHash) {
  return typeof txHash === "string" && STELLAR_TX_HASH_REGEX.test(txHash);
}
