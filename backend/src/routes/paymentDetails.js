import express from "express";
import { Horizon } from "stellar-sdk";
import { supabase } from "../lib/supabase.js";
import { validateUuidParam } from "../lib/validate-uuid.js";
import { fetchTxMetaWithRecovery } from "../lib/payment-details-recovery.js";
import { readThroughPaymentDetails } from "../lib/payment-details-cache.js";
import { createRouteThroughputTelemetry } from "../lib/route-throughput-telemetry.js";
import {
  paymentDetailsRequestsTotal,
  paymentDetailsRequestDurationSeconds,
  paymentDetailsInFlight,
} from "../lib/payment-details-metrics.js";

// ─── Horizon client ───────────────────────────────────────────────────────────
// Mirrors the network selection used elsewhere in the project.
// Set STELLAR_HORIZON_URL to override, or STELLAR_NETWORK=public for mainnet.

const HORIZON_URL =
  (process.env.STELLAR_HORIZON_URL || "").trim() ||
  (process.env.STELLAR_NETWORK === "public"
    ? "https://horizon.stellar.org"
    : "https://horizon-testnet.stellar.org");

const horizonServer = new Horizon.Server(HORIZON_URL);

// ─── Helper: fetch tx metadata from Horizon ───────────────────────────────────
// Never throws; resolves to null when the metadata is unavailable:
//   • tx_id is falsy or not a 64-hex transaction hash
//   • Horizon 404s (tx not yet propagated)
//   • a non-retryable Horizon error
// Transient Horizon failures (network errors, 408, 429, 5xx) are retried with
// backoff, and if they still fail the lookup is dead-lettered and recovered in
// the background (#1776), so a later request is served from the recovery cache.
// The payment record is always returned regardless.

async function loadTxMeta(txId) {
  const tx = await horizonServer.transactions().transaction(txId).call();
  return {
    tx_hash: tx.hash,
    ledger: tx.ledger, // integer ledger sequence number
    timestamp: tx.created_at, // ISO-8601 string from Horizon
  };
}

async function fetchStellarMeta(txId) {
  if (!txId) return null;
  return fetchTxMetaWithRecovery(txId, { fetchTx: loadTxMeta });
}

// ─── Router ───────────────────────────────────────────────────────────────────

/**
 * Load the response body for one payment, or null when it does not exist for
 * this merchant. The merchant filter is part of the query, and cache keys are
 * scoped by the same merchant id, so a cache hit never widens access.
 */
async function loadPaymentDetails(paymentId, merchantId) {
  const { data, error } = await supabase
    .from("payments")
    .select(
      "id, amount, asset, asset_issuer, recipient, description, memo, memo_type, status, tx_id, metadata, created_at, merchants(branding_config)"
    )
    .eq("id", paymentId)
    .eq("merchant_id", merchantId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    error.status = 500;
    throw error;
  }

  if (!data) return null;

  // Resolve branding the same way payment-status does
  const metadataBranding = data.metadata?.branding_config || null;
  const merchantBranding = data.merchants?.branding_config || null;
  const brandingConfig = metadataBranding || merchantBranding || null;

  const payment = { ...data, branding_config: brandingConfig };
  delete payment.merchants;

  // Only fetch from Horizon when the payment is completed and has a tx hash.
  // "confirmed" is intentionally excluded — the tx exists on-chain but Horizon
  // may not have it fully indexed yet, so the fetch would likely 404.
  const stellarTx =
    data.status === "completed" ? await fetchStellarMeta(data.tx_id) : null;

  return { payment, stellar_tx: stellarTx };
}

const router = express.Router();

// Throughput telemetry (#1775): count, latency and in-flight by route pattern.
router.use(
  createRouteThroughputTelemetry({
    router,
    requests: paymentDetailsRequestsTotal,
    duration: paymentDetailsRequestDurationSeconds,
    inFlight: paymentDetailsInFlight,
  }),
);

/**
 * @swagger
 * /api/payments/{id}:
 *   get:
 *     summary: Get detailed payment intent
 *     description: >
 *       Returns the full payment record for the authenticated merchant.
 *       When status is "completed", a `stellar_tx` block is also included
 *       containing the on-chain tx_hash, ledger sequence, and timestamp
 *       sourced directly from Horizon.
 *       Responses are cached in Redis per merchant (#1775): terminal payments
 *       for up to 5 minutes, in-progress payments for about 2 seconds, and
 *       every payment write invalidates the entry. Responses carry
 *       `Cache-Control: private, no-store` and `X-Cache: HIT | MISS | BYPASS`.
 *     tags: [Payments]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Payment intent UUID
 *     responses:
 *       200:
 *         description: Payment detail
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 payment:
 *                   type: object
 *                   properties:
 *                     id:             { type: string }
 *                     amount:         { type: number }
 *                     asset:          { type: string }
 *                     asset_issuer:   { type: string, nullable: true }
 *                     recipient:      { type: string }
 *                     description:    { type: string, nullable: true }
 *                     memo:           { type: string, nullable: true }
 *                     memo_type:      { type: string, nullable: true }
 *                     status:         { type: string, enum: [pending, confirmed, completed, failed] }
 *                     tx_id:          { type: string, nullable: true }
 *                     created_at:     { type: string, format: date-time }
 *                     branding_config: { type: object, nullable: true }
 *                 stellar_tx:
 *                   nullable: true
 *                   type: object
 *                   description: >
 *                     Present only when status is "completed" and Horizon
 *                     returns the transaction. null otherwise.
 *                   properties:
 *                     tx_hash:   { type: string }
 *                     ledger:    { type: integer }
 *                     timestamp: { type: string, format: date-time }
 *       401:
 *         description: Unauthorised — invalid or missing API key
 *       404:
 *         description: Payment not found
 *       500:
 *         description: Internal server error
 */
router.get("/:id", validateUuidParam(), async (req, res, next) => {
  try {
    const merchantId = req.merchant.id;
    const paymentId = req.params.id;

    // Redis read-through cache (#1775); see lib/payment-details-cache.js.
    const { value, cache } = await readThroughPaymentDetails(
      merchantId,
      paymentId,
      () => loadPaymentDetails(paymentId, merchantId),
    );

    // Per-merchant data: shared caches (CDN/proxy) must never store it.
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Cache", cache.toUpperCase());

    if (!value) {
      return res.status(404).json({ error: "Payment not found" });
    }

    return res.json(value);
  } catch (err) {
    next(err);
  }
});

export default router;
