/**
 * payment-details-concurrency.js
 *
 * Concurrency control and snapshot consistency for GET /api/payments/:id,
 * the Public Hosted Checkout Session Route (#1777).
 *
 * 1. Request coalescing (single flight)
 *    Checkout pages poll, and a customer often has several tabs open. When N
 *    identical lookups (same merchant + payment) arrive while one is already
 *    running, they share that lookup: one cache read, at most one database
 *    read and at most one Horizon call. The key includes the merchant id, so
 *    lookups are never shared across merchants. Each follower receives its own
 *    deep copy. The entry is removed as soon as the lookup settles, so a
 *    failure is never replayed to later requests.
 *
 * 2. Bounded Horizon enrichment (bulkhead + deadline)
 *    The on-chain `stellar_tx` block is best effort. At most
 *    PAYMENT_DETAILS_HORIZON_MAX_CONCURRENCY lookups run at once and
 *    PAYMENT_DETAILS_HORIZON_MAX_QUEUE wait. Beyond that, the request is shed
 *    and the payment is returned without `stellar_tx` (never a 503 for a
 *    payment we could read). A lookup that outlives
 *    PAYMENT_DETAILS_HORIZON_TIMEOUT_MS is abandoned for this response, but it
 *    keeps its slot until Horizon actually answers, so the limiter always
 *    reflects real outstanding calls.
 *
 * 3. Snapshot consistency
 *    The payment row (status + tx_id) is read in ONE statement, and
 *    enrichment is only attached when the transaction Horizon returned is the
 *    one in that snapshot. A mismatch drops `stellar_tx` rather than pairing
 *    a payment with someone else's transaction.
 */

import { ConcurrencyLimiter } from "./stellar/horizon-client/concurrency-limiter.js";
import { resolveBoundedInt } from "./redis-json-cache.js";
import {
  paymentDetailsCoalescedTotal,
  paymentDetailsSingleFlightInFlight,
  paymentDetailsEnrichmentTotal,
} from "./payment-details-metrics.js";

function safe(fn) {
  try {
    fn();
  } catch {
    // metrics never break the request path
  }
}

// ── Single flight ───────────────────────────────────────────────────────────

export const DEFAULT_SINGLE_FLIGHT_MAX_KEYS = 10_000;

/**
 * @param {{ maxKeys?: number, clone?: (v: any) => any }} [options]
 */
export function createSingleFlight({ maxKeys = DEFAULT_SINGLE_FLIGHT_MAX_KEYS, clone = structuredClone } = {}) {
  /** @type {Map<string, Promise<any>>} */
  const inflight = new Map();

  return {
    get size() {
      return inflight.size;
    },

    /**
     * Run `fn` for `key`, or join the run already in progress.
     * @template T
     * @param {string} key
     * @param {() => Promise<T>} fn
     * @returns {Promise<{ value: T, shared: boolean }>}
     */
    async run(key, fn) {
      const existing = inflight.get(key);
      if (existing) {
        safe(() => paymentDetailsCoalescedTotal.inc());
        const value = await existing;
        // Followers get their own copy so no caller can mutate another's result.
        return { value: value === null || value === undefined ? value : clone(value), shared: true };
      }

      // Bounded: under a flood of distinct keys, run uncoalesced rather than
      // grow the map without limit.
      if (inflight.size >= maxKeys) {
        return { value: await fn(), shared: false };
      }

      const promise = Promise.resolve().then(fn);
      inflight.set(key, promise);
      safe(() => paymentDetailsSingleFlightInFlight.set(inflight.size));
      try {
        return { value: await promise, shared: false };
      } finally {
        inflight.delete(key);
        safe(() => paymentDetailsSingleFlightInFlight.set(inflight.size));
      }
    },
  };
}

export const paymentDetailsSingleFlight = createSingleFlight();

/** Coalescing key: merchant-scoped so a lookup is never shared across tenants. */
export function paymentDetailsFlightKey(merchantId, paymentId) {
  return `${merchantId}\u0000${paymentId}`;
}

// ── Bounded, deadline-limited Horizon enrichment ───────────────────────────

export function resolveEnrichmentOptions(env = process.env) {
  return {
    maxConcurrent: resolveBoundedInt(env.PAYMENT_DETAILS_HORIZON_MAX_CONCURRENCY, { fallback: 8, min: 1, max: 256 }),
    maxQueue: resolveBoundedInt(env.PAYMENT_DETAILS_HORIZON_MAX_QUEUE, { fallback: 32, min: 0, max: 10_000 }),
    queueTimeoutMs: resolveBoundedInt(env.PAYMENT_DETAILS_HORIZON_QUEUE_TIMEOUT_MS, { fallback: 1_000, min: 10, max: 30_000 }),
    timeoutMs: resolveBoundedInt(env.PAYMENT_DETAILS_HORIZON_TIMEOUT_MS, { fallback: 4_000, min: 50, max: 30_000 }),
  };
}

export function createEnrichmentLimiter(options = resolveEnrichmentOptions()) {
  return new ConcurrencyLimiter({
    maxConcurrent: options.maxConcurrent,
    maxQueue: options.maxQueue,
    queueTimeoutMs: options.queueTimeoutMs,
  });
}

const defaultOptions = resolveEnrichmentOptions();
export const paymentDetailsEnrichmentLimiter = createEnrichmentLimiter(defaultOptions);

const DEADLINE = Symbol("deadline");

function raceDeadline(promise, ms) {
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve(DEADLINE), ms);
    timer.unref?.();
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

/**
 * True when `stellarTx` describes the transaction recorded in the payment
 * snapshot. Transaction hashes are hex, so the comparison ignores case.
 */
export function isConsistentStellarTx(txId, stellarTx) {
  if (!stellarTx || typeof stellarTx !== "object") return false;
  if (typeof txId !== "string" || typeof stellarTx.tx_hash !== "string") return false;
  return stellarTx.tx_hash.toLowerCase() === txId.toLowerCase();
}

/**
 * Fetch on-chain metadata for the snapshot's tx id under the bulkhead and
 * deadline. Never throws: any failure yields `null`, and the payment is still
 * returned.
 *
 * outcome: ok | skipped | unavailable | shed | timeout | mismatch
 *
 * @param {string|null} txId
 * @param {(txId: string) => Promise<object|null>} fetchMeta
 * @param {{ limiter?: ConcurrencyLimiter, timeoutMs?: number }} [options]
 * @returns {Promise<{ stellarTx: object|null, outcome: string }>}
 */
export async function enrichStellarTx(txId, fetchMeta, options = {}) {
  const limiter = options.limiter ?? paymentDetailsEnrichmentLimiter;
  const timeoutMs = options.timeoutMs ?? defaultOptions.timeoutMs;
  const done = (stellarTx, outcome) => {
    safe(() => paymentDetailsEnrichmentTotal.inc({ outcome }));
    return { stellarTx, outcome };
  };

  if (!txId) return done(null, "skipped");

  let release;
  try {
    release = await limiter.acquire("payment_details_horizon");
  } catch {
    // Queue full or queue wait exceeded: shed the enrichment, not the request.
    return done(null, "shed");
  }

  // The slot is released when Horizon answers, not when we stop waiting.
  const work = Promise.resolve()
    .then(() => fetchMeta(txId))
    .catch(() => null)
    .finally(release);

  const result = await raceDeadline(work, timeoutMs);
  if (result === DEADLINE) return done(null, "timeout");
  if (!result) return done(null, "unavailable");
  if (!isConsistentStellarTx(txId, result)) return done(null, "mismatch");
  return done(result, "ok");
}
