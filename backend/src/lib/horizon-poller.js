/**
 * Background Horizon Poller — Ledger Monitor
 *
 * Periodically fetches all pending payments from the DB and checks Horizon
 * for matching transactions. When found, updates status to "confirmed" and
 * fires webhooks/SSE/email — exactly the same logic as the verify-payment route.
 *
 * This ensures payments confirm automatically even if the customer closes the
 * browser before the frontend calls /api/verify-payment/:id.
 *
 * Error Recovery (Issue #627)
 * ───────────────────────────
 * The poller is designed to be resilient against transient failures:
 *
 *  • Horizon calls are rate-limited inside the monitor to avoid accidental
 *    endpoint abuse during large pending-payment batches.
 *  • Per-payment errors are isolated — one bad payment never aborts the cycle.
 *  • Horizon connectivity failures trigger exponential back-off so the poller
 *    does not hammer an unavailable endpoint.
 *  • A consecutive-failure counter gates circuit-breaker behaviour: after
 *    MAX_CONSECUTIVE_FAILURES the poller pauses for CIRCUIT_BREAKER_RESET_MS
 *    before resuming normal operation.
 *  • Signature verification failures are logged with full context and the
 *    payment is skipped (not failed) so it can be re-checked next cycle.
 *  • Wrong-amount transactions are signature-verified before status changes.
 *  • DB update conflicts (unique constraint on tx_id) are handled gracefully.
 *  • All error paths emit structured log entries for observability.
 */

import { supabase } from "./supabase.js";
import {
  findMatchingPayment,
  findAnyRecentPayment,
  verifyTransactionSignature,
} from "./stellar.js";
import {
  validatePaymentRecord,
  sanitizePaymentMetadata,
  auditPaymentAnomaly,
  isValidTransactionHash,
  METADATA_ALLOWLIST,
  STALE_PAYMENT_HOURS,
} from "./ledger-monitor-security.js";
import { sendWebhook, isEventSubscribed } from "./webhooks.js";
import { sendReceiptEmail } from "./email.js";
import { renderReceiptEmail } from "./email-templates.js";
import { getPayloadForVersion } from "../webhooks/resolver.js";
import { streamManager } from "./stream-manager.js";
import { connectRedisClient, invalidatePaymentCache } from "./redis.js";
import { logger } from "./logger.js";
import {
  paymentConfirmedCounter,
  paymentConfirmationLatency,
  ledgerMonitorCycleDuration,
  ledgerMonitorPaymentsChecked,
  ledgerMonitorCircuitBreakerTrips,
  ledgerMonitorBatchSize,
  ledgerMonitorRateLimiterWaitSeconds,
  ledgerMonitorValidationFailures,
  ledgerMonitorAnomaliesDetected,
  ledgerMonitorMerchantCacheHits,
  ledgerMonitorMerchantCacheMisses,
  ledgerMonitorMerchantCacheSize,
  ledgerMonitorSignatureVerifications,
  ledgerMonitorHorizonOperations,
  rateLimitRequestsTotal,
  rateLimitExceededTotal,
} from "./metrics.js";

// ── Merchant Config Cache ──────────────────────────────────────────────────────

/**
 * Robust in-memory LRU cache for merchant notification configs.
 * Reduces duplicate DB lookups across poll cycles and within a single cycle.
 */
class MerchantConfigCache {
  constructor(maxEntries = 1000, ttlMs = 5 * 60 * 1000) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
    this.cache = new Map();
  }

  get(merchantId) {
    const entry = this.cache.get(merchantId);
    if (!entry) {
      ledgerMonitorMerchantCacheMisses.inc();
      return null;
    }
    if (Date.now() - entry.insertedAt > this.ttlMs) {
      this.cache.delete(merchantId);
      ledgerMonitorMerchantCacheMisses.inc();
      return null;
    }
    // LRU touch
    this.cache.delete(merchantId);
    this.cache.set(merchantId, entry);
    ledgerMonitorMerchantCacheHits.inc();
    return entry.data;
  }

  set(merchantId, data) {
    if (this.cache.has(merchantId)) {
      this.cache.delete(merchantId);
    }
    if (this.cache.size >= this.maxEntries) {
      const oldest = this.cache.keys().next().value;
      this.cache.delete(oldest);
    }
    this.cache.set(merchantId, { data, insertedAt: Date.now() });
    ledgerMonitorMerchantCacheSize.set(this.cache.size);
  }

  invalidate(merchantId) {
    if (merchantId) {
      this.cache.delete(merchantId);
      return;
    }
    this.cache.clear();
  }

  getStats() {
    return {
      size: this.cache.size,
      maxEntries: this.maxEntries,
      ttlMs: this.ttlMs,
    };
  }
}

const merchantConfigCache = new MerchantConfigCache();

export function getMerchantConfigCacheStats() {
  return merchantConfigCache.getStats();
}

/** Prometheus label set identifying the Ledger Monitor's Horizon rate limiter. */
const RATE_LIMIT_LABELS = { endpoint: "ledger_monitor", type: "horizon" };

// ── Tuning constants ──────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 15_000;       // 15 seconds between normal cycles
const BATCH_SIZE = 50;                 // max pending payments per cycle
const MAX_AGE_HOURS = 24;             // ignore payments older than 24 h (likely abandoned)
const HORIZON_REQUESTS_PER_SECOND = parsePositiveInt(
  process.env.LEDGER_MONITOR_HORIZON_RPS,
  5,
);
const TRANSIENT_DB_RETRY_ATTEMPTS = 2;
const MERCHANT_NOTIFICATION_FIELDS = [
  "webhook_secret",
  "webhook_version",
  "notification_email",
  "email",
  "business_name",
  "webhook_custom_headers",
].join(", ");

/** Back-off schedule (ms) applied after consecutive Horizon fetch failures. */
const BACKOFF_DELAYS_MS = [5_000, 15_000, 30_000, 60_000];

/**
 * Number of consecutive full-cycle failures before the circuit breaker opens.
 * A "full-cycle failure" means the DB fetch itself failed, not individual
 * payment errors (those are always isolated).
 */
const MAX_CONSECUTIVE_FAILURES = 5;

/** How long the circuit breaker stays open before attempting recovery (ms). */
const CIRCUIT_BREAKER_RESET_MS = 5 * 60_000; // 5 minutes

// ── Module-level state ────────────────────────────────────────────────────────

let _io = null;
let _timer = null;
let _running = false;

/** Counts consecutive cycles where the DB fetch itself failed. */
let _consecutiveFailures = 0;

/** Timestamp (ms) when the circuit breaker was tripped. 0 = not tripped. */
let _circuitBreakerOpenAt = 0;

/** Current back-off delay index into BACKOFF_DELAYS_MS. */
let _backoffIndex = 0;
let _rateLimiter = createLedgerMonitorRateLimiter({
  maxPerSecond: HORIZON_REQUESTS_PER_SECOND,
});

/**
 * Sentinel used by the merchant config cache to distinguish between:
 *   • `undefined`   — entry not cached (cache miss)
 *   • `NOT_FOUND`   — entry was looked up and the merchant does not exist
 *   • `null`        — should never be stored; treated as a cache miss
 *
 * DI-06: previously both "not found" and "not cached" were represented as
 * null, so loadMerchantNotificationConfig could not tell whether a null in
 * the cycle cache meant "we checked and the merchant doesn't exist" vs
 * "the batch query errored out and we filled null defensively".  Using a
 * distinct symbol removes that ambiguity.
 */
const MERCHANT_NOT_FOUND = Symbol("MERCHANT_NOT_FOUND");

// ── Public API ────────────────────────────────────────────────────────────────

export function startHorizonPoller(io) {
  _io = io;
  _timer = setInterval(pollPendingPayments, POLL_INTERVAL_MS);
  // Run immediately on startup too
  pollPendingPayments();
  logger.info({ intervalMs: POLL_INTERVAL_MS }, "Horizon poller started");
}

export function stopHorizonPoller() {
  if (_timer) { clearInterval(_timer); _timer = null; }
  logger.info("Horizon poller stopped");
}

/**
 * Expose internal state for testing / health-check endpoints.
 * @returns {{ consecutiveFailures: number, circuitBreakerOpen: boolean, backoffIndex: number }}
 */
export function getPollerHealth() {
  const circuitBreakerOpen =
    _circuitBreakerOpenAt > 0 &&
    Date.now() - _circuitBreakerOpenAt < CIRCUIT_BREAKER_RESET_MS;

  const rateLimitedRequests =
    typeof _rateLimiter.stats === "function"
      ? _rateLimiter.stats().rateLimitedRequests
      : 0;

  return {
    consecutiveFailures: _consecutiveFailures,
    circuitBreakerOpen,
    backoffIndex: _backoffIndex,
    horizonRequestsPerSecond: _rateLimiter.maxPerSecond,
    rateLimitedRequests,
  };
}

/**
 * Reset error-recovery state. Useful in tests and after manual intervention.
 */
export function resetPollerState() {
  _consecutiveFailures = 0;
  _circuitBreakerOpenAt = 0;
  _backoffIndex = 0;
  _rateLimiter.reset();
}

/**
 * Run a single poll cycle immediately. Exposed for testing.
 * @returns {Promise<void>}
 */
export async function pollOnce() {
  return pollPendingPayments();
}

export function createLedgerMonitorRateLimiter({
  maxPerSecond,
  burst = maxPerSecond,
  now = () => Date.now(),
  sleepFn = sleep,
} = {}) {
  const safeMax = Math.max(1, Number(maxPerSecond) || 1);
  const safeBurst = Math.max(1, Number(burst) || safeMax);
  let tokens = safeBurst;
  let lastRefillAt = now();
  // Number of requests that were throttled (had to wait for a token). Surfaced
  // via stats() and getPollerHealth() for observability.
  let rateLimitedRequests = 0;

  function refill() {
    const current = now();
    const elapsedMs = Math.max(0, current - lastRefillAt);
    tokens = Math.min(safeBurst, tokens + (elapsedMs / 1000) * safeMax);
    lastRefillAt = current;
  }

  return {
    maxPerSecond: safeMax,
    async waitForSlot() {
      rateLimitRequestsTotal.inc(RATE_LIMIT_LABELS);
      refill();
      if (tokens >= 1) {
        tokens -= 1;
        return;
      }

      // No token available — this request is being throttled.
      rateLimitExceededTotal.inc(RATE_LIMIT_LABELS);
      rateLimitedRequests += 1;
      const delayMs = Math.ceil(((1 - tokens) / safeMax) * 1000);
      logger.warn(
        { delayMs, maxPerSecond: safeMax, rateLimitedRequests },
        "Horizon poller: rate limit reached — delaying Horizon request",
      );
      await sleepFn(delayMs);
      ledgerMonitorRateLimiterWaitSeconds.observe(delayMs / 1000);
      refill();
      tokens = Math.max(0, tokens - 1);
    },
    stats() {
      return { rateLimitedRequests, maxPerSecond: safeMax };
    },
    reset() {
      tokens = safeBurst;
      lastRefillAt = now();
      rateLimitedRequests = 0;
    },
  };
}

export function setLedgerMonitorRateLimiterForTest(rateLimiter) {
  _rateLimiter = rateLimiter;
}

// ── Core polling loop ─────────────────────────────────────────────────────────

async function pollPendingPayments() {
  if (_running) return; // skip if previous cycle still running
  _running = true;

  const cycleStartTime = Date.now();

  try {
    // ── Circuit breaker check ─────────────────────────────────────────────
    if (_circuitBreakerOpenAt > 0) {
      const elapsed = Date.now() - _circuitBreakerOpenAt;
      if (elapsed < CIRCUIT_BREAKER_RESET_MS) {
        logger.warn(
          { remainingMs: CIRCUIT_BREAKER_RESET_MS - elapsed },
          "Horizon poller: circuit breaker open — skipping cycle",
        );
        return;
      }
      // Reset circuit breaker and try again
      logger.info("Horizon poller: circuit breaker reset — resuming normal operation");
      _circuitBreakerOpenAt = 0;
      _consecutiveFailures = 0;
      _backoffIndex = 0;
    }

    const cutoff = new Date(Date.now() - MAX_AGE_HOURS * 60 * 60 * 1000).toISOString();

    const { data: pending, error } = await fetchPendingPayments(cutoff);

    if (error) {
      _consecutiveFailures += 1;
      logger.warn(
        { err: error, consecutiveFailures: _consecutiveFailures },
        "Horizon poller: failed to fetch pending payments",
      );

      // Apply back-off delay before next cycle
      const delay = BACKOFF_DELAYS_MS[Math.min(_backoffIndex, BACKOFF_DELAYS_MS.length - 1)];
      _backoffIndex = Math.min(_backoffIndex + 1, BACKOFF_DELAYS_MS.length - 1);
      logger.info({ delayMs: delay }, "Horizon poller: applying back-off delay");
      await sleep(delay);

      // Trip circuit breaker after too many consecutive failures
      if (_consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        _circuitBreakerOpenAt = Date.now();
        ledgerMonitorCircuitBreakerTrips.inc();
        logger.error(
          { consecutiveFailures: _consecutiveFailures, resetMs: CIRCUIT_BREAKER_RESET_MS },
          "Horizon poller: circuit breaker tripped — pausing polling",
        );
      }
      return;
    }

    // Successful DB fetch — reset failure counters
    if (_consecutiveFailures > 0) {
      logger.info(
        { previousFailures: _consecutiveFailures },
        "Horizon poller: DB fetch recovered — resetting failure counters",
      );
      _consecutiveFailures = 0;
      _backoffIndex = 0;
    }

    ledgerMonitorBatchSize.set(pending?.length ?? 0);

    if (!pending || pending.length === 0) return;

    logger.info({ count: pending.length }, "Horizon poller: checking pending payments");

    // Group by recipient+asset to process same-address payments sequentially.
    // This prevents two payments with identical recipient+amount from both
    // claiming the same on-chain transaction in the same cycle.
    const groups = new Map();
    for (const p of pending) {
      const key = `${p.recipient}:${p.asset}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    }

    // Pre-load every merchant notification config for this batch in a single
    // query, replacing the previous N+1 pattern (one merchants lookup per
    // confirmed payment). Seeds the per-cycle cache consumed by checkPayment.
    const cycleCache = await preloadMerchantConfigs(pending);
    const results = await Promise.allSettled(
      Array.from(groups.values()).map(async (group) => {
        for (const p of group) {
          await checkPayment(p, { merchantConfigCache: cycleCache });
        }
      })
    );

    // Record metrics for payment check results. `checkPayment` isolates its own
    // errors, so a rejected group here is unexpected — surface it instead of
    // letting it disappear (the previous code referenced an undefined
    // `results`, throwing a ReferenceError that aborted the cycle every time).
    for (const result of results) {
      if (result.status === "rejected") {
        logger.warn(
          { err: result.reason },
          "Horizon poller: payment group processing failed",
        );
      }
    }

  } catch (err) {
    logger.warn({ err }, "Horizon poller: unexpected error in poll cycle");
  } finally {
    const cycleDuration = (Date.now() - cycleStartTime) / 1000;
    ledgerMonitorCycleDuration.observe(cycleDuration);
    _running = false;
  }
}

// ── Per-payment check ─────────────────────────────────────────────────────────

async function checkPayment(payment, { merchantConfigCache = new Map() } = {}) {
  try {
    // Guard: full security validation on the DB record before touching Horizon
    const validation = validatePaymentRecord(payment);
    if (!validation.valid) {
      ledgerMonitorValidationFailures.inc({ reason: deriveValidationReasonTag(validation.reason) });
      logger.warn(
        { paymentId: payment?.id, reason: validation.reason },
        "Horizon poller: payment record failed security validation — skipping",
      );
      ledgerMonitorPaymentsChecked.inc({ result: "skipped" });
      return;
    }

    // Emit audit event for any anomalous field values and track per-type counts
    auditPaymentAnomaly(payment);
    recordAnomalyMetrics(payment);

    let match;
    try {
      match = await withLedgerMonitorRateLimit(
        () => findMatchingPayment({
          recipient: payment.recipient,
          amount: payment.amount,
          assetCode: payment.asset,
          assetIssuer: payment.asset_issuer,
          memo: payment.memo,
          memoType: payment.memo_type,
          createdAt: payment.created_at,
        }),
        { paymentId: payment.id, operation: "findMatchingPayment" },
      );
    } catch (horizonErr) {
      // Horizon errors during payment lookup are transient — log and skip.
      // The payment will be retried on the next poll cycle.
      logger.warn(
        { err: horizonErr, paymentId: payment.id },
        "Horizon poller: Horizon error during payment lookup — will retry next cycle",
      );
      ledgerMonitorPaymentsChecked.inc({ result: "skipped" });
      return;
    }

    // ── Signature verification (Issue #630) ──────────────────────────────
    if (match) {
      if (!(await verifyLedgerTransactionSignature(match.transaction_hash, payment.id))) {
        return;
      }
    }

    if (!match) {
      logger.info({ paymentId: payment.id }, "Horizon poller: no match yet");

      // Check for wrong-amount payment
      let anyPayment;
      try {
        anyPayment = await withLedgerMonitorRateLimit(
          () => findAnyRecentPayment({
            recipient: payment.recipient,
            assetCode: payment.asset,
            assetIssuer: payment.asset_issuer,
            createdAt: payment.created_at,
          }),
          { paymentId: payment.id, operation: "findAnyRecentPayment" },
        );
      } catch (horizonErr) {
        logger.warn(
          { err: horizonErr, paymentId: payment.id },
          "Horizon poller: Horizon error during wrong-amount check — skipping",
        );
        return;
      }

      if (anyPayment) {
        if (!(await verifyLedgerTransactionSignature(anyPayment.transaction_hash, payment.id))) {
          return;
        }

        const received = Number(anyPayment.received_amount);
        const expected = Number(payment.amount);
        const diff = received - expected;

        if (diff < -0.0000001) {
          // Underpayment — mark failed.
          // DI-01: add .is("tx_id", null) so the update is atomic — if another
          // poller cycle already claimed this payment the WHERE predicate fails
          // and `updated` is null, preventing a double-write.
          // DI-02: check the returned row before firing SSE/socket events so
          // notifications are not emitted when the row was already claimed.
          const { data: updated } = await retryTransientDbOperation(
            () => supabase.from("payments").update({
              status: "failed",
              tx_id: anyPayment.transaction_hash,
              metadata: sanitizePaymentMetadata({
                ...(payment.metadata || {}),
                failure_reason: "underpayment",
                expected_amount: expected,
                received_amount: received,
                shortfall: Number((expected - received).toFixed(7)),
              }),
            })
              .eq("id", payment.id)
              .eq("status", "pending")
              .is("tx_id", null)        // DI-01: atomic guard
              .select("id")
              .maybeSingle(),
            { paymentId: payment.id, operation: "markUnderpaymentFailed" },
          );

          if (!updated) {
            // Row was already claimed by another cycle — skip silently.
            logger.info(
              { paymentId: payment.id },
              "Horizon poller: underpayment — payment already processed, skipping",
            );
            return;
          }

          await safeInvalidatePaymentCache(payment.id);
          logger.info(
            { paymentId: payment.id, expected, received },
            "Horizon poller: underpayment detected — marked failed",
          );
          ledgerMonitorPaymentsChecked.inc({ result: "failed" });

          // DI-02: only notify after confirming the DB update succeeded.
          notifyPaymentEvent(payment, {
            sseEvent: "payment.failed",
            sseData: {
              status: "failed",
              reason: "underpayment",
              expected_amount: expected,
              received_amount: received,
            },
            socketEvent: "payment:failed",
            socketData: {
              id: payment.id,
              reason: "underpayment",
              expected_amount: expected,
              received_amount: received,
            },
          });
        } else if (diff > 0.0000001) {
          // Overpayment — confirm but flag
          const latencySeconds = (Date.now() - new Date(payment.created_at).getTime()) / 1000;
          const { data: updated } = await retryTransientDbOperation(
            () => supabase.from("payments").update({
              status: "confirmed",
              tx_id: anyPayment.transaction_hash,
              completion_duration_seconds: Math.floor(latencySeconds),
              metadata: sanitizePaymentMetadata({
                ...(payment.metadata || {}),
                overpayment: true,
                expected_amount: expected,
                received_amount: received,
                excess: Number((received - expected).toFixed(7)),
              }),
            }).eq("id", payment.id).eq("status", "pending").is("tx_id", null).select("id").maybeSingle(),
            { paymentId: payment.id, operation: "confirmOverpayment" },
          );

          if (!updated) return; // already claimed

          await safeInvalidatePaymentCache(payment.id);
          logger.info(
            { paymentId: payment.id, expected, received },
            "Horizon poller: overpayment — confirmed with flag",
          );
          ledgerMonitorPaymentsChecked.inc({ result: "confirmed" });
          notifyPaymentEvent(payment, {
            sseEvent: "payment.confirmed",
            sseData: {
              status: "confirmed",
              tx_id: anyPayment.transaction_hash,
              overpayment: true,
            },
            socketEvent: "payment:confirmed",
            socketData: {
              id: payment.id,
              tx_id: anyPayment.transaction_hash,
              overpayment: true,
            },
          });
        }
      }
      return;
    }

    // Guard: validate the transaction hash returned from Horizon before using it
    if (!isValidTransactionHash(match.transaction_hash)) {
      logger.warn(
        { paymentId: payment.id, txHash: match.transaction_hash },
        "Horizon poller: Horizon returned an invalid transaction hash — skipping",
      );
      ledgerMonitorPaymentsChecked.inc({ result: "skipped" });
      return;
    }

    // Guard: ensure this tx_hash hasn't already confirmed a different payment
    const { data: existing } = await supabase
      .from("payments")
      .select("id")
      .eq("tx_id", match.transaction_hash)
      .neq("id", payment.id)
      .maybeSingle();

    if (existing) {
      logger.warn(
        { paymentId: payment.id, txHash: match.transaction_hash },
        "Horizon poller: tx_hash already used by another payment — skipping",
      );
      return;
    }

    const createdAt = new Date(payment.created_at);
    const latencySeconds = (Date.now() - createdAt.getTime()) / 1000;

    // Atomic update: only succeeds if tx_id is still NULL (not claimed by another payment).
    // The unique index on tx_id provides the final database-level guarantee.
    const { data: updated, error: updateError } = await retryTransientDbOperation(
      () => supabase
        .from("payments")
        .update({
          status: "confirmed",
          tx_id: match.transaction_hash,
          completion_duration_seconds: Math.floor(latencySeconds),
        })
        .eq("id", payment.id)
        .eq("status", "pending")
        .is("tx_id", null)
        .select("id")
        .maybeSingle(),
      { paymentId: payment.id, operation: "confirmPayment" },
    );

    if (updateError) {
      // Unique constraint violation — another payment already claimed this tx
      if (updateError.code === "23505") {
        logger.warn(
          { paymentId: payment.id, txHash: match.transaction_hash },
          "Horizon poller: tx_hash already claimed by another payment (unique constraint)",
        );
        return;
      }
      logger.warn(
        { err: updateError, paymentId: payment.id },
        "Horizon poller: DB update failed",
      );
      return;
    }

    // If updated is null, the row was already confirmed or claimed — skip
    if (!updated) {
      logger.info(
        { paymentId: payment.id },
        "Horizon poller: payment already processed, skipping",
      );
      return;
    }

    // Invalidate Redis cache
    await safeInvalidatePaymentCache(payment.id);

    // Metrics
    paymentConfirmedCounter.inc({ asset: payment.asset });
    paymentConfirmationLatency.observe({ asset: payment.asset }, latencySeconds);

    logger.info(
      { paymentId: payment.id, txHash: match.transaction_hash },
      "Horizon poller: payment confirmed",
    );
    ledgerMonitorPaymentsChecked.inc({ result: "confirmed" });

    // SSE (customer checkout page) + Socket.io (merchant dashboard)
    notifyPaymentEvent(payment, {
      sseEvent: "payment.confirmed",
      sseData: {
        status: "confirmed",
        tx_id: match.transaction_hash,
      },
      socketEvent: "payment:confirmed",
      socketData: {
        id: payment.id,
        amount: payment.amount,
        asset: payment.asset,
        asset_issuer: payment.asset_issuer,
        recipient: payment.recipient,
        tx_id: match.transaction_hash,
        confirmed_at: new Date().toISOString(),
      },
    });

    // Webhook
    const merchant = await loadMerchantNotificationConfig(payment.merchant_id, merchantConfigCache);
    if (merchant) {
      const webhookPayload = getPayloadForVersion(
        merchant.webhook_version || "v1",
        "payment.confirmed",
        {
          payment_id: payment.id,
          amount: payment.amount,
          asset: payment.asset,
          asset_issuer: payment.asset_issuer,
          recipient: payment.recipient,
          tx_id: match.transaction_hash,
        }
      );

      if (payment.webhook_url && isEventSubscribed(merchant, "payment.confirmed")) {
        sendWebhook(
          payment.webhook_url,
          webhookPayload,
          merchant.webhook_secret,
          payment.id,
          merchant.webhook_custom_headers ?? {},
        ).catch(err =>
          logger.warn({ err, paymentId: payment.id }, "Horizon poller: webhook failed")
        );
      }

      // Receipt email
      const receiptTo = merchant.notification_email || merchant.email;
      if (receiptTo) {
        const html = renderReceiptEmail({
          payment: { ...payment, tx_id: match.transaction_hash },
          merchant,
        });
        sendReceiptEmail({
          to: receiptTo,
          subject: `Payment Receipt – ${payment.id}`,
          html,
        }).catch(err =>
          logger.warn({ err, paymentId: payment.id }, "Horizon poller: receipt email failed")
        );
      }
    }

  } catch (err) {
    // Non-fatal — log and continue with other payments
    logger.warn({ err, paymentId: payment.id }, "Horizon poller: error checking payment");
    ledgerMonitorPaymentsChecked.inc({ result: "skipped" });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Notify both the customer (SSE) and merchant dashboard (Socket.io) of a
 * payment status change. Consolidates the confirm/fail/overpayment emit
 * pattern that was previously duplicated at each call site.
 */
function notifyPaymentEvent(payment, { sseEvent, sseData, socketEvent, socketData }) {
  streamManager.notify(payment.id, sseEvent, sseData);
  if (_io && payment.merchant_id) {
    _io.to(`merchant:${payment.merchant_id}`).emit(socketEvent, socketData);
  }
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function withLedgerMonitorRateLimit(operation, context) {
  await _rateLimiter.waitForSlot();
  try {
    return await operation();
  } catch (err) {
    logger.warn(
      { err, ...context },
      "Horizon poller: rate-limited Horizon operation failed",
    );
    throw err;
  }
}

async function verifyLedgerTransactionSignature(txHash, paymentId) {
  let sigResult;
  try {
    sigResult = await withLedgerMonitorRateLimit(
      () => verifyTransactionSignature(txHash),
      { paymentId, txHash, operation: "verifyTransactionSignature" },
    );
  } catch (sigErr) {
    ledgerMonitorSignatureVerifications.inc({ result: "error" });
    logger.warn(
      { err: sigErr, paymentId, txHash },
      "Horizon poller: unexpected error during signature verification — skipping payment",
    );
    return false;
  }

  if (!sigResult?.valid) {
    ledgerMonitorSignatureVerifications.inc({ result: "failed" });
    logger.warn(
      {
        paymentId,
        txHash,
        reason: sigResult?.reason ?? "Signature verifier returned no result",
        isMultiSig: sigResult?.isMultiSig ?? false,
        signatureCount: sigResult?.signatureCount ?? 0,
        thresholdMet: sigResult?.thresholdMet ?? false,
      },
      "Horizon poller: signature verification failed — skipping payment",
    );
    return false;
  }

  ledgerMonitorSignatureVerifications.inc({ result: "passed" });
  logger.debug(
    {
      paymentId,
      txHash,
      isMultiSig: sigResult.isMultiSig,
      signatureCount: sigResult.signatureCount,
      isFeeBump: sigResult.isFeeBump ?? false,
    },
    "Horizon poller: signature verification passed",
  );
  return true;
}

async function fetchPendingPayments(cutoff) {
  return supabase
    .from("payments")
    .select("id, amount, asset, asset_issuer, recipient, memo, memo_type, webhook_url, created_at, merchant_id, metadata")
    .eq("status", "pending")
    .is("deleted_at", null)
    .is("tx_id", null)
    .gte("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(BATCH_SIZE);
}

async function retryTransientDbOperation(operation, context) {
  let lastResult;
  for (let attempt = 0; attempt <= TRANSIENT_DB_RETRY_ATTEMPTS; attempt += 1) {
    lastResult = await operation();
    if (!isTransientDbError(lastResult?.error)) {
      return lastResult;
    }

    const delayMs = 100 * 2 ** attempt;
    logger.warn(
      { err: lastResult.error, attempt: attempt + 1, delayMs, ...context },
      "Horizon poller: transient DB operation failed — retrying",
    );
    await sleep(delayMs);
  }
  return lastResult;
}

function isTransientDbError(error) {
  if (!error) return false;
  const code = String(error.code || "");
  const message = String(error.message || "").toLowerCase();
  return (
    code.startsWith("08") ||
    code === "40001" ||
    code === "40P01" ||
    message.includes("timeout") ||
    message.includes("temporarily unavailable") ||
    message.includes("connection")
  );
}

async function safeInvalidatePaymentCache(paymentId) {
  try {
    const redis = await connectRedisClient();
    await invalidatePaymentCache(redis, paymentId);
  } catch (err) {
    logger.warn(
      { err, paymentId },
      "Horizon poller: cache invalidation failed — continuing notifications",
    );
  }
}

/**
 * Pre-load merchant notification configs for an entire pending batch in one
 * `IN (...)` query, seeding the per-cycle cache. This collapses the previous
 * N+1 access pattern (one `merchants` lookup per confirmed payment) into a
 * single round-trip and removes the cross-group race on first lookup.
 *
 * Fully defensive: any failure returns an empty cache, so callers transparently
 * fall back to per-payment lookups via {@link loadMerchantNotificationConfig}.
 *
 * @param {Array<{ merchant_id?: string }>} payments
 * @returns {Promise<Map<string, object|null>>}
 */
async function preloadMerchantConfigs(payments) {
  const cache = new Map();
  try {
    const merchantIds = [
      ...new Set((payments ?? []).map((p) => p.merchant_id).filter(Boolean)),
    ];
    if (merchantIds.length === 0) return cache;

    const cached = [];
    const toFetch = [];
    for (const id of merchantIds) {
      const entry = merchantConfigCache.get(id);
      if (entry) {
        cached.push({ id, entry });
      } else {
        toFetch.push(id);
      }
    }

    for (const { id, entry } of cached) {
      cache.set(id, entry);
    }

    if (toFetch.length > 0) {
      const { data, error } = await supabase
        .from("merchants")
        .select(`id, ${MERCHANT_NOTIFICATION_FIELDS}`)
        .in("id", toFetch);

      if (error) {
        logger.warn(
          { err: error, merchantCount: toFetch.length },
          "Horizon poller: batch merchant preload failed — falling back to per-payment lookups",
        );
        return cache;
      }

      for (const merchant of data ?? []) {
        merchantConfigCache.set(merchant.id, merchant);
        cache.set(merchant.id, merchant);
      }
      // DI-06: store MERCHANT_NOT_FOUND (not null) for IDs that were queried
      // but absent from the result set.  null in a Map means "was fetched
      // successfully and doesn't exist"; undefined means "not yet fetched".
      // Using a distinct sentinel prevents a transient DB error from
      // permanently poisoning the cache with a null that looks like a real miss.
      for (const id of toFetch) {
        if (!cache.has(id)) {
          merchantConfigCache.set(id, MERCHANT_NOT_FOUND);
          cache.set(id, MERCHANT_NOT_FOUND);
        }
      }
    }
  } catch (err) {
    logger.warn(
      { err },
      "Horizon poller: batch merchant preload errored — falling back to per-payment lookups",
    );
    merchantConfigCache.invalidate(null);
    return new Map();
  }
  return cache;
}

async function loadMerchantNotificationConfig(merchantId, cache = new Map()) {
  if (!merchantId) {
    return null;
  }

  if (cache.has(merchantId)) {
    const cached = cache.get(merchantId);
    // DI-06: MERCHANT_NOT_FOUND means we already looked this merchant up and
    // it doesn't exist — return null without hitting the DB again.
    return cached === MERCHANT_NOT_FOUND ? null : cached;
  }

  const merchant = merchantConfigCache.get(merchantId);
  if (merchant !== null && merchant !== undefined) {
    // DI-06: translate the sentinel back to null for callers.
    const resolved = merchant === MERCHANT_NOT_FOUND ? null : merchant;
    cache.set(merchantId, resolved);
    return resolved;
  }

  const { data, error } = await supabase
    .from("merchants")
    .select(MERCHANT_NOTIFICATION_FIELDS)
    .eq("id", merchantId)
    .maybeSingle();

  if (error) {
    logger.warn(
      { err: error, merchantId },
      "Horizon poller: failed to load merchant notification config",
    );
    // DI-06: store MERCHANT_NOT_FOUND so a DB error on one lookup doesn't
    // permanently null-fill the cache entry for the rest of this cycle.
    cache.set(merchantId, null);
    merchantConfigCache.set(merchantId, MERCHANT_NOT_FOUND);
    return null;
  }

  const result = data ?? null;
  // DI-06: store MERCHANT_NOT_FOUND in the module-level LRU cache when the
  // merchant genuinely doesn't exist, so subsequent lookups are fast and the
  // absence is explicit rather than ambiguous.
  cache.set(merchantId, result);
  merchantConfigCache.set(merchantId, result === null ? MERCHANT_NOT_FOUND : result);
  return result;
}

/**
 * Derive a short, label-safe tag from a validation failure reason string.
 * Keeps Prometheus label cardinality bounded to a fixed set.
 */
function deriveValidationReasonTag(reason) {
  if (!reason) return "unknown";
  const r = reason.toLowerCase();
  if (r.includes("recipient")) return "bad_recipient";
  if (r.includes("amount")) return "bad_amount";
  if (r.includes("issuer")) return "bad_issuer";
  if (r.includes("asset")) return "bad_asset";
  if (r.includes("memo")) return "bad_memo";
  if (r.includes("future") || r.includes("created_at")) return "bad_date";
  if (r.includes("id")) return "missing_id";
  return "other";
}

/**
 * Emit per-type anomaly metrics for a payment record.
 * Mirrors the anomaly detection logic in auditPaymentAnomaly without
 * duplicating the logger.warn calls — only the metric increments live here.
 *
 * DI-03: uses the exported METADATA_ALLOWLIST from ledger-monitor-security.js
 * so both codepaths always reference the same set of allowed keys.
 * DI-05: uses the exported STALE_PAYMENT_HOURS constant so the anomaly
 * threshold stays in sync with the one used by auditPaymentAnomaly.
 */
function recordAnomalyMetrics(payment) {
  const amount = Number(payment.amount);
  if (amount > 100_000) {
    ledgerMonitorAnomaliesDetected.inc({ type: "large_amount" });
  }
  if (typeof payment.memo === "string") {
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(payment.memo)) {
      ledgerMonitorAnomaliesDetected.inc({ type: "memo_control_chars" });
    }
    if (payment.memo.includes("'") || payment.memo.includes('"') || payment.memo.includes("--")) {
      ledgerMonitorAnomaliesDetected.inc({ type: "memo_sql_chars" });
    }
  }
  if (payment.created_at) {
    const ageHours = (Date.now() - Date.parse(payment.created_at)) / 3_600_000;
    if (ageHours > STALE_PAYMENT_HOURS) {
      ledgerMonitorAnomaliesDetected.inc({ type: "stale_payment" });
    }
  }
  if (payment.metadata && typeof payment.metadata === "object") {
    const unknownKeys = Object.keys(payment.metadata).filter((k) => !METADATA_ALLOWLIST.has(k));
    if (unknownKeys.length > 0) {
      ledgerMonitorAnomaliesDetected.inc({ type: "metadata_unknown_keys" });
    }
  }
}
