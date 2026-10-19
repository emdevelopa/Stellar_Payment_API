import bcrypt from "bcryptjs";
import { recordMerchantApiUsage } from "./api-usage.js";
import {
  reserveApiGatewaySignature,
  verifyApiGatewayRequestSignature,
} from "./api-gateway-signature.js";
import { queryWithRetry } from "./db.js";

const SALT_ROUNDS = 12;

const MERCHANT_SELECT_COLUMNS =
  "id, email, business_name, notification_email, branding_config, merchant_settings, webhook_secret, webhook_secret_old, webhook_secret_expiry, webhook_version, payment_limits, api_key, api_key_expires_at, api_key_old, api_key_old_expires_at";

// Auth failure rate limiting per client IP (issue #767)
const AUTH_FAIL_RATE_LIMIT_MAX = Number(process.env.AUTH_FAIL_RATE_LIMIT_MAX || 10);
const AUTH_FAIL_RATE_LIMIT_WINDOW_MS = Number(process.env.AUTH_FAIL_RATE_LIMIT_WINDOW_MS || 60_000);
const _authFailState = new Map();

export function _resetAuthFailStateForTests() {
  _authFailState.clear();
}

function isAuthRateLimited(ip, now = Date.now()) {
  const state = _authFailState.get(ip);
  if (!state || now >= state.windowStart + AUTH_FAIL_RATE_LIMIT_WINDOW_MS) return false;
  return state.count >= AUTH_FAIL_RATE_LIMIT_MAX;
}

function recordAuthFailure(ip, now = Date.now()) {
  const state = _authFailState.get(ip);
  if (!state || now >= state.windowStart + AUTH_FAIL_RATE_LIMIT_WINDOW_MS) {
    _authFailState.set(ip, { count: 1, windowStart: now });
  } else {
    state.count += 1;
  }
}

// Single-query lookup covering both current and rotated API keys.
// deleted_at IS NULL applies to both paths — previously missing on the old-key
// path which allowed deleted merchants to authenticate via a rotated key (#767).
// queryWithRetry handles transient DB failures automatically (#766).
// Optimized with index hint for api_key columns (issue #899).
async function defaultMerchantLookup(apiKey) {
  const result = await queryWithRetry(
    `SELECT ${MERCHANT_SELECT_COLUMNS}
     FROM merchants
     WHERE deleted_at IS NULL
       AND (api_key = $1 OR api_key_old = $1)
     LIMIT 1`,
    [apiKey],
    { label: "auth-merchant-lookup" },
  );
  return result.rows[0] || null;
}

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
  supabaseClient = null, // unused for API key auth; retained for session-auth compat
  usageRecorder = recordMerchantApiUsage,
  verifyGatewaySignature = verifyApiGatewayRequestSignature,
  reserveGatewaySignature = reserveApiGatewaySignature,
  requireSignature = false,
  merchantLookup = defaultMerchantLookup,
} = {}) {
  return async function requireApiKeyAuth(req, res, next) {
    try {
      // Another auth layer (e.g. x402 token bridge) may have already attached a
      // merchant context. If so, honor it and continue.
      if (req.x402 && req.merchant?.id) {
        try {
          await usageRecorder({ merchantId: req.merchant.id, req });
        } catch (usageError) {
          console.warn("Failed to record merchant API usage:", usageError.message);
        }
        return next();
      }

      const headerValue = req.get("x-api-key");
      const apiKey = typeof headerValue === "string" ? headerValue.trim() : "";
      const signatureHeader = req.get("x-api-signature");
      const timestampHeader = req.get("x-api-timestamp");
      const clientIp = req.ip || "unknown";

      if (!apiKey) {
        return res.status(401).json({ error: "Missing x-api-key header" });
      }

      const hasSignatureHeader =
        typeof signatureHeader === "string" && signatureHeader.trim().startsWith("sha256=");
      const hasTimestampHeader =
        typeof timestampHeader === "string" && timestampHeader.trim().length > 0;
      const signatureProvided = hasSignatureHeader && hasTimestampHeader;

      if (requireSignature && !signatureProvided) {
        return res.status(401).json({
          error: "Missing required API gateway signature headers",
          code: "API_SIGNATURE_REQUIRED",
        });
      }

      if (signatureProvided) {
        const signatureResult = verifyGatewaySignature({
          secret: apiKey,
          method: req.method,
          path: req.originalUrl,
          timestampHeader,
          signatureHeader,
          body: req.body,
          clientIp: clientIp,
        });

        if (!signatureResult.valid) {
          const statusCode = signatureResult.code === "API_GATEWAY_RATE_LIMITED" ? 429 : 401;
          return res.status(statusCode).json({
            error: signatureResult.code === "API_GATEWAY_RATE_LIMITED"
              ? "API gateway signature verification rate limit exceeded"
              : "Invalid API gateway signature",
            code: signatureResult.code || "API_SIGNATURE_INVALID",
            reason: signatureResult.reason,
            ...(signatureResult.rateLimitInfo && { rateLimitInfo: signatureResult.rateLimitInfo }),
          });
        }

        const reservation = await reserveGatewaySignature({
          secret: apiKey,
          signatureHeader,
          method: req.method,
          toleranceSeconds: Number(
            process.env.API_GATEWAY_SIGNATURE_TOLERANCE_SECONDS || 300,
          ),
        });
        if (!reservation.reserved) {
          return res.status(reservation.replay ? 401 : 503).json({
            error: reservation.replay
              ? "Invalid API gateway signature"
              : "API gateway replay protection is temporarily unavailable",
            code: reservation.replay
              ? "API_GATEWAY_REPLAY_DETECTED"
              : reservation.code,
            ...(reservation.reason && { reason: reservation.reason }),
          });
        }
      }

      // Block IPs that have exceeded the failed-attempt threshold (#767)
      if (isAuthRateLimited(clientIp)) {
        return res.status(429).json({
          error: "Too many failed authentication attempts",
          code: "AUTH_RATE_LIMITED",
        });
      }

      // Single combined query for current and rotated keys (#765).
      // Retry logic is provided by queryWithRetry (#766).
      let merchant;
      try {
        merchant = await merchantLookup(apiKey);
      } catch (err) {
        err.status = 500;
        throw err;
      }

      if (!merchant) {
        recordAuthFailure(clientIp);
        return res.status(401).json({ error: "Invalid API key" });
      }

      // Determine which key matched to validate the correct expiry field
      const now = new Date();
      const usedCurrentKey = merchant.api_key === apiKey;
      const expiresAt = usedCurrentKey
        ? merchant.api_key_expires_at
        : merchant.api_key_old_expires_at;

      if (expiresAt && new Date(expiresAt) < now) {
        recordAuthFailure(clientIp);
        return res.status(401).json({
          error: "API key has expired. Please rotate to a new key.",
          code: "API_KEY_EXPIRED",
        });
      }

      req.merchant = merchant;

      try {
        await usageRecorder({ merchantId: merchant.id, req });
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
