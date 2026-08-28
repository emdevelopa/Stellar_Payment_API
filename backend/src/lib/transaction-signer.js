/**
 * Transaction Signer — Issues #912 (rate limiting), #913 (crypto signature
 * verification), #1075 (verification caching), #1077 (refactoring)
 *
 * Provides a hardened wrapper around the core `verifyTransactionSignature`
 * function from stellar.js with:
 *
 * - Replay attack prevention via a two-tier cache:
 *     • In-process LRU for sub-millisecond local checks.
 *     • Redis-backed distributed store (VULN-06 fix) so replay protection
 *       holds across multiple Node.js pods behind a load balancer.
 * - Verification result caching (in-memory LRU + optional Redis) to reduce
 *   redundant Horizon API calls.
 * - XDR / txHash format validation before touching the network.
 * - Rate-limit middleware factory wired to `transaction-signer-rate-limit.js`.
 * - Structured audit logging and Prometheus metrics on every outcome.
 * - Express middleware factory and route handler for `POST /api/verify-signature`.
 */

import {
  createTransactionSignerRateLimit,
  createTransactionSignerBurstRateLimit,
  createTransactionSignerRedisStore,
} from "./transaction-signer-rate-limit.js";
import {
  getTransactionSignerCache,
  stopCachePruneTimer,
  startCachePruneTimer,
} from "./transaction-signer-cache.js";
import { verifyTransactionSignature } from "./stellar.js";
import { logger } from "./logger.js";
import {
  txSignatureVerificationTotal,
  txSignatureVerificationLatency,
  txSignatureVerificationErrors,
  txSignatureReplayAttempts,
  txSignatureCacheSize,
  txSignatureValidationFailures,
} from "./metrics.js";

// ── Configuration ─────────────────────────────────────────────────────────────

const CONFIG = Object.freeze({
  /** Regex for a valid Stellar transaction hash (64 hex chars). */
  TX_HASH_REGEX: /^[a-f0-9]{64}$/i,

  /** How long a verified txHash is retained in the replay cache (ms). */
  REPLAY_CACHE_TTL_MS: 5 * 60 * 1000,

  /** Maximum number of entries in the in-process replay cache. */
  REPLAY_CACHE_MAX_SIZE: 10_000,

  /** Redis key prefix for distributed replay cache entries. */
  REPLAY_REDIS_PREFIX: "ts_replay:",

  /**
   * How often (ms) the background interval prunes expired entries from the
   * in-process ReplayCache.  Without this, entries only expire when prune()
   * is called inline at request time — under low traffic the Map can hold
   * up to REPLAY_CACHE_MAX_SIZE entries for the full TTL window (ML-01).
   */
  REPLAY_PRUNE_INTERVAL_MS: 60 * 1000,
});

// ── In-Process Replay Cache ───────────────────────────────────────────────────

/**
 * In-process LRU cache of recently verified txHash values.
 *
 * Acts as the fast local tier of the two-tier replay prevention system.
 * Redis is the authoritative cross-instance tier (see DistributedReplayCache).
 *
 * Designed as a standalone class for encapsulation, testability, and
 * adherence to the single-responsibility principle.
 */
class ReplayCache {
  /**
   * @param {Object} [options]
   * @param {number} [options.maxSize] - Maximum cache entries.
   * @param {number} [options.ttlMs] - Entry time-to-live in milliseconds.
   * @param {Function} [options.nowFn] - Clock function (injectable for tests).
   */
  constructor({
    maxSize = CONFIG.REPLAY_CACHE_MAX_SIZE,
    ttlMs = CONFIG.REPLAY_CACHE_TTL_MS,
    nowFn = () => Date.now(),
  } = {}) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
    this.nowFn = nowFn;
    /** @type {Map<string, { verifiedAt: number }>} */
    this._cache = new Map();
  }

  /**
   * Prune expired entries from the cache.
   * @returns {number} Number of entries removed.
   */
  prune() {
    const now = this.nowFn();
    let pruned = 0;
    for (const [hash, entry] of this._cache) {
      if (now - entry.verifiedAt > this.ttlMs) {
        this._cache.delete(hash);
        pruned += 1;
      }
    }
    return pruned;
  }

  /**
   * Check if a txHash is present in the local cache.
   * @param {string} txHash
   * @returns {boolean}
   */
  has(txHash) {
    return this._cache.has(txHash);
  }

  /**
   * Record a txHash as verified. Evicts the oldest entry when at capacity.
   * @param {string} txHash
   */
  record(txHash) {
    if (this._cache.size >= this.maxSize) {
      // NPE-09: Map.keys().next().value is undefined when the Map is empty
      // (e.g. maxSize=0) or when a concurrent clear races this call.  Guard so
      // we never call _cache.delete(undefined), which would silently no-op but
      // could mask an underlying misconfiguration and leave the cache unbounded.
      const oldest = this._cache.keys().next().value;
      if (oldest !== undefined) {
        this._cache.delete(oldest);
      }
    }
    this._cache.set(txHash, { verifiedAt: this.nowFn() });
    txSignatureCacheSize.set(this._cache.size);
  }

  /** Clear all entries and reset the cache-size metric. */
  clear() {
    this._cache.clear();
    txSignatureCacheSize.set(0);
  }

  /** @returns {number} Current number of entries. */
  get size() {
    return this._cache.size;
  }
}

// ── Distributed Replay Cache (Redis) ─────────────────────────────────────────

/**
 * Redis-backed distributed replay cache.
 *
 * VULN-06 fix: the in-process ReplayCache is process-local, so in a
 * horizontally scaled deployment (multiple pods behind a load balancer) a
 * replay attack routed to a different pod would succeed because that pod has
 * no knowledge of what the first pod already verified.
 *
 * This class writes a short-TTL key to Redis on every successful verification
 * so all pods share a single authoritative replay record. The local
 * ReplayCache remains as a fast in-process pre-check to avoid a Redis round-
 * trip for the common case where the same pod sees the replay.
 *
 * Falls back gracefully to local-only protection when Redis is unavailable so
 * a Redis outage does not break signature verification entirely.
 */
export class DistributedReplayCache {
  /**
   * @param {Object} [options]
   * @param {import('ioredis').Redis|null} [options.redisClient] - Redis client.
   * @param {number} [options.ttlMs] - Entry TTL in milliseconds.
   * @param {string} [options.prefix] - Redis key prefix.
   */
  constructor({
    redisClient = null,
    ttlMs = CONFIG.REPLAY_CACHE_TTL_MS,
    prefix = CONFIG.REPLAY_REDIS_PREFIX,
  } = {}) {
    this.redisClient = redisClient;
    this.ttlSeconds = Math.ceil(ttlMs / 1000);
    this.prefix = prefix;
  }

  /** @param {string} txHash @returns {string} */
  _key(txHash) {
    return `${this.prefix}${txHash}`;
  }

  /**
   * Check whether txHash has been recorded in Redis.
   * Returns false (allowing the request) on any Redis error so an outage
   * degrades gracefully to local-only protection rather than blocking all
   * verification requests.
   *
   * @param {string} txHash
   * @returns {Promise<boolean>}
   */
  async has(txHash) {
    if (!this.redisClient) return false;
    try {
      const exists = await this.redisClient.exists(this._key(txHash));
      return exists === 1;
    } catch (err) {
      logger.warn(
        { err, txHash },
        "DistributedReplayCache: Redis EXISTS failed — falling back to local cache only",
      );
      return false;
    }
  }

  /**
   * Record a txHash in Redis with the configured TTL.
   * Failures are logged but do not throw — the local cache still protects
   * the current pod.
   *
   * @param {string} txHash
   */
  async record(txHash) {
    if (!this.redisClient) return;
    try {
      // NX — only set if not already present; EX — auto-expire after TTL.
      await this.redisClient.set(this._key(txHash), "1", "EX", this.ttlSeconds, "NX");
    } catch (err) {
      logger.warn(
        { err, txHash },
        "DistributedReplayCache: Redis SET failed — replay entry not persisted to Redis",
      );
    }
  }

  /**
   * Remove a replay entry from Redis (test / admin use).
   * @param {string} txHash
   */
  async delete(txHash) {
    if (!this.redisClient) return;
    try {
      await this.redisClient.del(this._key(txHash));
    } catch (err) {
      logger.warn({ err, txHash }, "DistributedReplayCache: Redis DEL failed");
    }
  }
}

// ── Module-level instances ────────────────────────────────────────────────────

const replayCache = new ReplayCache();

/**
 * Module-level distributed replay cache. Starts without Redis; call
 * `initDistributedReplayCache(redisClient)` from app startup to enable
 * cross-instance replay protection.
 */
let distributedReplayCache = new DistributedReplayCache();

// ── Distributed Replay Cache Initialisation ───────────────────────────────────

/**
 * Wire a Redis client into the module-level distributed replay cache.
 *
 * Call this once at app startup (after the Redis client is confirmed open) to
 * enable cross-instance replay protection. Safe to call multiple times —
 * subsequent calls replace the client.
 *
 * @param {import('ioredis').Redis} redisClient
 */
export function initDistributedReplayCache(redisClient) {
  distributedReplayCache = new DistributedReplayCache({ redisClient });
  logger.info("TransactionSigner: distributed replay cache initialised with Redis");
}

// ── Input Validation ──────────────────────────────────────────────────────────

/**
 * Validate a transaction hash string before sending it to Horizon.
 *
 * @param {unknown} txHash
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateTxHash(txHash) {
  if (typeof txHash !== "string" || txHash.trim() === "") {
    txSignatureValidationFailures.inc({ reason: "empty_or_non_string" });
    return { valid: false, reason: "txHash must be a non-empty string" };
  }
  if (!CONFIG.TX_HASH_REGEX.test(txHash)) {
    txSignatureValidationFailures.inc({ reason: "invalid_format" });
    return { valid: false, reason: "txHash must be 64 lowercase hex characters" };
  }
  return { valid: true };
}

// ── Metrics Helpers ───────────────────────────────────────────────────────────

/**
 * Record metrics and log for a successful verification.
 * Writes to both the local and distributed replay caches.
 * @param {string} txHash
 * @param {object} result
 */
function recordVerificationSuccess(txHash, result) {
  // Local cache — synchronous, sub-millisecond.
  replayCache.record(txHash);
  // Distributed cache — async, does not block the response (VULN-06).
  distributedReplayCache.record(txHash).catch(() => {
    // Error already logged inside DistributedReplayCache.record.
  });
  txSignatureVerificationTotal.inc({ outcome: "valid" });
  logger.info(
    {
      txHash,
      isMultiSig: result.isMultiSig,
      signatureCount: result.signatureCount,
    },
    "TransactionSigner: signature verified successfully",
  );
}

/**
 * Record metrics and log for a failed verification.
 * @param {string} txHash
 * @param {object} result
 */
function recordVerificationFailure(txHash, result) {
  txSignatureVerificationTotal.inc({ outcome: "invalid" });
  txSignatureVerificationErrors.inc({ error_type: "invalid_signature" });
  logger.warn(
    { txHash, reason: result?.reason ?? "unknown" },
    "TransactionSigner: signature verification failed",
  );
}

/**
 * Record metrics and log for a verification exception.
 * @param {string} txHash
 * @param {Error} err
 * @returns {{ valid: false, reason: string }}
 */
function recordVerificationException(txHash, err) {
  txSignatureVerificationErrors.inc({ error_type: "verification_exception" });
  logger.warn(
    { err, txHash },
    "TransactionSigner: unexpected error during signature verification",
  );
  // Return a generic message — raw exception text can expose internal details
  // to callers (VULN-04).
  return { valid: false, reason: "Internal verification error" };
}

// ── Core Verification ─────────────────────────────────────────────────────────

/**
 * Verify a Stellar transaction's cryptographic signature with replay protection
 * and result caching.
 *
 * Pipeline:
 *   1. Format validation (reject malformed txHash before network call)
 *   2. Replay detection (in-process cache with TTL)
 *   3. Verification cache lookup (in-memory LRU + optional Redis)
 *   4. Core cryptographic verification via Horizon
 *   5. Cache the result for future lookups
 *   6. Record metrics and structured logs
 *
 * @param {string} txHash - 64-char hex transaction hash
 * @param {object} [options] - Forwarded to the underlying verifyTransactionSignature
 * @returns {Promise<{ valid: boolean, reason?: string, replay?: boolean, [key: string]: unknown }>}
 */
export async function verifyTransactionSignatureSecure(txHash, options = {}) {
  const timerEnd = txSignatureVerificationLatency.startTimer({ label: "transaction_signer" });

  try {
    // ── Step 1: Format validation ──────────────────────────────────────────────
    const formatCheck = validateTxHash(txHash);
    if (!formatCheck.valid) {
      txSignatureVerificationErrors.inc({ error_type: "validation_failure" });
      logger.warn(
        { txHash: String(txHash).slice(0, 10), reason: formatCheck.reason },
        "TransactionSigner: invalid txHash format rejected",
      );
      return { valid: false, reason: formatCheck.reason };
    }

    const normalizedHash = txHash.toLowerCase();

    // ── Step 2: Replay detection ───────────────────────────────────────────────
    // Check local cache first (O(1), no I/O), then Redis (VULN-06 fix: cross-
    // instance replay protection in horizontally scaled deployments).
    replayCache.prune();
    const localReplay = replayCache.has(normalizedHash);
    const distributedReplay = localReplay ? false : await distributedReplayCache.has(normalizedHash);

    if (localReplay || distributedReplay) {
      txSignatureReplayAttempts.inc();
      txSignatureVerificationErrors.inc({ error_type: "replay_attempt" });
      logger.warn(
        { txHash: normalizedHash, source: localReplay ? "local" : "distributed" },
        "TransactionSigner: replay attempt detected — txHash already verified",
      );
      return { valid: false, reason: "replay: txHash was already verified", replay: true };
    }

    // ── Step 3: Verification cache lookup ──────────────────────────────────────
    const cache = getTransactionSignerCache();
    const cached = await cache.get(normalizedHash);
    if (cached.hit) {
      // NPE-10: cached.result can theoretically be null if the cache entry was
      // evicted or corrupted between the hit flag being set and the result being
      // read (e.g. NPE-08 guard rejecting a malformed Redis payload).  Fall
      // through to a fresh verification rather than returning null to callers.
      if (cached.result == null) {
        logger.warn(
          { txHash: normalizedHash },
          "TransactionSigner: cache hit but result is null — falling through to fresh verification",
        );
      } else {
        txSignatureVerificationTotal.inc({ outcome: cached.result?.valid ? "valid" : "invalid" });
        logger.debug(
          { txHash: normalizedHash, cached: true },
          "TransactionSigner: returning cached verification result",
        );
        return cached.result;
      }
    }

    // ── Step 4: Core cryptographic verification ────────────────────────────────
    let result;
    try {
      result = await verifyTransactionSignature(normalizedHash, options);
    } catch (err) {
      return recordVerificationException(normalizedHash, err);
    }

    const finalResult = result ?? { valid: false, reason: "verifier returned no result" };

    // ── Step 5: Cache the result ───────────────────────────────────────────────
    await cache.set(normalizedHash, finalResult, !!finalResult.valid);

    // ── Step 6: Metrics and logging ────────────────────────────────────────────
    if (finalResult.valid) {
      recordVerificationSuccess(normalizedHash, finalResult);
    } else {
      recordVerificationFailure(normalizedHash, finalResult);
    }

    return finalResult;
  } finally {
    timerEnd();
  }
}

// ── Replay Cache Exports (Testing) ───────────────────────────────────────────

/**
 * Clear the local and distributed replay caches.
 * Exposed for tests only — do not call in production code paths.
 */
export async function clearReplayCache() {
  replayCache.clear();
  // No bulk-clear API on the distributed cache — individual deletes are only
  // needed in tests where specific hashes are known.
}

// ── Replay Cache Prune Timer ──────────────────────────────────────────────────

/** Handle for the background replay-cache prune interval. */
let _replayPruneTimer = null;

/**
 * Start a periodic background interval that evicts expired entries from the
 * in-process ReplayCache.
 *
 * Memory leak fix (ML-01): `replayCache.prune()` is also called inline on
 * every request, but under low or zero traffic expired entries accumulate in
 * the Map until the next request arrives.  This timer ensures the Map is
 * swept on a regular schedule regardless of request rate.
 *
 * The timer is `unref()`-ed so it does not prevent the Node.js event loop
 * from exiting after the HTTP server closes (ML-03).
 *
 * @param {number} [intervalMs] - Sweep frequency in milliseconds.
 * @returns {NodeJS.Timeout} The interval handle.
 */
export function startReplayCachePruneTimer(intervalMs = CONFIG.REPLAY_PRUNE_INTERVAL_MS) {
  if (_replayPruneTimer) {
    clearInterval(_replayPruneTimer);
  }

  _replayPruneTimer = setInterval(() => {
    const pruned = replayCache.prune();
    if (pruned > 0) {
      logger.debug(
        { pruned, size: replayCache.size },
        "TransactionSigner: background prune removed expired replay-cache entries",
      );
    }
  }, intervalMs);

  if (typeof _replayPruneTimer.unref === "function") {
    _replayPruneTimer.unref();
  }

  logger.debug(
    { intervalMs },
    "TransactionSigner: replay cache prune timer started",
  );

  return _replayPruneTimer;
}

/**
 * Stop the replay cache prune interval and release the timer handle.
 */
export function stopReplayCachePruneTimer() {
  if (_replayPruneTimer) {
    clearInterval(_replayPruneTimer);
    _replayPruneTimer = null;
    logger.debug("TransactionSigner: replay cache prune timer stopped");
  }
}

// ── Unified Shutdown Hook ─────────────────────────────────────────────────────

/**
 * Stop all Transaction Signer background timers and release all in-memory
 * state so objects become eligible for garbage collection.
 *
 * Memory leak fix (ML-03/ML-04/ML-05): call this from the server's graceful
 * shutdown handler (SIGTERM/SIGINT) alongside closing the HTTP server, Redis
 * client, and DB pool.
 *
 * Actions performed:
 *  1. Stop the replay-cache prune interval.
 *  2. Stop the verification-cache prune interval.
 *  3. Clear the in-process replay cache Map.
 *  4. Destroy the singleton TransactionSignerCache (clears its Map and
 *     releases the singleton reference so GC can reclaim it).
 */
export async function stopTransactionSignerTimers() {
  stopReplayCachePruneTimer();
  stopCachePruneTimer();
  replayCache.clear();
  const cache = getTransactionSignerCache();
  await cache.destroy();
  logger.info("TransactionSigner: all timers stopped and memory released");
}

/**
 * Start all Transaction Signer background prune timers.
 *
 * Call this once at server startup after Redis is connected.
 * Safe to call multiple times — subsequent calls reset the intervals.
 *
 * @param {object} [options]
 * @param {number} [options.replayPruneIntervalMs]
 * @param {number} [options.cachePruneIntervalMs]
 */
export function startTransactionSignerTimers({
  replayPruneIntervalMs = CONFIG.REPLAY_PRUNE_INTERVAL_MS,
  cachePruneIntervalMs,
} = {}) {
  startReplayCachePruneTimer(replayPruneIntervalMs);
  startCachePruneTimer(cachePruneIntervalMs);
  logger.info(
    { replayPruneIntervalMs, cachePruneIntervalMs },
    "TransactionSigner: background prune timers started",
  );
}

// ── Express Integration ───────────────────────────────────────────────────────

/**
 * Build an array of Express middlewares for the transaction signer endpoint:
 * burst limiter first, then standard limiter.
 *
 * Also initialises the distributed replay cache when a Redis client is
 * provided so replay protection spans all pods (VULN-06).
 *
 * @param {object} [options]
 * @param {import('ioredis').Redis} [options.redisClient] - Redis client for distributed limiting and replay cache
 * @returns {import('express').RequestHandler[]}
 */
export function createTransactionSignerMiddlewares({ redisClient } = {}) {
  let store;
  if (redisClient) {
    try {
      store = createTransactionSignerRedisStore({ client: redisClient });
    } catch (err) {
      logger.warn(
        { err },
        "TransactionSigner: failed to create Redis store, using memory store",
      );
    }
    // Initialise distributed replay cache for cross-instance protection.
    initDistributedReplayCache(redisClient);
  }

  return [
    createTransactionSignerBurstRateLimit({ store }),
    createTransactionSignerRateLimit({ store }),
  ];
}

/**
 * Express route handler for `POST /api/verify-signature`.
 *
 * Expects a JSON body with `{ txHash: string }`.
 * Query-parameter acceptance has been intentionally removed: accepting txHash
 * via GET query string would log it in every reverse-proxy / CDN access log
 * and would fall through the per-txHash rate-limit bucket to "unknown-tx",
 * bypassing sustained-rate protection (VULN-05).
 *
 * Returns `{ valid: boolean, reason?: string, ... }` with appropriate status.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function handleVerifySignature(req, res) {
  const txHash = req.body?.txHash;

  const formatCheck = validateTxHash(txHash);
  if (!formatCheck.valid) {
    return res.status(400).json({ error: formatCheck.reason });
  }

  try {
    const result = await verifyTransactionSignatureSecure(txHash);
    return res.status(result.valid ? 200 : 422).json(result);
  } catch (err) {
    logger.warn({ err }, "TransactionSigner route: unhandled error");
    return res.status(500).json({ error: "Internal server error" });
  }
}
