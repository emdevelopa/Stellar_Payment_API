/**
 * merchant-key-lifecycle.js
 *
 * Concurrency control and atomic credential updates for the Merchant
 * Onboarding and Key Lifecycle Route (#1772).
 *
 * Problems this closes
 * --------------------
 * 1. Duplicate registration. `register-merchant` checks "does this email
 *    exist?" and then inserts. Two concurrent requests for one email can both
 *    pass the check. Registration now runs under a per-email lock, and a
 *    database unique violation (23505) is mapped to the same 409.
 *
 * 2. Lost / interleaved rotations. Key and secret rotations were blind
 *    read-modify-writes: the "old" credential written to the grace-period slot
 *    came from the request context loaded BEFORE the update, so two concurrent
 *    rotations could overwrite each other and leave the merchant holding a key
 *    nobody was ever given. Rotations now (a) serialize per merchant under a
 *    distributed lock, and (b) write with a compare-and-swap on the credential
 *    that was read, so a stale writer is rejected (409) instead of clobbering
 *    the winner. The lock is the fast path; the CAS is the correctness
 *    backstop that still holds if the lock expires or Redis is down on one node.
 *
 * Locking reuses the Redis `SET NX PX` + compare-and-delete implementation from
 * payment-session-lock.js (with its in-process fallback when Redis is
 * unreachable). Lock keys use the merchant id, or a SHA-256 of the email, so
 * user input never reaches the key namespace.
 *
 * A request that loses the race receives HTTP 409. It never queues, so there is
 * no head-of-line blocking; the client retries.
 */

import { createHash } from "node:crypto";
import { acquireSessionLock } from "./payment-session-lock.js";
import { logger } from "./logger.js";
import {
  merchantLockTotal,
  merchantLockHeldSeconds,
  merchantCredentialConflictsTotal,
} from "./merchant-lifecycle-metrics.js";

export const MERCHANT_LIFECYCLE_BUSY = "MERCHANT_LIFECYCLE_BUSY";
export const MERCHANT_CREDENTIAL_CONFLICT = "MERCHANT_CREDENTIAL_CONFLICT";

/** Long enough for a rotation (one DB write), short enough to self-heal. */
export const MERCHANT_LOCK_TTL_MS = 15_000;

const LOCK_PREFIX = "lock:merchant";

/**
 * @param {"key"|"register"} scope
 * @param {string} id  Merchant id for "key", email for "register"
 */
export function buildMerchantLockKey(scope, id) {
  if (scope !== "key" && scope !== "register") {
    throw new TypeError(`Unknown merchant lock scope: ${scope}`);
  }
  if (!id || typeof id !== "string") {
    throw new TypeError("A merchant lock requires a non-empty string id");
  }
  const part =
    scope === "register"
      ? createHash("sha256").update(id.trim().toLowerCase()).digest("hex")
      : id;
  return `${LOCK_PREFIX}:${scope}:${part}`;
}

export function createLifecycleBusyError(operation) {
  const error = new Error(
    "Another credential operation for this merchant is in progress. Retry shortly.",
  );
  error.status = 409;
  error.code = MERCHANT_LIFECYCLE_BUSY;
  error.retryable = false;
  error.operation = operation;
  return error;
}

export function createCredentialConflictError(operation) {
  const error = new Error(
    "The credential changed while this request was running. Re-fetch and retry.",
  );
  error.status = 409;
  error.code = MERCHANT_CREDENTIAL_CONFLICT;
  error.retryable = false;
  error.operation = operation;
  return error;
}

/**
 * Run `fn` while holding the merchant lock; reject with 409 when it is held.
 *
 * @template T
 * @param {{ scope: "key"|"register", id: string, operation: string }} lockScope
 * @param {() => Promise<T>} fn
 * @param {{ ttlMs?: number, getRedis?: () => Promise<object> }} [options]
 * @returns {Promise<T>}
 */
export async function withMerchantLock({ scope, id, operation }, fn, options = {}) {
  const key = buildMerchantLockKey(scope, id);
  const lock = await acquireSessionLock(key, {
    ttlMs: options.ttlMs ?? MERCHANT_LOCK_TTL_MS,
    ...(options.getRedis ? { getRedis: options.getRedis } : {}),
  });

  if (!lock) {
    merchantLockTotal.inc({ operation, outcome: "contended" });
    logger.warn({ operation, scope }, "Merchant lifecycle request rejected: lock held");
    throw createLifecycleBusyError(operation);
  }

  merchantLockTotal.inc({ operation, outcome: "acquired" });
  const startedAt = Date.now();
  try {
    return await fn();
  } finally {
    merchantLockHeldSeconds.observe({ operation }, (Date.now() - startedAt) / 1000);
    await lock.release();
  }
}

/**
 * Atomically replace a merchant credential: the update only applies if
 * `expected.column` still equals `expected.value`.
 *
 * `supabase` is injected so callers (and tests) control the client. A missing
 * stored credential (`null`) is matched with IS NULL.
 *
 * @throws 409 (MERCHANT_CREDENTIAL_CONFLICT) when the stored value changed or
 *         the merchant no longer exists; the original database error (status 500)
 *         for any other failure.
 */
export async function compareAndSwapMerchant(
  supabase,
  merchantId,
  expected,
  patch,
  operation = "credential_update",
) {
  let query = supabase.from("merchants").update(patch).eq("id", merchantId);
  query =
    expected.value === null || expected.value === undefined
      ? query.is(expected.column, null)
      : query.eq(expected.column, expected.value);

  const { data, error } = await query.select("id");

  if (error) {
    error.status = 500;
    throw error;
  }
  if (!Array.isArray(data) || data.length === 0) {
    merchantCredentialConflictsTotal.inc({ operation });
    throw createCredentialConflictError(operation);
  }
  return data[0];
}
