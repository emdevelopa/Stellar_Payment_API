import bcrypt from "bcryptjs";
import { recordMerchantApiUsage } from "./api-usage.js";

const SALT_ROUNDS = 12;

/**
 * Hash a plain-text merchant password with bcrypt.
 * @param {string} plaintext
 * @returns {Promise<string>} bcrypt hash
 */
export async function hashPassword(plaintext) {
  return bcrypt.hash(plaintext, SALT_ROUNDS);
}

/**
 * Verify a plain-text password against a stored bcrypt hash.
 * @param {string} plaintext
 * @param {string} hash
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(plaintext, hash) {
  return bcrypt.compare(plaintext, hash);
}

export function createApiKeyAuth({
  supabaseClient = null,
  usageRecorder = recordMerchantApiUsage,
} = {}) {
  return async function requireApiKeyAuth(req, res, next) {
    try {
      // Another auth layer (for example x402 token bridge) may have already
      // attached a merchant context. If so, honor it and continue.
      if (req.merchant?.id) {
        try {
          await usageRecorder({
            merchantId: req.merchant.id,
            req,
          });
        } catch (usageError) {
          console.warn("Failed to record merchant API usage:", usageError.message);
        }
        return next();
      }

      const client = supabaseClient || (await import("./supabase.js")).supabase;
      const headerValue = req.get("x-api-key");
      const apiKey = typeof headerValue === "string" ? headerValue.trim() : "";

      if (!apiKey) {
        return res.status(401).json({ error: "Missing x-api-key header" });
      }

      // First try to find merchant by current API key
      let { data: merchant, error } = await client
        .from("merchants")
        .select(
          "id, email, business_name, notification_email, branding_config, merchant_settings, webhook_secret, webhook_secret_old, webhook_secret_expiry, webhook_version, payment_limits, api_key, api_key_expires_at, api_key_old, api_key_old_expires_at"
        )
        .eq("api_key", apiKey)
        .is("deleted_at", null)
        .maybeSingle();

      if (error) {
        error.status = 500;
        throw error;
      }

      // If not found by current key, check if it's the old key during rotation overlap
      if (!merchant) {
        const { data: oldKeyMerchant, error: oldKeyError } = await client
          .from("merchants")
          .select(
            "id, email, business_name, notification_email, branding_config, merchant_settings, webhook_secret, webhook_secret_old, webhook_secret_expiry, webhook_version, payment_limits, api_key, api_key_expires_at, api_key_old, api_key_old_expires_at"
          )
          .eq("api_key_old", apiKey)
          .maybeSingle();

        if (oldKeyError) {
          oldKeyError.status = 500;
          throw oldKeyError;
        }

        if (!oldKeyMerchant) {
          return res.status(401).json({ error: "Invalid API key" });
        }

        // Check if old key has expired (overlap period ended)
        const now = new Date();
        if (
          oldKeyMerchant.api_key_old_expires_at &&
          new Date(oldKeyMerchant.api_key_old_expires_at) < now
        ) {
          return res.status(401).json({
            error: "API key has expired. Please rotate to a new key.",
            code: "API_KEY_EXPIRED"
          });
        }

        merchant = oldKeyMerchant;
      } else {
        // Check if current API key has expired
        const now = new Date();
        if (
          merchant.api_key_expires_at &&
          new Date(merchant.api_key_expires_at) < now
        ) {
          return res.status(401).json({
            error: "API key has expired. Please rotate to a new key.",
            code: "API_KEY_EXPIRED"
          });
        }
      }

      req.merchant = merchant;

      try {
        await usageRecorder({
          merchantId: merchant.id,
          req,
        });
      } catch (usageError) {
        // Usage metrics should never block API traffic.
        console.warn("Failed to record merchant API usage:", usageError.message);
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

export function requireApiKeyAuth(options) {
  return createApiKeyAuth(options);
}

export function requireSessionAuth() {
  return async function (req, res, next) {
    try {
      const authHeader = req.get("Authorization");
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Missing or invalid Authorization header" });
      }

      const token = authHeader.split(" ")[1];
      const { verifySessionToken } = await import("./sep10-auth.js");
      const { valid, payload, error: verifyError } = verifySessionToken(token);

      if (!valid) {
        return res.status(401).json({ error: verifyError || "Invalid session token" });
      }

      const client = (await import("./supabase.js")).supabase;
      const merchantId = payload.id || payload.merchant_id;
      
      if (!merchantId) {
        return res.status(401).json({ error: "Invalid token payload: missing merchant identification" });
      }

      const { data: merchant, error } = await client
        .from("merchants")
        .select("id, email, business_name, notification_email, api_key")
        .eq("id", merchantId)
        .maybeSingle();

      if (error || !merchant) {
        return res.status(401).json({ error: "Merchant not found" });
      }

      req.merchant = merchant;
      next();
    } catch (err) {
      next(err);
    }
  };
}
