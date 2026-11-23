/**
 * redis-json-cache.js
 *
 * Small, fail-open helpers for route-level JSON caching in Redis
 * (#1770, #1775).
 *
 * Rules every caller relies on:
 *   - A cache problem never fails a request. Every operation is bounded by a
 *     timeout and resolves to a status instead of throwing, so a slow or
 *     unreachable Redis degrades to "miss" and the route reads the database.
 *   - Values are JSON. A corrupt or non-JSON entry is reported as "error" and
 *     deleted, never returned.
 *   - `getClient` defaults to connectRedisClient(), which returns a no-op
 *     client when Redis is down, so callers do not need a separate code path.
 */

import { connectRedisClient } from "./redis.js";

export const DEFAULT_CACHE_OP_TIMEOUT_MS = 150;

/**
 * Parse a positive integer from env-style input and clamp it.
 * Invalid input falls back to `fallback`.
 */
export function resolveBoundedInt(raw, { fallback, min, max }) {
  const parsed = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

export function resolveCacheOpTimeoutMs(env = process.env) {
  return resolveBoundedInt(env.REDIS_CACHE_OP_TIMEOUT_MS, {
    fallback: DEFAULT_CACHE_OP_TIMEOUT_MS,
    min: 10,
    max: 5_000,
  });
}

class CacheTimeoutError extends Error {
  constructor(ms) {
    super(`Redis cache operation timed out after ${ms}ms`);
    this.name = "CacheTimeoutError";
  }
}

/** Race `promise` against a timer; the timer never keeps the process alive. */
export function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new CacheTimeoutError(ms)), ms);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Resolve a usable client, or null. Never throws. The no-op fallback from
 * connectRedisClient() reports `isOpen: false` and is treated as unavailable,
 * so "Redis down" reads as a cache bypass, not as an endless run of misses.
 * @param {() => Promise<object>} getClient
 */
export async function resolveCacheClient(getClient = connectRedisClient, timeoutMs = resolveCacheOpTimeoutMs()) {
  try {
    const client = await withTimeout(Promise.resolve(getClient()), timeoutMs);
    if (!client || client.isOpen === false) return null;
    return client;
  } catch {
    return null;
  }
}

/**
 * @returns {Promise<{ status: "hit", value: unknown } | { status: "miss" } | { status: "error", error: Error }>}
 */
export async function cacheGetJson(client, key, { timeoutMs = resolveCacheOpTimeoutMs() } = {}) {
  if (!client) return { status: "error", error: new Error("Redis client unavailable") };
  let raw;
  try {
    raw = await withTimeout(client.get(key), timeoutMs);
  } catch (error) {
    return { status: "error", error };
  }
  if (raw === null || raw === undefined) return { status: "miss" };
  try {
    return { status: "hit", value: JSON.parse(raw) };
  } catch (error) {
    // A corrupt entry must not be served or keep failing: drop it.
    cacheDelete(client, [key], { timeoutMs }).catch(() => {});
    return { status: "error", error };
  }
}

/** @returns {Promise<boolean>} true when the value was stored. */
export async function cacheSetJson(client, key, value, ttlSeconds, { timeoutMs = resolveCacheOpTimeoutMs() } = {}) {
  if (!client || value === undefined) return false;
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) return false;
  try {
    await withTimeout(client.set(key, JSON.stringify(value), { EX: ttlSeconds }), timeoutMs);
    return true;
  } catch {
    return false;
  }
}

/** @returns {Promise<boolean>} true when the delete was acknowledged. */
export async function cacheDelete(client, keys, { timeoutMs = resolveCacheOpTimeoutMs() } = {}) {
  if (!client || !Array.isArray(keys) || keys.length === 0) return false;
  try {
    await withTimeout(Promise.all(keys.map((key) => client.del(key))), timeoutMs);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read a generation counter (missing → "0"). Returns null when Redis is
 * unusable, so the caller can bypass the cache rather than read under a
 * generation it cannot confirm.
 */
export async function cacheGetGeneration(client, key, { timeoutMs = resolveCacheOpTimeoutMs() } = {}) {
  if (!client) return null;
  try {
    const raw = await withTimeout(client.get(key), timeoutMs);
    if (raw === null || raw === undefined) return "0";
    return /^\d{1,20}$/.test(String(raw)) ? String(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Atomically bump a generation counter so every key derived from the old
 * value becomes unreachable. `INCR` is atomic in Redis, so concurrent
 * invalidations from several API nodes cannot lose an increment.
 *
 * @returns {Promise<boolean>}
 */
export async function cacheBumpGeneration(client, key, ttlSeconds, { timeoutMs = resolveCacheOpTimeoutMs() } = {}) {
  if (!client || typeof client.incr !== "function") return false;
  try {
    await withTimeout(client.incr(key), timeoutMs);
    if (typeof client.expire === "function") {
      await withTimeout(client.expire(key, ttlSeconds), timeoutMs);
    }
    return true;
  } catch {
    return false;
  }
}
