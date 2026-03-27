import express from "express";
import { randomBytes } from "crypto";
import { supabase } from "../lib/supabase.js";
import {
  registerMerchantZodSchema,
  sessionBrandingSchema,
  webhookSettingsSchema,
} from "../lib/request-schemas.js";
import { resolveBrandingConfig } from "../lib/branding.js";

const router = express.Router();

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
    const body = registerMerchantZodSchema.parse(req.body || {});

    const { email } = body;
    const business_name = body.business_name || email.split("@")[0];
    const notification_email = body.notification_email || email;

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

router.get("/merchant-branding", async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("merchants")
      .select("branding_config")
      .eq("id", req.merchant.id)
      .maybeSingle();

    if (error) {
      error.status = 500;
      throw error;
    }

    res.json({
      branding_config: resolveBrandingConfig({
        merchantBranding: data?.branding_config || null,
      }),
    });
  } catch (err) {
    next(err);
  }
});

router.put("/merchant-branding", async (req, res, next) => {
  try {
    const brandingConfig = sessionBrandingSchema.parse(req.body || {});
    const resolved = resolveBrandingConfig({ merchantBranding: brandingConfig });

    const { data, error } = await supabase
      .from("merchants")
      .update({ branding_config: resolved })
      .eq("id", req.merchant.id)
      .select("branding_config")
      .single();

    if (error) {
      error.status = 500;
      throw error;
    }

    res.json({ branding_config: data.branding_config });
  } catch (err) {
    next(err);
  }
});

// ─── Webhook Settings ────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/webhook-settings:
 *   get:
 *     summary: Retrieve current webhook URL and masked webhook secret
 *     tags: [Merchants]
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Current webhook settings
 */
router.get("/webhook-settings", async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("merchants")
      .select("webhook_url, webhook_secret")
      .eq("id", req.merchant.id)
      .single();

    if (error) {
      error.status = 500;
      throw error;
    }

    // Mask the secret: show first 10 chars, hide the rest
    const secret = data.webhook_secret || "";
    const maskedSecret =
      secret.length > 10
        ? secret.slice(0, 10) + "•".repeat(secret.length - 10)
        : "•".repeat(secret.length);

    res.json({
      webhook_url: data.webhook_url || "",
      webhook_secret_masked: maskedSecret,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/webhook-settings:
 *   put:
 *     summary: Update the merchant's webhook endpoint URL
 *     tags: [Merchants]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               webhook_url:
 *                 type: string
 *                 format: uri
 *     responses:
 *       200:
 *         description: Webhook URL updated
 *       400:
 *         description: Validation error
 */
router.put("/webhook-settings", async (req, res, next) => {
  try {
    const body = webhookSettingsSchema.parse(req.body || {});

    const { data, error } = await supabase
      .from("merchants")
      .update({ webhook_url: body.webhook_url || null })
      .eq("id", req.merchant.id)
      .select("webhook_url")
      .single();

    if (error) {
      error.status = 500;
      throw error;
    }

    res.json({ webhook_url: data.webhook_url || "" });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/regenerate-webhook-secret:
 *   post:
 *     summary: Regenerate the merchant's webhook signing secret
 *     tags: [Merchants]
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: New webhook secret issued
 *       401:
 *         description: Missing or invalid x-api-key header
 */
router.post("/regenerate-webhook-secret", async (req, res, next) => {
  try {
    const newSecret = `whsec_${randomBytes(24).toString("hex")}`;

    const { error } = await supabase
      .from("merchants")
      .update({ webhook_secret: newSecret })
      .eq("id", req.merchant.id);

    if (error) {
      error.status = 500;
      throw error;
    }

    res.json({ webhook_secret: newSecret });
  } catch (err) {
    next(err);
  }
});

export default router;
