/**
 * merchant-cache.js
 *
 * Distributed (Redis) read-through cache for the Merchant Onboarding and Key
 * Lifecycle Route's read endpoints (#1770).
 *
 * Cached resources (per merchant):
 *   profile           GET /merchant-profile   (no credentials in the row)
 *   branding          GET /merchant-branding
 *   webhook_settings  GET /webhook-settings   (the MASKED response only; the
 *                                              raw webhook_secret never enters Redis)
 *
 * Never cached: API keys, raw webhook secrets, password hashes, and
 * /merchants/api-key-status (it depends on the clock and is security-relevant).
 *
 * Invalidation uses a per-merchant generation counter:
 *
 *   merchant:cache:v1:gen:<merchantId>                      INCR on every write
 *   merchant:cache:v1:<resource>:<merchantId>:g<generation> the cached value
 *
 * A writer updates the database first and then bumps the generation. A reader
 * reads the generation BEFORE it reads the database, so a reader racing a
 * writer can only store its result under the old generation, which nobody
 * reads again. With a plain DEL, a slow reader could put the stale row back
 * after the writer had deleted it.
 *
 * Fail-open: any Redis problem means a database read, never an error
 * response. When the generation cannot be read, the cache is bypassed
 * entirely rather than read under an unconfirmed generation.
 */

import { logger as defaultLogger } from "./logger.js";
import {
  resolveBoundedInt,
  resolveCacheClient,
  cacheGetJson,
  cacheSetJson,
  cacheGetGeneration,
  cacheBumpGeneration,
} from "./redis-json-cache.js";
import { merchantCacheOperationsTotal } from "./merchant-lifecycle-metrics.js";

export const MERCHANT_CACHE_RESOURCES = Object.freeze(["profile", "branding", "webhook_settings"]);
const RESOURCE_SET = new Set(MERCHANT_CACHE_RESOURCES);

const PREFIX = "merchant:cache:v1";
export const DEFAULT_MERCHANT_CACHE_TTL_SECONDS = 60;
/** Generation keys outlive every value key by a wide margin. */
const GENERATION_TTL_SECONDS = 7 * 24 * 60 * 60;
/** Merchant ids are UUIDs; anything else is refused so input cannot shape keys. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function resolveMerchantCacheTtlSeconds(env = process.env) {
  return resolveBoundedInt(env.MERCHANT_CACHE_TTL_SECONDS, {
    fallback: DEFAULT_MERCHANT_CACHE_TTL_SECONDS,
    min: 1,
    max: 900,
  });
}

export function isMerchantCacheEnabled(env = process.env) {
  return String(env.MERCHANT_CACHE_ENABLED ?? "true").toLowerCase() !== "false";
}

export function merchantGenerationKey(merchantId) {
  return `${PREFIX}:gen:${merchantId}`;
}

export function merchantCacheKey(resource, merchantId, generation) {
  if (!RESOURCE_SET.has(resource)) {
    throw new TypeError(`Unknown merchant cache resource: ${resource}`);
  }
  return `${PREFIX}:${resource}:${merchantId}:g${generation}`;
}

function record(resource, result) {
  try {
    merchantCacheOperationsTotal.inc({ resource, result });
  } catch {
    // metrics never break the request path
  }
}

/**
 * Return the cached value for `resource`, or run `loader` and cache its
 * result. `loader` errors propagate uncached. A loader result of
 * `null`/`undefined` (e.g. a 404) is returned but never cached.
 *
 * @template T
 * @param {string} resource  one of MERCHANT_CACHE_RESOURCES
 * @param {string} merchantId
 * @param {() => Promise<T>} loader
 * @param {{ getClient?: Function, env?: object, logger?: object }} [options]
 * @returns {Promise<{ value: T, cache: "hit" | "miss" | "bypass" }>}
 */
export async function readThroughMerchantCache(resource, merchantId, loader, options = {}) {
  const { env = process.env, logger = defaultLogger } = options;
  if (!RESOURCE_SET.has(resource)) {
    throw new TypeError(`Unknown merchant cache resource: ${resource}`);
  }

  if (!isMerchantCacheEnabled(env) || typeof merchantId !== "string" || !SAFE_ID.test(merchantId)) {
    record(resource, "bypass");
    return { value: await loader(), cache: "bypass" };
  }

  const client = await resolveCacheClient(options.getClient);
  const generation = await cacheGetGeneration(client, merchantGenerationKey(merchantId));
  if (generation === null) {
    record(resource, "bypass");
    return { value: await loader(), cache: "bypass" };
  }

  const key = merchantCacheKey(resource, merchantId, generation);
  const cached = await cacheGetJson(client, key);
  if (cached.status === "hit") {
    record(resource, "hit");
    return { value: cached.value, cache: "hit" };
  }
  if (cached.status === "error") {
    record(resource, "error");
    logger.warn({ resource, err: cached.error?.message }, "Merchant cache read failed; using database");
  } else {
    record(resource, "miss");
  }

  const value = await loader();
  if (value !== null && value !== undefined) {
    const stored = await cacheSetJson(client, key, value, resolveMerchantCacheTtlSeconds(env));
    record(resource, stored ? "store" : "store_error");
  }
  return { value, cache: "miss" };
}

/**
 * Make every cached resource for `merchantId` unreachable. Call AFTER the
 * database write has committed. Never throws; a failure is logged and
 * counted, and stale entries then expire within the TTL.
 *
 * @returns {Promise<boolean>}
 */
export async function invalidateMerchantCache(merchantId, options = {}) {
  const { logger = defaultLogger } = options;
  if (typeof merchantId !== "string" || !SAFE_ID.test(merchantId)) return false;

  const client = await resolveCacheClient(options.getClient);
  if (!client) {
    // Redis is unavailable on this node, so nothing could have been cached
    // through it. Entries written by another node expire within the TTL.
    record("all", "invalidate_skipped");
    return false;
  }
  const ok = await cacheBumpGeneration(client, merchantGenerationKey(merchantId), GENERATION_TTL_SECONDS);
  record("all", ok ? "invalidate" : "invalidate_error");
  if (!ok) {
    logger.warn({ merchantId }, "Merchant cache invalidation failed; entries expire with TTL");
  }
  return ok;
}
