import "dotenv/config";
import express from "express";
import rateLimit from "express-rate-limit";
import { randomUUID } from "node:crypto";
import {
  findMatchingPayment,
  findStrictReceivePaths,
  createRefundTransaction,
} from "../lib/stellar.js";
import { supabase } from "../lib/supabase.js";
import { validateUuidParam } from "../lib/validate-uuid.js";
import {
  paymentSessionZodSchema,
  parseVersionedPaymentBody,
} from "../lib/request-schemas.js";
import { createCreatePaymentRateLimit } from "../lib/create-payment-rate-limit.js";
import { sendWebhook } from "../lib/webhooks.js";
import { resolveBrandingConfig } from "../lib/branding.js";
import { getPayloadForVersion } from "../webhooks/resolver.js";

const createPaymentRateLimit = createCreatePaymentRateLimit();

const defaultVerifyPaymentRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: "Too many verification requests, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

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
   *               merchant_id:
   *                 type: string
   *               description:
   *                 type: string
   *               memo:
   *                 type: string
   *               memo_type:
   *                 type: string
   *                 enum: [text, id, hash, return]
   *               webhook_url:
   *                 type: string
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
      const body = parseVersionedPaymentBody(req);

      // Per-asset payment limit validation (#153)
      const limits = req.merchant.payment_limits;
      if (limits && typeof limits === "object") {
        const assetLimits = limits[body.asset];
        if (assetLimits) {
          if (assetLimits.min !== undefined && body.amount < assetLimits.min) {
            return res.status(400).json({
              error: `Amount is below the minimum for ${body.asset}`,
              min: assetLimits.min,
              delta: Number((assetLimits.min - body.amount).toFixed(7)),
            });
          }
          if (assetLimits.max !== undefined && body.amount > assetLimits.max) {
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
          return res.status(400).json({
            error:
              "asset_issuer is not in the merchant's list of allowed issuers",
          });
        }
      }

      const paymentId = randomUUID();
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
        status: "pending",
        tx_id: null,
        metadata,
        created_at: now,
      };

      const { error: insertError } = await supabase
        .from("payments")
        .insert(payload);

      if (insertError) {
        insertError.status = 500;
        throw insertError;
      }

      res.status(201).json({
        payment_id: paymentId,
        payment_link: paymentLink,
        status: "pending",
        branding_config: resolvedBrandingConfig,
      });
    } catch (err) {
      next(err);
    }
  }

  router.post("/create-payment", createPaymentRateLimit, createSession);
  router.post("/sessions", createPaymentRateLimit, createSession);

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

        res.json({ payment: response });
      } catch (err) {
        next(err);
      }
    }
  );

  /**
   * @swagger
   * /api/verify-payment/{id}:
   *   post:
   *     summary: Verify a payment on the Stellar network
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
   *         description: Verification result
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 status:
   *                   type: string
   *                   enum: [pending, confirmed]
   *                 tx_id:
   *                   type: string
   *                 webhook:
   *                   type: object
   *       404:
   *         description: Payment not found
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
  "id, merchant_id, amount, asset, asset_issuer, recipient, status, tx_id, memo, memo_type, webhook_url, merchants(webhook_secret, webhook_version)"
);

        if (req.merchant?.id) {
          query = query.eq("merchant_id", req.merchant.id);
        }

        const { data, error } = await query
          .eq("id", req.params.id)
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

        const { error: updateError } = await supabase
          .from("payments")
          .update({ status: "confirmed", tx_id: match.transaction_hash })
          .eq("id", data.id);

        if (updateError) {
          updateError.status = 500;
          throw updateError;
        }

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

const webhookResult = await sendWebhook(
  data.webhook_url,
  webhookPayload,
  merchantSecret
);

        if (!webhookResult.ok && !webhookResult.skipped) {
          console.warn("Webhook failed", webhookResult);
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
   *       401:
   *         description: Missing or invalid API key
   */
  router.get("/payments", async (req, res, next) => {
    try {
      let page = parseInt(req.query.page, 10) || 1;
      let limit = parseInt(req.query.limit, 10) || 10;

      if (page < 1) page = 1;
      if (limit < 1) limit = 1;
      if (limit > 100) limit = 100;

      const offset = (page - 1) * limit;

      const { count: totalCount, error: countError } = await supabase
        .from("payments")
        .select("*", { count: "exact", head: true })
        .eq("merchant_id", req.merchant.id);

      if (countError) {
        countError.status = 500;
        throw countError;
      }

      const { data: payments, error: dataError } = await supabase
        .from("payments")
        .select(
          "id, amount, asset, asset_issuer, recipient, description, status, tx_id, created_at"
        )
        .eq("merchant_id", req.merchant.id)
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

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
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const { data: payments, error } = await supabase
        .from("payments")
        .select("amount, created_at, status")
        .eq("merchant_id", req.merchant.id)
        .gte("created_at", sevenDaysAgo.toISOString())
        .order("created_at", { ascending: true });

      if (error) {
        error.status = 500;
        throw error;
      }

      const metricsMap = new Map();
      let totalVolume = 0;

      payments.forEach((payment) => {
        const date = new Date(payment.created_at).toISOString().split("T")[0];
        const volume = Number(payment.amount) || 0;

        if (!metricsMap.has(date)) {
          metricsMap.set(date, { date, volume: 0, count: 0 });
        }

        const dayMetric = metricsMap.get(date);
        dayMetric.volume += volume;
        dayMetric.count += 1;
        totalVolume += volume;
      });

      const data = [];
      for (let i = 6; i >= 0; i -= 1) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split("T")[0];

        if (metricsMap.has(dateStr)) {
          data.push(metricsMap.get(dateStr));
        } else {
          data.push({ date: dateStr, volume: 0, count: 0 });
        }
      }

      const confirmedCount = payments.filter((p) => p.status === "confirmed").length;
      const successRate =
        payments.length > 0
          ? Number(((confirmedCount / payments.length) * 100).toFixed(1))
          : 0;

      res.json({
        data,
        total_volume: Number(totalVolume.toFixed(2)),
        total_payments: payments.length,
        confirmed_count: confirmedCount,
        success_rate: successRate,
      });
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
        const { data: payment, error } = await supabase
          .from("payments")
          .select(
            "id, merchant_id, amount, asset, asset_issuer, recipient, status, tx_id, metadata"
          )
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

        if (payment.status !== "confirmed") {
          return res.status(400).json({
            error: "Only confirmed payments can be refunded",
          });
        }

        if (payment.metadata?.refund_status === "refunded") {
          return res.status(400).json({
            error: "Payment already refunded",
          });
        }

        const StellarSdk = await import("stellar-sdk");
        const HORIZON_URL =
          process.env.STELLAR_HORIZON_URL ||
          (process.env.STELLAR_NETWORK === "public"
            ? "https://horizon.stellar.org"
            : "https://horizon-testnet.stellar.org");

        const server = new StellarSdk.Horizon.Server(HORIZON_URL);
        const tx = await server
          .transactions()
          .transaction(payment.tx_id)
          .call();

        const refundDestination = tx.source_account;

        const refundTx = await createRefundTransaction({
          sourceAccount: payment.recipient,
          destination: refundDestination,
          amount: payment.amount,
          assetCode: payment.asset,
          assetIssuer: payment.asset_issuer,
          memo: `Refund: ${payment.id.substring(0, 8)}`,
        });

        await supabase
          .from("payments")
          .update({
            metadata: {
              ...payment.metadata,
              refund_status: "pending",
              refund_xdr: refundTx.xdr,
              refund_created_at: new Date().toISOString(),
            },
          })
          .eq("id", payment.id);

        res.json({
          xdr: refundTx.xdr,
          hash: refundTx.hash,
          refund_amount: payment.amount,
          refund_destination: refundDestination,
          instructions:
            "Sign this transaction with your merchant wallet and submit to Stellar network. Then call POST /api/payments/:id/refund/confirm with the transaction hash.",
        });
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
    async (req, res, next) => {
      try {
        const { tx_hash } = req.body;

        if (!tx_hash) {
          return res.status(400).json({ error: "Transaction hash required" });
        }

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
   * /api/path-payment-quote/{id}:
   *   get:
   *     summary: Get a path payment quote for a payment session
   *     description: Returns the estimated send amount if the customer wants to pay with a different asset than the merchant expects.
   *     tags: [Payments]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Payment ID
   *       - in: query
   *         name: source_asset
   *         required: true
   *         schema:
   *           type: string
   *         description: Asset code the customer wants to send (e.g. XLM)
   *       - in: query
   *         name: source_asset_issuer
   *         schema:
   *           type: string
   *         description: Issuer of the source asset (required if not XLM)
   *       - in: query
   *         name: source_account
   *         required: true
   *         schema:
   *           type: string
   *         description: Customer's Stellar public key
   *     responses:
   *       200:
   *         description: Path payment quote
   *       400:
   *         description: Missing parameters or same asset
   *       404:
   *         description: Payment not found or no path available
   */
  router.get(
    "/path-payment-quote/:id",
    validateUuidParam(),
    async (req, res, next) => {
      try {
        const sourceAsset = req.query.source_asset;
        const sourceAssetIssuer = req.query.source_asset_issuer || null;
        const sourceAccount = req.query.source_account;

        if (!sourceAsset || !sourceAccount) {
          return res.status(400).json({
            error:
              "source_asset and source_account query parameters are required",
          });
        }

        let query = supabase
          .from("payments")
          .select("id, amount, asset, asset_issuer, recipient, status");

        if (req.merchant?.id) {
          query = query.eq("merchant_id", req.merchant.id);
        }

        const { data, error } = await query
          .eq("id", req.params.id)
          .maybeSingle();

        if (error) {
          error.status = 500;
          throw error;
        }

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

  return router;
}

export default createPaymentsRouter;

