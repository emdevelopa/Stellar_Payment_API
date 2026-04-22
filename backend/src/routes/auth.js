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
import { hashPassword, verifyPassword } from "../lib/auth.js";
import { logLoginAttempt } from "../lib/audit.js";
import { validateRequest } from "../lib/validation.js";
import { authChallengeSchema, authVerifySchema } from "../lib/request-schemas.js";

const router = express.Router();

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Login with email and password
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login successful
 *       401:
 *         description: Invalid credentials
 */
router.post("/auth/login", async (req, res, next) => {
  const ipAddress = req.ip ?? null;
  const userAgent = req.get("user-agent") ?? null;

  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const { data: merchant, error } = await supabase
      .from("merchants")
      .select("id, email, business_name, notification_email, password_hash, api_key, webhook_secret, merchant_settings")
      .eq("email", email.toLowerCase().trim())
      .is("deleted_at", null)
      .maybeSingle();

    if (error) { error.status = 500; throw error; }

    if (!merchant || !merchant.password_hash) {
      await logLoginAttempt({ merchantId: null, ipAddress, userAgent, status: "failure" });
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const valid = await verifyPassword(password, merchant.password_hash);
    if (!valid) {
      await logLoginAttempt({ merchantId: merchant.id, ipAddress, userAgent, status: "failure" });
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = generateSessionToken(merchant.id, merchant.email);

    await logLoginAttempt({ merchantId: merchant.id, ipAddress, userAgent, status: "success" });

    res.json({
      token,
      merchant: {
        id: merchant.id,
        email: merchant.email,
        business_name: merchant.business_name,
        notification_email: merchant.notification_email,
        api_key: merchant.api_key,
        webhook_secret: merchant.webhook_secret,
        merchant_settings: merchant.merchant_settings,
      },
    });
  } catch (err) {
    next(err);
  }
});

/*
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
router.post("/auth/challenge", validateRequest({ body: authChallengeSchema }), async (req, res, next) => {
  try {
    const { account } = req.body;

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
router.post("/auth/verify", validateRequest({ body: authVerifySchema }), async (req, res, next) => {
  const ipAddress = req.ip ?? null;
  const userAgent = req.get("user-agent") ?? null;

  try {
    const { transaction } = req.body;

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
      await logLoginAttempt({
        merchantId: null,
        ipAddress,
        userAgent,
        status: "failure",
      });
      return res.status(401).json({ error: verification.error });
    }

    // Look up merchant by Stellar address
    const { data: merchant, error } = await supabase
      .from("merchants")
      .select("id, email, business_name, notification_email")
      .eq("recipient", clientAccount)
      .is("deleted_at", null)
      .maybeSingle();

    if (error) {
      error.status = 500;
      throw error;
    }

    if (!merchant) {
      await logLoginAttempt({
        merchantId: null,
        ipAddress,
        userAgent,
        status: "failure",
      });
      return res.status(401).json({
        error: "No merchant account found for this Stellar address",
      });
    }

    // Generate session token
    const token = generateSessionToken(merchant.id, merchant.email || clientAccount);

    // Audit: successful login
    await logLoginAttempt({
      merchantId: merchant.id,
      ipAddress,
      userAgent,
      status: "success",
    });

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
