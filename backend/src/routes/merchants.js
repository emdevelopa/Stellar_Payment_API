import express from "express";
import { randomBytes } from "crypto";
import { supabase } from "../lib/supabase.js";
import { requireApiKeyAuth } from "../lib/auth.js";
import { getMerchantApiUsage } from "../lib/api-usage.js";
import {
  registerMerchantZodSchema,
  sessionBrandingSchema,
  webhookSettingsSchema,
} from "../lib/request-schemas.js";
import { resolveBrandingConfig } from "../lib/branding.js";
import { resolveMerchantSettings } from "../lib/merchant-settings.js";
import { sendWebhook } from "../lib/webhooks.js";
import { getPayloadForVersion } from "../webhooks/resolver.js";

const router = express.Router();

const DEFAULT_WEBHOOK_SECRET_ROTATION_GRACE_HOURS = 24;

const rotateWebhookSecretSchema = z.object({
  grace_period_hours: z.number().int().min(0).max(168).optional(),
});

function resolveWebhookSecretRotationGraceHours(requestValue) {
  if (typeof requestValue === "number") {
    return requestValue;
  }

  const envValue = process.env.WEBHOOK_SECRET_ROTATION_GRACE_HOURS;
  if (envValue === undefined) {
    return DEFAULT_WEBHOOK_SECRET_ROTATION_GRACE_HOURS;
  }

  const parsed = Number.parseInt(envValue, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_WEBHOOK_SECRET_ROTATION_GRACE_HOURS;
  }

  return Math.min(parsed, 168);
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
 *               metadata:
 *                 type: object
 *                 additionalProperties: true
 *                 description: Optional free-form onboarding data (e.g. industry, country)
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
      merchant_settings: resolveMerchantSettings(body.merchant_settings),
      metadata: body.metadata ?? null,
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
        merchant_settings: resolveMerchantSettings(merchant.merchant_settings),
        metadata: merchant.metadata ?? null,
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

/**
 * @swagger
 * /api/merchants/rotate-webhook-secret:
 *   post:
 *     summary: Rotate the authenticated merchant's webhook signing secret
 *     tags: [Merchants]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               grace_period_hours:
 *                 type: integer
 *                 minimum: 0
 *                 maximum: 168
 *                 description: Optional override for old-secret grace period in hours (default 24)
 *     responses:
 *       200:
 *         description: New webhook secret issued; old secret remains valid until expiry
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 webhook_secret:
 *                   type: string
 *                 webhook_secret_old_expires_at:
 *                   type: string
 *                   format: date-time
 *                 grace_period_hours:
 *                   type: integer
 */
router.post("/merchants/rotate-webhook-secret", async (req, res, next) => {
  try {
    const body = rotateWebhookSecretSchema.parse(req.body || {});
    const graceHours = resolveWebhookSecretRotationGraceHours(
      body.grace_period_hours,
    );
    const now = Date.now();
    const expiryIso = new Date(now + graceHours * 60 * 60 * 1000).toISOString();

    const newWebhookSecret = `whsec_${randomBytes(32).toString("hex")}`;

    const { error } = await supabase
      .from("merchants")
      .update({
        webhook_secret_old: req.merchant.webhook_secret,
        webhook_secret_expiry: expiryIso,
        webhook_secret: newWebhookSecret,
      })
      .eq("id", req.merchant.id);

    if (error) {
      error.status = 500;
      throw error;
    }

    res.json({
      webhook_secret: newWebhookSecret,
      webhook_secret_old_expires_at: expiryIso,
      grace_period_hours: graceHours,
    });
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

router.get("/merchant-profile", async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("merchants")
      .select(
        "id, email, business_name, notification_email, merchant_settings, created_at",
      )
      .eq("id", req.merchant.id)
      .maybeSingle();

    if (error) {
      error.status = 500;
      throw error;
    }

    if (!data) {
      return res.status(404).json({ error: "Merchant profile not found" });
    }

    res.json({
      merchant: {
        ...data,
        merchant_settings: resolveMerchantSettings(data.merchant_settings),
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/test-webhook:
 *   post:
 *     summary: Send a test ping to a webhook URL
 *     tags: [Merchants]
 *     security:
 *       - ApiKeyAuth: []
 */
router.post("/test-webhook", async (req, res, next) => {
  try {
    const { webhook_url } = req.body || {};

    if (!webhook_url) {
      return res.status(400).json({ error: "webhook_url is required" });
    }

    const urlValidation = z.string().url().safeParse(webhook_url);
    if (!urlValidation.success) {
      return res.status(400).json({ error: "webhook_url must be a valid URL" });
    }

    const payload = getPayloadForVersion(
      req.merchant.webhook_version || "v1",
      "ping",
      {
        merchant_id: req.merchant.id,
        timestamp: new Date().toISOString(),
      }
    );

    const result = await sendWebhook(
      webhook_url,
      payload,
      req.merchant.webhook_secret || null
    );

    res.json({
      ok: result.ok,
      status: result.status ?? null,
      body: result.body ?? null,
      signed: result.signed,
    });
  } catch (err) {
    next(err);
  }
});

const paymentLimitsSchema = z
  .record(
    z.string().min(1),
    z.object({
      min: z.number().positive().optional(),
      max: z.number().positive().optional(),
    })
  )
  .optional();
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

    if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return res.status(400).json({
        error: "month must be in YYYY-MM format",
      });
    }

    res.json({ webhook_secret: newSecret });
  } catch (err) {
    next(err);
  }
});

export default router;
