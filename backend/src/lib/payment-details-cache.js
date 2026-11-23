/**
 * payment-details-cache.js
 *
 * Distributed (Redis) read-through cache for GET /api/payments/:id, the
 * Public Hosted Checkout Session Route's payment/invoice state lookup (#1775).
 *
 * Checkout pages poll this endpoint while a customer pays. Without a cache
 * every poll costs a database read, and every poll of a completed payment
 * also costs a Horizon call.
 *
 * Keys
 * ----
 *   payment:details:v1:gen:<paymentId>                               generation (INCR)
 *   payment:details:v1:<merchantId>:<paymentId>:g<generation>         response body
 *
 * - Merchant-scoped: an entry is only ever read back under the merchant id
 *   that loaded it, so a cache hit cannot bypass the ownership filter that the
 *   database query applies (the same class of bug as #1311).
 * - Per-payment generation: every payment writer already calls
 *   invalidatePaymentCache() (lib/redis.js), which now also INCRs this
 *   generation, whatever merchant scope the entry was stored under. Readers
 *   read the generation before the database, so a reader racing a writer can
 *   only store under the old generation.
 *
 * TTL by state
 * ------------
 *   failed / expired / refunded, or completed WITH on-chain metadata
 *       → PAYMENT_DETAILS_CACHE_TERMINAL_TTL_SECONDS (default 300 s)
 *   pending / confirmed, or completed while Horizon metadata is missing
 *       → PAYMENT_DETAILS_CACHE_ACTIVE_TTL_SECONDS (default 2 s, 0 disables)
 *
 * A short active TTL absorbs bursts from polling clients while keeping a
 * status change visible within about a second or two, even if a writer were
 * to skip invalidation.
 *
 * Fail-open: a Redis problem means a database read, never an error.
 */

import { logger as defaultLogger } from "./logger.js";
import { paymentDetailsGenerationKey } from "./redis.js";
import {
  resolveBoundedInt,
  resolveCacheClient,
  cacheGetJson,
  cacheSetJson,
  cacheGetGeneration,
} from "./redis-json-cache.js";
import { paymentDetailsCacheOperationsTotal } from "./payment-details-metrics.js";

const PREFIX = "payment:details:v1";
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export const TERMINAL_PAYMENT_STATUSES = Object.freeze(["failed", "expired", "refunded"]);
const TERMINAL = new Set(TERMINAL_PAYMENT_STATUSES);

export const DEFAULT_TERMINAL_TTL_SECONDS = 300;
export const DEFAULT_ACTIVE_TTL_SECONDS = 2;

export function isPaymentDetailsCacheEnabled(env = process.env) {
  return String(env.PAYMENT_DETAILS_CACHE_ENABLED ?? "true").toLowerCase() !== "false";
}

export function paymentDetailsCacheKey(merchantId, paymentId, generation) {
  return `${PREFIX}:${merchantId}:${paymentId}:g${generation}`;
}

/**
 * TTL for a response body; 0 means "do not cache".
 * @param {{ payment?: { status?: string }, stellar_tx?: object|null }} body
 */
export function resolvePaymentDetailsTtlSeconds(body, env = process.env) {
  const terminalTtl = resolveBoundedInt(env.PAYMENT_DETAILS_CACHE_TERMINAL_TTL_SECONDS, {
    fallback: DEFAULT_TERMINAL_TTL_SECONDS,
    min: 1,
    max: 3_600,
  });
  const activeTtl = resolveBoundedInt(env.PAYMENT_DETAILS_CACHE_ACTIVE_TTL_SECONDS, {
    fallback: DEFAULT_ACTIVE_TTL_SECONDS,
    min: 0,
    max: 30,
  });

  const status = body?.payment?.status;
  if (TERMINAL.has(status)) return terminalTtl;
  if (status === "completed" && body?.stellar_tx) return terminalTtl;
  return activeTtl;
}

function record(result) {
  try {
    paymentDetailsCacheOperationsTotal.inc({ result });
  } catch {
    // metrics never break the request path
  }
}

/**
 * Return the cached response body for (merchantId, paymentId), or run
 * `loader`, cache its result according to the payment's state, and return it.
 * `null` (404) and loader errors are never cached.
 *
 * @template T
 * @param {string} merchantId
 * @param {string} paymentId
 * @param {() => Promise<T|null>} loader
 * @param {{ getClient?: Function, env?: object, logger?: object }} [options]
 * @returns {Promise<{ value: T|null, cache: "hit" | "miss" | "bypass" }>}
 */
export async function readThroughPaymentDetails(merchantId, paymentId, loader, options = {}) {
  const { env = process.env, logger = defaultLogger } = options;

  if (
    !isPaymentDetailsCacheEnabled(env) ||
    typeof merchantId !== "string" ||
    !SAFE_ID.test(merchantId) ||
    typeof paymentId !== "string" ||
    !SAFE_ID.test(paymentId)
  ) {
    record("bypass");
    return { value: await loader(), cache: "bypass" };
  }

  const client = await resolveCacheClient(options.getClient);
  const generation = await cacheGetGeneration(client, paymentDetailsGenerationKey(paymentId));
  if (generation === null) {
    record("bypass");
    return { value: await loader(), cache: "bypass" };
  }

  const key = paymentDetailsCacheKey(merchantId, paymentId, generation);
  const cached = await cacheGetJson(client, key);
  if (cached.status === "hit") {
    record("hit");
    return { value: cached.value, cache: "hit" };
  }
  if (cached.status === "error") {
    record("error");
    logger.warn({ err: cached.error?.message }, "Payment details cache read failed; using database");
  } else {
    record("miss");
  }

  const value = await loader();
  if (value !== null && value !== undefined) {
    const ttl = resolvePaymentDetailsTtlSeconds(value, env);
    if (ttl > 0) {
      const stored = await cacheSetJson(client, key, value, ttl);
      record(stored ? "store" : "store_error");
    } else {
      record("skip_store");
    }
  }
  return { value, cache: "miss" };
}
