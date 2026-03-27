import "dotenv/config";
import express from "express";
import rateLimit from "express-rate-limit";
import { randomUUID } from "node:crypto";
import {
  findMatchingPayment,
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
        const { data, error } = await supabase
          .from("payments")
          .select(
            "id, amount, asset, asset_issuer, recipient, description, memo, memo_type, status, tx_id, metadata, created_at, merchants(branding_config)",
          )
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
    },
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
        const { data, error } = await supabase
          .from("payments")
          .select(
            "id, amount, asset, asset_issuer, recipient, status, tx_id, memo, memo_type, webhook_url, merchants(webhook_secret)",
          )
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

        const merchantSecret = data.merchants?.webhook_secret;

        const webhookResult = await sendWebhook(
          data.webhook_url,
          {
            event: "payment.confirmed",
            payment_id: data.id,
            amount: data.amount,
            asset: data.asset,
            asset_issuer: data.asset_issuer,
            recipient: data.recipient,
            tx_id: match.transaction_hash,
          },
          merchantSecret,
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
    },
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
          "id, amount, asset, asset_issuer, recipient, description, status, tx_id, created_at",
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

      res.json({
        data,
        total_volume: Number(totalVolume.toFixed(2)),
        total_payments: payments.length,
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
            "id, merchant_id, amount, asset, asset_issuer, recipient, status, tx_id, metadata",
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
    },
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
    },
  );


  /**
   * Fetches the anchor's stellar.toml and extracts its SEP-0024 transfer server URL.
   * Every SEP-compliant anchor publishes this at /.well-known/stellar.toml
   *
   * @param {string} anchorDomain - e.g. "testanchor.stellar.org"
   * @returns {Promise<string>} - The TRANSFER_SERVER_SEP0024 URL
   */
  async function fetchAnchorToml(anchorDomain) {
    const tomlUrl = `https://${anchorDomain}/.well-known/stellar.toml`;
    const response = await fetch(tomlUrl);

    if (!response.ok) {
      throw Object.assign(
        new Error(`Failed to fetch anchor TOML from ${tomlUrl}`),
        { status: 502 }
      );
    }

    const text = await response.text();

    // Parse TRANSFER_SERVER_SEP0024 from the TOML file
    // Example line: TRANSFER_SERVER_SEP0024 = "https://sep24.circle.com/sep24"
    const match = text.match(/TRANSFER_SERVER_SEP0024\s*=\s*"([^"]+)"/);
    if (!match) {
      throw Object.assign(
        new Error(
          `Anchor TOML at ${tomlUrl} is missing TRANSFER_SERVER_SEP0024`
        ),
        { status: 502 }
      );
    }

    return match[1]; // The base URL of the anchor's SEP-0024 API
  }

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
  router.post("/anchor/sep24/deposit", async (req, res, next) => {
    try {
      const { asset_code, account, amount, anchor_domain } = req.body;

      if (!asset_code || !account) {
        return res.status(400).json({
          error: "asset_code and account are required",
        });
      }

      const domain = anchor_domain || process.env.ANCHOR_DOMAIN;
      if (!domain) {
        return res.status(500).json({
          error:
            "No anchor domain configured. Set ANCHOR_DOMAIN in your .env file (e.g. testanchor.stellar.org)",
        });
      }

      // Step 1: Read the anchor's TOML to get its SEP-0024 server URL
      const transferServer = await fetchAnchorToml(domain);

      // Step 2: Call the anchor's deposit endpoint
      // The anchor returns a URL for the user to open — we never see bank details
      const anchorRes = await fetch(
        `${transferServer}/transactions/deposit/interactive`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // If your anchor requires a JWT bearer token, add it here:
            // "Authorization": `Bearer ${your_sep10_jwt}`,
          },
          body: JSON.stringify({
            asset_code,
            account,
            ...(amount !== undefined && { amount: String(amount) }),
          }),
        }
      );

      if (!anchorRes.ok) {
        const errBody = await anchorRes.text();
        return res.status(502).json({
          error: "Anchor rejected the deposit request",
          anchor_status: anchorRes.status,
          detail: errBody,
        });
      }

      const anchorData = await anchorRes.json();

      // anchorData shape (SEP-0024 spec):
      // {
      //   type: "interactive_customer_info_needed",
      //   url:  "https://anchor.example.com/sep24/transactions/deposit?token=...",
      //   id:   "2cb4c100-a1e2-4273-9b2c-abc123"
      // }
      res.json({
        type: anchorData.type,
        url: anchorData.url,           // Frontend opens this in a popup
        id: anchorData.id,             // Poll this with GET /anchor/sep24/transaction/:id
        anchor_domain: domain,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * @swagger
   * /api/anchor/sep24/withdraw:
   *   post:
   *     summary: Initiate a SEP-0024 hosted withdrawal (Stellar token → fiat)
   *     description: >
   *       Starts an interactive withdrawal flow with a Stellar anchor. Returns a URL
   *       the frontend opens in a popup where the user enters their bank/cash-out details.
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
   *                 description: Stellar asset code to withdraw (e.g. USDC, EURC)
   *                 example: USDC
   *               account:
   *                 type: string
   *                 description: User's Stellar public key that holds the tokens
   *               amount:
   *                 type: number
   *                 description: Optional pre-fill amount for the withdrawal form
   *               anchor_domain:
   *                 type: string
   *                 description: Anchor domain override (defaults to ANCHOR_DOMAIN env var)
   *     responses:
   *       200:
   *         description: Interactive withdrawal URL from the anchor
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
   *                   description: Open this URL in a popup for the user to complete the withdrawal
   *                 id:
   *                   type: string
   *                   description: Anchor transaction ID for polling
   *                 anchor_domain:
   *                   type: string
   *       400:
   *         description: Missing required fields
   *       500:
   *         description: ANCHOR_DOMAIN not configured
   *       502:
   *         description: Anchor request failed
   */
  router.post("/anchor/sep24/withdraw", async (req, res, next) => {
    try {
      const { asset_code, account, amount, anchor_domain } = req.body;

      if (!asset_code || !account) {
        return res.status(400).json({
          error: "asset_code and account are required",
        });
      }

      const domain = anchor_domain || process.env.ANCHOR_DOMAIN;
      if (!domain) {
        return res.status(500).json({
          error:
            "No anchor domain configured. Set ANCHOR_DOMAIN in your .env file (e.g. testanchor.stellar.org)",
        });
      }

      // Step 1: Discover the anchor's SEP-0024 server from its TOML
      const transferServer = await fetchAnchorToml(domain);

      // Step 2: Call the anchor's withdrawal endpoint
      const anchorRes = await fetch(
        `${transferServer}/transactions/withdraw/interactive`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // "Authorization": `Bearer ${your_sep10_jwt}`,
          },
          body: JSON.stringify({
            asset_code,
            account,
            ...(amount !== undefined && { amount: String(amount) }),
          }),
        }
      );

      if (!anchorRes.ok) {
        const errBody = await anchorRes.text();
        return res.status(502).json({
          error: "Anchor rejected the withdrawal request",
          anchor_status: anchorRes.status,
          detail: errBody,
        });
      }

      const anchorData = await anchorRes.json();

      res.json({
        type: anchorData.type,
        url: anchorData.url,           // Frontend opens this in a popup
        id: anchorData.id,             // Poll this with GET /anchor/sep24/transaction/:id
        anchor_domain: domain,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * @swagger
   * /api/anchor/sep24/transaction/{id}:
   *   get:
   *     summary: Poll the status of a SEP-0024 anchor transaction
   *     description: >
   *       Fetches the current status of a deposit or withdrawal transaction from
   *       the anchor. Call this repeatedly after the user closes the popup to check
   *       whether the transaction has completed.
   *     tags: [Anchor / SEP-0024]
   *     security:
   *       - ApiKeyAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Anchor transaction ID returned from /deposit or /withdraw
   *       - in: query
   *         name: anchor_domain
   *         schema:
   *           type: string
   *         description: Anchor domain override (defaults to ANCHOR_DOMAIN env var)
   *     responses:
   *       200:
   *         description: Transaction object from the anchor
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 transaction:
   *                   type: object
   *                   properties:
   *                     id:
   *                       type: string
   *                     status:
   *                       type: string
   *                       description: >
   *                         One of: incomplete, pending_user_transfer_start,
   *                         pending_anchor, pending_stellar, completed, error
   *                     amount_in:
   *                       type: string
   *                     amount_out:
   *                       type: string
   *                     stellar_transaction_id:
   *                       type: string
   *                     more_info_url:
   *                       type: string
   *       400:
   *         description: Missing transaction ID
   *       500:
   *         description: ANCHOR_DOMAIN not configured
   *       502:
   *         description: Anchor request failed
   */
  router.get("/anchor/sep24/transaction/:id", async (req, res, next) => {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({ error: "Transaction ID is required" });
      }

      const domain = req.query.anchor_domain || process.env.ANCHOR_DOMAIN;
      if (!domain) {
        return res.status(500).json({
          error:
            "No anchor domain configured. Set ANCHOR_DOMAIN in your .env file",
        });
      }

      // Discover the anchor's SEP-0024 server
      const transferServer = await fetchAnchorToml(domain);

      // Fetch the transaction status from the anchor
      const anchorRes = await fetch(
        `${transferServer}/transaction?id=${encodeURIComponent(id)}`,
        {
          headers: {
            // "Authorization": `Bearer ${your_sep10_jwt}`,
          },
        }
      );

      if (!anchorRes.ok) {
        return res.status(502).json({
          error: "Failed to fetch transaction status from anchor",
          anchor_status: anchorRes.status,
        });
      }

      const data = await anchorRes.json();

      // Anchor response shape (SEP-0024 spec):
      // {
      //   transaction: {
      //     id:                     "2cb4c100-...",
      //     kind:                   "deposit",
      //     status:                 "completed",   ← watch this field
      //     amount_in:              "100.00",
      //     amount_out:             "99.50",
      //     amount_fee:             "0.50",
      //     stellar_transaction_id: "abc123...",   ← on-chain tx hash when done
      //     more_info_url:          "https://..."
      //   }
      // }
      //
      // Possible status values:
      //   incomplete                  — user hasn't finished the popup form yet
      //   pending_user_transfer_start — waiting for user to send Stellar tokens (withdraw only)
      //   pending_anchor              — anchor is processing
      //   pending_stellar             — anchor is waiting for Stellar confirmation
      //   completed                   — done, tokens delivered
      //   error                       — something went wrong on the anchor's side

      res.json(data);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export default createPaymentsRouter;