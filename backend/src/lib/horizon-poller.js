/**
 * Background Horizon Poller
 *
 * Periodically fetches all pending payments from the DB and checks Horizon
 * for matching transactions. When found, updates status to "confirmed" and
 * fires webhooks/SSE/email — exactly the same logic as the verify-payment route.
 *
 * This ensures payments confirm automatically even if the customer closes the
 * browser before the frontend calls /api/verify-payment/:id.
 */

import { supabase } from "./supabase.js";
import { findMatchingPayment, findAnyRecentPayment } from "./stellar.js";
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
} from "./metrics.js";

const POLL_INTERVAL_MS = 15_000; // 15 seconds
const BATCH_SIZE = 50;           // max pending payments per cycle
const MAX_AGE_HOURS = 24;        // ignore payments older than 24h (likely abandoned)

let _io = null;
let _timer = null;
let _running = false;

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

async function pollPendingPayments() {
  if (_running) return; // skip if previous cycle still running
  _running = true;

  try {
    const cutoff = new Date(Date.now() - MAX_AGE_HOURS * 60 * 60 * 1000).toISOString();

    const { data: pending, error } = await supabase
      .from("payments")
      .select("id, amount, asset, asset_issuer, recipient, memo, memo_type, webhook_url, created_at, merchant_id, merchants(webhook_secret, webhook_version, notification_email, email, business_name, webhook_custom_headers)")
      .eq("status", "pending")
      .is("deleted_at", null)
      .gte("created_at", cutoff)
      .limit(BATCH_SIZE);

    if (error) {
      logger.warn({ err: error }, "Horizon poller: failed to fetch pending payments");
      return;
    }

    if (!pending || pending.length === 0) return;

    logger.info({ count: pending.length }, "Horizon poller: checking pending payments");

    // Group by recipient+asset to process same-address payments sequentially
    // This prevents two payments with identical recipient+amount from both
    // claiming the same on-chain transaction in the same cycle.
    const groups = new Map();
    for (const p of pending) {
      const key = `${p.recipient}:${p.asset}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    }

    // Process each group sequentially, different groups in parallel
    await Promise.allSettled(
      Array.from(groups.values()).map(async (group) => {
        for (const p of group) {
          await checkPayment(p);
        }
      })
    );

  } catch (err) {
    logger.warn({ err }, "Horizon poller: unexpected error");
  } finally {
    _running = false;
  }
}

async function checkPayment(payment) {
  try {
    // Guard: skip if essential fields are missing
    if (!payment.asset || !payment.recipient) {
      logger.warn({ paymentId: payment.id }, "Horizon poller: skipping payment with missing asset or recipient");
      return;
    }

    const match = await findMatchingPayment({
      recipient: payment.recipient,
      amount: payment.amount,
      assetCode: payment.asset,
      assetIssuer: payment.asset_issuer,
      memo: payment.memo,
      memoType: payment.memo_type,
      createdAt: payment.created_at,
    });

    if (!match) {
      logger.info({ paymentId: payment.id }, "Horizon poller: no match yet");

      // Check for wrong-amount payment
      const anyPayment = await findAnyRecentPayment({
        recipient: payment.recipient,
        assetCode: payment.asset,
        assetIssuer: payment.asset_issuer,
        createdAt: payment.created_at,
      });

      if (anyPayment) {
        const received = Number(anyPayment.received_amount);
        const expected = Number(payment.amount);
        const diff = received - expected;

        if (diff < -0.0000001) {
          // Underpayment — mark failed
          await supabase.from("payments").update({
            status: "failed",
            tx_id: anyPayment.transaction_hash,
            metadata: {
              ...(payment.metadata || {}),
              failure_reason: "underpayment",
              expected_amount: expected,
              received_amount: received,
              shortfall: Number((expected - received).toFixed(7)),
            },
          }).eq("id", payment.id).eq("status", "pending");

          const redis = await connectRedisClient();
          await invalidatePaymentCache(redis, payment.id);
          logger.info({ paymentId: payment.id, expected, received }, "Horizon poller: underpayment detected — marked failed");

          // Notify via SSE and Socket.io
          streamManager.notify(payment.id, "payment.failed", { status: "failed", reason: "underpayment", expected_amount: expected, received_amount: received });
          if (_io && payment.merchant_id) {
            _io.to(`merchant:${payment.merchant_id}`).emit("payment:failed", { id: payment.id, reason: "underpayment", expected_amount: expected, received_amount: received });
          }
        } else if (diff > 0.0000001) {
          // Overpayment — confirm but flag
          const latencySeconds = (Date.now() - new Date(payment.created_at).getTime()) / 1000;
          const { data: updated } = await supabase.from("payments").update({
            status: "confirmed",
            tx_id: anyPayment.transaction_hash,
            completion_duration_seconds: Math.floor(latencySeconds),
            metadata: { ...(payment.metadata || {}), overpayment: true, expected_amount: expected, received_amount: received, excess: Number((received - expected).toFixed(7)) },
          }).eq("id", payment.id).eq("status", "pending").is("tx_id", null).select("id").maybeSingle();

          if (!updated) return; // already claimed

          const redis = await connectRedisClient();
          await invalidatePaymentCache(redis, payment.id);
          logger.info({ paymentId: payment.id, expected, received }, "Horizon poller: overpayment — confirmed with flag");
          streamManager.notify(payment.id, "payment.confirmed", { status: "confirmed", tx_id: anyPayment.transaction_hash, overpayment: true });
          if (_io && payment.merchant_id) {
            _io.to(`merchant:${payment.merchant_id}`).emit("payment:confirmed", { id: payment.id, tx_id: anyPayment.transaction_hash, overpayment: true });
          }
        }
      }
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
      logger.warn({ paymentId: payment.id, txHash: match.transaction_hash }, "Horizon poller: tx_hash already used by another payment — skipping");
      return;
    }

    const createdAt = new Date(payment.created_at);
    const latencySeconds = (Date.now() - createdAt.getTime()) / 1000;

    // Atomic update: only succeeds if tx_id is still NULL (not claimed by another payment).
    // The unique index on tx_id provides the final database-level guarantee.
    const { data: updated, error: updateError } = await supabase
      .from("payments")
      .update({
        status: "confirmed",
        tx_id: match.transaction_hash,
        completion_duration_seconds: Math.floor(latencySeconds),
      })
      .eq("id", payment.id)
      .eq("status", "pending")
      .is("tx_id", null)   // ← only claim if not already taken
      .select("id")
      .maybeSingle();

    if (updateError) {
      // Unique constraint violation — another payment already claimed this tx
      if (updateError.code === "23505") {
        logger.warn({ paymentId: payment.id, txHash: match.transaction_hash }, "Horizon poller: tx_hash already claimed by another payment (unique constraint)");
        return;
      }
      logger.warn({ err: updateError, paymentId: payment.id }, "Horizon poller: DB update failed");
      return;
    }

    // If updated is null, the row was already confirmed or claimed — skip
    if (!updated) {
      logger.info({ paymentId: payment.id }, "Horizon poller: payment already processed, skipping");
      return;
    }

    // Invalidate Redis cache
    const redis = await connectRedisClient();
    await invalidatePaymentCache(redis, payment.id);

    // Metrics
    paymentConfirmedCounter.inc({ asset: payment.asset });
    paymentConfirmationLatency.observe({ asset: payment.asset }, latencySeconds);

    logger.info({ paymentId: payment.id, txHash: match.transaction_hash }, "Horizon poller: payment confirmed");

    // SSE → customer checkout page
    streamManager.notify(payment.id, "payment.confirmed", {
      status: "confirmed",
      tx_id: match.transaction_hash,
    });

    // Socket.io → merchant dashboard
    if (_io && payment.merchant_id) {
      _io.to(`merchant:${payment.merchant_id}`).emit("payment:confirmed", {
        id: payment.id,
        amount: payment.amount,
        asset: payment.asset,
        asset_issuer: payment.asset_issuer,
        recipient: payment.recipient,
        tx_id: match.transaction_hash,
        confirmed_at: new Date().toISOString(),
      });
    }

    // Webhook
    const merchant = payment.merchants;
    if (merchant) {
      const webhookPayload = getPayloadForVersion(
        merchant.webhook_version || "v1",
        "payment.confirmed",
        { payment_id: payment.id, amount: payment.amount, asset: payment.asset, asset_issuer: payment.asset_issuer, recipient: payment.recipient, tx_id: match.transaction_hash }
      );

      if (payment.webhook_url && isEventSubscribed(merchant, "payment.confirmed")) {
        sendWebhook(payment.webhook_url, webhookPayload, merchant.webhook_secret, payment.id, merchant.webhook_custom_headers ?? {})
          .catch(err => logger.warn({ err, paymentId: payment.id }, "Horizon poller: webhook failed"));
      }

      // Receipt email
      const receiptTo = merchant.notification_email || merchant.email;
      if (receiptTo) {
        const html = renderReceiptEmail({ payment: { ...payment, tx_id: match.transaction_hash }, merchant });
        sendReceiptEmail({ to: receiptTo, subject: `Payment Receipt – ${payment.id}`, html })
          .catch(err => logger.warn({ err, paymentId: payment.id }, "Horizon poller: receipt email failed"));
      }
    }

  } catch (err) {
    // Non-fatal — log and continue with other payments
    logger.warn({ err, paymentId: payment.id }, "Horizon poller: error checking payment");
  }
}
