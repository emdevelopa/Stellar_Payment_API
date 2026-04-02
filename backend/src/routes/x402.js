/**
 * POST /api/verify-x402
 *
 * Verifies a Stellar USDC payment for x402 access.
 * Returns a short-lived JWT if the payment is valid.
 */

import express from "express";
import { createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import * as StellarSdk from "stellar-sdk";
import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";

const router = express.Router();

const HORIZON_URL = process.env.STELLAR_HORIZON_URL || "https://horizon-testnet.stellar.org";
const USDC_ISSUER = process.env.USDC_ISSUER || "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const TOKEN_EXPIRY = parseInt(process.env.X402_TOKEN_EXPIRY_SECONDS || "60", 10);

const server = new StellarSdk.Horizon.Server(HORIZON_URL);

/**
 * @swagger
 * /api/verify-x402:
 *   post:
 *     summary: Verify a Stellar USDC payment for x402 access
 *     tags: [x402]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [tx_hash, expected_amount, expected_recipient, memo]
 *             properties:
 *               tx_hash:
 *                 type: string
 *               expected_amount:
 *                 type: string
 *               expected_recipient:
 *                 type: string
 *               memo:
 *                 type: string
 *     responses:
 *       200:
 *         description: Payment verified — access token returned
 *       400:
 *         description: Payment verification failed
 *       409:
 *         description: Transaction already used (replay attack)
 */
router.post("/verify-x402", async (req, res, next) => {
  try {
    const { tx_hash, expected_amount, expected_recipient, memo } = req.body;

    if (!tx_hash || !expected_amount || !expected_recipient || !memo) {
      return res.status(400).json({
        error: "Missing required fields: tx_hash, expected_amount, expected_recipient, memo",
      });
    }

    const jwtSecret = process.env.X402_JWT_SECRET;
    if (!jwtSecret) {
      return res.status(500).json({ error: "x402 not configured on this server" });
    }

    // 1. Replay attack check — has this tx_hash been used before?
    const { data: existing } = await supabase
      .from("x402_payments")
      .select("id")
      .eq("tx_hash", tx_hash)
      .maybeSingle();

    if (existing) {
      return res.status(409).json({
        error: "Transaction already used. Each payment can only be used once.",
        tx_hash,
      });
    }

    // 2. Fetch transaction from Horizon
    let transaction;
    try {
      transaction = await server.transactions().transaction(tx_hash).call();
    } catch (err) {
      return res.status(400).json({
        error: "Transaction not found on Stellar network",
        tx_hash,
        detail: err.message,
      });
    }

    // 3. Verify memo matches
    const txMemo = transaction.memo ?? "";
    if (txMemo !== memo) {
      return res.status(400).json({
        error: "Memo mismatch",
        expected: memo,
        received: txMemo,
      });
    }

    // 4. Fetch payment operations for this transaction
    const ops = await server.operations().forTransaction(tx_hash).call();
    const paymentOps = ops.records.filter(
      (op) => op.type === "payment" || op.type === "path_payment_strict_receive"
    );

    if (paymentOps.length === 0) {
      return res.status(400).json({ error: "No payment operations found in transaction" });
    }

    // 5. Find a matching USDC payment to the expected recipient
    const matchingOp = paymentOps.find((op) => {
      const isUSDC =
        op.asset_code === "USDC" && op.asset_issuer === USDC_ISSUER;
      const toRecipient = op.to === expected_recipient;
      const amountOk =
        Math.abs(Number(op.amount) - Number(expected_amount)) <= 0.0000001;
      return isUSDC && toRecipient && amountOk;
    });

    if (!matchingOp) {
      return res.status(400).json({
        error: "Payment verification failed",
        detail: `No USDC payment of ${expected_amount} to ${expected_recipient} found in transaction`,
        tx_hash,
      });
    }

    // 6. All checks passed — issue access token
    const tokenPayload = {
      tx_hash,
      amount: expected_amount,
      recipient: expected_recipient,
      memo,
      iat: Math.floor(Date.now() / 1000),
    };

    const accessToken = jwt.sign(tokenPayload, jwtSecret, {
      expiresIn: TOKEN_EXPIRY,
    });

    const tokenHash = createHash("sha256").update(accessToken).digest("hex");

    // 7. Store in DB to prevent replay
    await supabase.from("x402_payments").insert({
      tx_hash,
      amount: Number(expected_amount),
      recipient: expected_recipient,
      memo,
      access_token_hash: tokenHash,
      verified_at: new Date().toISOString(),
    });

    logger.info({ tx_hash, amount: expected_amount, recipient: expected_recipient }, "x402 payment verified");

    return res.json({
      verified: true,
      access_token: accessToken,
      expires_in: TOKEN_EXPIRY,
      tx_hash,
      amount: expected_amount,
      asset: "USDC",
    });
  } catch (err) {
    next(err);
  }
});

export default router;
