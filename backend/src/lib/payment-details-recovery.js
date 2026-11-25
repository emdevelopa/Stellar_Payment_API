/**
 * payment-details-recovery.js
 *
 * Automated retry and dead-letter recovery for the Horizon transaction lookup
 * behind the Public Hosted Checkout Session Route (#1776).
 *
 * The route always returns the payment record; the on-chain `stellar_tx` block
 * is best effort. Previously one transient Horizon failure silently dropped it.
 * Now:
 *
 *   1. Transient failures (network errors, 408, 429, 5xx) are retried with
 *      full-jitter backoff inside the request, bounded so the response stays fast.
 *      404 (not yet propagated) and other 4xx are never retried in-request.
 *   2. A lookup that still fails transiently is dead-lettered by transaction id
 *      (never by payment data) and re-driven in the background with backoff.
 *   3. A recovered lookup is stored in a small TTL cache, so the next request
 *      for that transaction is served without another Horizon call. Completed
 *      transactions are immutable, so the cache cannot go stale.
 *
 * Background recovery is opportunistic: a throttled, fire-and-forget run is
 * triggered after a dead-letter, so no timer is created at import time and
 * nothing keeps the process alive. `recoverPaymentDetailsDlq()` is also exported
 * for a scheduled job.
 *
 * Security: queue entries hold only the tx id (a public, 64-hex Horizon
 * identifier). Logs never include payment amounts, recipients or memos.
 */

import { logger as defaultLogger } from "./logger.js";
import { retryWithBackoff, resolveBackoffOptions } from "./backoff-retry.js";
import { RecoveryQueue } from "./recovery-queue.js";
import {
  paymentDetailsHorizonFetchTotal,
  paymentDetailsHorizonRetriesTotal,
  paymentDetailsDlqDepth,
  paymentDetailsDlqOperationsTotal,
} from "./payment-details-metrics.js";

export const TX_ID_PATTERN = /^[0-9a-fA-F]{64}$/;

const RETRY_SPEC = Object.freeze({
  envPrefix: "PAYMENT_DETAILS_RETRY",
  defaults: { maxAttempts: 3, baseDelayMs: 150, maxDelayMs: 1_500 },
  maxAttemptsCeiling: 5,
  maxDelayCeilingMs: 5_000,
});

const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 1_000;
const RECOVERY_MIN_INTERVAL_MS = 15_000;

const RETRYABLE_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "ETIMEDOUT",
  "EPIPE",
  "EAI_AGAIN",
  "ENOTFOUND",
  "EHOSTUNREACH",
  "ENETUNREACH",
]);

function statusOf(err) {
  const status = err?.response?.status ?? err?.status ?? err?.statusCode;
  return typeof status === "number" ? status : null;
}

export function isHorizonNotFound(err) {
  return statusOf(err) === 404;
}

/** Transient Horizon failures worth retrying. 404 and other 4xx are deterministic. */
export function isHorizonRetryable(err) {
  if (!err || typeof err !== "object") return false;
  if (err.retryable === false) return false;
  const status = statusOf(err);
  if (status !== null) {
    if (status === 408 || status === 429) return true;
    return status >= 500 && status !== 501;
  }
  if (RETRYABLE_NETWORK_CODES.has(err.code)) return true;
  return /fetch failed|socket hang up|network error|timed? ?out/i.test(String(err.message ?? ""));
}

export const paymentDetailsDlq = new RecoveryQueue({
  name: "payment_details",
  maxCapacity: 500,
  maxAttempts: 5,
  baseDelayMs: 2_000,
  maxDelayMs: 60_000,
  metrics: {
    onDepth: (n) => paymentDetailsDlqDepth.set(n),
    onOperation: (action, status) => paymentDetailsDlqOperationsTotal.inc({ action, status }),
  },
});

// ── Recovered-metadata cache ────────────────────────────────────────────────

const metaCache = new Map(); // txId -> { value, expiresAt }

function cacheGet(txId, now) {
  const hit = metaCache.get(txId);
  if (!hit) return null;
  if (hit.expiresAt <= now) {
    metaCache.delete(txId);
    return null;
  }
  return hit.value;
}

function cacheSet(txId, value, now) {
  if (metaCache.size >= CACHE_MAX_ENTRIES) {
    // Map iterates in insertion order: drop the oldest entry.
    metaCache.delete(metaCache.keys().next().value);
  }
  metaCache.set(txId, { value, expiresAt: now + CACHE_TTL_MS });
}

export function resetPaymentDetailsRecoveryForTests() {
  metaCache.clear();
  paymentDetailsDlq.clear();
  lastRecoveryStartedAt = 0;
}

// ── Lookup with retry + dead-lettering ──────────────────────────────────────

let lastRecoveryStartedAt = 0;

/**
 * Look up Horizon metadata for a transaction. Never throws: returns the
 * metadata, or `null` when it is unavailable (the route then omits `stellar_tx`).
 *
 * @param {string} txId
 * @param {object} options
 * @param {(txId:string) => Promise<object>} options.fetchTx  Throws on failure
 * @param {boolean} [options.scheduleRecovery=true]
 * @param {() => number} [options.now]
 */
export async function fetchTxMetaWithRecovery(txId, options) {
  const {
    fetchTx,
    scheduleRecovery: shouldSchedule = true,
    now = Date.now,
    sleep,
    random,
    logger = defaultLogger,
  } = options;

  if (!txId || typeof txId !== "string" || !TX_ID_PATTERN.test(txId)) return null;

  const cached = cacheGet(txId, now());
  if (cached) {
    paymentDetailsHorizonFetchTotal.inc({ outcome: "cache_hit" });
    return cached;
  }

  try {
    const meta = await retryWithBackoff(() => fetchTx(txId), {
      resolved: resolveBackoffOptions({}, process.env, RETRY_SPEC),
      label: "payment_details_horizon_lookup",
      shouldRetry: isHorizonRetryable,
      onRetry: () => paymentDetailsHorizonRetriesTotal.inc(),
      ...(sleep ? { sleep } : {}),
      ...(random ? { random } : {}),
      logger,
    });
    cacheSet(txId, meta, now());
    paymentDetailsHorizonFetchTotal.inc({ outcome: "success" });
    return meta;
  } catch (err) {
    if (isHorizonNotFound(err)) {
      // Not yet visible on Horizon: normal for a fresh transaction. Silent.
      paymentDetailsHorizonFetchTotal.inc({ outcome: "not_found" });
      return null;
    }

    if (isHorizonRetryable(err)) {
      paymentDetailsDlq.enqueue(txId, { txId }, err);
      paymentDetailsHorizonFetchTotal.inc({ outcome: "dead_lettered" });
      if (shouldSchedule) scheduleRecovery({ fetchTx, now, logger });
    } else {
      paymentDetailsHorizonFetchTotal.inc({ outcome: "error" });
      logger.warn?.({ err: err?.message, status: statusOf(err) }, "Horizon lookup failed (not retryable)");
    }
    return null;
  }
}

// ── Recovery ────────────────────────────────────────────────────────────────

/**
 * Re-drive due dead-lettered lookups with a single attempt each. Successes are
 * cached; failures back off or, after repeated failure, are isolated.
 */
export async function recoverPaymentDetailsDlq({ fetchTx, now = Date.now, maxBatch = 10 } = {}) {
  if (typeof fetchTx !== "function") {
    throw new TypeError("recoverPaymentDetailsDlq requires a fetchTx function");
  }
  return paymentDetailsDlq.recover(
    async (entry) => {
      const meta = await fetchTx(entry.payload.txId);
      cacheSet(entry.payload.txId, meta, now());
    },
    { maxBatch },
  );
}

/**
 * Throttled, fire-and-forget background recovery. Safe to call on every failure:
 * at most one run is started per RECOVERY_MIN_INTERVAL_MS, and runs never overlap.
 */
export function scheduleRecovery({ fetchTx, now = Date.now, logger = defaultLogger } = {}) {
  const current = now();
  if (current - lastRecoveryStartedAt < RECOVERY_MIN_INTERVAL_MS) return false;
  lastRecoveryStartedAt = current;

  const timer = setTimeout(() => {
    recoverPaymentDetailsDlq({ fetchTx, now }).catch((err) => {
      logger.error?.({ err: err?.message }, "Payment details DLQ recovery run failed");
    });
  }, 0);
  timer.unref?.();
  return true;
}
