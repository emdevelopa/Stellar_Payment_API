/**
 * validators-cache.js
 *
 * Distributed (Redis) cache with an in-process fallback for the Stellar
 * validators' network-bound work: federated address resolution (#1765).
 *
 * Resolving `name*domain` costs two HTTPS round trips (stellar.toml, then the
 * federation server). Results are stable for minutes, so they are cached:
 *
 *   - Redis (shared across instances) when available, via GET / SET EX.
 *   - A bounded in-memory LRU when Redis is unavailable or errors, so a Redis
 *     outage degrades to per-instance caching and never fails a validation.
 *
 * Safety
 * ------
 *   - Keys are `validator:v1:<namespace>:<sha256(input)>`, so user input can
 *     never inject Redis key separators or create oversized keys.
 *   - Only SUCCESSFUL results are cached; failures are never cached, so an
 *     outage cannot be turned into a sticky rejection.
 *   - Values are JSON. The caller re-validates anything it reads back (see
 *     `parse`), so a poisoned or corrupt entry is discarded rather than trusted.
 *   - TTL is clamped (1s..1h). The in-memory store is bounded and expires
 *     lazily on access and on insert; there are no timers to leak.
 *   - Redis errors are swallowed, counted and logged without the key or value.
 */

import { createHash } from "node:crypto";
import { logger as defaultLogger } from "../logger.js";
import { connectRedisClient } from "../redis.js";
import { validatorCacheOperationsTotal } from "./validators-metrics.js";

export const DEFAULT_CACHE_TTL_SECONDS = 300;
const MIN_TTL_SECONDS = 1;
const MAX_TTL_SECONDS = 3_600;
const DEFAULT_MAX_MEMORY_ENTRIES = 1_000;
const KEY_PREFIX = "validator:v1";

export function resolveCacheTtlSeconds(value, env = process.env) {
  const raw = Number(value ?? env.VALIDATOR_CACHE_TTL_SECONDS);
  if (!Number.isFinite(raw)) return DEFAULT_CACHE_TTL_SECONDS;
  return Math.min(Math.max(Math.trunc(raw), MIN_TTL_SECONDS), MAX_TTL_SECONDS);
}

export function buildValidatorCacheKey(namespace, input) {
  if (!namespace || typeof namespace !== "string" || !/^[a-z0-9_]+$/.test(namespace)) {
    throw new TypeError("namespace must be a lowercase [a-z0-9_] string");
  }
  const digest = createHash("sha256").update(String(input).toLowerCase()).digest("hex");
  return `${KEY_PREFIX}:${namespace}:${digest}`;
}

export class ValidatorCache {
  /**
   * @param {object} [options]
   * @param {() => Promise<object>} [options.getRedis]  Injected for tests
   * @param {number} [options.ttlSeconds]
   * @param {number} [options.maxMemoryEntries]
   * @param {() => number} [options.now]
   * @param {object} [options.logger]
   */
  constructor(options = {}) {
    this.getRedis = options.getRedis || connectRedisClient;
    this.ttlSeconds = resolveCacheTtlSeconds(options.ttlSeconds);
    this.maxMemoryEntries = Math.max(1, options.maxMemoryEntries || DEFAULT_MAX_MEMORY_ENTRIES);
    this.now = options.now || Date.now;
    this.logger = options.logger || defaultLogger;
    this._memory = new Map(); // key -> { value, expiresAt } (insertion order = LRU order)
  }

  get memorySize() {
    return this._memory.size;
  }

  async _redis() {
    try {
      const client = await this.getRedis();
      // connectRedisClient() returns a no-op client (isOpen:false) when Redis is
      // unreachable; treat that as "no distributed backend".
      if (!client || client.isOpen === false) return null;
      return client;
    } catch (err) {
      this.logger.warn?.({ err: err?.message }, "Validator cache: Redis unavailable, using memory");
      return null;
    }
  }

  _memoryGet(key) {
    const entry = this._memory.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this._memory.delete(key);
      return null;
    }
    // Refresh recency.
    this._memory.delete(key);
    this._memory.set(key, entry);
    return entry.value;
  }

  _memorySet(key, serialized, ttlSeconds) {
    this._memory.delete(key);
    // Make room: drop expired entries first, then the least recently used.
    if (this._memory.size >= this.maxMemoryEntries) {
      const now = this.now();
      for (const [k, entry] of this._memory) {
        if (entry.expiresAt <= now) this._memory.delete(k);
      }
      while (this._memory.size >= this.maxMemoryEntries) {
        this._memory.delete(this._memory.keys().next().value);
      }
    }
    this._memory.set(key, { value: serialized, expiresAt: this.now() + ttlSeconds * 1000 });
  }

  /**
   * Read a cached value.
   *
   * @param {string} operation  Metric label, e.g. "federation_resolve"
   * @param {string} key        From buildValidatorCacheKey()
   * @param {(raw: unknown) => unknown|null} parse  Re-validates a cached value;
   *   return null to reject it (the entry is then dropped and treated as a miss).
   * @returns {Promise<unknown|null>}
   */
  async get(operation, key, parse) {
    const client = await this._redis();
    let serialized = null;
    let backend = "memory";

    if (client) {
      try {
        serialized = await client.get(key);
        backend = "redis";
      } catch (err) {
        validatorCacheOperationsTotal.inc({ operation, result: "error", backend: "redis" });
        this.logger.warn?.({ err: err?.message }, "Validator cache: Redis GET failed, using memory");
      }
    }
    if (serialized === null || serialized === undefined) {
      const fromMemory = this._memoryGet(key);
      if (fromMemory !== null) {
        serialized = fromMemory;
        backend = "memory";
      }
    }

    if (serialized === null || serialized === undefined) {
      validatorCacheOperationsTotal.inc({ operation, result: "miss", backend });
      return null;
    }

    let value = null;
    try {
      value = parse(JSON.parse(serialized));
    } catch {
      value = null;
    }
    if (value === null || value === undefined) {
      // Corrupt or poisoned entry: drop it everywhere and treat as a miss.
      validatorCacheOperationsTotal.inc({ operation, result: "invalid", backend });
      await this.delete(key);
      return null;
    }

    validatorCacheOperationsTotal.inc({ operation, result: "hit", backend });
    return value;
  }

  /** Store a successful result. Never throws. */
  async set(operation, key, value, ttlSeconds = this.ttlSeconds) {
    const ttl = resolveCacheTtlSeconds(ttlSeconds);
    let serialized;
    try {
      serialized = JSON.stringify(value);
    } catch {
      return false;
    }
    this._memorySet(key, serialized, ttl);

    const client = await this._redis();
    if (client) {
      try {
        await client.set(key, serialized, { EX: ttl });
        validatorCacheOperationsTotal.inc({ operation, result: "set", backend: "redis" });
        return true;
      } catch (err) {
        validatorCacheOperationsTotal.inc({ operation, result: "error", backend: "redis" });
        this.logger.warn?.({ err: err?.message }, "Validator cache: Redis SET failed, kept in memory");
      }
    }
    validatorCacheOperationsTotal.inc({ operation, result: "set", backend: "memory" });
    return true;
  }

  async delete(key) {
    this._memory.delete(key);
    const client = await this._redis();
    if (client) {
      try {
        await client.del(key);
      } catch {
        // The entry expires on its own via EX.
      }
    }
  }

  clearMemory() {
    this._memory.clear();
  }
}

/** Process-wide cache used by resolveFederatedAddress unless one is injected. */
export const validatorCache = new ValidatorCache();
