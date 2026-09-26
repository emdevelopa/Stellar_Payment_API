import crypto from "node:crypto";
import { getRedisClient } from "./redis.js";

/**
 * TTL for idempotency cache entries in seconds.
 */
const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60; // 24 hours

export function buildIdempotencyRedisKey(merchantId, idempotencyKey) {
  return `idempotency:${merchantId}:${idempotencyKey}`;
}

export function hashIdempotencyPayload(body) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(body || {}))
    .digest("hex");
}

/**
 * Look up a previously cached idempotent response.
 *
 * Used by the payment session handler after it acquires the per-key session
 * lock (issue #1450): a request that passed the middleware while a concurrent
 * twin was still in flight must replay that twin's response instead of
 * creating a second session.
 *
 * `payloadHash` must be the hash the middleware computed from the RAW body
 * (exposed as `req.idempotency.payloadHash`), because downstream Zod schemas
 * may transform `req.body`.
 *
 * @returns {Promise<null | {status:"hit", response:object} | {status:"mismatch"}>}
 */
export async function lookupIdempotentResponse({ redisClient, merchantId, idempotencyKey, payloadHash }) {
  if (!redisClient || !merchantId || !idempotencyKey || !payloadHash) return null;
  const cachedValue = await redisClient.get(buildIdempotencyRedisKey(merchantId, idempotencyKey));
  if (!cachedValue) return null;

  const { hash, response } = JSON.parse(cachedValue);
  if (hash !== payloadHash) {
    return { status: "mismatch" };
  }
  return { status: "hit", response };
}

/**
 * Idempotency middleware that checks and enforces idempotent requests.
 * Tracks the key tied to the payload hash and response.
 * Returns a cached 201 response if the key matches a previous request.
 * Stores cached state in Redis for 24h.
 */
export async function idempotencyMiddleware(req, res, next) {
  // Only process POST requests as per requirements
  if (req.method !== "POST") {
    return next();
  }

  const idempotencyKey = req.get("Idempotency-Key");

  if (idempotencyKey === undefined) {
    // Idempotency-Key is optional but allows safe retries when present
    return next();
  }

  if (typeof idempotencyKey !== "string" || idempotencyKey.trim().length === 0) {
    return res.status(400).json({
      error: "Idempotency-Key header must be a non-empty string",
    });
  }


  // Ensure merchant context is available (assumes requireApiKeyAuth was run)
  const merchantId = req.merchant?.id;
  if (!merchantId) {
    // If authentication hasn't run or failed to set merchant, we can't safely track idempotency per merchant
    return res.status(401).json({ error: "Merchant authentication required" });
  }

  const redisClient = getRedisClient();
  const redisKey = buildIdempotencyRedisKey(merchantId, idempotencyKey);

  // Calculate hash of payload to ensure consistency
  const payloadHash = hashIdempotencyPayload(req.body);
  req.idempotency = { key: idempotencyKey, payloadHash };

  try {
    const cachedValue = await redisClient.get(redisKey);

    if (cachedValue) {
      const { hash, response } = JSON.parse(cachedValue);

      // Verify if the payload matches the original request
      if (hash !== payloadHash) {
        return res.status(400).json({
          error: "Idempotency-Key already used with a different request payload"
        });
      }

      // Return cached response with 201 status code as requested
      return res.status(201).json(response);
    }

    // Capture the original json method to intercept the response
    const originalJson = res.json.bind(res);

    res.json = function (data) {
      // Only cache successful creation-like responses (2xx)
      if (res.statusCode >= 200 && res.statusCode < 300) {
        redisClient
          .set(
            redisKey,
            JSON.stringify({
              hash: payloadHash,
              response: data,
            }),
            { EX: IDEMPOTENCY_TTL_SECONDS }
          )
          .catch((err) => {
            console.error("Failed to cache idempotency response:", err.message);
          });
      }
      return originalJson(data);
    };

    next();
  } catch (err) {
    // If Redis is unavailable, log error and proceed without idempotency (fail-safe)
    console.error("Idempotency check failed (Redis error):", err.message);
    next();
  }
}

