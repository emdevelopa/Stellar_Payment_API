import express from "express";
import { Horizon } from "stellar-sdk";
import { supabase } from "../lib/supabase.js";
import { validateUuidParam } from "../lib/validate-uuid.js";

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
// Returns null (non-throwing) when:
//   • tx_id is falsy
//   • Horizon 404s (tx not yet propagated)
//   • any transient network error
// The payment record is always returned regardless.

async function fetchStellarMeta(txId) {
  if (!txId) return null;

  try {
    const tx = await horizonServer.transactions().transaction(txId).call();
    return {
      tx_hash: tx.hash,
      ledger: tx.ledger, // integer ledger sequence number
      timestamp: tx.created_at, // ISO-8601 string from Horizon
    };
  } catch (err) {
    // 404 = tx not visible on Horizon yet — silent
    // anything else is unexpected but non-fatal
    if (err?.response?.status !== 404) {
      console.warn("[stellar] tx fetch failed", { txId, err: err.message });
    }
    return null;
  }
}

// ─── Router ───────────────────────────────────────────────────────────────────

const router = express.Router();

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
    const { data, error } = await supabase
      .from("payments")
      .select(
        "id, amount, asset, asset_issuer, recipient, description, memo, memo_type, status, tx_id, metadata, created_at, merchants(branding_config)"
      )
      .eq("id", req.params.id)
      .eq("merchant_id", req.merchant.id)
      .is("deleted_at", null)
      .maybeSingle();

    if (error) {
      error.status = 500;
      throw error;
    }

    if (!data) {
      return res.status(404).json({ error: "Payment not found" });
    }

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

    return res.json({
      payment,
      stellar_tx: stellarTx,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
