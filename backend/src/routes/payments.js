import 'dotenv/config';
import express from "express";
import { randomUUID } from "node:crypto";
import { supabase } from "../lib/supabase.js";
import { findMatchingPayment } from "../lib/stellar.js";
import { sendWebhook } from "../lib/webhooks.js";
import rateLimit from "express-rate-limit";
import { validateUuidParam } from "../lib/validate-uuid.js";
import { paymentZodSchema } from "../lib/request-schemas.js";

const router = express.Router();

const verifyPaymentRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: "Too many verification requests, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * @swagger
 * /api/create-payment:
 *   post:
 *     summary: Create a new payment request
 *     tags: [Payments]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [amount, asset, recipient]
 *             properties:
 *               amount:
 *                 type: number
 *                 description: Payment amount (must be positive)
 *               asset:
 *                 type: string
 *                 description: Asset code (e.g. XLM, USDC)
 *               asset_issuer:
 *                 type: string
 *                 description: Asset issuer (required for non-native assets)
 *               recipient:
 *                 type: string
 *                 description: Stellar address of the recipient
 *               merchant_id:
 *                 type: string
 *               description:
 *                 type: string
 *               memo:
 *                 type: string
 *               memo_type:
 *                 type: string
 *                 enum: [text, id, hash, return]
 *               webhook_url:
 *                 type: string
 *     responses:
 *       201:
 *         description: Payment created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 payment_id:
 *                   type: string
 *                 payment_link:
 *                   type: string
 *                 status:
 *                   type: string
 *       400:
 *         description: Validation error
 */
router.post("/create-payment", async (req, res, next) => {
  try {
    const body = paymentZodSchema.parse(req.body || {});

    const paymentId = randomUUID();
    const now = new Date().toISOString();
    const paymentLinkBase = process.env.PAYMENT_LINK_BASE || "http://localhost:3000";
    const paymentLink = `${paymentLinkBase}/pay/${paymentId}`;

    const payload = {
      id: paymentId,
      merchant_id: req.merchant.id,
      amount: body.amount,
      asset: body.asset,
      asset_issuer: body.asset_issuer || null,
      recipient: body.recipient,
      description: body.description || null,
      memo: body.memo || null,
      memo_type: body.memo_type || null,
      webhook_url: body.webhook_url || null,
      status: "pending",
      tx_id: null,
      metadata: body.metadata || null,
      created_at: now
    };

    const { error: insertError } = await supabase
      .from("payments")
      .insert(payload);

    if (insertError) {
      insertError.status = 500;
      throw insertError;
    }

    res.status(201).json({
      payment_id: paymentId,
      payment_link: paymentLink,
      status: "pending"
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/payment-status/{id}:
 *   get:
 *     summary: Get the status of a payment
 *     tags: [Payments]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Payment ID
 *     responses:
 *       200:
 *         description: Payment details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 payment:
 *                   type: object
 *       404:
 *         description: Payment not found
 */
router.get("/payment-status/:id", validateUuidParam(), async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("payments")
      .select(
        "id, amount, asset, asset_issuer, recipient, description, memo, memo_type, status, tx_id, metadata, created_at"
      )
      .eq("id", req.params.id)
      .maybeSingle();

    if (error) {
      error.status = 500;
      throw error;
    }

    if (!data) {
      return res.status(404).json({ error: "Payment not found" });
    }

    res.json({ payment: data });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/verify-payment/{id}:
 *   post:
 *     summary: Verify a payment on the Stellar network
 *     tags: [Payments]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Payment ID
 *     responses:
 *       200:
 *         description: Verification result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   enum: [pending, confirmed]
 *                 tx_id:
 *                   type: string
 *                 webhook:
 *                   type: object
 *       404:
 *         description: Payment not found
 */
router.post("/verify-payment/:id", verifyPaymentRateLimit, validateUuidParam(), async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("payments")
      .select(
        "id, amount, asset, asset_issuer, recipient, status, tx_id, memo, memo_type, webhook_url, merchants(webhook_secret)"
      )
      .eq("id", req.params.id)
      .maybeSingle();

    if (error) {
      error.status = 500;
      throw error;
    }

    if (!data) {
      return res.status(404).json({ error: "Payment not found" });
    }

    if (data.status === "confirmed") {
      return res.json({ 
        status: "confirmed", 
        tx_id: data.tx_id,
        ledger_url: `https://stellar.expert/explorer/testnet/tx/${data.tx_id}`
      });
    }

    const match = await findMatchingPayment({
      recipient: data.recipient,
      amount: data.amount,
      assetCode: data.asset,
      assetIssuer: data.asset_issuer,
      memo: data.memo,
      memoType: data.memo_type
    });

    if (!match) {
      return res.json({ status: "pending" });
    }

    const { error: updateError } = await supabase
      .from("payments")
      .update({ status: "confirmed", tx_id: match.transaction_hash })
      .eq("id", data.id);

    if (updateError) {
      updateError.status = 500;
      throw updateError;
    }

    const merchantSecret = data.merchants?.webhook_secret;

    const webhookResult = await sendWebhook(data.webhook_url, {
      event: "payment.confirmed",
      payment_id: data.id,
      amount: data.amount,
      asset: data.asset,
      asset_issuer: data.asset_issuer,
      recipient: data.recipient,
      tx_id: match.transaction_hash
    }, merchantSecret);

    if (!webhookResult.ok && !webhookResult.skipped) {
      console.warn("Webhook failed", webhookResult);
    }

    res.json({
      status: "confirmed",
      tx_id: match.transaction_hash,
      ledger_url: `https://stellar.expert/explorer/testnet/tx/${match.transaction_hash}`,
      webhook: webhookResult
    });
  } catch (err) {
    next(err);
  }
});

export default router;
