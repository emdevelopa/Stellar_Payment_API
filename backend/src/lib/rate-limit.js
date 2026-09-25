import { createHash } from "node:crypto";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";

export const RATE_LIMIT_REDIS_PREFIX = "rl:";
export const VERIFY_PAYMENT_RATE_LIMIT_WINDOW_MS = 60 * 1000;
export const VERIFY_PAYMENT_RATE_LIMIT_MAX = 30;
export const MERCHANT_SECURITY_ACTION_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
export const MERCHANT_SECURITY_ACTION_RATE_LIMIT_MAX = 10;
export const SEP10_CHALLENGE_RATE_LIMIT_WINDOW_MS = Number(
  process.env.SEP10_CHALLENGE_RATE_LIMIT_WINDOW_MS || 60 * 1000,
);
export const SEP10_CHALLENGE_RATE_LIMIT_MAX = Number(
  process.env.SEP10_CHALLENGE_RATE_LIMIT_MAX || 20,
);
// Per-IP ceiling on challenge issuance across *all* accounts (#584). The
// per-account+IP limiter above is keyed on the caller-supplied `account`, so a
// single IP could otherwise mint unlimited server-signed challenges by
// rotating account values — each fresh account gets its own bucket.
export const SEP10_CHALLENGE_IP_RATE_LIMIT_WINDOW_MS = Number(
  process.env.SEP10_CHALLENGE_IP_RATE_LIMIT_WINDOW_MS || 60 * 1000,
);
export const SEP10_CHALLENGE_IP_RATE_LIMIT_MAX = Number(
  process.env.SEP10_CHALLENGE_IP_RATE_LIMIT_MAX || 60,
);
export const SEP10_VERIFY_RATE_LIMIT_WINDOW_MS = Number(
  process.env.SEP10_VERIFY_RATE_LIMIT_WINDOW_MS || 60 * 1000,
);
export const SEP10_VERIFY_RATE_LIMIT_MAX = Number(
  process.env.SEP10_VERIFY_RATE_LIMIT_MAX || 10,
);
export const DASHBOARD_METRICS_RATE_LIMIT_WINDOW_MS = Number(
  process.env.DASHBOARD_METRICS_RATE_LIMIT_WINDOW_MS || 60 * 1000,
);
export const DASHBOARD_METRICS_RATE_LIMIT_MAX = Number(
  process.env.DASHBOARD_METRICS_RATE_LIMIT_MAX || 30,
);

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

export function getMerchantSecurityActionRateLimitKey(req) {
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

  return merchantId ?? apiKey ?? `ip:${ipKey}`;
}

export function createMerchantSecurityActionRateLimit({
  store,
  rateLimitFactory = rateLimit,
} = {}) {
  return rateLimitFactory({
    windowMs: MERCHANT_SECURITY_ACTION_RATE_LIMIT_WINDOW_MS,
    max: MERCHANT_SECURITY_ACTION_RATE_LIMIT_MAX,
    message: {
      error: "Too many sensitive merchant actions, please try again later.",
    },
    standardHeaders: true,
    legacyHeaders: false,
    validate: { ip: false },
    keyGenerator: getMerchantSecurityActionRateLimitKey,
    requestWasSuccessful: (req, res) => {
      setStandardRateLimitHeaders(res, req.rateLimit);
      return res.statusCode < 400;
    },
    store,
    passOnStoreError: true,
  });
}

export function getSep10ChallengeRateLimitKey(req) {
  const account =
    typeof req?.body?.account === "string" && req.body.account.trim().length > 0
      ? req.body.account.trim()
      : "unknown-account";
  const ipKey = ipKeyGenerator(req?.ip ?? req?.socket?.remoteAddress ?? "unknown-ip");
  return `sep10:challenge:${account}:${ipKey}`;
}

export function getSep10ChallengeIpRateLimitKey(req) {
  const ipKey = ipKeyGenerator(req?.ip ?? req?.socket?.remoteAddress ?? "unknown-ip");
  return `sep10:challenge-ip:${ipKey}`;
}

export function getSep10VerifyRateLimitKey(req) {
  const ipKey = ipKeyGenerator(req?.ip ?? req?.socket?.remoteAddress ?? "unknown-ip");
  return `sep10:verify:${ipKey}`;
}

export function createSep10ChallengeRateLimit({
  store,
  rateLimitFactory = rateLimit,
  max = SEP10_CHALLENGE_RATE_LIMIT_MAX,
  windowMs = SEP10_CHALLENGE_RATE_LIMIT_WINDOW_MS,
} = {}) {
  return rateLimitFactory({
    windowMs,
    max,
    message: {
      error: "Too many challenge requests, please try again later.",
      code: "SEP10_RATE_LIMITED",
    },
    standardHeaders: true,
    legacyHeaders: false,
    validate: { ip: false },
    keyGenerator: getSep10ChallengeRateLimitKey,
    handler: (req, res, _next, options) => {
      setStandardRateLimitHeaders(res, req.rateLimit);
      res.status(options.statusCode).json(options.message);
    },
    store,
    passOnStoreError: true,
  });
}

/**
 * Per-IP aggregate limit for POST /auth/challenge (#584). Mounted in front of
 * the per-account limiter so account rotation from one IP can't bypass it.
 * Runs before body validation, so malformed requests count too.
 */
export function createSep10ChallengeIpRateLimit({
  store,
  rateLimitFactory = rateLimit,
  max = SEP10_CHALLENGE_IP_RATE_LIMIT_MAX,
  windowMs = SEP10_CHALLENGE_IP_RATE_LIMIT_WINDOW_MS,
} = {}) {
  return rateLimitFactory({
    windowMs,
    max,
    message: {
      error: "Too many challenge requests from this address, please try again later.",
      code: "SEP10_RATE_LIMITED",
    },
    standardHeaders: true,
    legacyHeaders: false,
    validate: { ip: false },
    keyGenerator: getSep10ChallengeIpRateLimitKey,
    handler: (req, res, _next, options) => {
      setStandardRateLimitHeaders(res, req.rateLimit);
      res.status(options.statusCode).json(options.message);
    },
    store,
    passOnStoreError: true,
  });
}

export function createSep10VerifyRateLimit({
  store,
  rateLimitFactory = rateLimit,
  max = SEP10_VERIFY_RATE_LIMIT_MAX,
  windowMs = SEP10_VERIFY_RATE_LIMIT_WINDOW_MS,
} = {}) {
  return rateLimitFactory({
    windowMs,
    max,
    message: {
      error: "Too many verification attempts, please try again later.",
      code: "SEP10_RATE_LIMITED",
    },
    standardHeaders: true,
    legacyHeaders: false,
    validate: { ip: false },
    keyGenerator: getSep10VerifyRateLimitKey,
    handler: (req, res, _next, options) => {
      setStandardRateLimitHeaders(res, req.rateLimit);
      res.status(options.statusCode).json(options.message);
    },
    store,
    passOnStoreError: true,
  });
}

export function getDashboardMetricsRateLimitKey(req) {
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

  return merchantId ?? apiKey ?? `ip:${ipKey}`;
}

/**
 * Per-merchant rate limit for the admin dashboard metrics endpoints
 * (summary/revenue/volume). These queries aggregate over the full payments
 * table, so unrestricted polling can add significant load (issue #927).
 */
export function createDashboardMetricsRateLimit({
  store,
  rateLimitFactory = rateLimit,
  max = DASHBOARD_METRICS_RATE_LIMIT_MAX,
  windowMs = DASHBOARD_METRICS_RATE_LIMIT_WINDOW_MS,
} = {}) {
  return rateLimitFactory({
    windowMs,
    max,
    message: {
      error: "Too many dashboard requests, please try again later.",
      code: "DASHBOARD_METRICS_RATE_LIMITED",
    },
    standardHeaders: true,
    legacyHeaders: false,
    validate: { ip: false },
    keyGenerator: getDashboardMetricsRateLimitKey,
    handler: (req, res, _next, options) => {
      setStandardRateLimitHeaders(res, req.rateLimit);
      res.status(options.statusCode).json(options.message);
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
