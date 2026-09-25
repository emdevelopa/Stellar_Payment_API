import { createHash } from "node:crypto";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";

const DEFAULT_PATH_PAYMENT_QUOTE_RATE_LIMIT_MAX = 20;
const DEFAULT_PATH_PAYMENT_QUOTE_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const PATH_PAYMENT_QUOTE_RATE_LIMIT_ERROR =
  "Too many path payment quote requests, please try again later.";

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

export function getPathPaymentQuoteRateLimitConfig(env = process.env) {
  return {
    max: parsePositiveInteger(
      env.PATH_PAYMENT_QUOTE_RATE_LIMIT_MAX,
      DEFAULT_PATH_PAYMENT_QUOTE_RATE_LIMIT_MAX
    ),
    windowMs: parsePositiveInteger(
      env.PATH_PAYMENT_QUOTE_RATE_LIMIT_WINDOW_MS,
      DEFAULT_PATH_PAYMENT_QUOTE_RATE_LIMIT_WINDOW_MS
    ),
  };
}

export function getPathPaymentQuoteRateLimitKey(req) {
  const paymentId =
    typeof req?.params?.id === "string" && req.params.id.length > 0
      ? req.params.id
      : "unknown-payment";

  const apiKey = req.get?.("x-api-key")?.trim();
  if (apiKey) {
    const hashedKey = createHash("sha256").update(apiKey).digest("hex");
    return `${paymentId}:api:${hashedKey}`;
  }

  if (req.merchant?.id) {
    return `${paymentId}:merchant:${req.merchant.id}`;
  }

  return `${paymentId}:ip:${ipKeyGenerator(req.ip ?? req.socket?.remoteAddress ?? "unknown-ip")}`;
}

export function getRetryAfterSeconds(resetTime, now = new Date(), windowMs = DEFAULT_PATH_PAYMENT_QUOTE_RATE_LIMIT_WINDOW_MS) {
  if (!(resetTime instanceof Date) || Number.isNaN(resetTime.getTime())) {
    return Math.max(1, Math.ceil(windowMs / 1000));
  }

  const remainingMs = resetTime.getTime() - now.getTime();
  return Math.max(1, Math.ceil(remainingMs / 1000));
}

export function createPathPaymentQuoteRateLimit({
  env = process.env,
  limiterFactory = rateLimit,
} = {}) {
  const config = getPathPaymentQuoteRateLimitConfig(env);

  return limiterFactory({
    windowMs: config.windowMs,
    max: config.max,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { ip: false },
    keyGenerator: getPathPaymentQuoteRateLimitKey,
    requestWasSuccessful(req, res) {
      if (typeof req.rateLimit?.limit === "number") {
        res.set("X-RateLimit-Limit", String(req.rateLimit.limit));
      }
      if (typeof req.rateLimit?.remaining === "number") {
        res.set("X-RateLimit-Remaining", String(req.rateLimit.remaining));
      }
      if (
        req.rateLimit?.resetTime instanceof Date &&
        !Number.isNaN(req.rateLimit.resetTime.getTime())
      ) {
        res.set(
          "X-RateLimit-Reset",
          String(Math.floor(req.rateLimit.resetTime.getTime() / 1000))
        );
      }

      return res.statusCode < 400;
    },
    handler(req, res) {
      const retryAfterSeconds = getRetryAfterSeconds(
        req.rateLimit?.resetTime,
        new Date(),
        config.windowMs
      );

      res.set("Retry-After", String(retryAfterSeconds));
      res.status(429).json({ error: PATH_PAYMENT_QUOTE_RATE_LIMIT_ERROR });
    },
  });
}

export {
  PATH_PAYMENT_QUOTE_RATE_LIMIT_ERROR,
  DEFAULT_PATH_PAYMENT_QUOTE_RATE_LIMIT_MAX,
  DEFAULT_PATH_PAYMENT_QUOTE_RATE_LIMIT_WINDOW_MS,
};
