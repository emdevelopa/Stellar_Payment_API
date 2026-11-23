import express from "express";
import rateLimit from "express-rate-limit";
import { randomBytes } from "crypto";
import { supabase } from "../lib/supabase.js";
import { requireApiKeyAuth, requireSessionAuth, hashPassword } from "../lib/auth.js";
import { generateSessionToken } from "../lib/sep10-auth.js";
import { getMerchantApiUsage } from "../lib/api-usage.js";
import { createMerchantSecurityActionRateLimit } from "../lib/rate-limit.js";
import {
  webhookSettingsSchema,
  VALID_WEBHOOK_EVENTS,
} from "../lib/request-schemas.js";
import { merchantService } from "../services/merchantService.js";
import { resolveMerchantSettings } from "../lib/merchant-settings.js";
import {
  sanitizeMerchantPayload,
  validateMerchantRequest,
  rotateApiKeySchema,
  rotateWebhookSecretSchema,
  setApiKeyExpirySchema,
  emptyBodySchema,
  registerMerchantSchema,
  merchantBrandingSchema,
  testWebhookRequestSchema,
  clipEchoedBody,
} from "../lib/merchant-payload-validation.js";
import { renderReceiptEmail } from "../lib/email-templates.js";
import { resolveBrandingConfig } from "../lib/branding.js";
import { sendWebhook } from "../lib/webhooks.js";
import { getPayloadForVersion } from "../webhooks/resolver.js";
import {
  createWebhookDomainVerificationState,
  readWebhookDomainVerification,
  verifyWebhookDomain,
} from "../lib/webhook-domain-verification.js";
import {
  withMerchantLock,
  compareAndSwapMerchant,
} from "../lib/merchant-key-lifecycle.js";
import { persistVerificationWithRecovery } from "../lib/merchant-recovery.js";
import {
  readThroughMerchantCache,
  invalidateMerchantCache,
} from "../lib/merchant-cache.js";
import { createRouteThroughputTelemetry } from "../lib/route-throughput-telemetry.js";
import {
  merchantRouteRequestsTotal,
  merchantRouteRequestDurationSeconds,
  merchantRouteInFlight,
} from "../lib/merchant-lifecycle-metrics.js";

const defaultMerchantRegistrationRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: { error: "Too many registration attempts, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

const defaultMerchantSecurityActionRateLimit =
  createMerchantSecurityActionRateLimit();

/**
 * Cached reads are per merchant and may never be stored by shared caches
 * (CDNs, proxies). X-Cache is for debugging only; values are HIT | MISS | BYPASS.
 */
function setMerchantCacheHeaders(res, cache) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Cache", String(cache).toUpperCase());
}


function createMerchantsRouter({
  merchantRegistrationRateLimit = defaultMerchantRegistrationRateLimit,
  merchantSecurityActionRateLimit = defaultMerchantSecurityActionRateLimit,
} = {}) {
  const router = express.Router();

  // Throughput telemetry for every route below (#1770). Registered first so
  // it also times validation and rate-limit rejections.
  router.use(
    createRouteThroughputTelemetry({
      router,
      requests: merchantRouteRequestsTotal,
      duration: merchantRouteRequestDurationSeconds,
      inFlight: merchantRouteInFlight,
    }),
  );

  const DEFAULT_WEBHOOK_SECRET_ROTATION_GRACE_HOURS = 24;

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
   *       429:
   *         description: Too many registration attempts
   */
  router.post(
    "/register-merchant",
    merchantRegistrationRateLimit,
    sanitizeMerchantPayload,
    validateMerchantRequest({ body: registerMerchantSchema }),
    async (req, res, next) => {
      try {
        const body = req.body;

        const { email } = body;
        const business_name = body.business_name || email.split("@")[0];
        const notification_email = body.notification_email || email;

        // Serialize registrations per email so the existence check and the
        // insert below cannot interleave with a concurrent request (#1772).
        await withMerchantLock(
          { scope: "register", id: email, operation: "register" },
          async () => {
        // Check if merchant already exists
        const { data: existing } = await supabase
          .from("merchants")
          .select("id")
          .eq("email", email)
          .maybeSingle();

        if (existing) {
          return res
            .status(409)
            .json({ error: "Merchant with this email already exists" });
        }

        // Generate secure credentials
        const apiKey = `sk_${randomBytes(24).toString("hex")}`;
        const webhookSecret = `whsec_${randomBytes(24).toString("hex")}`;
        const password_hash = await hashPassword(body.password);

        const payload = {
          email,
          business_name,
          notification_email,
          api_key: apiKey,
          webhook_secret: webhookSecret,
          password_hash,
          merchant_settings: resolveMerchantSettings(body.merchant_settings),
          metadata: body.metadata ?? null,
          created_at: new Date().toISOString(),
        };

        const { data: merchant, error: insertError } = await supabase
          .from("merchants")
          .insert(payload)
          .select()
          .single();

    if (insertError) {
      // Unique violation: another instance registered this email between our
      // check and insert (e.g. the lock expired or Redis was unreachable).
      if (insertError.code === "23505") {
        return res
          .status(409)
          .json({ error: "Merchant with this email already exists" });
      }
      console.error("Supabase insert error:", JSON.stringify(insertError));
      console.error("Supabase insert error details:", insertError.message, insertError.code, insertError.hint);
      insertError.status = 500;
      throw insertError;
    }

        const token = generateSessionToken(merchant.id, merchant.email);

        res.status(201).json({
          message: "Merchant registered successfully",
          token,
          merchant: {
            id: merchant.id,
            email: merchant.email,
            business_name: merchant.business_name,
            notification_email: merchant.notification_email,
            merchant_settings: resolveMerchantSettings(
              merchant.merchant_settings,
            ),
            metadata: merchant.metadata ?? null,
            api_key: merchant.api_key,
            webhook_secret: merchant.webhook_secret,
            created_at: merchant.created_at,
          },
        });
          },
        );
      } catch (err) {
        next(err);
      }
    },
  );

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
  router.post(
    "/rotate-key",
    sanitizeMerchantPayload,
    validateMerchantRequest({ body: emptyBodySchema }),
    async (req, res, next) => {
    try {
      const newApiKey = `sk_${randomBytes(24).toString("hex")}`;

      await withMerchantLock(
        { scope: "key", id: req.merchant.id, operation: "rotate_key" },
        () =>
          compareAndSwapMerchant(
            supabase,
            req.merchant.id,
            { column: "api_key", value: req.merchant.api_key },
            { api_key: newApiKey },
            "rotate_key",
          ),
      );

      res.json({ api_key: newApiKey });
    } catch (err) {
      next(err);
    }
  },
  );

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
  router.post(
    "/merchants/rotate-webhook-secret",
    requireApiKeyAuth({ requireSignature: true }),
    merchantSecurityActionRateLimit,
    sanitizeMerchantPayload,
    validateMerchantRequest({ body: rotateWebhookSecretSchema }),
    async (req, res, next) => {
      try {
        const body = req.body;
        const graceHours = resolveWebhookSecretRotationGraceHours(
          body.grace_period_hours,
        );
        const now = Date.now();
        const expiryIso = new Date(
          now + graceHours * 60 * 60 * 1000,
        ).toISOString();

        const newWebhookSecret = `whsec_${randomBytes(32).toString("hex")}`;

        await withMerchantLock(
          { scope: "key", id: req.merchant.id, operation: "rotate_webhook_secret" },
          () =>
            compareAndSwapMerchant(
              supabase,
              req.merchant.id,
              { column: "webhook_secret", value: req.merchant.webhook_secret },
              {
                webhook_secret_old: req.merchant.webhook_secret,
                webhook_secret_expiry: expiryIso,
                webhook_secret: newWebhookSecret,
              },
              "rotate_webhook_secret",
            ),
        );
        // The masked secret in GET /webhook-settings changed.
        await invalidateMerchantCache(req.merchant.id);

        res.json({
          webhook_secret: newWebhookSecret,
          webhook_secret_old_expires_at: expiryIso,
          grace_period_hours: graceHours,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get("/merchant-branding", async (req, res, next) => {
    try {
      const { value, cache } = await readThroughMerchantCache(
        "branding",
        req.merchant.id,
        async () => {
          const { data, error } = await supabase
            .from("merchants")
            .select("branding_config")
            .eq("id", req.merchant.id)
            .maybeSingle();

          if (error) {
            error.status = 500;
            throw error;
          }

          return {
            branding_config: resolveBrandingConfig({
              merchantBranding: data?.branding_config || null,
            }),
          };
        },
      );

      setMerchantCacheHeaders(res, cache);
      res.json(value);
    } catch (err) {
      next(err);
    }
  });

  router.put(
    "/merchant-branding",
    sanitizeMerchantPayload,
    validateMerchantRequest({ body: merchantBrandingSchema }),
    async (req, res, next) => {
      try {
        const brandingConfig = req.body;
        const resolved = resolveBrandingConfig({
          merchantBranding: brandingConfig,
        });

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
        await invalidateMerchantCache(req.merchant.id);

        res.json({ branding_config: data.branding_config });
      } catch (err) {
        next(err);
      }
    },
  );

  /**
   * @swagger
   * /api/preview-receipt:
   *   post:
   *     summary: Generate a preview HTML of the email receipt with custom branding
   *     tags: [Merchants]
   *     security:
   *       - ApiKeyAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/BrandingConfig'
   *     responses:
   *       200:
   *         description: HTML preview of the receipt
   *         content:
   *           text/html:
   *             schema:
   *               type: string
   */
  router.post(
    "/preview-receipt",
    requireApiKeyAuth(),
    sanitizeMerchantPayload,
    validateMerchantRequest({ body: merchantBrandingSchema }),
    async (req, res) => {
      try {
        const brandingConfig = req.body;
        
        // Mock payment details for preview
        const mockPayment = {
          id: "preview_12345",
          amount: 100.5,
          asset: "USDC",
          recipient: "GC7H...PREVIEW",
          tx_id: "tx_preview_hash",
          created_at: new Date().toISOString(),
        };

        const html = renderReceiptEmail({
          payment: mockPayment,
          merchant: {
            business_name: req.merchant.business_name,
            branding_config: brandingConfig,
          },
        });

        res.setHeader("Content-Type", "text/html");
        res.send(html);
      } catch (err) {
        res.status(500).json({ error: "Failed to generate preview" });
      }
    },
  );
  // ─── Webhook Settings ────────────────────────────────────────────────────────

  router.get("/merchant-profile", requireApiKeyAuth(), async (req, res, next) => {
    try {
      const { value, cache } = await readThroughMerchantCache(
        "profile",
        req.merchant.id,
        async () => {
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

          // null is never cached, so a merchant created later is seen at once.
          if (!data) return null;

          return {
            merchant: {
              ...data,
              merchant_settings: resolveMerchantSettings(data.merchant_settings),
            },
          };
        },
      );

      setMerchantCacheHeaders(res, cache);
      if (!value) {
        return res.status(404).json({ error: "Merchant profile not found" });
      }
      res.json(value);
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
  router.post(
    "/test-webhook",
    requireApiKeyAuth(),
    merchantSecurityActionRateLimit,
    sanitizeMerchantPayload,
    validateMerchantRequest({ body: testWebhookRequestSchema }),
    async (req, res, next) => {
      try {
        const { webhook_url } = req.body;

        const payload = getPayloadForVersion(
          req.merchant.webhook_version || "v1",
          "ping",
          {
            merchant_id: req.merchant.id,
            timestamp: new Date().toISOString(),
          },
        );

        const result = await sendWebhook(
          webhook_url,
          payload,
          req.merchant.webhook_secret || null,
        );

        res.json({
          ok: result.ok,
          status: result.status ?? null,
          // Third-party content: bounded and stripped of control characters.
          body: clipEchoedBody(result.body),
          signed: result.signed,
        });
      } catch (err) {
        next(err);
      }
    },
  );

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
  router.get("/webhook-settings", requireApiKeyAuth(), async (req, res, next) => {
    try {
      // Only the masked response is cached; the raw secret never leaves
      // this loader.
      const { value, cache } = await readThroughMerchantCache(
        "webhook_settings",
        req.merchant.id,
        async () => {
          const { data, error } = await supabase
            .from("merchants")
            .select("webhook_url, webhook_secret, subscribed_events, metadata")
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

          return {
            webhook_url: data.webhook_url || "",
            webhook_secret_masked: maskedSecret,
            subscribed_events: data.subscribed_events ?? null,
            available_events: VALID_WEBHOOK_EVENTS,
            webhook_domain_verification: readWebhookDomainVerification(
              data.metadata,
              data.webhook_url || "",
            ),
          };
        },
      );

      setMerchantCacheHeaders(res, cache);
      res.json(value);
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
  router.put(
    "/webhook-settings",
    requireApiKeyAuth(),
    merchantSecurityActionRateLimit,
    sanitizeMerchantPayload,
    validateMerchantRequest({ body: webhookSettingsSchema }),
    async (req, res, next) => {
      try {
        const body = req.body;

        const updatePayload = { webhook_url: body.webhook_url || null };
        if ("custom_headers" in body) {
          updatePayload.webhook_custom_headers = body.custom_headers ?? null;
        }
        if ("subscribed_events" in body) {
          updatePayload.subscribed_events = body.subscribed_events ?? null;
        }
        const { data: existing, error: existingError } = await supabase
          .from("merchants")
          .select("metadata")
          .eq("id", req.merchant.id)
          .single();

        if (existingError) {
          existingError.status = 500;
          throw existingError;
        }

        const verificationState = createWebhookDomainVerificationState(
          body.webhook_url || "",
          existing?.metadata,
        );

        const { data, error } = await supabase
          .from("merchants")
          .update(updatePayload)
          .eq("id", req.merchant.id)
          .select("webhook_url, webhook_custom_headers")
          .single();

        if (error) {
          error.status = 500;
          throw error;
        }
        await invalidateMerchantCache(req.merchant.id);

        res.json({
          webhook_url: data.webhook_url || "",
          custom_headers: data.webhook_custom_headers ?? {},
        });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    "/webhook-settings/verify",
    requireApiKeyAuth({ requireSignature: true }),
    merchantSecurityActionRateLimit,
    sanitizeMerchantPayload,
    validateMerchantRequest({ body: emptyBodySchema }),
    async (req, res, next) => {
    try {
      const { data, error } = await supabase
        .from("merchants")
        .select("webhook_url, metadata")
        .eq("id", req.merchant.id)
        .single();

      if (error) {
        error.status = 500;
        throw error;
      }

      if (!data.webhook_url) {
        return res.status(400).json({
          error: "Save a webhook URL before starting domain verification.",
        });
      }

      const result = await verifyWebhookDomain({
        webhookUrl: data.webhook_url,
        metadata: data.metadata,
      });

      // Retry transient write failures; if they persist, dead-letter the result
      // for background recovery and still return it (#1771).
      const persistence = await persistVerificationWithRecovery(supabase, {
        merchantId: req.merchant.id,
        metadata: result.metadata,
        verification: result.verification,
      });
      if (persistence.persisted) {
        await invalidateMerchantCache(req.merchant.id);
      }

      if (!persistence.persisted) {
        return res.status(202).json({
          webhook_domain_verification: result.verification,
          persisted: false,
          recovery: "queued",
        });
      }

      res.json({
        webhook_domain_verification: result.verification,
      });
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
  router.post(
    "/regenerate-webhook-secret",
    requireApiKeyAuth({ requireSignature: true }),
    merchantSecurityActionRateLimit,
    sanitizeMerchantPayload,
    validateMerchantRequest({ body: emptyBodySchema }),
    async (req, res, next) => {
    try {
      const newSecret = `whsec_${randomBytes(24).toString("hex")}`;

      await withMerchantLock(
        { scope: "key", id: req.merchant.id, operation: "regenerate_webhook_secret" },
        () =>
          compareAndSwapMerchant(
            supabase,
            req.merchant.id,
            { column: "webhook_secret", value: req.merchant.webhook_secret },
            { webhook_secret: newSecret },
            "regenerate_webhook_secret",
          ),
      );
      await invalidateMerchantCache(req.merchant.id);

      res.json({ webhook_secret: newSecret });
    } catch (err) {
      next(err);
    }
  });

    /**
     * @swagger
     * /api/merchants/generate-api-key:
     *   post:
     *     summary: Generate an API key using session authentication
     *     tags: [Merchants]
     *     security:
     *       - BearerAuth: []
     *     responses:
     *       200:
     *         description: New API key issued
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 api_key:
     *                   type: string
     */
    router.post(
      "/merchants/generate-api-key",
      requireSessionAuth(),
      merchantSecurityActionRateLimit,
      sanitizeMerchantPayload,
      validateMerchantRequest({ body: emptyBodySchema }),
      async (req, res, next) => {
      try {
        const newApiKey = `sk_${randomBytes(24).toString("hex")}`;

        await withMerchantLock(
          { scope: "key", id: req.merchant.id, operation: "generate_api_key" },
          () =>
            compareAndSwapMerchant(
              supabase,
              req.merchant.id,
              { column: "api_key", value: req.merchant.api_key },
              { api_key: newApiKey },
              "generate_api_key",
            ),
        );

        res.json({
          api_key: newApiKey
        });
      } catch (err) {
        next(err);
      }
    });

    /**
     * @swagger
     * /api/merchants/rotate-api-key:
     *   post:
     *     summary: Rotate API key with overlap period for seamless migration
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
     *                 description: Hours the old key remains valid (0-168, default 24)
     *                 default: 24
     *     responses:
     *       200:
     *         description: New API key generated with old key overlap period
     */
    router.post(
      "/merchants/rotate-api-key",
      requireApiKeyAuth({ requireSignature: true }),
      merchantSecurityActionRateLimit,
      sanitizeMerchantPayload,
      validateMerchantRequest({ body: rotateApiKeySchema }),
      async (req, res, next) => {
      try {
        const body = req.body;
        const result = await withMerchantLock(
          { scope: "key", id: req.merchant.id, operation: "rotate_api_key" },
          () =>
            merchantService.rotateApiKey(req.merchant.id, body.grace_period_hours),
        );
        res.json(result);
      } catch (err) {
        next(err);
      }
    });

    /**
     * @swagger
     * /api/merchants/api-key-status:
     *   get:
     *     summary: Get current API key status and expiry information
     *     tags: [Merchants]
     *     security:
     *       - ApiKeyAuth: []
     *     responses:
     *       200:
     *         description: API key status information
     */
    router.get("/merchants/api-key-status", requireApiKeyAuth(), async (req, res, next) => {
      try {
        const result = await merchantService.getApiKeyStatus(req.merchant.id);
        res.json(result);
      } catch (err) {
        next(err);
      }
    });

    /**
     * @swagger
     * /api/merchants/set-api-key-expiry:
     *   put:
     *     summary: Set an expiry date for the current API key
     *     tags: [Merchants]
     *     security:
     *       - ApiKeyAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - expires_at
     *             properties:
     *               expires_at:
     *                 type: string
     *                 format: date-time
     *                 description: ISO 8601 datetime (with timezone) when the API key expires. Must be at least 1 minute in the future and within 365 days. Unknown body fields are rejected.
     */
    router.put(
      "/merchants/set-api-key-expiry",
      requireApiKeyAuth({ requireSignature: true }),
      merchantSecurityActionRateLimit,
      sanitizeMerchantPayload,
      validateMerchantRequest({ body: setApiKeyExpirySchema }),
      async (req, res, next) => {
      try {
        const body = req.body;
        const result = await withMerchantLock(
          { scope: "key", id: req.merchant.id, operation: "set_api_key_expiry" },
          () =>
            merchantService.setApiKeyExpiry(req.merchant.id, body.expires_at),
        );
        res.json(result);
      } catch (err) {
        next(err);
      }
    });


  return router;
}


export default createMerchantsRouter;
