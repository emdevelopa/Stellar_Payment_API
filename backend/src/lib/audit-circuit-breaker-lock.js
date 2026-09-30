/**
 * Distributed Audit Circuit Breaker Lock (Issue #1435)
 *
 * Wraps `AuditCircuitBreaker` with Redis-backed distributed locking so that
 * multiple instances of the service agree on circuit state and avoid
 * concurrent state-transitions stomping on each other.
 *
 * Features:
 * - Redis SET NX PX lock acquisition with a per-operation owner token
 * - Lua-script guarded release (only the owner can release its own lock)
 * - executeWithLock(): acquire → execute → release (always in a finally block)
 * - syncState(): pull circuit state from Redis and reconcile local instance
 * - publishState(): push local state to Redis so peers can sync
 * - Graceful degradation: if Redis is unavailable the instance falls back to
 *   local-only behavior and logs a warning rather than throwing.
 * - Prometheus metric: audit_circuit_breaker_lock_acquisitions_total
 */

import client from "prom-client";
import { CircuitState } from "./audit-circuit-breaker.js";

// ── Prometheus metric (self-contained registry) ──────────────────────────────

const _lockRegistry = new client.Registry();

const cbLockAcquisitionsTotal = new client.Counter({
  name: "audit_circuit_breaker_lock_acquisitions_total",
  help: "Total number of distributed lock acquisition attempts for the audit circuit breaker",
  labelNames: ["label", "result"], // result: acquired | failed | fallback
  registers: [_lockRegistry],
});

// ── Lua script: only release if the caller owns the lock ──────────────────────
// Returns 1 on success, 0 if the key no longer exists or belongs to someone else.
const RELEASE_LOCK_SCRIPT = `
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
  else
    return 0
  end
`;

// ── DistributedAuditCircuitBreakerLock ───────────────────────────────────────

export class DistributedAuditCircuitBreakerLock {
  /**
   * @param {object}                opts
   * @param {import("./audit-circuit-breaker.js").AuditCircuitBreaker} opts.circuitBreaker
   * @param {object|null}           opts.redisClient      - ioredis / node-redis v4 client
   * @param {number}                [opts.lockTtlMs=5000]  - Lock TTL in milliseconds
   * @param {string}                [opts.lockKey="audit:circuit-breaker:lock"]
   */
  constructor({
    circuitBreaker,
    redisClient,
    lockTtlMs = 5000,
    lockKey = "audit:circuit-breaker:lock",
  }) {
    if (!circuitBreaker) {
      throw new TypeError("DistributedAuditCircuitBreakerLock requires a circuitBreaker");
    }

    this.circuitBreaker = circuitBreaker;
    this.redisClient = redisClient ?? null;
    this.lockTtlMs = lockTtlMs;
    this.lockKey = lockKey;

    // Derived key used for state sync/publish.
    this._stateKey = `audit:circuit-breaker:state:${circuitBreaker.label}`;
  }

  // ── Lock primitives ───────────────────────────────────────────────────────

  /**
   * Attempt to acquire the distributed lock.
   *
   * Uses Redis SET NX PX — atomically set the key only if it does not exist
   * and attach a TTL so the lock is auto-released if the process crashes.
   *
   * @param {string} operationId - Unique owner token (e.g. a UUID)
   * @returns {Promise<boolean>}  true if the lock was acquired
   */
  async acquireLock(operationId) {
    if (!this._redisAvailable()) {
      cbLockAcquisitionsTotal.inc({
        label: this.circuitBreaker.label,
        result: "fallback",
      });
      return true; // Fallback: optimistically proceed without a distributed lock
    }

    try {
      const result = await this.redisClient.set(
        this.lockKey,
        operationId,
        "NX",
        "PX",
        this.lockTtlMs,
      );

      // node-redis v4 returns "OK" or null; ioredis returns "OK" or null too.
      const acquired = result === "OK" || result === 1;

      cbLockAcquisitionsTotal.inc({
        label: this.circuitBreaker.label,
        result: acquired ? "acquired" : "failed",
      });

      return acquired;
    } catch (err) {
      this._logRedisWarning("acquireLock", err);
      cbLockAcquisitionsTotal.inc({
        label: this.circuitBreaker.label,
        result: "fallback",
      });
      return true; // Fallback: proceed without lock
    }
  }

  /**
   * Release the distributed lock only if this caller still owns it.
   * Uses a Lua script for an atomic check-and-delete.
   *
   * @param {string} operationId - Owner token passed to acquireLock()
   * @returns {Promise<boolean>}  true if the lock was released by this caller
   */
  async releaseLock(operationId) {
    if (!this._redisAvailable()) {
      return true; // Fallback: nothing to release
    }

    try {
      const released = await this._evalLua(
        RELEASE_LOCK_SCRIPT,
        [this.lockKey],
        [operationId],
      );
      return released === 1;
    } catch (err) {
      this._logRedisWarning("releaseLock", err);
      return false;
    }
  }

  // ── Wrapped execution ─────────────────────────────────────────────────────

  /**
   * Acquire the distributed lock, run fn through the circuit breaker,
   * then release the lock in a finally block.
   *
   * If the lock cannot be acquired (another instance holds it), this method
   * throws an Error with `code: "LOCK_NOT_ACQUIRED"` so the caller can decide
   * whether to retry or drop the call.
   *
   * @param {Function} fn          - Async function to execute
   * @param {string}   operationId - Unique owner token for this call
   * @returns {Promise<*>}
   */
  async executeWithLock(fn, operationId) {
    const acquired = await this.acquireLock(operationId);

    if (!acquired) {
      const err = new Error(
        `[${this.circuitBreaker.label}] Could not acquire distributed lock for operation '${operationId}'`,
      );
      err.code = "LOCK_NOT_ACQUIRED";
      throw err;
    }

    try {
      return await this.circuitBreaker.execute(fn);
    } finally {
      await this.releaseLock(operationId);
    }
  }

  // ── State sync / publish ──────────────────────────────────────────────────

  /**
   * Publish the current local circuit-breaker state to Redis so that other
   * instances can discover it via syncState().
   *
   * Key: `audit:circuit-breaker:state:{label}`
   * TTL: 120 seconds
   *
   * @returns {Promise<void>}
   */
  async publishState() {
    if (!this._redisAvailable()) return;

    const payload = JSON.stringify({
      state: this.circuitBreaker.state,
      failures: this.circuitBreaker.failures,
      openedAt: this.circuitBreaker.openedAt,
      halfOpenSuccesses: this.circuitBreaker.halfOpenSuccesses,
      publishedAt: Date.now(),
    });

    try {
      await this.redisClient.set(this._stateKey, payload, "PX", 120_000);
    } catch (err) {
      this._logRedisWarning("publishState", err);
    }
  }

  /**
   * Read the circuit state published by another instance from Redis and
   * reconcile the local circuit breaker.
   *
   * Reconciliation rules:
   * - Remote OPEN  → force local to OPEN  (conservative: if any peer is open, be open)
   * - Remote HALF_OPEN → only move local to HALF_OPEN if currently OPEN
   * - Remote CLOSED → no forced change (local failures still count independently)
   *
   * @param {object|null} [redisClient] - Optionally override the client for this call
   * @returns {Promise<object|null>}    - Parsed remote state, or null if unavailable
   */
  async syncState(redisClient) {
    const redis = redisClient ?? this.redisClient;

    if (!redis || !this._isClientConnected(redis)) {
      return null;
    }

    let raw;
    try {
      raw = await redis.get(this._stateKey);
    } catch (err) {
      this._logRedisWarning("syncState", err);
      return null;
    }

    if (!raw) return null;

    let remoteState;
    try {
      remoteState = JSON.parse(raw);
    } catch {
      return null;
    }

    // Reconcile
    const now = Date.now();

    if (remoteState.state === CircuitState.OPEN) {
      if (this.circuitBreaker.state !== CircuitState.OPEN) {
        this.circuitBreaker.state = CircuitState.OPEN;
        this.circuitBreaker.openedAt = remoteState.openedAt ?? now;
        this.circuitBreaker.failures = remoteState.failures ?? this.circuitBreaker.failureThreshold;
        this.circuitBreaker.halfOpenSuccesses = 0;
        console.warn(
          `[${this.circuitBreaker.label}] Circuit state synced from Redis: OPEN`,
        );
      }
    } else if (remoteState.state === CircuitState.HALF_OPEN) {
      if (this.circuitBreaker.state === CircuitState.OPEN) {
        this.circuitBreaker.state = CircuitState.HALF_OPEN;
        this.circuitBreaker.halfOpenSuccesses = remoteState.halfOpenSuccesses ?? 0;
        console.info(
          `[${this.circuitBreaker.label}] Circuit state synced from Redis: HALF_OPEN`,
        );
      }
    }
    // CLOSED: do not override local state — the local instance tracks its own failures.

    return remoteState;
  }

  // ── Static helper ─────────────────────────────────────────────────────────

  /**
   * Returns the prom-client Registry containing the lock metrics.
   *
   * @returns {import("prom-client").Registry}
   */
  static getMetrics() {
    return _lockRegistry;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  _redisAvailable() {
    return this.redisClient !== null && this._isClientConnected(this.redisClient);
  }

  _isClientConnected(redis) {
    // node-redis v4: `isOpen` property
    // ioredis: `status === "ready"`
    if (typeof redis.isOpen === "boolean") return redis.isOpen;
    if (typeof redis.status === "string") return redis.status === "ready";
    // Assume connected if neither property is present (e.g. mock clients).
    return true;
  }

  _logRedisWarning(operation, err) {
    console.warn(
      `[${this.circuitBreaker.label}] Redis unavailable in ${operation}: ${err.message}. Falling back to local behavior.`,
    );
  }

  /**
   * Evaluate a Lua script. Handles both node-redis v4 (`eval`) and ioredis
   * (`eval(script, numkeys, ...keys, ...args)`).
   */
  async _evalLua(script, keys, args) {
    const redis = this.redisClient;

    // node-redis v4: redis.eval(script, { keys, arguments })
    if (typeof redis.eval === "function") {
      try {
        return await redis.eval(script, { keys, arguments: args });
      } catch {
        // ioredis-style fallback
        return await redis.eval(script, keys.length, ...keys, ...args);
      }
    }

    throw new Error("Redis client does not support eval()");
  }
}
