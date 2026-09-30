/**
 * Fraud Detection Engine — Payload Sanitization & Strict Validation (#1427)
 *
 * Provides input sanitization and Zod-based strict schema validation
 * for all payloads entering the Fraud Detection Engine.
 */

import { z } from 'zod';
import { sanitizeMetadata } from './sanitize-metadata.js';
import { logger } from './logger.js';

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

/** Stellar public key pattern (G... 56 chars, base32 uppercase) */
const stellarAddressSchema = z
  .string()
  .regex(/^G[A-Z2-7]{55}$/, 'Invalid Stellar public key format');

/** Payment amount: numeric string, positive, max 20 chars */
const amountSchema = z
  .string()
  .regex(/^\d+(\.\d{1,7})?$/, 'Amount must be a positive numeric string with up to 7 decimal places')
  .refine((v) => parseFloat(v) > 0, { message: 'Amount must be greater than zero' })
  .refine((v) => v.length <= 20, { message: 'Amount string too long' });

/** Payment status whitelist */
const paymentStatusSchema = z.enum(['pending', 'completed', 'failed', 'expired', 'refunded']);

/** Memo: optional, max 200 chars, stripped of control characters */
const memoSchema = z
  .string()
  .max(200, 'Memo exceeds maximum length of 200 characters')
  .transform((v) => v.replace(/[\u0000-\u001F\u007F]/g, '').trim())
  .optional()
  .nullable();

/** Merchant ID: non-empty string, max 128 chars */
const merchantIdSchema = z
  .string()
  .min(1, 'Merchant ID is required')
  .max(128, 'Merchant ID too long')
  .regex(/^[a-zA-Z0-9_\-:.@]+$/, 'Merchant ID contains invalid characters');

/** Full payment payload schema for fraud detection */
export const fraudDetectionPayloadSchema = z.object({
  id: z.string().min(1, 'Payment ID is required').max(128),
  amount: amountSchema,
  recipient: stellarAddressSchema,
  status: paymentStatusSchema,
  created_at: z.string().datetime({ message: 'created_at must be a valid ISO 8601 datetime' }),
  memo: memoSchema,
  metadata: z
    .record(z.unknown())
    .optional()
    .nullable()
    .default({}),
  // Optional fields that may be present
  merchant_id: z.string().max(128).optional(),
  currency: z.string().max(12).optional(),
  asset_code: z.string().max(12).optional(),
  asset_issuer: stellarAddressSchema.optional().nullable(),
});

/** Partial schema for cache-key-only operations */
export const fraudDetectionCacheKeySchema = z.object({
  id: z.string().min(1).max(128),
  merchant_id: merchantIdSchema.optional(),
});

// ---------------------------------------------------------------------------
// Sanitization helpers
// ---------------------------------------------------------------------------

/**
 * Strip prototype-pollution and dangerous keys from a plain object.
 * @param {Record<string, unknown>} obj
 * @returns {Record<string, unknown>}
 */
function stripDangerousKeys(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const dangerous = new Set(['__proto__', 'constructor', 'prototype']);
  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    if (dangerous.has(k)) continue;
    result[k] = typeof v === 'object' && v !== null ? stripDangerousKeys(v) : v;
  }
  return result;
}

/**
 * Truncate all string values in a flat/nested object to a maximum length.
 */
function truncateStrings(obj, maxLen = 1000) {
  if (!obj || typeof obj !== 'object') return obj;
  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') {
      result[k] = v.length > maxLen ? v.slice(0, maxLen) : v;
    } else if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      result[k] = truncateStrings(v, maxLen);
    } else {
      result[k] = v;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Main sanitize + validate function
// ---------------------------------------------------------------------------

/**
 * Sanitize and strictly validate a payment payload before it enters
 * the Fraud Detection Engine.
 *
 * @param {unknown} rawPayload - Raw incoming payment object
 * @param {string} [merchantId] - Merchant identifier (optional; defaults to 'unknown')
 * @returns {{ valid: true, payload: object, merchantId: string } | { valid: false, errors: string[], rawPayload: unknown }}
 */
export function sanitizeAndValidateFraudPayload(rawPayload, merchantId) {
  // --- 1. Reject non-object payloads immediately ---
  if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) {
    logger.warn({ rawPayload }, '[FraudDetection] Rejected non-object payload');
    return {
      valid: false,
      errors: ['Payload must be a non-null object'],
      rawPayload,
    };
  }

  // --- 2. Strip prototype-pollution keys ---
  const stripped = stripDangerousKeys(rawPayload);

  // --- 3. Sanitize metadata field using the existing sanitize-metadata utility ---
  if (stripped.metadata && typeof stripped.metadata === 'object') {
    try {
      stripped.metadata = sanitizeMetadata(stripped.metadata);
    } catch (err) {
      logger.warn({ err }, '[FraudDetection] metadata sanitization failed, resetting to empty object');
      stripped.metadata = {};
    }
  }

  // --- 4. Truncate long string values ---
  const truncated = truncateStrings(stripped, 1000);

  // --- 5. Zod strict validation ---
  const parseResult = fraudDetectionPayloadSchema.safeParse(truncated);
  if (!parseResult.success) {
    const errors = parseResult.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`
    );
    logger.warn({ errors, paymentId: truncated.id }, '[FraudDetection] Payload validation failed');
    return { valid: false, errors, rawPayload };
  }

  // --- 6. Validate merchantId separately (treat missing/empty as 'unknown') ---
  const effectiveMerchantId = merchantId && typeof merchantId === 'string' && merchantId.trim()
    ? merchantId
    : 'unknown';

  // Only strict-validate if a non-default merchantId was provided
  if (effectiveMerchantId !== 'unknown') {
    const merchantResult = merchantIdSchema.safeParse(effectiveMerchantId);
    if (!merchantResult.success) {
      const errors = merchantResult.error.issues.map((i) => `merchantId: ${i.message}`);
      logger.warn({ errors }, '[FraudDetection] Invalid merchant ID');
      return { valid: false, errors, rawPayload };
    }
  }

  return {
    valid: true,
    payload: parseResult.data,
    merchantId: effectiveMerchantId,
  };
}

/**
 * Validate merchantId only (for cache-clear operations).
 */
export function validateMerchantId(merchantId) {
  const result = merchantIdSchema.safeParse(merchantId);
  if (!result.success) {
    return { valid: false, errors: result.error.issues.map((i) => i.message) };
  }
  return { valid: true, merchantId: result.data };
}
