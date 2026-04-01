import rateLimit from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";

export const RATE_LIMIT_REDIS_PREFIX = "rl:";

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

export function createVerifyPaymentRateLimit({
  store,
  rateLimitFactory = rateLimit,
} = {}) {
  return rateLimitFactory({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: {
      error: "Too many verification requests, please try again later.",
    },
    standardHeaders: true,
    legacyHeaders: false,
    requestWasSuccessful: (req, res) => {
      setStandardRateLimitHeaders(res, req.rateLimit);
      return res.statusCode < 400;
    },
    store,
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
    requestWasSuccessful: (req, res) => {
      setStandardRateLimitHeaders(res, req.rateLimit);
      return res.statusCode < 400;
    },
    store,
    keyGenerator: (req) => {
      // Rate limit by IP address
      return req.ip || req.connection.remoteAddress;
    },
  });
}
