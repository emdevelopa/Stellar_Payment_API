import express from "express";
import { randomBytes } from "crypto";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import {
  merchantProfileUpdateZodSchema,
  registerMerchantZodSchema,
  sessionBrandingSchema,
} from "../lib/request-schemas.js";
import { resolveBrandingConfig } from "../lib/branding.js";
import { resolveMerchantSettings } from "../lib/merchant-settings.js";
import { sendWebhook } from "../lib/webhooks.js";

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
      webhook_version: "v1",
      merchant_settings: resolveMerchantSettings(body.merchant_settings),
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [webhook_url]
 *             properties:
 *               webhook_url:
 *                 type: string
 *                 format: uri
 *     responses:
 *       200:
 *         description: Ping result from the target server
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                 status:
 *                   type: integer
 *                 body:
 *                   type: string
 *       400:
 *         description: Missing or invalid webhook_url
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

    const result = await sendWebhook(
      webhook_url,
      {
        event: "ping",
        merchant_id: req.merchant.id,
        timestamp: new Date().toISOString(),
      },
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
 * /api/merchant-limits:
 *   get:
 *     summary: Get per-asset payment limits for the authenticated merchant
 *     tags: [Merchants]
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Current payment limits config
 */
router.get("/merchant-limits", async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("merchants")
      .select("payment_limits")
      .eq("id", req.merchant.id)
      .maybeSingle();

    if (error) {
      error.status = 500;
      throw error;
    }

    res.json({ payment_limits: data?.payment_limits ?? {} });
  } catch (err) {
    next(err);
  }
});

router.put("/merchant-profile", async (req, res, next) => {
  try {
    const body = merchantProfileUpdateZodSchema.parse(req.body || {});
    const updatePayload = {};

    if (body.notification_email !== undefined) {
      updatePayload.notification_email = body.notification_email;
    }

    if (body.merchant_settings !== undefined) {
      updatePayload.merchant_settings = resolveMerchantSettings({
        ...req.merchant.merchant_settings,
        ...body.merchant_settings,
      });
    }

    const { data, error } = await supabase
      .from("merchants")
      .update(updatePayload)
      .eq("id", req.merchant.id)
      .select(
        "id, email, business_name, notification_email, merchant_settings, created_at",
      )
      .single();

    if (error) {
      error.status = 500;
      throw error;
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
 * /api/merchant-limits:
 *   put:
 *     summary: Set per-asset payment limits for the authenticated merchant
 *   tags: [Merchants]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             additionalProperties:
 *               type: object
 *               properties:
 *                 min:
 *                   type: number
 *                 max:
 *                   type: number
 *     responses:
 *       200:
 *         description: Updated payment limits
 */
router.put("/merchant-limits", async (req, res, next) => {
  try {
    const limits = paymentLimitsSchema.parse(req.body || {});

    const { data, error } = await supabase
      .from("merchants")
      .update({ payment_limits: limits ?? {} })
      .eq("id", req.merchant.id)
      .select("payment_limits")
      .single();

    if (error) {
      error.status = 500;
      throw error;
    }

    res.json({ payment_limits: data.payment_limits });
  } catch (err) {
    next(err);
  }
});

// Stellar public keys start with 'G' and are 56 characters long.
const stellarAddressSchema = z
  .string()
  .trim()
  .refine(
    (v) => v.startsWith("G") && v.length === 56,
    "Each issuer must be a valid Stellar public key (starts with 'G', 56 characters)"
  );

const allowedIssuersSchema = z.array(stellarAddressSchema);

/**
 * @swagger
 * /api/merchant-issuers:
 *   get:
 *     summary: Get the allowed issuers list for the authenticated merchant
 *     tags: [Merchants]
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Current allowed issuers list (empty array means all issuers accepted)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 allowed_issuers:
 *                   type: array
 *                   items:
 *                     type: string
 */
router.get("/merchant-issuers", async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("merchants")
      .select("allowed_issuers")
      .eq("id", req.merchant.id)
      .maybeSingle();

    if (error) {
      error.status = 500;
      throw error;
    }

    res.json({ allowed_issuers: data?.allowed_issuers ?? [] });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/merchant-issuers:
 *   put:
 *     summary: Set the allowed issuers list for the authenticated merchant
 *     tags: [Merchants]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [allowed_issuers]
 *             properties:
 *               allowed_issuers:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Array of trusted Stellar issuer public keys. Send an empty array to allow all issuers.
 *     responses:
 *       200:
 *         description: Updated allowed issuers list
 *       400:
 *         description: Validation error
 */
router.put("/merchant-issuers", async (req, res, next) => {
  try {
    const body = z.object({ allowed_issuers: allowedIssuersSchema }).parse(req.body || {});

    const { data, error } = await supabase
      .from("merchants")
      .update({ allowed_issuers: body.allowed_issuers })
      .eq("id", req.merchant.id)
      .select("allowed_issuers")
      .single();

    if (error) {
      error.status = 500;
      throw error;
    }

    res.json({ allowed_issuers: data.allowed_issuers });
  } catch (err) {
    next(err);
  }
});

export default router;
