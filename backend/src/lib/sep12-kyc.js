/**
 * SEP-12 KYC integration.
 *
 * Stores and retrieves customer KYC records keyed by Stellar account (+ memo),
 * gated by a cryptographic signature from the account holder (issue #590).
 * Queries are single-round-trip, parameterised, and index-aligned (#591) and
 * every database interaction goes through a structured error-recovery wrapper
 * (#592). See SEP12_KYC_SECURITY_AUDIT.md for the threat model (#593).
 */

import { createHash } from "node:crypto";
import * as StellarSdk from "stellar-sdk";
import { z } from "zod";
import { queryWithRetry, isRetryablePoolError } from "./db.js";
import { logger } from "./logger.js";

/** Max age (seconds) accepted for a request signature — replay protection. */
export const SIGNATURE_MAX_AGE_SECONDS = 300;

/** Max accepted memo length; bounds stored key size. */
const MAX_MEMO_LENGTH = 64;

/** KYC lifecycle statuses (SEP-12 §Status). */
export const KYC_STATUSES = ["ACCEPTED", "PROCESSING", "NEEDS_INFO", "REJECTED"];

/**
 * Accepted KYC fields. `.strict()` rejects unknown keys so callers cannot
 * smuggle arbitrary JSON into the store (security hardening, #593).
 */
const fieldsSchema = z
  .object({
    first_name: z.string().min(1).max(100).optional(),
    last_name: z.string().min(1).max(100).optional(),
    email_address: z.string().email().max(254).optional(),
    birth_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "birth_date must be YYYY-MM-DD")
      .optional(),
    address: z.string().max(500).optional(),
    id_number: z.string().min(1).max(100).optional(),
  })
  .strict();

/**
 * Structured error type so the route layer can map failures to the right HTTP
 * status and signal retryability to clients (#592).
 */
export class KycError extends Error {
  constructor(code, message, httpStatus = 400, { retryable = false, cause } = {}) {
    super(message);
    this.name = "KycError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.retryable = retryable;
    if (cause) this.cause = cause;
  }
}

// ---------------------------------------------------------------------------
// Signature verification (#590)
// ---------------------------------------------------------------------------

/** Deterministic JSON with sorted keys so client and server hash identically. */
function canonicalJson(obj) {
  const sorted = {};
  for (const key of Object.keys(obj || {}).sort()) {
    sorted[key] = obj[key];
  }
  return JSON.stringify(sorted);
}

/**
 * The canonical message a client signs to authorise a KYC write. Binds the
 * account, memo, a unix `timestamp` (replay window), and a hash of the field
 * payload so a captured signature cannot be replayed against different data.
 */
export function buildSignaturePayload({ account, memo = "", timestamp, fields }) {
  const fieldsHash = createHash("sha256").update(canonicalJson(fields)).digest("hex");
  return `${account}:${memo}:${timestamp}:${fieldsHash}`;
}

/**
 * Verify a customer's signature over {@link buildSignaturePayload}.
 * Returns `{ valid: true }` or `{ valid: false, reason }` — never throws.
 */
export function verifyCustomerSignature(
  { account, memo = "", timestamp, fields, signature },
  { maxAgeSeconds = SIGNATURE_MAX_AGE_SECONDS, now = Date.now() } = {},
) {
  if (!account || typeof signature !== "string" || signature.length === 0 || !timestamp) {
    return { valid: false, reason: "missing_signature_fields" };
  }

  const ts = Number(timestamp);
  const ageSeconds = Math.abs(Math.floor(now / 1000) - ts);
  if (!Number.isFinite(ts) || ageSeconds > maxAgeSeconds) {
    return { valid: false, reason: "stale_or_invalid_timestamp" };
  }

  let keypair;
  try {
    keypair = StellarSdk.Keypair.fromPublicKey(account);
  } catch {
    return { valid: false, reason: "invalid_account" };
  }

  let signatureBuffer;
  try {
    signatureBuffer = Buffer.from(signature, "base64");
  } catch {
    return { valid: false, reason: "invalid_signature_encoding" };
  }
  if (signatureBuffer.length === 0) {
    return { valid: false, reason: "invalid_signature_encoding" };
  }

  const payload = buildSignaturePayload({ account, memo, timestamp: ts, fields });
  const hash = createHash("sha256").update(payload).digest();

  let ok = false;
  try {
    ok = keypair.verify(hash, signatureBuffer);
  } catch {
    ok = false;
  }
  return ok ? { valid: true } : { valid: false, reason: "signature_mismatch" };
}

// ---------------------------------------------------------------------------
// Error recovery wrapper (#592)
// ---------------------------------------------------------------------------

/**
 * Run a DB operation, translating low-level failures into {@link KycError}.
 * `queryWithRetry` already retries transient pool errors; once retries are
 * exhausted we surface a retryable 503 so the client can back off, and map
 * everything else to a non-leaky 500. Field values are never logged (#593).
 */
const SLOW_QUERY_THRESHOLD_MS = 500;

async function withRecovery(fn, label) {
  const start = Date.now();
  try {
    const result = await fn();
    const elapsed = Date.now() - start;
    if (elapsed > SLOW_QUERY_THRESHOLD_MS) {
      logger.warn({ label, elapsed }, "sep12 kyc slow query");
    }
    return result;
  } catch (err) {
    const elapsed = Date.now() - start;
    if (err instanceof KycError) throw err;
    if (isRetryablePoolError(err)) {
      logger.warn({ label, code: err.code, elapsed }, "sep12 kyc store temporarily unavailable");
      throw new KycError(
        "SERVICE_UNAVAILABLE",
        "KYC store temporarily unavailable, please retry",
        503,
        { retryable: true, cause: err },
      );
    }
    logger.error({ label, code: err.code, elapsed }, "sep12 kyc store error");
    throw new KycError("DB_ERROR", "KYC store error", 500, { cause: err });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assertValidAccount(account) {
  try {
    StellarSdk.Keypair.fromPublicKey(account);
  } catch {
    throw new KycError("INVALID_ACCOUNT", "A valid Stellar account is required", 400);
  }
}

/** Coerce a missing memo to "" and reject non-string/oversized values. */
function normalizeMemo(memo) {
  if (memo === undefined || memo === null) return "";
  if (typeof memo !== "string" || memo.length > MAX_MEMO_LENGTH) {
    throw new KycError("INVALID_MEMO", "memo must be a string of at most 64 characters", 400);
  }
  return memo;
}

/** Derive a KYC status from the supplied fields. */
function deriveStatus(fields) {
  const hasCore = fields.first_name && fields.last_name && fields.email_address;
  return hasCore ? "ACCEPTED" : "NEEDS_INFO";
}

function mapRow(row) {
  return {
    id: row.id,
    account: row.stellar_account,
    memo: row.memo,
    fields: row.fields ?? {},
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/**
 * Create or update a customer's KYC record (SEP-12 `PUT /customer`).
 *
 * Steps: validate account → verify signature (#590) → validate fields → upsert
 * in a single parameterised round trip (#591) under error recovery (#592).
 *
 * `deps` allows injecting `query` / `verifySignature` for testing.
 */
export async function putCustomer(rawInput, deps = {}) {
  const input = { ...(rawInput ?? {}), memo: normalizeMemo(rawInput?.memo) };
  const query = deps.query || queryWithRetry;
  const verifySignature = deps.verifySignature || verifyCustomerSignature;
  const now = deps.now;

  assertValidAccount(input.account);

  const signatureResult = verifySignature(input, now ? { now } : undefined);
  if (!signatureResult.valid) {
    throw new KycError(
      "SIGNATURE_INVALID",
      `Signature verification failed: ${signatureResult.reason}`,
      401,
    );
  }

  const parsed = fieldsSchema.safeParse(input.fields ?? {});
  if (!parsed.success) {
    throw new KycError("VALIDATION_ERROR", "Invalid KYC fields", 400, {
      cause: parsed.error,
    });
  }
  const fields = parsed.data;
  const memo = input.memo;
  const status = deriveStatus(fields);

  // Single-round-trip parameterised upsert (#591, #593). The ON CONFLICT
  // target matches the sep12_kyc_account_memo_uidx unique index. The WHERE
  // guard only lets a strictly newer signed request overwrite a record, so
  // concurrent or replayed older writes cannot clobber newer data.
  const sql = `
    INSERT INTO sep12_kyc_customers (stellar_account, memo, fields, status, signed_at, updated_at)
    VALUES ($1, $2, $3::jsonb, $4, $5, now())
    ON CONFLICT (stellar_account, memo)
    DO UPDATE SET fields = EXCLUDED.fields, status = EXCLUDED.status,
                  signed_at = EXCLUDED.signed_at, updated_at = now()
    WHERE sep12_kyc_customers.signed_at < EXCLUDED.signed_at
    RETURNING id, status`;

  const signedAt = Math.floor(Number(input.timestamp));
  const result = await withRecovery(
    () =>
      query(sql, [input.account, memo, JSON.stringify(fields), status, signedAt], {
        label: "sep12_put",
      }),
    "sep12_put",
  );

  if (result.rows.length === 0) {
    throw new KycError(
      "STALE_REQUEST",
      "A newer KYC update already exists for this customer",
      409,
    );
  }
  return { id: result.rows[0].id, status: result.rows[0].status };
}

/**
 * Fetch a customer's KYC record (SEP-12 `GET /customer`). Uses the unique
 * (stellar_account, memo) index and selects only the needed columns (#591).
 */
export async function getCustomer({ account, memo } = {}, deps = {}) {
  const query = deps.query || queryWithRetry;
  assertValidAccount(account);
  memo = normalizeMemo(memo);

  const sql = `
    SELECT id, stellar_account, memo, fields, status, created_at, updated_at
    FROM sep12_kyc_customers
    WHERE stellar_account = $1 AND memo = $2
    LIMIT 1`;

  const result = await withRecovery(
    () => query(sql, [account, memo], { label: "sep12_get" }),
    "sep12_get",
  );

  if (result.rows.length === 0) {
    throw new KycError("NOT_FOUND", "Customer not found", 404);
  }
  return mapRow(result.rows[0]);
}

/**
 * Delete a customer's KYC record (SEP-12 `DELETE /customer`).
 * Requires a valid signature from the account holder (#739).
 */
export async function deleteCustomer(
  { account, memo, timestamp, signature } = {},
  deps = {},
) {
  const query = deps.query || queryWithRetry;
  const verifySignature = deps.verifySignature || verifyCustomerSignature;
  const now = deps.now;

  assertValidAccount(account);
  memo = normalizeMemo(memo);

  const signatureResult = verifySignature(
    { account, memo, timestamp, signature, fields: {} },
    now ? { now } : undefined,
  );
  if (!signatureResult.valid) {
    throw new KycError(
      "SIGNATURE_INVALID",
      `Signature verification failed: ${signatureResult.reason}`,
      401,
    );
  }

  const sql = `
    DELETE FROM sep12_kyc_customers
    WHERE stellar_account = $1 AND memo = $2
    RETURNING id`;

  const result = await withRecovery(
    () => query(sql, [account, memo], { label: "sep12_delete" }),
    "sep12_delete",
  );

  if (result.rows.length === 0) {
    throw new KycError("NOT_FOUND", "Customer not found", 404);
  }
  return { id: result.rows[0].id, deleted: true };
}
