import "dotenv/config";
import { randomUUID } from "node:crypto";
import express from "express";
import rateLimit from "express-rate-limit";
import { paymentService } from "../services/paymentService.js";
import { validateUuidParam } from "../lib/validate-uuid.js";
import {
  paymentSessionZodSchema,
  refundConfirmSchema,
  pathPaymentQuoteQuerySchema,
  paymentsListQuerySchema
} from "../lib/request-schemas.js";
import { validateRequest } from "../lib/validation.js";
import { createCreatePaymentRateLimit } from "../lib/create-payment-rate-limit.js";
import { recaptchaMiddleware } from "../lib/recaptcha.js";
import { sendWebhook, isEventSubscribed } from "../lib/webhooks.js";
import { sendReceiptEmail } from "../lib/email.js";
import { renderReceiptEmail } from "../lib/email-templates.js";
import { resolveBrandingConfig } from "../lib/branding.js";
import { generatePaginationLinks } from "../lib/pagination-links.js";

import {
  connectRedisClient,
  getCachedPayment,
  setCachedPayment,
  invalidatePaymentCache,
} from "../lib/redis.js";
import { getPayloadForVersion } from "../webhooks/resolver.js";
import { streamManager } from "../lib/stream-manager.js";
import {
  paymentCreatedCounter,
  paymentConfirmedCounter,
  paymentConfirmationLatency,
  paymentFailedCounter,
} from "../lib/metrics.js";
import { sanitizeMetadataMiddleware } from "../lib/sanitize-metadata.js";
import { supabase } from "../lib/supabase.js";
import {
  findMatchingPayment,
  findStrictReceivePaths,
  getNetworkFeeStats,
} from "../lib/stellar.js";


const createPaymentRateLimit = createCreatePaymentRateLimit();

const defaultVerifyPaymentRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: "Too many verification requests, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});



function applyPaymentFilters(query, req) {
  const { status, asset, date_from: dateFrom, date_to: dateTo, search } = req.query || {};
  const { created_after: createdAfter, created_before: createdBefore } = req.query || {};

  if (typeof status === "string" && status.length > 0) {
    query = query.eq("status", status);
  }
  if (typeof asset === "string" && asset.length > 0) {
    query = query.eq("asset", asset);
  }
  if (typeof dateFrom === "string" && dateFrom.length > 0) {
    query = query.gte("created_at", `${dateFrom}T00:00:00.000Z`);
  }
  if (typeof dateTo === "string" && dateTo.length > 0) {
    query = query.lte("created_at", `${dateTo}T23:59:59.999Z`);
  }

  if (typeof createdAfter === "string" && createdAfter.length > 0) {
    query = query.gte("created_at", createdAfter);
  }

  if (typeof createdBefore === "string" && createdBefore.length > 0) {
    query = query.lte("created_at", createdBefore);
  }
  if (typeof search === "string" && search.trim().length > 0) {
    const term = search.trim().replaceAll(",", "\\,");
    let orQuery = `id.ilike.%${term}%,description.ilike.%${term}%,recipient.ilike.%${term}%`;
    const numTerm = Number(term);
    if (!isNaN(numTerm)) {
      orQuery += `,amount.eq.${numTerm}`;
    }
    query = query.or(orQuery);
  }
  return query;
}

/**
 * Parse `metadata[key]=value` query params and apply JSONB equality filters.
 *
 * Each `metadata[key]` entry is translated to a Supabase `.filter()` call
 * using the `cs` (contains) operator against a single-key JSON object, which
 * maps to the Postgres `@>` operator on a JSONB column.
 *
 * Only safe key names (alphanumeric + _ + -) are accepted to guard against
 * SQL injection.
 */
const SAFE_METADATA_KEY_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function applyMetadataFilters(query, rawQuery) {
  const metadataParam = rawQuery.metadata;
  if (!metadataParam || typeof metadataParam !== "object" || Array.isArray(metadataParam)) {
    return query;
  }
  for (const [key, value] of Object.entries(metadataParam)) {
    if (!SAFE_METADATA_KEY_RE.test(key)) continue;
    if (typeof value !== "string") continue;
    query = query.filter("metadata", "cs", JSON.stringify({ [key]: value }));
  }
  return query;
}

function createPaymentsRouter({
  verifyPaymentRateLimit = defaultVerifyPaymentRateLimit,
} = {}) {
  const router = express.Router();

  /**
   * @swagger
   * /api/create-payment:
   *   post:
   *     summary: Create a new payment session request
   *     tags: [Payments]
   *     parameters:
   *       - in: header
   *         name: Idempotency-Key
   *         schema:
   *           type: string
   *         description: Optional unique key for idempotent requests. Use UUID or request ID. Responses are cached for 24 hours.
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
   *                 description: Payment amount (must be positive and at least 0.01 XLM for native payments)
   *               asset:
   *                 type: string
   *                 description: Asset code (e.g. XLM, USDC)
   *               asset_issuer:
   *                 type: string
   *                 description: Asset issuer (required for non-native assets)
   *               recipient:
   *                 type: string
   *                 description: Stellar address of the recipient
   *               description:
   *                 type: string
   *               memo:
   *                 type: string
   *               memo_type:
   *                 type: string
   *                 enum: [text, id, hash, return]
   *               webhook_url:
   *                 type: string
   *               client_id:
   *                 type: string
   *                 description: Merchant-defined client/store identifier for segmentation
   *               branding_overrides:
   *                 type: object
   *                 properties:
   *                   primary_color:
   *                     type: string
   *                     example: "#5ef2c0"
   *                   secondary_color:
   *                     type: string
   *                     example: "#b8ffe2"
   *                   background_color:
   *                     type: string
   *                     example: "#050608"
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
   *                 branding_config:
   *                   type: object
   *       200:
   *         description: Duplicate request — cached response returned from idempotency key
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
   *         description: Validation error or invalid Idempotency-Key
   *       429:
   *         description: Too many requests
   */
  async function createSession(req, res, next) {
    try {
      const body = req.body;

      // Per-asset payment limit validation (#153)
      const limits = req.merchant.payment_limits;
      if (limits && typeof limits === "object") {
        const assetLimits = limits[body.asset];
        if (assetLimits) {
          if (assetLimits.min !== undefined && body.amount < assetLimits.min) {
            paymentFailedCounter.inc({ asset: body.asset, reason: "below_min" });
            return res.status(400).json({
              error: `Amount is below the minimum for ${body.asset}`,
              min: assetLimits.min,
              delta: Number((assetLimits.min - body.amount).toFixed(7)),
            });
          }
          if (assetLimits.max !== undefined && body.amount > assetLimits.max) {
            paymentFailedCounter.inc({ asset: body.asset, reason: "above_max" });
            return res.status(400).json({
              error: `Amount exceeds the maximum for ${body.asset}`,
              max: assetLimits.max,
              delta: Number((body.amount - assetLimits.max).toFixed(7)),
            });
          }
        }
      }

      // Allowed-issuers check: if the merchant has configured a non-empty
      // allowlist, only those issuer addresses may be used.
      const allowedIssuers = req.merchant.allowed_issuers;
      if (Array.isArray(allowedIssuers) && allowedIssuers.length > 0) {
        if (!body.asset_issuer || !allowedIssuers.includes(body.asset_issuer)) {
          paymentFailedCounter.inc({ asset: body.asset, reason: "invalid_issuer" });
          return res.status(400).json({
            error:
              "asset_issuer is not in the merchant's list of allowed issuers",
          });
        }
      }

      const isSandbox = body.sandbox === true;
      const baseId = randomUUID();
      const paymentId = isSandbox ? `test_${baseId}` : baseId;
      const now = new Date().toISOString();
      const paymentLinkBase =
        process.env.PAYMENT_LINK_BASE || "http://localhost:3000";
      const paymentLink = `${paymentLinkBase}/pay/${paymentId}`;
      const resolvedBrandingConfig = resolveBrandingConfig({
        merchantBranding: req.merchant.branding_config,
        brandingOverrides: body.branding_overrides,
      });

      const metadata =
        body.metadata && typeof body.metadata === "object"
          ? { ...body.metadata }
          : {};
      metadata.branding_config = resolvedBrandingConfig;

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
        client_id: body.client_id || null,
        status: "pending",
        tx_id: null,
        metadata,
        sandbox: isSandbox,
        created_at: now,
      };

      const { error: insertError } = await supabase
        .from("payments")
        .insert(payload);

      if (insertError) {
        insertError.status = 500;
        throw insertError;
      }

      // Only record production metrics for non-sandbox payments.
      if (!isSandbox) {
        paymentCreatedCounter.inc({ asset: body.asset });
      }

      res.status(201).json({
        payment_id: paymentId,
        payment_link: paymentLink,
        status: "pending",
        sandbox: isSandbox,
        branding_config: resolvedBrandingConfig,
      });
    } catch (err) {
      if (err.status === 400 && err.details) {
        return res.status(400).json({ error: err.message, ...err.details });
      }
      next(err);
    }
  }

  router.post("/create-payment", createPaymentRateLimit, recaptchaMiddleware(), validateRequest({ body: paymentSessionZodSchema }), sanitizeMetadataMiddleware, createSession);
  router.post("/sessions", createPaymentRateLimit, validateRequest({ body: paymentSessionZodSchema }), sanitizeMetadataMiddleware, createSession);

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
  router.get(
    "/payment-status/:id",
    validateUuidParam(),
    async (req, res, next) => {
      try {
        // --- Redis read-through cache ---
        const redis = await connectRedisClient();
        const cached = await getCachedPayment(redis, req.params.id);
        if (cached) {
          return res.json({ payment: cached });
        }

        let query = supabase
          .from("payments")
          .select(
            "id, amount, asset, asset_issuer, recipient, description, memo, memo_type, status, tx_id, metadata, created_at, merchants(branding_config)"
          );

        if (req.merchant?.id) {
          query = query.eq("merchant_id", req.merchant.id);
        }

        const { data, error } = await query
          .eq("id", req.params.id)
          .is("deleted_at", null)
          .maybeSingle();

        if (error) {
          error.status = 500;
          throw error;
        }

        if (!data) {
          return res.status(404).json({ error: "Payment not found" });
        }

        const metadataBranding = data.metadata?.branding_config || null;
        const merchantBranding = data.merchants?.branding_config || null;
        const brandingConfig = metadataBranding || merchantBranding || null;

        const response = {
          ...data,
          branding_config: brandingConfig,
        };
        delete response.merchants;

        // Cache the result for ~2 s to absorb polling bursts
        await setCachedPayment(redis, req.params.id, response);

        res.json({ payment: response });
      } catch (err) {
        next(err);
      }
    }
  );

  /**
   * @swagger
   * /api/stream/{id}:
   *   get:
   *     summary: Subscribe to real-time status updates for a payment
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
   *         description: SSE stream
   */
  router.get("/stream/:id", validateUuidParam(), (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    streamManager.addClient(req.params.id, res);
  });

  router.get("/network-fee", async (req, res, next) => {
    try {
      const fee = await getNetworkFeeStats(1);
      res.json({
        network_fee: {
          network: fee.network,
          horizon_url: fee.horizonUrl,
          operation_count: fee.operationCount,
          stroops: fee.totalFeeStroops,
          xlm: fee.totalFeeXlm,
          last_ledger_base_fee: fee.lastLedgerBaseFee,
        },
      });
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
   */
  router.post(
    "/verify-payment/:id",
    verifyPaymentRateLimit,
    validateUuidParam(),
    async (req, res, next) => {
      try {
        let query = supabase
          .from("payments")
          .select(
            "id, amount, asset, asset_issuer, recipient, status, tx_id, memo, memo_type, webhook_url, merchants(webhook_secret, webhook_version, webhook_custom_headers, notification_email, email, business_name, subscribed_events)"
          );

        if (req.merchant?.id) {
          query = query.eq("merchant_id", req.merchant.id);
        }

        const { data, error } = await query

          .eq("id", req.params.id)
          .is("deleted_at", null)
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
            ledger_url: `https://stellar.expert/explorer/testnet/tx/${data.tx_id}`,
          });
        }

        const match = await findMatchingPayment({
          recipient: data.recipient,
          amount: data.amount,
          assetCode: data.asset,
          assetIssuer: data.asset_issuer,
          memo: data.memo,
          memoType: data.memo_type,
        });

        if (!match) {
          return res.json({ status: "pending" });
        }

        // Calculate latency from creation to confirmation
        const createdAt = new Date(data.created_at);
        const now = new Date();
        const latencySeconds = (now - createdAt) / 1000;

        const { error: updateError } = await supabase
          .from("payments")
          .update({
            status: "confirmed",
            tx_id: match.transaction_hash,
            completion_duration_seconds: Math.floor(latencySeconds)
          })
          .eq("id", data.id);

        if (updateError) {
          updateError.status = 500;
          throw updateError;
        }

        // --- Invalidate cache so next poll sees confirmed status immediately ---
        const redis = await connectRedisClient();
        await invalidatePaymentCache(redis, data.id);
        // Record metrics for confirmation
        paymentConfirmedCounter.inc({ asset: data.asset });
        paymentConfirmationLatency.observe({ asset: data.asset }, latencySeconds);

        // Emit real-time event to the merchant's private room (issue #229)
        const io = req.app.locals.io;
        if (io && data.merchant_id) {
          io.to(`merchant:${data.merchant_id}`).emit("payment:confirmed", {
            id: data.id,
            amount: data.amount,
            asset: data.asset,
            asset_issuer: data.asset_issuer,
            recipient: data.recipient,
            tx_id: match.transaction_hash,
            confirmed_at: new Date().toISOString(),
          });
        }

        // Notify customer via SSE (issue #89)
        streamManager.notify(data.id, "payment.confirmed", {
          status: "confirmed",
          tx_id: match.transaction_hash,
        });

        const merchantSecret = data.merchants?.webhook_secret;
        const merchantVersion = data.merchants?.webhook_version || "v1";

        const webhookPayload = getPayloadForVersion(
          merchantVersion,
          "payment.confirmed",
          {
            payment_id: data.id,
            amount: data.amount,
            asset: data.asset,
            asset_issuer: data.asset_issuer,
            recipient: data.recipient,
            tx_id: match.transaction_hash,
          }
        );
        let webhookResult = { ok: true, skipped: true };
        if (isEventSubscribed(data.merchants, "payment.confirmed")) {
          webhookResult = await sendWebhook(
            data.webhook_url,
            webhookPayload,
            merchantSecret,
            data.id,
            data.merchants?.webhook_custom_headers ?? {}
          );
        }
        sendReceiptEmail({
          to: data.merchants?.notification_email,
          businessName: data.merchants?.business_name || "Merchant",
          amount: data.amount,
          asset: data.asset,
          recipient: data.recipient,
          txId: match.transaction_hash,
          paymentId: data.id,
        });

        if (!webhookResult.ok && !webhookResult.skipped) {
          console.warn("Webhook failed", webhookResult);
        }

        // Fire-and-forget receipt email — must not block the response
        const receiptTo =
          data.merchants?.notification_email || data.merchants?.email;

        if (receiptTo) {
          const receiptHtml = renderReceiptEmail({
            payment: { ...data, tx_id: match.transaction_hash },
            merchant: data.merchants,
          });
          Promise.resolve()
            .then(() =>
              sendReceiptEmail({
                to: receiptTo,
                subject: `Payment Receipt – ${data.id}`,
                html: receiptHtml,
              })
            )
            .then((result) => {
              if (!result.ok) {
                console.warn("Receipt email failed", result.error);
              }
            })
            .catch((err) => {
              console.warn("Receipt email error", err);
            });
        }

        res.json({
          status: "confirmed",
          tx_id: match.transaction_hash,
          ledger_url: `https://stellar.expert/explorer/testnet/tx/${match.transaction_hash}`,
          webhook: webhookResult,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  /**
   * @swagger
   * /api/payments:
   *   get:
   *     summary: Get paginated list of payments for the authenticated merchant
   *     tags: [Payments]
   *     security:
   *       - ApiKeyAuth: []
   *     parameters:
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *           default: 1
   *         description: Page number (1-indexed)
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           default: 10
   *         description: Number of results per page (max 100)
   *       - in: query
   *         name: client_id
   *         schema:
   *           type: string
   *         description: Filter payments by merchant-defined client identifier
   *     responses:
   *       200:
   *         description: Paginated payments
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 payments:
   *                   type: array
   *                   items:
   *                     type: object
   *                 total_count:
   *                   type: integer
   *                 total_pages:
   *                   type: integer
   *                 page:
   *                   type: integer
   *                 limit:
   *                   type: integer
   *                 links:
   *                   type: object
   *                   properties:
   *                     next:
   *                       type: string
   *                       description: URL to the next page
   *                     previous:
   *                       type: string
   *                       description: URL to the previous page
   *       401:
   *         description: Missing or invalid API key
   */
  router.get("/payments", validateRequest({ query: paymentsListQuerySchema }), async (req, res, next) => {
    try {
      let page = parseInt(req.query.page, 10) || 1;
      let limit = parseInt(req.query.limit, 10) || 10;
      const clientId =
        typeof req.query.client_id === "string" && req.query.client_id.trim()
          ? req.query.client_id.trim()
          : null;

      if (page < 1) page = 1;
      if (limit < 1) limit = 1;
      if (limit > 100) limit = 100;

      const offset = (page - 1) * limit;

      let countQuery = supabase
        .from("payments")
        .select("*", { count: "exact", head: true })
        .eq("merchant_id", req.merchant.id)
        .is("deleted_at", null);
      if (clientId) {
        countQuery = countQuery.eq("client_id", clientId);
      }
      countQuery = applyPaymentFilters(countQuery, req);
      countQuery = applyMetadataFilters(countQuery, req.query);

      const { count: totalCount, error: countError } = await countQuery;

      if (countError) {
        countError.status = 500;
        throw countError;
      }

      let dataQuery = supabase
        .from("payments")
        .select(
          "id, amount, asset, asset_issuer, recipient, description, client_id, status, tx_id, created_at",
        )
        .eq("merchant_id", req.merchant.id)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (clientId) {
        dataQuery = dataQuery.eq("client_id", clientId);
      }
      dataQuery = applyPaymentFilters(dataQuery, req);
      dataQuery = applyMetadataFilters(dataQuery, req.query);
      const { data: payments, error: dataError } = await dataQuery.range(
        offset,
        offset + limit - 1,
      );

      if (dataError) {
        dataError.status = 500;
        throw dataError;
      }

      const totalPages = Math.ceil(totalCount / limit);

      res.json({
        payments: payments || [],
        total_count: totalCount,
        total_pages: totalPages,
        page,
        limit,
        ...generatePaginationLinks(req, page, limit, totalPages),
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * @swagger
   * /api/metrics/7day:
   *   get:
   *     summary: Get 7-day rolling payment volume metrics
   *     tags: [Metrics]
   *     security:
   *       - ApiKeyAuth: []
   *     responses:
   *       200:
   *         description: Daily volume data for past 7 days
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 data:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       date:
   *                         type: string
   *                         description: Date in YYYY-MM-DD format
   *                       volume:
   *                         type: number
   *                         description: Total payment amount for that day
   *                       count:
   *                         type: integer
   *                         description: Number of payments on that day
   *                 total_volume:
   *                   type: number
   *                   description: Total volume across all 7 days
   *                 total_payments:
   *                   type: integer
   *                   description: Total payment count across all 7 days
   *       401:
   *         description: Missing or invalid API key
   */
  router.get("/metrics/7day", async (req, res, next) => {
    try {
      const result = await paymentService.getRollingMetrics(req.merchant.id);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  /**
   * @swagger
   * /api/payments/{id}/refund:
   *   post:
   *     summary: Generate a refund transaction for a confirmed payment
   *     tags: [Payments]
   *     security:
   *       - ApiKeyAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Payment ID
   *     responses:
   *       200:
   *         description: Refund transaction XDR
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 xdr:
   *                   type: string
   *                   description: Transaction XDR to sign and submit
   *                 hash:
   *                   type: string
   *                   description: Transaction hash
   *                 instructions:
   *                   type: string
   *       400:
   *         description: Payment not eligible for refund
   *       404:
   *         description: Payment not found
   */
  router.post(
    "/payments/:id/refund",
    validateUuidParam(),
    async (req, res, next) => {
      try {
        const result = await paymentService.generateRefundTx(req.params.id, req.merchant.id);
        res.json(result);
      } catch (err) {
        next(err);
      }
    }
  );

  /**
   * @swagger
   * /api/payments/{id}/refund/confirm:
   *   post:
   *     summary: Confirm a refund transaction has been submitted
   *     tags: [Payments]
   *     security:
   *       - ApiKeyAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Payment ID
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [tx_hash]
   *             properties:
   *               tx_hash:
   *                 type: string
   *                 description: Submitted refund transaction hash
   *     responses:
   *       200:
   *         description: Refund confirmed
   *       404:
   *         description: Payment not found
   */
  router.post(
    "/payments/:id/refund/confirm",
    validateUuidParam(),
    validateRequest({ body: refundConfirmSchema }),
    async (req, res, next) => {
      try {
        const { tx_hash } = req.body;

        const { data: payment, error } = await supabase
          .from("payments")
          .select("id, metadata")
          .eq("id", req.params.id)
          .eq("merchant_id", req.merchant.id)
          .maybeSingle();

        if (error) {
          error.status = 500;
          throw error;
        }

        if (!payment) {
          return res.status(404).json({ error: "Payment not found" });
        }

        await supabase
          .from("payments")
          .update({
            metadata: {
              ...payment.metadata,
              refund_status: "refunded",
              refund_tx_hash: tx_hash,
              refund_confirmed_at: new Date().toISOString(),
            },
          })
          .eq("id", payment.id);

        res.json({
          status: "refunded",
          refund_tx_hash: tx_hash,
          message: "Refund confirmed successfully",
        });
      } catch (err) {
        next(err);
      }
    }
  );

  /**
   * @swagger
   * /api/anchor/sep24/deposit:
   *   post:
   *     summary: Initiate a SEP-0024 hosted deposit (fiat → Stellar token)
   *     description: >
   *       Starts an interactive deposit flow with a Stellar anchor (e.g. Circle,
   *       MoneyGram). Returns a URL the frontend should open in a popup — the anchor
   *       hosts the deposit form, so no bank details are ever sent to this API.
   *     tags: [Anchor / SEP-0024]
   *     security:
   *       - ApiKeyAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [asset_code, account]
   *             properties:
   *               asset_code:
   *                 type: string
   *                 description: Stellar asset code to deposit (e.g. USDC, EURC)
   *                 example: USDC
   *               account:
   *                 type: string
   *                 description: User's Stellar public key that will receive the tokens
   *               amount:
   *                 type: number
   *                 description: Optional pre-fill amount for the deposit form
   *               anchor_domain:
   *                 type: string
   *                 description: Anchor domain override (defaults to ANCHOR_DOMAIN env var)
   *                 example: testanchor.stellar.org
   *     responses:
   *       200:
   *         description: Interactive deposit URL from the anchor
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 type:
   *                   type: string
   *                   example: interactive_customer_info_needed
   *                 url:
   *                   type: string
   *                   description: Open this URL in a popup for the user to complete the deposit
   *                 id:
   *                   type: string
   *                   description: Anchor transaction ID — use this to poll /anchor/sep24/transaction/:id
   *                 anchor_domain:
   *                   type: string
   *       400:
   *         description: Missing required fields
   *       500:
   *         description: ANCHOR_DOMAIN not configured
   *       502:
   *         description: Anchor request failed
   */
  router.get(
    "/path-payment-quote/:id",
    validateUuidParam(),
    validateRequest({ query: pathPaymentQuoteQuerySchema }),
    async (req, res, next) => {
      try {
        const sourceAsset = req.query.source_asset;
        const sourceAssetIssuer = req.query.source_asset_issuer || null;
        const sourceAccount = req.query.source_account;

        let query = supabase
          .from("payments")
          .select("id, amount, asset, asset_issuer, recipient, status");

        if (req.merchant?.id) {
          query = query.eq("merchant_id", req.merchant.id);
        }

        const { data, error } = await query
          .eq("id", req.params.id)
          .is("deleted_at", null)
          .maybeSingle();

        if (error) {
          error.status = 500;
          throw error;
        }

        if (!data) {
          return res.status(404).json({ error: "Payment not found" });
        }

        const sameAsset =
          sourceAsset.toUpperCase() === data.asset.toUpperCase() &&
          sourceAssetIssuer === (data.asset_issuer || null);

        if (sameAsset) {
          return res.status(400).json({
            error:
              "Source asset is the same as destination asset. Use a direct payment.",
          });
        }

        const quote = await findStrictReceivePaths({
          sourceAccount,
          destAssetCode: data.asset,
          destAssetIssuer: data.asset_issuer,
          destAmount: String(data.amount),
          sourceAssetCode: sourceAsset,
          sourceAssetIssuer,
        });

        if (!quote) {
          return res.status(404).json({
            error: "No path found for this asset pair",
          });
        }

        const SLIPPAGE = 0.01; // 1%
        const sendMax = (
          parseFloat(quote.source_amount) *
          (1 + SLIPPAGE)
        ).toFixed(7);

        res.json({
          source_asset: quote.source_asset_code,
          source_asset_issuer: quote.source_asset_issuer,
          source_amount: quote.source_amount,
          send_max: sendMax,
          destination_asset: data.asset,
          destination_asset_issuer: data.asset_issuer,
          destination_amount: String(data.amount),
          path: quote.path,
          slippage: SLIPPAGE,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  /**
   * @swagger
   * /api/anchor/sep24/withdraw:
   *   post:
   *     summary: Initiate a SEP-0024 hosted withdrawal
   *     tags: [Anchor / SEP-0024]
   */
  router.post("/anchor/sep24/withdraw", async (req, res, next) => {
    try {
      const { asset_code, account, amount, anchor_domain } = req.body;
      if (!data) {
        return res.status(404).json({ error: "Payment not found" });
      }

      // No quote needed if customer is already paying with the right asset
      const sameAsset =
        sourceAsset.toUpperCase() === data.asset.toUpperCase() &&
        (sourceAssetIssuer || null) === (data.asset_issuer || null);

      if (sameAsset) {
        return res.status(400).json({
          error:
            "Source asset is the same as destination asset. Use a direct payment.",
        });
      }

      const SLIPPAGE = 0.01; // 1%

      const quote = await findStrictReceivePaths({
        sourceAccount,
        destAssetCode: data.asset,
        destAssetIssuer: data.asset_issuer,
        destAmount: String(data.amount),
        sourceAssetCode: sourceAsset,
        sourceAssetIssuer,
      });

      if (!quote) {
        return res.status(404).json({
          error: "No path found for this asset pair",
        });
      }

      const sendMax = (
        parseFloat(quote.source_amount) *
        (1 + SLIPPAGE)
      ).toFixed(7);

      res.json({
        source_asset: quote.source_asset_code,
        source_asset_issuer: quote.source_asset_issuer,
        source_amount: quote.source_amount,
        send_max: sendMax,
        destination_asset: data.asset,
        destination_asset_issuer: data.asset_issuer,
        destination_amount: String(data.amount),
        path: quote.path,
        slippage: SLIPPAGE,
      });
    } catch (err) {
      next(err);
    }
  }
  );

  /**
   * @swagger
   * /api/anchor/sep24/transaction/{id}:
   * get:
   * summary: Poll the status of a SEP-0024 anchor transaction
   * description: >
   * Fetches the current status of a deposit or withdrawal transaction from
   * the anchor. Call this repeatedly after the user closes the popup to check
   * whether the transaction has completed.
   * tags: [Anchor / SEP-0024]
   * security:
   * - ApiKeyAuth: []
   * parameters:
   * - in: path
   * name: id
   * required: true
   * schema:
   * type: string
   * description: Anchor transaction ID returned from /deposit or /withdraw
   * - in: query
   * name: anchor_domain
   * schema:
   * type: string
   * description: Anchor domain override (defaults to ANCHOR_DOMAIN env var)
   * responses:
   * 200:
   * description: Transaction object from the anchor
   * content:
   * application/json:
   * schema:
   * type: object
   * properties:
   * transaction:
   * type: object
   * properties:
   * id:
   * type: string
   * status:
   * type: string
   * description: >
   * One of: incomplete, pending_user_transfer_start,
   * pending_anchor, pending_stellar, completed, error
   * amount_in:
   * type: string
   * amount_out:
   * type: string
   * stellar_transaction_id:
   * type: string
   * more_info_url:
   * type: string
   * 400:
   * description: Missing transaction ID
   * 500:
   * description: ANCHOR_DOMAIN not configured
   * 502:
   * description: Anchor request failed
   * /api/payments/{id}:
   *   delete:
   *     summary: Soft delete a payment (preserves audit logs)
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
   *         description: Payment soft deleted
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                 payment_id:
   *                   type: string
   *                 deleted_at:
   *                   type: string
   *       404:
   *         description: Payment not found
   *       410:
   *         description: Payment already deleted
   */
  router.delete("/payments/:id", validateUuidParam(), async (req, res, next) => {
    try {
      // First check if payment exists and is not already deleted
      const { data: existing, error: fetchError } = await supabase
        .from("payments")
        .select("id, deleted_at, merchant_id")
        .eq("id", req.params.id)
        .maybeSingle();

      if (fetchError) {
        fetchError.status = 500;
        throw fetchError;
      }

      if (!existing) {
        return res.status(404).json({ error: "Payment not found" });
      }

      // Verify merchant owns this payment
      if (req.merchant?.id && existing.merchant_id !== req.merchant.id) {
        return res.status(403).json({ error: "Forbidden" });
      }

      if (existing.deleted_at) {
        return res.status(410).json({
          error: "Payment already deleted",
          deleted_at: existing.deleted_at
        });
      }

      // Soft delete by setting deleted_at timestamp
      const now = new Date().toISOString();
      const { error: updateError } = await supabase
        .from("payments")
        .update({ deleted_at: now })
        .eq("id", req.params.id);

      if (updateError) {
        updateError.status = 500;
        throw updateError;
      }

      res.json({
        message: "Payment soft deleted successfully",
        payment_id: req.params.id,
        deleted_at: now
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export default createPaymentsRouter;
