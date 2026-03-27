import { randomBytes } from "crypto";
import { supabase } from "../lib/supabase.js";
import { resolveBrandingConfig } from "../lib/branding.js";
import { resolveMerchantSettings } from "../lib/merchant-settings.js";
import { sendWebhook } from "../lib/webhooks.js";
import { getPayloadForVersion } from "../webhooks/resolver.js";

/**
 * Merchant Service handles core business logic for merchant management.
 */
export const merchantService = {
  /**
   * Registers a new merchant.
   */
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
      const err = new Error("Merchant with this email already exists");
      err.status = 409;
      throw err;
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

    return {
      id: merchant.id,
      email: merchant.email,
      business_name: merchant.business_name,
      notification_email: merchant.notification_email,
      merchant_settings: resolveMerchantSettings(merchant.merchant_settings),
      metadata: merchant.metadata ?? null,
      api_key: merchant.api_key,
      webhook_secret: merchant.webhook_secret,
      created_at: merchant.created_at
    };
  },

  /**
   * Rotates a merchant's API key.
   */
  async rotateApiKey(merchantId) {
    const newApiKey = `sk_${randomBytes(24).toString("hex")}`;

    const { error } = await supabase
      .from("merchants")
      .update({ api_key: newApiKey })
      .eq("id", merchantId);

    if (error) {
      error.status = 500;
      throw error;
    }

    return { api_key: newApiKey };
  },

  /**
   * Rotates a merchant's webhook secret.
   */
  async rotateWebhookSecret(merchantId, currentSecret, graceHours) {
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

  /**
   * Retrieves merchant branding configuration.
   */
  async getBranding(merchantId) {
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

  /**
   * Updates merchant branding configuration.
   */
  async updateBranding(merchantId, brandingConfig) {
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

  /**
   * Retrieves merchant profile details.
   */
  async getProfile(merchantId) {
    const { data, error } = await supabase
      .from("merchants")
      .select("id, email, business_name, notification_email, merchant_settings, created_at")
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

  /**
   * Sends a test webhook ping.
   */
  async testWebhook(merchant, webhookUrl) {
    const payload = getPayloadForVersion(
      merchant.webhook_version || "v1",
      "ping",
      {
        merchant_id: merchant.id,
        timestamp: new Date().toISOString(),
      }
    );

    const result = await sendWebhook(
      webhookUrl,
      payload,
      merchant.webhook_secret || null
    );

    return {
      ok: result.ok,
      status: result.status ?? null,
      body: result.body ?? null,
      signed: result.signed,
    };
  },

  /**
   * Retrieves current webhook settings.
   */
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

  /**
   * Updates merchant's webhook URL.
   */
  async updateWebhookUrl(merchantId, webhookUrl) {
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

  /**
   * Simple regeneration of webhook secret (without grace period).
   */
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
  }
};
