import { createHash } from "node:crypto";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";

export const RATE_LIMIT_REDIS_PREFIX = "rl:";
export const VERIFY_PAYMENT_RATE_LIMIT_WINDOW_MS = 60 * 1000;
export const VERIFY_PAYMENT_RATE_LIMIT_MAX = 30;

function setStandardRateLimitHeaders(res, rateLimitState) {
  if (!res || !rateLimitState) {
    return;
  }

  const limit = rateLimitState.limit;
  const remaining = rateLimitState.remaining;
  const resetTime = rateLimitState.resetTime;

  if (typeof limit === "number") {
    res.setHeader("X-RateLimit-Limit", String(limit));
  }
  if (typeof remaining === "number") {
    res.setHeader("X-RateLimit-Remaining", String(remaining));
  }
  if (resetTime instanceof Date && !Number.isNaN(resetTime.getTime())) {
    res.setHeader("X-RateLimit-Reset", String(Math.floor(resetTime.getTime() / 1000)));
  }
}

export function createRedisRateLimitStore({
  client,
  StoreClass = RedisStore,
  prefix = RATE_LIMIT_REDIS_PREFIX,
} = {}) {
  return new StoreClass({
    sendCommand: (...args) => client.sendCommand(args),
    prefix,
  });
}

export function getVerifyPaymentRateLimitKey(req) {
  const paymentId =
    typeof req?.params?.id === "string" && req.params.id.length > 0
      ? req.params.id
      : "unknown-payment";
  const merchantId =
    typeof req?.merchant?.id === "string" && req.merchant.id.length > 0
      ? `merchant:${req.merchant.id}`
      : null;
  const apiKey =
    typeof req?.headers?.["x-api-key"] === "string" &&
    req.headers["x-api-key"].length > 0
      ? `api:${createHash("sha256").update(req.headers["x-api-key"]).digest("hex")}`
      : null;
  const ipKey = ipKeyGenerator(req?.ip ?? req?.socket?.remoteAddress ?? "unknown-ip");
  const actor = merchantId ?? apiKey ?? `ip:${ipKey}`;

  return `${paymentId}:${actor}`;
}

export function createVerifyPaymentRateLimit({
  store,
  rateLimitFactory = rateLimit,
} = {}) {
  return rateLimitFactory({
    windowMs: VERIFY_PAYMENT_RATE_LIMIT_WINDOW_MS,
    max: VERIFY_PAYMENT_RATE_LIMIT_MAX,
    message: {
      error: "Too many verification requests, please try again later.",
    },
    standardHeaders: true,
    legacyHeaders: false,
    validate: { ip: false },
    keyGenerator: getVerifyPaymentRateLimitKey,
    requestWasSuccessful: (req, res) => {
      setStandardRateLimitHeaders(res, req.rateLimit);
      return res.statusCode < 400;
    },
    store,
    passOnStoreError: true,
  });
}

export function createMerchantRegistrationRateLimit({
  store,
  rateLimitFactory = rateLimit,
} = {}) {
  return rateLimitFactory({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5, // 5 registration attempts per hour per IP
    message: {
      error: "Too many registration attempts, please try again later.",
    },
    standardHeaders: true,
    legacyHeaders: false,
    validate: { ip: false },
    requestWasSuccessful: (req, res) => {
      setStandardRateLimitHeaders(res, req.rateLimit);
      return res.statusCode < 400;
    },
    store,
    passOnStoreError: true,
  });
}
