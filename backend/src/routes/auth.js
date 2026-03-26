/**
 * SEP-0010 Authentication Routes
 * Issue #148: Stellar Web Authentication Support
 */

import express from "express";
import { supabase } from "../lib/supabase.js";
import {
  generateChallenge,
  verifyChallenge,
  generateSessionToken,
} from "../lib/sep10-auth.js";

const router = express.Router();

/**
 * @swagger
 * /api/auth/challenge:
 *   post:
 *     summary: Generate a SEP-0010 challenge transaction
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [account]
 *             properties:
 *               account:
 *                 type: string
 *                 description: Stellar public key (G...)
 *     responses:
 *       200:
 *         description: Challenge transaction
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 transaction:
 *                   type: string
 *                   description: Base64-encoded challenge XDR
 *                 network_passphrase:
 *                   type: string
 *       400:
 *         description: Invalid request
 */
router.post("/auth/challenge", async (req, res, next) => {
  try {
    const { account } = req.body;

    if (!account || typeof account !== "string") {
      return res.status(400).json({ error: "Account address required" });
    }

    // Validate Stellar address format
    if (!account.startsWith("G") || account.length !== 56) {
      return res.status(400).json({ error: "Invalid Stellar address" });
    }

    const challengeXdr = generateChallenge(account);
    const networkPassphrase =
      process.env.STELLAR_NETWORK === "public"
        ? "Public Global Stellar Network ; September 2015"
        : "Test SDF Network ; September 2015";

    res.json({
      transaction: challengeXdr,
      network_passphrase: networkPassphrase,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/auth/verify:
 *   post:
 *     summary: Verify a signed SEP-0010 challenge and issue session token
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [transaction]
 *             properties:
 *               transaction:
 *                 type: string
 *                 description: Signed challenge transaction XDR
 *     responses:
 *       200:
 *         description: Authentication successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: string
 *                   description: Session JWT token
 *                 merchant:
 *                   type: object
 *       401:
 *         description: Authentication failed
 */
router.post("/auth/verify", async (req, res, next) => {
  try {
    const { transaction } = req.body;

    if (!transaction || typeof transaction !== "string") {
      return res.status(400).json({ error: "Transaction XDR required" });
    }

    // Extract client account from transaction
    const StellarSdk = await import("stellar-sdk");
    const networkPassphrase =
      process.env.STELLAR_NETWORK === "public"
        ? StellarSdk.Networks.PUBLIC
        : StellarSdk.Networks.TESTNET;

    const tx = StellarSdk.TransactionBuilder.fromXDR(
      transaction,
      networkPassphrase,
    );

    const clientAccount = tx.operations[0]?.source;
    if (!clientAccount) {
      return res.status(400).json({ error: "Invalid transaction structure" });
    }

    // Verify challenge signature
    const verification = verifyChallenge(transaction, clientAccount);
    if (!verification.valid) {
      return res.status(401).json({ error: verification.error });
    }

    // Look up merchant by Stellar address
    const { data: merchant, error } = await supabase
      .from("merchants")
      .select("id, email, business_name, notification_email")
      .eq("recipient", clientAccount)
      .maybeSingle();

    if (error) {
      error.status = 500;
      throw error;
    }

    if (!merchant) {
      return res.status(401).json({
        error: "No merchant account found for this Stellar address",
      });
    }

    // Generate session token
    const token = generateSessionToken(merchant.id, clientAccount);

    res.json({
      token,
      merchant: {
        id: merchant.id,
        email: merchant.email,
        business_name: merchant.business_name,
        stellar_address: clientAccount,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
