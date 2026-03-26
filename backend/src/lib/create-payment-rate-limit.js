import { createHash } from "node:crypto";
import rateLimit from "express-rate-limit";

const DEFAULT_CREATE_PAYMENT_RATE_LIMIT_MAX = 50;
const DEFAULT_CREATE_PAYMENT_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const CREATE_PAYMENT_RATE_LIMIT_ERROR =
  "Too many create payment requests, please try again later.";

function parsePositiveInteger(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const parsedValue = Number.parseInt(String(value), 10);

  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    return fallback;
  }

  return parsedValue;
}

export function getCreatePaymentRateLimitConfig(env = process.env) {
  return {
    max: parsePositiveInteger(
      env.CREATE_PAYMENT_RATE_LIMIT_MAX,
      DEFAULT_CREATE_PAYMENT_RATE_LIMIT_MAX
    ),
    windowMs: parsePositiveInteger(
      env.CREATE_PAYMENT_RATE_LIMIT_WINDOW_MS,
      DEFAULT_CREATE_PAYMENT_RATE_LIMIT_WINDOW_MS
    ),
  };
}

export function getCreatePaymentRateLimitKey(req) {
  const apiKey = req.get?.("x-api-key")?.trim();

  if (apiKey) {
    return createHash("sha256").update(apiKey).digest("hex");
  }

  if (req.merchant?.id) {
    return `merchant:${req.merchant.id}`;
  }

  return req.ip;
}

export function getRetryAfterSeconds(resetTime, now = new Date(), windowMs = DEFAULT_CREATE_PAYMENT_RATE_LIMIT_WINDOW_MS) {
  if (!(resetTime instanceof Date) || Number.isNaN(resetTime.getTime())) {
    return Math.max(1, Math.ceil(windowMs / 1000));
  }

  const remainingMs = resetTime.getTime() - now.getTime();
  return Math.max(1, Math.ceil(remainingMs / 1000));
}

export function createCreatePaymentRateLimit({
  env = process.env,
  limiterFactory = rateLimit,
} = {}) {
  const config = getCreatePaymentRateLimitConfig(env);

  return limiterFactory({
    windowMs: config.windowMs,
    max: config.max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: getCreatePaymentRateLimitKey,
    handler(req, res) {
      const retryAfterSeconds = getRetryAfterSeconds(
        req.rateLimit?.resetTime,
        new Date(),
        config.windowMs
      );

      res.set("Retry-After", String(retryAfterSeconds));
      res.status(429).json({ error: CREATE_PAYMENT_RATE_LIMIT_ERROR });
    },
  });
}

export {
  CREATE_PAYMENT_RATE_LIMIT_ERROR,
  DEFAULT_CREATE_PAYMENT_RATE_LIMIT_MAX,
  DEFAULT_CREATE_PAYMENT_RATE_LIMIT_WINDOW_MS,
};
