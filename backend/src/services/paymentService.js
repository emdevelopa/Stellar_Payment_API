import { randomUUID } from "node:crypto";
import { supabase } from "../lib/supabase.js";
import { resolveBrandingConfig } from "../lib/branding.js";
import { sendWebhook } from "../lib/webhooks.js";
import { getPayloadForVersion } from "../webhooks/resolver.js";
import {
  findMatchingPayment,
  findStrictReceivePaths,
  createRefundTransaction,
} from "../lib/stellar.js";

/**
 * Payment Service handles core business logic for payment lifecycles.
 */
export const paymentService = {
  /**
   * Creates a new payment session.
   */
  async createSession(merchant, body) {
    // Per-asset payment limit validation
    const limits = merchant.payment_limits;
    if (limits && typeof limits === "object") {
      const assetLimits = limits[body.asset];
      if (assetLimits) {
        if (assetLimits.min !== undefined && body.amount < assetLimits.min) {
          const err = new Error(`Amount is below the minimum for ${body.asset}`);
          err.status = 400;
          err.details = { min: assetLimits.min, delta: Number((assetLimits.min - body.amount).toFixed(7)) };
          throw err;
        }
        if (assetLimits.max !== undefined && body.amount > assetLimits.max) {
          const err = new Error(`Amount exceeds the maximum for ${body.asset}`);
          err.status = 400;
          err.details = { max: assetLimits.max, delta: Number((body.amount - assetLimits.max).toFixed(7)) };
          throw err;
        }
      }
    }

    // Allowed-issuers check
    const allowedIssuers = merchant.allowed_issuers;
    if (Array.isArray(allowedIssuers) && allowedIssuers.length > 0) {
      if (!body.asset_issuer || !allowedIssuers.includes(body.asset_issuer)) {
        const err = new Error("asset_issuer is not in the merchant's list of allowed issuers");
        err.status = 400;
        throw err;
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

    const payload = {
      id: paymentId,
      merchant_id: merchant.id,
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

    const { error: insertError } = await supabase.from("payments").insert(payload);
    if (insertError) {
      insertError.status = 500;
      throw insertError;
    }

    return {
      payment_id: paymentId,
      payment_link: paymentLink,
      status: "pending",
      branding_config: resolvedBranding,
    };
  },

  /**
   * Retrieves status of a payment.
   */
  async getStatus(paymentId, merchantId = null) {
    let query = supabase
      .from("payments")
      .select("id, amount, asset, asset_issuer, recipient, description, memo, memo_type, status, tx_id, metadata, created_at, merchants(branding_config)");

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

    const metadataBranding = data.metadata?.branding_config || null;
    const merchantBranding = data.merchants?.branding_config || null;
    const brandingConfig = metadataBranding || merchantBranding || null;

    const payment = { ...data, branding_config: brandingConfig };
    delete payment.merchants;

    return { payment };
  },

  /**
   * Verifies a payment on the Stellar network.
   */
  async verifyPayment(paymentId, merchantId, app) {
    let query = supabase
      .from("payments")
      .select("id, merchant_id, amount, asset, asset_issuer, recipient, status, tx_id, memo, memo_type, webhook_url, merchants(webhook_secret, webhook_version)");

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

    const { error: updateError } = await supabase
      .from("payments")
      .update({ status: "confirmed", tx_id: match.transaction_hash })
      .eq("id", data.id);

    if (updateError) {
      updateError.status = 500;
      throw updateError;
    }

    // Real-time notification
    const io = app.locals.io;
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

    // Webhook dispatch
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

    return {
      status: "confirmed",
      tx_id: match.transaction_hash,
      ledger_url: `https://stellar.expert/explorer/testnet/tx/${match.transaction_hash}`,
      webhook: webhookResult,
    };
  },

  /**
   * Retrieves paginated payments for a merchant.
   */
  async getPayments(merchantId, page = 1, limit = 10) {
    const offset = (page - 1) * limit;

    const { count: totalCount, error: countError } = await supabase
      .from("payments")
      .select("*", { count: "exact", head: true })
      .eq("merchant_id", merchantId);

    if (countError) {
      countError.status = 500;
      throw countError;
    }

    const { data: payments, error: dataError } = await supabase
      .from("payments")
      .select("id, amount, asset, asset_issuer, recipient, description, status, tx_id, created_at")
      .eq("merchant_id", merchantId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (dataError) {
      dataError.status = 500;
      throw dataError;
    }

    return {
      payments: payments || [],
      total_count: totalCount,
      total_pages: Math.ceil(totalCount / limit),
      page,
      limit,
    };
  },

  /**
   * Retrieves 7-day rolling metrics.
   */
  async get7DayMetrics(merchantId) {
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
      data.push(metricsMap.get(dateStr) || { date: dateStr, volume: 0, count: 0 });
    }

    const confirmedCount = payments.filter((p) => p.status === "confirmed").length;
    const successRate = payments.length > 0 ? Number(((confirmedCount / payments.length) * 100).toFixed(1)) : 0;

    return {
      data,
      total_volume: Number(totalVolume.toFixed(2)),
      total_payments: payments.length,
      confirmed_count: confirmedCount,
      success_rate: successRate,
    };
  },

  /**
   * Generates a refund transaction.
   */
  async generateRefund(paymentId, merchantId) {
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

    // Dynamic import for Stellar SDK to keep service lightweight if not used
    const StellarSdk = await import("stellar-sdk");
    const HORIZON_URL = process.env.STELLAR_HORIZON_URL || (process.env.STELLAR_NETWORK === "public" ? "https://horizon.stellar.org" : "https://horizon-testnet.stellar.org");
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

    await supabase.from("payments").update({
      metadata: {
        ...payment.metadata,
        refund_status: "pending",
        refund_xdr: refundTx.xdr,
        refund_created_at: new Date().toISOString(),
      },
    }).eq("id", payment.id);

    return {
      xdr: refundTx.xdr,
      hash: refundTx.hash,
      refund_amount: payment.amount,
      refund_destination: refundDestination,
    };
  },

  /**
   * Confirms a refund has been submitted.
   */
  async confirmRefund(paymentId, merchantId, txHash) {
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

    await supabase.from("payments").update({
      metadata: {
        ...payment.metadata,
        refund_status: "refunded",
        refund_tx_hash: txHash,
        refund_confirmed_at: new Date().toISOString(),
      },
    }).eq("id", payment.id);

    return {
      status: "refunded",
      refund_tx_hash: txHash,
      message: "Refund confirmed successfully",
    };
  },

  /**
   * Gets a path payment quote.
   */
  async getPathQuote(paymentId, merchantId, sourceAsset, sourceAssetIssuer, sourceAccount) {
    let query = supabase.from("payments").select("id, amount, asset, asset_issuer, recipient, status");
    if (merchantId) query = query.eq("merchant_id", merchantId);

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

    const sameAsset = sourceAsset.toUpperCase() === data.asset.toUpperCase() && (sourceAssetIssuer || null) === (data.asset_issuer || null);
    if (sameAsset) {
      const err = new Error("Source asset is the same as destination asset. Use a direct payment.");
      err.status = 400;
      throw err;
    }

    const SLIPPAGE = 0.01;
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
  }
};
