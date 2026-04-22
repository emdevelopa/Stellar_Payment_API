import { randomUUID } from "node:crypto";
import { supabase } from "../lib/supabase.js";
import {
  findMatchingPayment,
  createRefundTransaction,
  findStrictReceivePaths,
} from "../lib/stellar.js";
import { resolveBrandingConfig } from "../lib/branding.js";
import { sendWebhook } from "../lib/webhooks.js";
import { getPayloadForVersion } from "../webhooks/resolver.js";
import { sendReceiptEmail } from "../lib/email.js";
import { renderReceiptEmail } from "../lib/email-templates.js";
import {
  connectRedisClient,
  getCachedPayment,
  setCachedPayment,
  invalidatePaymentCache,
} from "../lib/redis.js";
import { ASSET_DEFAULTS } from "../constants/assetConstants.js";
import {
  paymentCreatedCounter,
  paymentConfirmedCounter,
  paymentConfirmationLatency,
  paymentFailedCounter,
} from "../lib/metrics.js";

function applyPaymentFilters(query, filters) {
  const { status, asset, date_from: dateFrom, date_to: dateTo, search } = filters;

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

  if (typeof search === "string" && search.trim().length > 0) {
    const term = search.trim().replaceAll(",", "\\,");
    query = query.or(
      `id.ilike.%${term}%,description.ilike.%${term}%,recipient.ilike.%${term}%`
    );
  }

  return query;
}

export const paymentService = {
  async createPaymentSession(merchant, body) {
    // Per-asset payment limit validation
    const limits = merchant.payment_limits;
    if (limits && typeof limits === "object") {
      const assetLimits = limits[body.asset];
      if (assetLimits) {
        if (assetLimits.min !== undefined && body.amount < assetLimits.min) {
          paymentFailedCounter.inc({ asset: body.asset, reason: "below_min" });
          const error = new Error(`Amount is below the minimum for ${body.asset}`);
          error.status = 400;
          error.details = {
            min: assetLimits.min,
            delta: Number((assetLimits.min - body.amount).toFixed(7)),
          };
          throw error;
        }
        if (assetLimits.max !== undefined && body.amount > assetLimits.max) {
          paymentFailedCounter.inc({ asset: body.asset, reason: "above_max" });
          const error = new Error(`Amount exceeds the maximum for ${body.asset}`);
          error.status = 400;
          error.details = {
            max: assetLimits.max,
            delta: Number((body.amount - assetLimits.max).toFixed(7)),
          };
          throw error;
        }
      }
    }

    // Allowed-issuers check
    const allowedIssuers = merchant.allowed_issuers;
    if (Array.isArray(allowedIssuers) && allowedIssuers.length > 0) {
      if (!body.asset_issuer || !allowedIssuers.includes(body.asset_issuer)) {
        paymentFailedCounter.inc({ asset: body.asset, reason: "invalid_issuer" });
        const error = new Error("asset_issuer is not in the merchant's list of allowed issuers");
        error.status = 400;
        throw error;
      }
    }

    const paymentId = randomUUID();
    const now = new Date().toISOString();
    const paymentLinkBase = process.env.PAYMENT_LINK_BASE || "http://localhost:3000";
    const paymentLink = `${paymentLinkBase}/pay/${paymentId}`;
    
    const resolvedBranding = resolveBrandingConfig({
      merchantBranding: merchant.branding_config,
      brandingOverrides: body.branding_overrides,
    });

    const metadata = body.metadata && typeof body.metadata === "object" ? { ...body.metadata } : {};
    metadata.branding_config = resolvedBranding;

    const network = (process.env.STELLAR_NETWORK || "testnet").toLowerCase();
    const asset = body.asset?.toUpperCase();
    let assetIssuer = body.asset_issuer;

    if (!assetIssuer && ASSET_DEFAULTS[asset]) {
      assetIssuer = ASSET_DEFAULTS[asset][network] || ASSET_DEFAULTS[asset]["testnet"];
    }

    const payload = {
      id: paymentId,
      merchant_id: merchant.id,
      amount: body.amount,
      asset: asset,
      asset_issuer: assetIssuer || null,
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

    const { error: insertError } = await supabase.from("payments").insert(payload);

    if (insertError) {
      insertError.status = 500;
      throw insertError;
    }

    // Record metric for payment creation
    paymentCreatedCounter.inc({ asset: body.asset });

    return {
      payment_id: paymentId,
      payment_link: paymentLink,
      status: "pending",
      branding_config: resolvedBranding,
    };
  },

  async getPaymentStatus(paymentId, merchantId = null) {
    // --- Redis read-through cache ---
    const redis = await connectRedisClient();
    const cached = await getCachedPayment(redis, paymentId);
    if (cached) {
      return { payment: cached };
    }

    let query = supabase
      .from("payments")
      .select(
        "id, amount, asset, asset_issuer, recipient, description, memo, memo_type, status, tx_id, metadata, created_at, merchants(branding_config)"
      );

    if (merchantId) {
      query = query.eq("merchant_id", merchantId);
    }

    const { data, error } = await query
      .eq("id", paymentId)
      .is("deleted_at", null)
      .maybeSingle();

    if (error) {
      error.status = 500;
      throw error;
    }

    if (!data) {
      const err = new Error("Payment not found");
      err.status = 404;
      throw err;
    }

    const metadataBranding = data.metadata?.branding_config || null;
    const merchantBranding = data.merchants?.branding_config || null;
    const brandingConfig = metadataBranding || merchantBranding || null;

    const response = {
      ...data,
      branding_config: brandingConfig,
    };
    delete response.merchants;

    // Cache the result to absorb polling bursts
    await setCachedPayment(redis, paymentId, response);

    return { payment: response };
  },

  async verifyPayment(paymentId, merchantId = null, io = null) {
    let query = supabase
      .from("payments")
      .select(
        "id, merchant_id, amount, asset, asset_issuer, recipient, status, tx_id, memo, memo_type, webhook_url, created_at, merchants(webhook_secret, webhook_version, notification_email, email)"
      );

    if (merchantId) {
      query = query.eq("merchant_id", merchantId);
    }

    const { data, error } = await query
      .eq("id", paymentId)
      .is("deleted_at", null)
      .maybeSingle();

    if (error) {
      error.status = 500;
      throw error;
    }

    if (!data) {
      const err = new Error("Payment not found");
      err.status = 404;
      throw err;
    }

    if (data.status === "confirmed") {
      return {
        status: "confirmed",
        tx_id: data.tx_id,
        ledger_url: `https://stellar.expert/explorer/testnet/tx/${data.tx_id}`,
      };
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
      return { status: "pending" };
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

    // Invalidate cache
    const redis = await connectRedisClient();
    await invalidatePaymentCache(redis, data.id);

    // Record metrics
    paymentConfirmedCounter.inc({ asset: data.asset });
    paymentConfirmationLatency.observe({ asset: data.asset }, latencySeconds);

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

    const webhookPayload = getPayloadForVersion(merchantVersion, "payment.confirmed", {
      payment_id: data.id,
      amount: data.amount,
      asset: data.asset,
      asset_issuer: data.asset_issuer,
      recipient: data.recipient,
      tx_id: match.transaction_hash,
    });

    const webhookResult = await sendWebhook(data.webhook_url, webhookPayload, merchantSecret);

    // Fire-and-forget receipt email
    const receiptTo = data.merchants?.notification_email || data.merchants?.email;
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
        .catch((err) => {
          console.warn("Receipt email error", err);
        });
    }

    return {
      status: "confirmed",
      tx_id: match.transaction_hash,
      ledger_url: `https://stellar.expert/explorer/testnet/tx/${match.transaction_hash}`,
      webhook: webhookResult,
    };
  },

  async getMerchantPayments(merchantId, queryParams) {
    let page = parseInt(queryParams.page, 10) || 1;
    let limit = parseInt(queryParams.limit, 10) || 10;

    if (page < 1) page = 1;
    if (limit < 1) limit = 1;
    if (limit > 100) limit = 100;

    const offset = (page - 1) * limit;

    let countQuery = supabase
      .from("payments")
      .select("*", { count: "exact", head: true })
      .eq("merchant_id", merchantId);

    countQuery = applyPaymentFilters(countQuery, queryParams);

    const { count: totalCount, error: countError } = await countQuery;

    if (countError) {
      countError.status = 500;
      throw countError;
    }

    let dataQuery = supabase
      .from("payments")
      .select("id, amount, asset, asset_issuer, recipient, description, status, tx_id, created_at")
      .eq("merchant_id", merchantId);

    dataQuery = applyPaymentFilters(dataQuery, queryParams);

    const { data: payments, error: dataError } = await dataQuery
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (dataError) {
      dataError.status = 500;
      throw dataError;
    }

    const totalPages = Math.ceil(totalCount / limit);

    return {
      payments: payments || [],
      total_count: totalCount,
      total_pages: totalPages,
      page,
      limit,
    };
  },

  async getRollingMetrics(merchantId) {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data: payments, error } = await supabase
      .from("payments")
      .select("amount, created_at, status")
      .eq("merchant_id", merchantId)
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
      payments.length > 0 ? Number(((confirmedCount / payments.length) * 100).toFixed(1)) : 0;

    return {
      data,
      total_volume: Number(totalVolume.toFixed(2)),
      total_payments: payments.length,
      confirmed_count: confirmedCount,
      success_rate: successRate,
    };
  },

  async generateRefundTx(paymentId, merchantId) {
    const { data: payment, error } = await supabase
      .from("payments")
      .select("id, merchant_id, amount, asset, asset_issuer, recipient, status, tx_id, metadata")
      .eq("id", paymentId)
      .eq("merchant_id", merchantId)
      .maybeSingle();

    if (error) {
      error.status = 500;
      throw error;
    }

    if (!payment) {
      const err = new Error("Payment not found");
      err.status = 404;
      throw err;
    }

    if (payment.status !== "confirmed") {
      const err = new Error("Only confirmed payments can be refunded");
      err.status = 400;
      throw err;
    }

    if (payment.metadata?.refund_status === "refunded") {
      const err = new Error("Payment already refunded");
      err.status = 400;
      throw err;
    }

    const StellarSdk = await import("stellar-sdk");
    const HORIZON_URL =
      process.env.STELLAR_HORIZON_URL ||
      (process.env.STELLAR_NETWORK === "public"
        ? "https://horizon.stellar.org"
        : "https://horizon-testnet.stellar.org");

    const server = new StellarSdk.Horizon.Server(HORIZON_URL);
    const tx = await server.transactions().transaction(payment.tx_id).call();

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

    return {
      xdr: refundTx.xdr,
      hash: refundTx.hash,
      refund_amount: payment.amount,
      refund_destination: refundDestination,
      instructions:
        "Sign this transaction with your merchant wallet and submit to Stellar network. Then call POST /api/payments/:id/refund/confirm with the transaction hash.",
    };
  },

  async confirmRefundTx(paymentId, merchantId, txHash) {
    const { data: payment, error } = await supabase
      .from("payments")
      .select("id, metadata")
      .eq("id", paymentId)
      .eq("merchant_id", merchantId)
      .maybeSingle();

    if (error) {
      error.status = 500;
      throw error;
    }

    if (!payment) {
      const err = new Error("Payment not found");
      err.status = 404;
      throw err;
    }

    await supabase
      .from("payments")
      .update({
        metadata: {
          ...payment.metadata,
          refund_status: "refunded",
          refund_tx_hash: txHash,
          refund_confirmed_at: new Date().toISOString(),
        },
      })
      .eq("id", payment.id);

    return { message: "Refund confirmed successfully" };
  },

  async getPathPaymentQuote(paymentId, sourceAsset, sourceAssetIssuer, sourceAccount, merchantId = null) {
    let query = supabase
      .from("payments")
      .select("id, amount, asset, asset_issuer, recipient, status");

    if (merchantId) {
      query = query.eq("merchant_id", merchantId);
    }

    const { data, error } = await query.eq("id", paymentId).maybeSingle();

    if (error) {
      error.status = 500;
      throw error;
    }

    if (!data) {
      const err = new Error("Payment not found");
      err.status = 404;
      throw err;
    }

    // No quote needed if customer is already paying with the right asset
    const sameAsset =
      sourceAsset.toUpperCase() === data.asset.toUpperCase() &&
      (sourceAssetIssuer || null) === (data.asset_issuer || null);

    if (sameAsset) {
      const err = new Error("Source asset is the same as destination asset. Use a direct payment.");
      err.status = 400;
      throw err;
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
      const err = new Error("No path found for this asset pair");
      err.status = 404;
      throw err;
    }

    const sendMax = (parseFloat(quote.source_amount) * (1 + SLIPPAGE)).toFixed(7);

    return {
      source_asset: quote.source_asset_code,
      source_asset_issuer: quote.source_asset_issuer,
      source_amount: quote.source_amount,
      send_max: sendMax,
      destination_asset: data.asset,
      destination_asset_issuer: data.asset_issuer,
      destination_amount: String(data.amount),
      path: quote.path,
      slippage: SLIPPAGE,
    };
  },
};
