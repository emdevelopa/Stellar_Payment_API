/**
 * Distributed concurrency control for the Exchange Rate Oracle Cache
 * (issue #1445).
 *
 * The in-memory ExchangeRateCache already coalesces concurrent misses within
 * one process. With N API instances behind a load balancer, a popular quote
 * can still trigger N simultaneous Horizon queries. This module coordinates
 * those instances through Redis:
 *
 *   1. Shared quote store  – `exrate:quote:<key>` holds the latest quote for
 *      ttlMs so any instance can reuse a peer's result.
 *   2. Distributed lock    – `exrate:lock:<key>` (SET NX PX + random token)
 *      elects one instance to query Horizon. Release is a compare-and-delete
 *      Lua script, so a holder whose lock already expired can never delete a
 *      lock now owned by someone else.
 *   3. Followers poll the shared store. If the leader fails or crashes (lock
 *      released or expired with no quote written), the next poll can take
 *      the lock itself. After waitTimeoutMs a follower gives up and queries
 *      Horizon directly.
 *
 * Failure policy: FAIL OPEN. Quotes are read-only public DEX data, so any
 * Redis error (or a closed client) falls back to a direct Horizon query
 * rather than failing the request. Coordination is purely an optimization.
 *
 * Data read from Redis is validated before use. A corrupted or foreign entry
 * counts as a miss, never as a quote.
 *
 * All commands go through `sendCommand`, which node-redis v4/v5 and the
 * project's no-op fallback client all support.
 */

import { randomUUID } from 'node:crypto';
import { logger } from './logger.js';
import {
  exchangeRateLockAcquisitions,
  exchangeRateLockWaitDuration,
  exchangeRateSharedCacheLookups,
  exchangeRateCoordinationFallbacks,
} from './path-payment-metrics.js';

const DEFAULT_METRICS = {
  lock: exchangeRateLockAcquisitions,
  wait: exchangeRateLockWaitDuration,
  shared: exchangeRateSharedCacheLookups,
  fallback: exchangeRateCoordinationFallbacks,
};

/** Compare-and-delete: only the token holder may release the lock. */
const RELEASE_LOCK_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

const SHARED_ENTRY_VERSION = 1;

/** Stellar amounts: up to 7 decimal places, no sign or exponent. */
const AMOUNT_PATTERN = /^\d{1,19}(\.\d{1,7})?$/;

function readIntEnv(name, fallback) {
  const raw = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

const sleep = (ms) => new Promise((resolve) => {
  const timer = setTimeout(resolve, ms);
  timer.unref?.();
});

/**
 * Default shape check for a cached exchange-rate quote. Guards against
 * corrupted or tampered Redis content reaching payers as a send_max.
 */
export function isValidQuote(data) {
  return (
    data !== null &&
    typeof data === 'object' &&
    typeof data.sourceAsset === 'string' &&
    typeof data.sourceAmount === 'string' &&
    AMOUNT_PATTERN.test(data.sourceAmount) &&
    typeof data.sendMax === 'string' &&
    AMOUNT_PATTERN.test(data.sendMax) &&
    Array.isArray(data.path)
  );
}

/**
 * Minimal Redis lock with owner tokens and TTL-based expiry.
 */
export class RedisLock {
  constructor(client, { prefix = 'exrate:lock:' } = {}) {
    this.client = client;
    this.prefix = prefix;
  }

  /** @returns {Promise<string|null>} owner token when acquired, else null */
  async acquire(name, ttlMs) {
    const token = randomUUID();
    const reply = await this.client.sendCommand([
      'SET', this.prefix + name, token, 'PX', String(ttlMs), 'NX',
    ]);
    return reply === 'OK' ? token : null;
  }

  /** @returns {Promise<boolean>} whether this token still owned the lock */
  async release(name, token) {
    const reply = await this.client.sendCommand([
      'EVAL', RELEASE_LOCK_SCRIPT, '1', this.prefix + name, token,
    ]);
    return Number(reply) === 1;
  }
}

/**
 * Coordinates quote loads across API instances. See module docs.
 */
export class ExchangeRateCoordinator {
  /**
   * @param {object} opts
   * @param {object} opts.redisClient      node-redis client (must expose sendCommand)
   * @param {number} [opts.sharedTtlMs]    how long a shared quote is reusable
   * @param {number} [opts.lockTtlMs]      lock lease; should exceed a typical Horizon call
   * @param {number} [opts.waitTimeoutMs]  max time a follower waits before querying directly
   * @param {number} [opts.pollIntervalMs] follower poll cadence
   * @param {string} [opts.keyPrefix]
   * @param {(data: unknown) => boolean} [opts.validate] shared-entry validator
   * @param {object|null} [opts.metrics]
   */
  constructor({
    redisClient,
    sharedTtlMs = readIntEnv('EXCHANGE_RATE_CACHE_TTL_MS', 30_000),
    lockTtlMs = readIntEnv('EXCHANGE_RATE_LOCK_TTL_MS', 5_000),
    waitTimeoutMs = readIntEnv('EXCHANGE_RATE_LOCK_WAIT_MS', 2_000),
    pollIntervalMs = readIntEnv('EXCHANGE_RATE_LOCK_POLL_MS', 50),
    keyPrefix = 'exrate:',
    validate = isValidQuote,
    metrics = DEFAULT_METRICS,
  } = {}) {
    if (!redisClient || typeof redisClient.sendCommand !== 'function') {
      throw new TypeError('ExchangeRateCoordinator requires a redis client with sendCommand');
    }
    this.client = redisClient;
    this.sharedTtlMs = sharedTtlMs;
    this.lockTtlMs = lockTtlMs;
    this.waitTimeoutMs = waitTimeoutMs;
    this.pollIntervalMs = pollIntervalMs;
    this.quotePrefix = `${keyPrefix}quote:`;
    this.lock = new RedisLock(redisClient, { prefix: `${keyPrefix}lock:` });
    this.validate = validate;
    this.metrics = metrics;
  }

  /** Whether the underlying client can currently be used. */
  get available() {
    return this.client.isOpen !== false;
  }

  async _readShared(key) {
    const raw = await this.client.sendCommand(['GET', this.quotePrefix + key]);
    if (raw === null || raw === undefined) {
      this.metrics?.shared?.inc?.({ result: 'miss' });
      return null;
    }
    try {
      const entry = JSON.parse(String(raw));
      if (entry?.v === SHARED_ENTRY_VERSION && this.validate(entry.data)) {
        this.metrics?.shared?.inc?.({ result: 'hit' });
        return entry.data;
      }
    } catch {
      // fall through: treat unparsable content as a miss
    }
    this.metrics?.shared?.inc?.({ result: 'invalid' });
    logger.warn({ keyPrefix: key.slice(0, 8) }, 'Ignoring invalid shared exchange-rate cache entry');
    return null;
  }

  async _writeShared(key, data) {
    const payload = JSON.stringify({ v: SHARED_ENTRY_VERSION, insertedAt: Date.now(), data });
    await this.client.sendCommand([
      'SET', this.quotePrefix + key, payload, 'PX', String(this.sharedTtlMs),
    ]);
  }

  /** Remove a quote from the shared store (cross-instance invalidation). */
  async invalidate(key) {
    if (!this.available) return false;
    const removed = await this.client.sendCommand(['DEL', this.quotePrefix + key]);
    return Number(removed) > 0;
  }

  /**
   * Run `loader` at most once across all coordinated instances for `key`
   * (subject to lock TTL and wait timeout — see module docs).
   *
   * @template T
   * @param {string} key      already-hashed cache key
   * @param {() => Promise<T>} loader  queries Horizon
   * @returns {Promise<{data: T, source: 'shared'|'leader'|'fallback'}>}
   */
  async load(key, loader) {
    if (!this.available) {
      return { data: await loader(), source: 'fallback' };
    }

    const startedAt = Date.now();
    const deadline = startedAt + this.waitTimeoutMs;
    const observeWait = (outcome) =>
      this.metrics?.wait?.observe?.({ outcome }, (Date.now() - startedAt) / 1000);

    // Only Redis operations run inside this try; the loader is always
    // invoked outside it so loader errors are never mistaken for Redis ones.
    let token = null;
    try {
      for (;;) {
        const shared = await this._readShared(key);
        if (shared !== null) {
          observeWait('shared_hit');
          return { data: shared, source: 'shared' };
        }

        token = await this.lock.acquire(key, this.lockTtlMs);
        if (token) {
          this.metrics?.lock?.inc?.({ result: 'acquired' });
          // Double-check: a previous leader may have written between our
          // GET and SET NX.
          const written = await this._readShared(key);
          if (written !== null) {
            await this._release(key, token);
            observeWait('shared_hit');
            return { data: written, source: 'shared' };
          }
          observeWait('acquired');
          break;
        }

        this.metrics?.lock?.inc?.({ result: 'contended' });
        if (Date.now() >= deadline) {
          observeWait('timeout');
          this.metrics?.fallback?.inc?.({ reason: 'wait_timeout' });
          logger.warn(
            { keyPrefix: key.slice(0, 8), waitedMs: Date.now() - startedAt },
            'Exchange-rate lock wait timed out; querying Horizon directly',
          );
          break;
        }
        await sleep(this.pollIntervalMs);
      }
    } catch (err) {
      // Redis failure during coordination: fail open.
      if (token) await this._release(key, token);
      token = null;
      observeWait('error');
      this.metrics?.lock?.inc?.({ result: 'error' });
      this.metrics?.fallback?.inc?.({ reason: 'redis_error' });
      logger.warn({ err: err?.message }, 'Exchange-rate coordination unavailable; querying Horizon directly');
    }

    if (!token) {
      return { data: await loader(), source: 'fallback' };
    }

    // Leader path. The loader's own errors propagate to the caller; the lock
    // is always released so followers can take over immediately.
    try {
      const data = await loader();
      try {
        await this._writeShared(key, data);
      } catch (err) {
        logger.warn({ err: err?.message }, 'Failed to publish exchange-rate quote to shared cache');
      }
      return { data, source: 'leader' };
    } finally {
      await this._release(key, token);
    }
  }

  async _release(key, token) {
    try {
      const released = await this.lock.release(key, token);
      if (!released) {
        logger.warn(
          { keyPrefix: key.slice(0, 8), lockTtlMs: this.lockTtlMs },
          'Exchange-rate lock expired before release; consider raising EXCHANGE_RATE_LOCK_TTL_MS',
        );
      }
    } catch (err) {
      // The lease expires on its own; nothing else to do.
      logger.warn({ err: err?.message }, 'Failed to release exchange-rate lock');
    }
  }
}
