import { z } from "zod";
import { pool } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import {
  recordRlsTransaction,
  dbRlsActiveTransactions,
} from "../lib/db-rls-telemetry.js";

// ── Validation Schemas ──────────────────────────────────────────────────────
const MerchantIdSchema = z
  .string()
  .trim()
  .min(1, "merchantId must be a non-empty string")
  .max(128, "merchantId exceeds maximum length of 128 characters")
  .regex(
    /^[a-zA-Z0-9_\-:.@]+$/,
    "merchantId contains invalid characters"
  );

// ── Sanitization Helpers ─────────────────────────────────────────────────────

// ── Validation Functions ─────────────────────────────────────────────────────

/**
 * Strictly validates and sanitizes a merchant ID.
 * Returns { valid: true, merchantId } or { valid: false, error }
 */
export function validateAndSanitizeMerchantId(merchantId) {
  try {
    const parsed = MerchantIdSchema.parse(merchantId);
    return { valid: true, merchantId: parsed };
  } catch (err) {
    const errorMessage =
      err instanceof z.ZodError ? err.errors[0]?.message : "Invalid merchantId";
    return { valid: false, error: errorMessage };
  }
}

// ── Core Functions ──────────────────────────────────────────────────────────

/**
 * Executes a callback within a transaction where the merchant context is set.
 * This ensures Row Level Security (RLS) is enforced for direct pg pool queries.
 * Includes payload sanitization and strict validation for merchantId.
 */
export async function withMerchantContext(merchantId, callback) {
  const startedAt = process.hrtime.bigint();
  const finish = (outcome) => {
    const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
    recordRlsTransaction(outcome, seconds);
  };

  // Validate and sanitize merchantId
  const validation = validateAndSanitizeMerchantId(merchantId);
  if (!validation.valid) {
    logger.warn(
      { merchantId, error: validation.error },
      "[RLS] Invalid merchantId provided to withMerchantContext"
    );
    finish("invalid_input");
    throw new Error(`Invalid merchantId: ${validation.error}`);
  }

  const sanitizedMerchantId = validation.merchantId;

  // Validate callback is a function
  if (typeof callback !== "function") {
    logger.warn(
      { merchantId: sanitizedMerchantId },
      "[RLS] Invalid callback provided to withMerchantContext"
    );
    finish("invalid_input");
    throw new Error("callback must be a function");
  }

  let client;
  try {
    client = await pool.connect();
  } catch (err) {
    logger.error({ err: err.message }, "[RLS] Failed to acquire pooled connection");
    finish("connection_error");
    throw err;
  }

  dbRlsActiveTransactions.inc();
  let outcome = "committed";
  let callbackStarted = false;
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL app.current_merchant_id = $1", [
      sanitizedMerchantId,
    ]);
    callbackStarted = true;
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    if (callbackStarted) {
      outcome = "rolled_back";
    } else {
      outcome = "transaction_error";
    }
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      outcome = "transaction_error";
      logger.error(
        { rollbackErr: rollbackErr.message },
        "[RLS] Failed to rollback transaction"
      );
    }
    throw err;
  } finally {
    dbRlsActiveTransactions.dec();
    client.release();
    finish(outcome);
  }
}

/**
 * Sanitizes a merchant ID for logging purposes (non-validation path).
 * This is useful when you need to safely include merchantId in logs
 * without throwing validation errors.
 */
export function sanitizeMerchantId(merchantId) {
  if (typeof merchantId !== "string") {
    return null;
  }
  const trimmed = merchantId.trim();
  if (trimmed.length === 0 || trimmed.length > 128) {
    return null;
  }
  const sanitized = trimmed.replace(/[^a-zA-Z0-9_\-:.@]/g, "");
  return sanitized.length > 0 ? sanitized : null;
}

/**
 * Distributed advisory lock management for Row-Level Security
 *
 * PostgreSQL advisory locks provide distributed concurrency control across
 * multiple application instances. Locks are automatically released when the
 * session ends, providing safety against orphaned locks.
 */

const LOCK_TIMEOUT_MS = Number.parseInt(
  process.env.RLS_LOCK_TIMEOUT_MS || "5000",
  10,
);

/**
 * Acquire an advisory lock for a specific merchant resource.
 *
 * @param {string} merchantId - The merchant ID to lock
 * @param {string} resourceType - Type of resource (e.g., 'payment', 'merchant')
 * @param {Object} options - Lock options
 * @param {number} options.timeout - Lock acquisition timeout in milliseconds
 * @returns {Promise<boolean>} - True if lock was acquired, false otherwise
 */
export async function acquireAdvisoryLock(
  merchantId,
  resourceType,
  { timeout = LOCK_TIMEOUT_MS } = {},
) {
  const lockKey = generateLockKey(merchantId, resourceType);
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    try {
      const { rows } = await pool.query(
        "SELECT pg_try_advisory_lock($1::bigint) as acquired",
        [lockKey],
      );

      if (rows[0].acquired) {
        logger.info(
          { merchantId, resourceType, lockKey },
          "Advisory lock acquired",
        );
        return true;
      }

      // Wait before retrying (exponential backoff)
      const elapsed = Date.now() - startTime;
      const backoffMs = Math.min(100 * Math.pow(2, Math.floor(elapsed / 1000)), 1000);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    } catch (err) {
      logger.error(
        { err: err.message, merchantId, resourceType },
        "Failed to acquire advisory lock",
      );
      return false;
    }
  }

  logger.warn(
    { merchantId, resourceType, timeout },
    "Advisory lock acquisition timed out",
  );
  return false;
}

/**
 * Release an advisory lock for a specific merchant resource.
 *
 * @param {string} merchantId - The merchant ID to unlock
 * @param {string} resourceType - Type of resource
 * @returns {Promise<boolean>} - True if lock was released, false otherwise
 */
export async function releaseAdvisoryLock(merchantId, resourceType) {
  const lockKey = generateLockKey(merchantId, resourceType);

  try {
    const { rows } = await pool.query(
      "SELECT pg_advisory_unlock($1::bigint) as released",
      [lockKey],
    );

    if (rows[0].released) {
      logger.info(
        { merchantId, resourceType, lockKey },
        "Advisory lock released",
      );
      return true;
    }

    logger.warn(
      { merchantId, resourceType, lockKey },
      "Advisory lock was not held by this session",
    );
    return false;
  } catch (err) {
    logger.error(
      { err: err.message, merchantId, resourceType },
      "Failed to release advisory lock",
    );
    return false;
  }
}

/**
 * Execute a callback with an advisory lock held.
 *
 * This provides distributed concurrency control for critical sections
 * that need to be serialized across multiple application instances.
 *
 * @param {string} merchantId - The merchant ID to lock
 * @param {string} resourceType - Type of resource
 * @param {Function} callback - Function to execute while holding the lock
 * @param {Object} options - Lock options
 * @returns {Promise<*>} - Result of the callback
 */
export async function withAdvisoryLock(
  merchantId,
  resourceType,
  callback,
  options = {},
) {
  const acquired = await acquireAdvisoryLock(merchantId, resourceType, options);

  if (!acquired) {
    throw new Error(
      `Failed to acquire advisory lock for merchant ${merchantId} on ${resourceType}`,
    );
  }

  try {
    return await callback();
  } finally {
    await releaseAdvisoryLock(merchantId, resourceType);
  }
}

/**
 * Execute a callback with both merchant context and advisory lock.
 *
 * This combines RLS enforcement with distributed concurrency control,
 * ensuring both security and serialization across instances.
 *
 * @param {string} merchantId - The merchant ID
 * @param {string} resourceType - Type of resource for locking
 * @param {Function} callback - Function to execute
 * @param {Object} options - Lock options
 * @returns {Promise<*>} - Result of the callback
 */
export async function withMerchantContextAndLock(
  merchantId,
  resourceType,
  callback,
  options = {},
) {
  return withAdvisoryLock(merchantId, resourceType, async () => {
    return withMerchantContext(merchantId, callback);
  }, options);
}

/**
 * Check if an advisory lock is currently held.
 *
 * @param {string} merchantId - The merchant ID
 * @param {string} resourceType - Type of resource
 * @returns {Promise<boolean>} - True if lock is held, false otherwise
 */
export async function isAdvisoryLockHeld(merchantId, resourceType) {
  const lockKey = generateLockKey(merchantId, resourceType);

  try {
    const { rows } = await pool.query(
      "SELECT pg_advisory_lock_is_held($1::bigint) as held",
      [lockKey],
    );

    return rows[0].held;
  } catch (err) {
    logger.error(
      { err: err.message, merchantId, resourceType },
      "Failed to check advisory lock status",
    );
    return false;
  }
}

/**
 * Generate a consistent lock key from merchant ID and resource type.
 *
 * Uses hash function to convert string identifiers to numeric lock keys
 * for PostgreSQL advisory locks.
 *
 * @param {string} merchantId - The merchant ID
 * @param {string} resourceType - Type of resource
 * @returns {number} - Numeric lock key
 */
function generateLockKey(merchantId, resourceType) {
  const combined = `${merchantId}:${resourceType}`;
  let hash = 0;

  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }

  return Math.abs(hash);
}

/**
 * Get current advisory lock statistics for monitoring.
 *
 * @returns {Promise<Object>} - Lock statistics
 */
export async function getLockStats() {
  try {
    const { rows } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE locktype = 'advisory') as advisory_locks,
        COUNT(*) FILTER (WHERE locktype = 'relation') as relation_locks,
        COUNT(*) FILTER (WHERE locktype = 'transactionid') as transaction_locks
      FROM pg_locks
      WHERE pid = pg_backend_pid()
    `);

    return {
      advisoryLocks: Number.parseInt(rows[0].advisory_locks || "0", 10),
      relationLocks: Number.parseInt(rows[0].relation_locks || "0", 10),
      transactionLocks: Number.parseInt(rows[0].transaction_locks || "0", 10),
    };
  } catch (err) {
    logger.error({ err: err.message }, "Failed to get lock stats");
    return {
      advisoryLocks: 0,
      relationLocks: 0,
      transactionLocks: 0,
    };
  }
}
