import express from "express";
import { randomBytes } from "crypto";
import { supabase } from "../lib/supabase.js";

const router = express.Router();

const REQUIRED_FIELDS = ["email"];

function validateRegisterMerchant(body) {
  for (const field of REQUIRED_FIELDS) {
    if (!body[field]) {
      return `Missing field: ${field}`;
    }
  }

  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(body.email)) {
    return "Invalid email format";
  }
  if (body.notification_email && !emailRegex.test(body.notification_email)) {
    return "Invalid notification_email format";
  }

  return null;
}

/**
 * @swagger
 * /api/register-merchant:
 *   post:
 *     summary: Register a new merchant
 *     tags: [Merchants]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               business_name:
 *                 type: string
 *               notification_email:
 *                 type: string
 *                 format: email
 *     responses:
 *       201:
 *         description: Merchant registered
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 merchant:
 *                   type: object
 *       400:
 *         description: Validation error
 *       409:
 *         description: Merchant already exists
 */
router.post("/register-merchant", async (req, res, next) => {
  try {
    const error = validateRegisterMerchant(req.body || {});
    if (error) {
      return res.status(400).json({ error });
    }

    const { email } = req.body;
    const business_name = req.body.business_name || email.split("@")[0];
    const notification_email = req.body.notification_email || email;

    // Check if merchant already exists
    const { data: existing } = await supabase
      .from("merchants")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ error: "Merchant with this email already exists" });
    }

    // Generate secure credentials
    const apiKey = `sk_${randomBytes(24).toString("hex")}`;
    const webhookSecret = `whsec_${randomBytes(24).toString("hex")}`;

    const payload = {
      email,
      business_name,
      notification_email,
      api_key: apiKey,
      webhook_secret: webhookSecret,
      webhook_version: "v1",
      created_at: new Date().toISOString()
    };

    const { data: merchant, error: insertError } = await supabase
      .from("merchants")
      .insert(payload)
      .select()
      .single();

    if (insertError) {
      insertError.status = 500;
      throw insertError;
    }

    res.status(201).json({
      message: "Merchant registered successfully",
      merchant: {
        id: merchant.id,
        email: merchant.email,
        business_name: merchant.business_name,
        notification_email: merchant.notification_email,
        api_key: merchant.api_key,
        webhook_secret: merchant.webhook_secret,
        webhook_version: merchant.webhook_version,
        created_at: merchant.created_at
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/rotate-key:
 *   post:
 *     summary: Rotate the authenticated merchant's API key
 *     tags: [Merchants]
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: New API key issued; the old key is immediately invalidated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 api_key:
 *                   type: string
 *       401:
 *         description: Missing or invalid x-api-key header
 */
router.post("/rotate-key", async (req, res, next) => {
  try {
    const newApiKey = `sk_${randomBytes(24).toString("hex")}`;

    const { error } = await supabase
      .from("merchants")
      .update({ api_key: newApiKey })
      .eq("id", req.merchant.id);

    if (error) {
      error.status = 500;
      throw error;
    }

    res.json({ api_key: newApiKey });
  } catch (err) {
    next(err);
  }
});

export default router;
