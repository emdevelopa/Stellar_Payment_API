/**
 * SEP-0010 Authentication Routes
 * Issue #148: Stellar Web Authentication Support
 */

import express from "express";
import * as StellarSdk from "stellar-sdk";
import { supabase } from "../lib/supabase.js";
import {
  generateChallenge,
  verifyChallenge,
  generateSessionToken,
  getHomeDomain,
  getNetworkPassphrase,
  lookupMerchantByStellarAddress,
  releaseChallengeNonce,
  Sep10AuthError,
  validateChallengeXdr,
} from "../lib/sep10-auth.js";
import { hashPassword, verifyPassword } from "../lib/auth.js";
import { logLoginAttempt } from "../lib/audit.js";
import { logger } from "../lib/logger.js";
import { validateRequest } from "../lib/validation.js";
import { authChallengeSchema, authVerifySchema } from "../lib/request-schemas.js";
import {
  createSep10ChallengeRateLimit,
  createSep10VerifyRateLimit,
} from "../lib/rate-limit.js";

const defaultSep10ChallengeRateLimit = createSep10ChallengeRateLimit();
const defaultSep10VerifyRateLimit = createSep10VerifyRateLimit();

export default function createAuthRouter({
  sep10ChallengeRateLimit = defaultSep10ChallengeRateLimit,
  sep10VerifyRateLimit = defaultSep10VerifyRateLimit,
} = {}) {
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

      if (error) {
        error.status = 500;
        throw error;
      }

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

  router.post(
    "/auth/challenge",
    sep10ChallengeRateLimit,
    validateRequest({ body: authChallengeSchema }),
    async (req, res, next) => {
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
    },
  );

  router.post(
    "/auth/verify",
    sep10VerifyRateLimit,
    validateRequest({ body: authVerifySchema }),
    async (req, res, next) => {
      const ipAddress = req.ip ?? null;
      const userAgent = req.get("user-agent") ?? null;
      let claimedNonce = null;

      try {
        const { transaction } = req.body;

        const xdrValidation = validateChallengeXdr(transaction);
        if (!xdrValidation.valid) {
          return res.status(400).json({ error: xdrValidation.error });
        }

        let tx;
        try {
          tx = StellarSdk.TransactionBuilder.fromXDR(transaction, getNetworkPassphrase());
        } catch {
          return res.status(400).json({ error: "Invalid challenge transaction" });
        }

        const operation = tx.operations?.[0];
        const clientAccount = operation?.source;
        if (!clientAccount || typeof clientAccount !== "string") {
          return res.status(400).json({ error: "Invalid transaction structure" });
        }

        const verification = verifyChallenge(transaction, clientAccount, getHomeDomain());

        if (!verification.valid) {
          await logLoginAttempt({
            merchantId: null,
            ipAddress,
            userAgent,
            status: "failure",
          });
          return res.status(401).json({
            error: verification.error,
            code: verification.code,
          });
        }

        claimedNonce = verification.nonce;

        const merchant = await lookupMerchantByStellarAddress(clientAccount, supabase);

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

        const token = generateSessionToken(merchant.id, merchant.email || clientAccount);

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
        // No token was issued for this challenge, so hand the nonce back and
        // let the client retry the same signed challenge (#1295).
        if (claimedNonce && !res.headersSent) {
          releaseChallengeNonce(claimedNonce);
          logger.info({ code: err?.code }, "sep10 nonce released after failed token issuance");
        }

        if (err instanceof Sep10AuthError) {
          return res.status(err.httpStatus).json({
            error: err.code,
            message: err.message,
            retryable: err.retryable,
          });
        }
        next(err);
      }
    },
  );

  return router;
}
