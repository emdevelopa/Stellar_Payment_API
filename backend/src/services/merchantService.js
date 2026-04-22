import { randomBytes } from "crypto";
import { supabase } from "../lib/supabase.js";
import { resolveBrandingConfig } from "../lib/branding.js";
import { resolveMerchantSettings } from "../lib/merchant-settings.js";
import { sendWebhook } from "../lib/webhooks.js";
import { getPayloadForVersion } from "../webhooks/resolver.js";

const DEFAULT_WEBHOOK_SECRET_ROTATION_GRACE_HOURS = 24;
const DEFAULT_API_KEY_ROTATION_GRACE_HOURS = 24;

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

export const merchantService = {
  async registerMerchant(body) {
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
      const error = new Error("Merchant with this email already exists");
      error.status = 409;
      throw error;
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
      created_at: new Date().toISOString(),
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

    return {
      id: merchant.id,
      email: merchant.email,
      business_name: merchant.business_name,
      notification_email: merchant.notification_email,
      merchant_settings: resolveMerchantSettings(merchant.merchant_settings),
      metadata: merchant.metadata ?? null,
      api_key: merchant.api_key,
      webhook_secret: merchant.webhook_secret,
      created_at: merchant.created_at,
    };
  },

  async rotateApiKey(merchantId, gracePeriodHours = DEFAULT_API_KEY_ROTATION_GRACE_HOURS) {
    // Get current merchant to preserve old key
    const { data: merchant, error: fetchError } = await supabase
      .from("merchants")
      .select("api_key")
      .eq("id", merchantId)
      .maybeSingle();

    if (fetchError) {
      fetchError.status = 500;
      throw fetchError;
    }

    if (!merchant) {
      const err = new Error("Merchant not found");
      err.status = 404;
      throw err;
    }

    const newApiKey = `sk_${randomBytes(24).toString("hex")}`;
    const now = Date.now();
    const graceHours = Math.min(Math.max(gracePeriodHours, 0), 168); // Clamp between 0 and 168 hours (1 week)
    const oldKeyExpiry = new Date(now + graceHours * 60 * 60 * 1000).toISOString();

    const { error } = await supabase
      .from("merchants")
      .update({
        api_key: newApiKey,
        api_key_old: merchant.api_key,
        api_key_old_expires_at: oldKeyExpiry,
        api_key_expires_at: null, // Clear any previous expiry
      })
      .eq("id", merchantId);

    if (error) {
      error.status = 500;
      throw error;
    }

    return {
      api_key: newApiKey,
      api_key_old_expires_at: oldKeyExpiry,
      grace_period_hours: graceHours,
    };
  },

  async setApiKeyExpiry(merchantId, expiresAt) {
    const { error } = await supabase
      .from("merchants")
      .update({ api_key_expires_at: expiresAt })
      .eq("id", merchantId);

    if (error) {
      error.status = 500;
      throw error;
    }

    return { api_key_expires_at: expiresAt };
  },

  async getApiKeyStatus(merchantId) {
    const { data, error } = await supabase
      .from("merchants")
      .select("api_key, api_key_expires_at, api_key_old, api_key_old_expires_at")
      .eq("id", merchantId)
      .maybeSingle();

    if (error) {
      error.status = 500;
      throw error;
    }

    if (!data) {
      const err = new Error("Merchant not found");
      err.status = 404;
      throw err;
    }

    const now = new Date();
    const expiresAt = data.api_key_expires_at ? new Date(data.api_key_expires_at) : null;
    const oldExpiresAt = data.api_key_old_expires_at ? new Date(data.api_key_old_expires_at) : null;

    return {
      current_key_expires_at: data.api_key_expires_at,
      is_expired: expiresAt ? expiresAt < now : false,
      is_expiring_soon: expiresAt && expiresAt > now && expiresAt < new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      old_key_active: oldExpiresAt ? oldExpiresAt > now : false,
      old_key_expires_at: data.api_key_old_expires_at,
    };
  },

  async rotateWebhookSecret(merchantId, currentSecret, gracePeriodHours) {
    const graceHours = resolveWebhookSecretRotationGraceHours(gracePeriodHours);
    const now = Date.now();
    const expiryIso = new Date(now + graceHours * 60 * 60 * 1000).toISOString();

    const newWebhookSecret = `whsec_${randomBytes(32).toString("hex")}`;

    const { error } = await supabase
      .from("merchants")
      .update({
        webhook_secret_old: currentSecret,
        webhook_secret_expiry: expiryIso,
        webhook_secret: newWebhookSecret,
      })
      .eq("id", merchantId);

    if (error) {
      error.status = 500;
      throw error;
    }

    return {
      webhook_secret: newWebhookSecret,
      webhook_secret_old_expires_at: expiryIso,
      grace_period_hours: graceHours,
    };
  },

  async getMerchantBranding(merchantId) {
    const { data, error } = await supabase
      .from("merchants")
      .select("branding_config")
      .eq("id", merchantId)
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

  async updateMerchantBranding(merchantId, brandingConfig) {
    const resolved = resolveBrandingConfig({ merchantBranding: brandingConfig });

    const { data, error } = await supabase
      .from("merchants")
      .update({ branding_config: resolved })
      .eq("id", merchantId)
      .select("branding_config")
      .single();

    if (error) {
      error.status = 500;
      throw error;
    }

    return { branding_config: data.branding_config };
  },

  async getMerchantProfile(merchantId) {
    const { data, error } = await supabase
      .from("merchants")
      .select(
        "id, email, business_name, notification_email, merchant_settings, created_at",
      )
      .eq("id", merchantId)
      .maybeSingle();

    if (error) {
      error.status = 500;
      throw error;
    }

    if (!data) {
      const err = new Error("Merchant profile not found");
      err.status = 404;
      throw err;
    }

    return {
      merchant: {
        ...data,
        merchant_settings: resolveMerchantSettings(data.merchant_settings),
      },
    };
  },

  async testWebhook(merchant, webhookUrl) {
    const payload = getPayloadForVersion(
      merchant.webhook_version || "v1",
      "ping",
      {
        merchant_id: merchant.id,
        timestamp: new Date().toISOString(),
      },
    );

    const result = await sendWebhook(
      webhookUrl,
      payload,
      merchant.webhook_secret || null,
    );

    return {
      ok: result.ok,
      status: result.status ?? null,
      body: result.body ?? null,
      signed: result.signed,
    };
  },

  async getWebhookSettings(merchantId) {
    const { data, error } = await supabase
      .from("merchants")
      .select("webhook_url, webhook_secret")
      .eq("id", merchantId)
      .single();

    if (error) {
      error.status = 500;
      throw error;
    }

    const secret = data.webhook_secret || "";
    const maskedSecret =
      secret.length > 10
        ? secret.slice(0, 10) + "•".repeat(secret.length - 10)
        : "•".repeat(secret.length);

    return {
      webhook_url: data.webhook_url || "",
      webhook_secret_masked: maskedSecret,
    };
  },

  async updateWebhookSettings(merchantId, webhookUrl) {
    const { data, error } = await supabase
      .from("merchants")
      .update({ webhook_url: webhookUrl || null })
      .eq("id", merchantId)
      .select("webhook_url")
      .single();

    if (error) {
      error.status = 500;
      throw error;
    }

    return { webhook_url: data.webhook_url || "" };
  },

  async regenerateWebhookSecret(merchantId) {
    const newSecret = `whsec_${randomBytes(24).toString("hex")}`;

    const { error } = await supabase
      .from("merchants")
      .update({ webhook_secret: newSecret })
      .eq("id", merchantId);

    if (error) {
      error.status = 500;
      throw error;
    }

    return { webhook_secret: newSecret };
  },

  async getWebhookLogs(merchantId, { limit = 20, cursor = null, status = null } = {}) {
    const parsedLimit = Math.min(100, Math.max(1, parseInt(limit) || 20));

    let query = supabase
      .from("webhook_delivery_logs")
      .select(`
        id,
        payment_id,
        status_code,
        request_payload,
        request_headers,
        response_body,
        timestamp,
        payments!inner(merchant_id, amount, asset, status)
      `)
      .eq("payments.merchant_id", merchantId);

    if (status === "success") {
      query = query.gte("status_code", 200).lt("status_code", 300);
    } else if (status === "failure") {
      query = query.or("status_code.lt.200,status_code.gte.300");
    }

    if (cursor) {
      try {
        const decoded = Buffer.from(cursor, "base64").toString("utf-8");
        const { timestamp, id } = JSON.parse(decoded);
        query = query.or(`timestamp.lt.${timestamp},and(timestamp.eq.${timestamp},id.lt.${id})`);
      } catch (e) {
        const err = new Error("Invalid pagination cursor");
        err.status = 400;
        throw err;
      }
    }

    const { data: logsData, error } = await query
      .order("timestamp", { ascending: false })
      .order("id", { ascending: false })
      .limit(parsedLimit + 1);

    if (error) {
      error.status = 500;
      throw error;
    }

    const hasNextPage = logsData.length > parsedLimit;
    const items = hasNextPage ? logsData.slice(0, parsedLimit) : logsData;

    let nextCursor = null;
    if (hasNextPage) {
      const lastItem = items[items.length - 1];
      nextCursor = Buffer.from(
        JSON.stringify({
          timestamp: lastItem.timestamp,
          id: lastItem.id,
        })
      ).toString("base64");
    }

    const logs = items.map((log) => ({
      id: log.id,
      payment_id: log.payment_id,
      status_code: log.status_code,
      success: log.status_code >= 200 && log.status_code < 300,
      request_payload: log.request_payload,
      request_headers: log.request_headers,
      response_body: log.response_body,
      timestamp: log.timestamp,
      payment: {
        amount: log.payments.amount,
        asset: log.payments.asset,
        status: log.payments.status,
      },
    }));

    return {
      logs,
      next_cursor: nextCursor,
      limit: parsedLimit,
    };
  },
};
