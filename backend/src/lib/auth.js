import bcrypt from "bcryptjs";

function getSaltRounds() {
  const parsed = Number.parseInt(process.env.BCRYPT_SALT_ROUNDS ?? "", 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return 12;
}

/**
 * Hash a plain-text merchant password with bcrypt.
 * @param {string} plaintext
 * @returns {Promise<string>} bcrypt hash
 */
export async function hashPassword(plaintext) {
  return bcrypt.hash(plaintext, getSaltRounds());
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

export function createApiKeyAuth({ supabaseClient = null } = {}) {
  return async function requireApiKeyAuth(req, res, next) {
    try {
      const client = supabaseClient || (await import("./supabase.js")).supabase;
      const headerValue = req.get("x-api-key");
      const apiKey = typeof headerValue === "string" ? headerValue.trim() : "";

      if (!apiKey) {
        return res.status(401).json({ error: "Missing x-api-key header" });
      }

      const { data: merchant, error } = await client
        .from("merchants")
        .select("id, email, business_name, notification_email, branding_config, webhook_secret, payment_limits")
        .eq("api_key", apiKey)
        .maybeSingle();

      if (error) {
        error.status = 500;
        throw error;
      }

      if (!merchant) {
        return res.status(401).json({ error: "Invalid API key" });
      }

      req.merchant = merchant;
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function requireApiKeyAuth(options) {
  return createApiKeyAuth(options);
}
