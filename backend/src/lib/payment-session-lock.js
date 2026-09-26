/**
 * payment-session-lock.js
 *
 * Distributed concurrency control for the Payment Session Validator
 * (issue #1450).
 *
 * Problem
 * -------
 * The idempotency middleware checks Redis for a cached response and only
 * writes the cache AFTER the handler responds. Two concurrent requests that
 * carry the same Idempotency-Key (client retry storms, double-clicks, load
 * balancer replays) can therefore both miss the cache, both pass validation
 * and both create a payment session — on the same or on different instances.
 *
 * Solution
 * --------
 * A short-lived mutual-exclusion lock per (merchant, Idempotency-Key):
 *
 *   - Redis:  SET <key> <token> NX PX <ttl>  — atomic acquire across instances
 *   - Release: compare-and-delete Lua script — a request can only release the
 *     lock it owns, never one that expired and was re-acquired by another.
 *   - Fallback: when Redis is unavailable, an in-process lock keeps a single
 *     instance correct instead of silently failing open.
 *
 * A request that loses the race gets HTTP 409 (never a second session); the
 * client simply retries and then receives the cached idempotent response.
 *
 * Keys are namespaced per merchant and the client-supplied Idempotency-Key is
 * SHA-256 hashed, so it cannot inject Redis key separators, collide across
 * merchants, or create unbounded key sizes.
 */

import { createHash, randomUUID } from "node:crypto";
import { connectRedisClient } from "./redis.js";
import { logger } from "./logger.js";

export const DEFAULT_LOCK_TTL_MS = 30_000;
const MIN_LOCK_TTL_MS = 1_000;
const MAX_LOCK_TTL_MS = 120_000;
const LOCK_KEY_PREFIX = "lock:payment-session";

/** Error code for a request rejected because its twin holds the lock. */
export const PAYMENT_SESSION_IN_PROGRESS = "PAYMENT_SESSION_IN_PROGRESS";

/**
 * Compare-and-delete: only the owner (matching token) may release the lock.
 */
export const RELEASE_LOCK_SCRIPT =
  'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';

/** In-process fallback: key -> { token, expiresAt } */
const localLocks = new Map();

export function resolveLockTtlMs(value, env = process.env) {
  const raw = Number(value ?? env.PAYMENT_SESSION_LOCK_TTL_MS);
  if (!Number.isFinite(raw)) return DEFAULT_LOCK_TTL_MS;
  return Math.min(Math.max(Math.trunc(raw), MIN_LOCK_TTL_MS), MAX_LOCK_TTL_MS);
}

/**
 * Build a collision-free, injection-safe lock key.
 *
 * @param {string} merchantId
 * @param {string} idempotencyKey
 */
export function buildSessionLockKey(merchantId, idempotencyKey) {
  if (!merchantId || typeof merchantId !== "string") {
    throw new TypeError("merchantId is required to build a session lock key");
  }
  if (!idempotencyKey || typeof idempotencyKey !== "string") {
    throw new TypeError("idempotencyKey is required to build a session lock key");
  }
  const digest = createHash("sha256").update(idempotencyKey).digest("hex");
  return `${LOCK_KEY_PREFIX}:${merchantId}:${digest}`;
}

function acquireLocalLock(key, token, ttlMs, now = Date.now()) {
  const existing = localLocks.get(key);
  if (existing && existing.expiresAt > now) {
    return false;
  }
  localLocks.set(key, { token, expiresAt: now + ttlMs });
  return true;
}

function releaseLocalLock(key, token) {
  const existing = localLocks.get(key);
  if (existing && existing.token === token) {
    localLocks.delete(key);
    return true;
  }
  return false;
}

async function resolveRedis(getRedis) {
  try {
    const client = await getRedis();
    // connectRedisClient() returns a no-op client (isOpen:false) when Redis is
    // unreachable. Its SET would report success for everyone, so treat it as
    // "no distributed backend" and use the local lock instead.
    if (!client || client.isOpen === false || typeof client.sendCommand !== "function") {
      return null;
    }
    return client;
  } catch (err) {
    logger.warn({ err: err?.message }, "Payment session lock: Redis unavailable, using local lock");
    return null;
  }
}

/**
 * Try to acquire the session lock without waiting.
 *
 * @param {string} key  From buildSessionLockKey()
 * @param {object} [options]
 * @param {number} [options.ttlMs]
 * @param {() => Promise<object>} [options.getRedis]  Injected for tests
 * @returns {Promise<null | { key:string, token:string, backend:"redis"|"local", ttlMs:number, release:() => Promise<boolean> }>}
 *   `null` when another request currently holds the lock.
 */
export async function acquireSessionLock(key, { ttlMs, getRedis = connectRedisClient } = {}) {
  const ttl = resolveLockTtlMs(ttlMs);
  const token = randomUUID();
  const client = await resolveRedis(getRedis);

  if (client) {
    try {
      const reply = await client.sendCommand(["SET", key, token, "NX", "PX", String(ttl)]);
      if (reply !== "OK") {
        return null;
      }
      return {
        key,
        token,
        backend: "redis",
        ttlMs: ttl,
        release: async () => {
          try {
            const released = await client.sendCommand(["EVAL", RELEASE_LOCK_SCRIPT, "1", key, token]);
            if (Number(released) !== 1) {
              logger.warn(
                { key, ttlMs: ttl },
                "Payment session lock expired before release; operation outlived lock TTL",
              );
              return false;
            }
            return true;
          } catch (err) {
            // The lock will still expire via PX, so a failed release is not fatal.
            logger.error({ err: err?.message, key }, "Payment session lock release failed");
            return false;
          }
        },
      };
    } catch (err) {
      logger.warn(
        { err: err?.message, key },
        "Payment session lock: Redis SET NX failed, falling back to local lock",
      );
    }
  }

  if (!acquireLocalLock(key, token, ttl)) {
    return null;
  }
  return {
    key,
    token,
    backend: "local",
    ttlMs: ttl,
    release: async () => releaseLocalLock(key, token),
  };
}

/**
 * Build the error returned when a concurrent request holds the lock.
 */
export function createLockConflictError() {
  const error = new Error(
    "A request with this Idempotency-Key is already being processed. Retry shortly.",
  );
  error.status = 409;
  error.code = PAYMENT_SESSION_IN_PROGRESS;
  error.retryable = false;
  return error;
}

/**
 * Run `fn` while holding the (merchant, Idempotency-Key) session lock.
 *
 * Requests without an Idempotency-Key are NOT serialized: two independent
 * sessions with identical bodies are legitimate, and there is nothing to
 * de-duplicate against.
 *
 * @template T
 * @param {{ merchantId:string, idempotencyKey?:string|null }} scope
 * @param {(lock: object|null) => Promise<T>} fn
 * @param {object} [options]  Forwarded to acquireSessionLock
 * @returns {Promise<T>}
 * @throws 409 error (code PAYMENT_SESSION_IN_PROGRESS) when the lock is held
 */
export async function withPaymentSessionLock(scope, fn, options = {}) {
  const { merchantId, idempotencyKey } = scope ?? {};
  if (!idempotencyKey || !merchantId) {
    return fn(null);
  }

  const key = buildSessionLockKey(merchantId, idempotencyKey);
  const lock = await acquireSessionLock(key, options);
  if (!lock) {
    logger.warn({ merchantId }, "Concurrent payment session request rejected: lock held");
    throw createLockConflictError();
  }

  const startedAt = Date.now();
  try {
    return await fn(lock);
  } finally {
    const heldMs = Date.now() - startedAt;
    await lock.release();
    logger.debug?.({ merchantId, backend: lock.backend, heldMs }, "Payment session lock released");
  }
}

/** Test helper: clear the in-process fallback lock table. */
export function resetLocalSessionLocksForTests() {
  localLocks.clear();
}
