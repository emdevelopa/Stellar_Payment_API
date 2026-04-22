/**
 * x402 Auth Bridge
 *
 * When a request carries a valid X-Payment-Token (x402 JWT), this middleware
 * injects a system merchant into req.merchant so downstream routes work
 * without requiring a merchant API key.
 *
 * This enables true agent-first access: pay USDC → get API access.
 * No merchant account registration required.
 */

import jwt from "jsonwebtoken";
import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";

// System merchant used for x402-authenticated requests.
// Fetched once and cached in memory.
let _systemMerchant = null;

async function getOrCreateSystemMerchant() {
  if (_systemMerchant) return _systemMerchant;

  const systemEmail = process.env.X402_SYSTEM_MERCHANT_EMAIL || "x402-system@pluto.internal";

  // Try to find existing system merchant
  const { data: existing } = await supabase
    .from("merchants")
    .select("id, email, business_name, notification_email, api_key, webhook_secret, merchant_settings")
    .eq("email", systemEmail)
    .maybeSingle();

  if (existing) {
    _systemMerchant = existing;
    return _systemMerchant;
  }

  // Create system merchant if it doesn't exist
  const { randomBytes } = await import("node:crypto");
  const { data: created, error } = await supabase
    .from("merchants")
    .insert({
      email: systemEmail,
      business_name: "PLUTO x402 System",
      notification_email: systemEmail,
      api_key: `sk_x402_${randomBytes(24).toString("hex")}`,
      webhook_secret: `whsec_x402_${randomBytes(24).toString("hex")}`,
      merchant_settings: { send_success_emails: false },
    })
    .select()
    .single();

  if (error) {
    logger.warn({ err: error }, "x402-auth: could not create system merchant");
    return null;
  }

  logger.info({ merchantId: created.id }, "x402-auth: system merchant created");
  _systemMerchant = created;
  return _systemMerchant;
}

/**
 * Middleware that checks for a valid X-Payment-Token.
 * If found and valid, injects system merchant and skips API key auth.
 * If not found, passes through to the next middleware (API key auth).
 */
export function x402AuthBridge() {
  return async function (req, res, next) {
    const token = req.headers["x-payment-token"];
    if (!token) return next(); // no token — fall through to API key auth

    const jwtSecret = process.env.X402_JWT_SECRET;
    if (!jwtSecret) return next();

    try {
      const payload = jwt.verify(token, jwtSecret);

      // Token is valid — get/create system merchant
      const merchant = await getOrCreateSystemMerchant();
      if (!merchant) return next(); // fallback to API key auth

      // Inject merchant and mark as x402-authenticated
      req.merchant = merchant;
      req.x402 = payload;

      logger.info({
        txHash: payload.tx_hash,
        amount: payload.amount,
        merchantId: merchant.id,
      }, "x402-auth: request authenticated via payment token");

      return next();
    } catch {
      // Token invalid/expired — fall through to API key auth
      return next();
    }
  };
}
