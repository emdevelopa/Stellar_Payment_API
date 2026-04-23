import crypto from "node:crypto";
import { getRedisClient } from "./redis.js";

/**
 * TTL for idempotency keys (10 minutes)
 */
const IDEMPOTENCY_TTL_SECONDS = 10 * 60; // 600 seconds

export async function idempotencyMiddleware(req, res, next) {
  // Only apply to POST requests
  if (req.method !== "POST") {
    return next();
  }

  const idempotencyKey = req.get("Idempotency-Key");

  // 🔴 NOW REQUIRED
  if (!idempotencyKey || typeof idempotencyKey !== "string" || idempotencyKey.trim().length === 0) {
    return res.status(400).json({
      error: "Idempotency-Key header is required and must be a non-empty string",
    });
  }

  // Ensure merchant context exists
  const merchantId = req.merchant?.id;
  if (!merchantId) {
    return res.status(401).json({
      error: "Merchant authentication required",
    });
  }

  const redisClient = getRedisClient();
  const redisKey = `idempotency:${merchantId}:${idempotencyKey}`;

  // Optional: still keep hash for safety (prevents misuse)
  const payloadHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(req.body || {}))
    .digest("hex");

  try {
    const existing = await redisClient.get(redisKey);

    if (existing) {
      const { hash } = JSON.parse(existing);

      // Same key but different payload → reject
      if (hash !== payloadHash) {
        return res.status(400).json({
          error: "Idempotency-Key already used with a different request payload",
        });
      }

      // 🔴 MAIN CHANGE: reject duplicates
      return res.status(409).json({
        error: "Duplicate request: Idempotency-Key already used",
      });
    }

    // Store key immediately (no response caching)
    await redisClient.set(
      redisKey,
      JSON.stringify({ hash: payloadHash }),
      { EX: IDEMPOTENCY_TTL_SECONDS }
    );

    return next();
  } catch (err) {
    // Fail-safe: allow request if Redis fails
    console.error("Idempotency check failed (Redis error):", err.message);
    return next();
  }
}