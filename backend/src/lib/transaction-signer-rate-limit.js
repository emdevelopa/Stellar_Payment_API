/**
 * Dedicated Rate Limiting for Transaction Signer Endpoint
 * Issue: Rate Limiting Protections for Transaction Signer
 * 
 * This module implements rate limiting specifically for the transaction signature verification
 * endpoint to prevent abuse and resource exhaustion. It provides:
 * - Configurable thresholds per actor type (IP, API key, merchant)
 * - Secure fallback behavior when Redis is unavailable
 * - Accurate logging and monitoring
 * - Protection against burst traffic and bypass attempts
 */

import { createHash } from "node:crypto";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { logger } from "./logger.js";
import {
  rateLimitExceededTotal,
  rateLimitRequestsTotal,
} from "./metrics.js";

export const TRANSACTION_SIGNER_RATE_LIMIT_PREFIX = "ts_rl:";
export const TRANSACTION_SIGNER_WINDOW_MS = 60 * 1000; // 1 minute
export const TRANSACTION_SIGNER_MAX_REQUESTS = 100; // 100 verifications per minute per actor
export const TRANSACTION_SIGNER_BURST_MAX = 20; // 20 verifications in 10 seconds burst window
export const TRANSACTION_SIGNER_BURST_WINDOW_MS = 10 * 1000; // 10 seconds

/**
 * Generate a rate limit key for transaction signer requests.
 *
 * Key is actor-only (merchant_id > api_key_hash > ip). The txHash is no
 * longer included: per-txHash bucketing let attackers rotate through
 * arbitrary hashes to create an effectively unlimited number of buckets,
 * each with its own full rate-limit allowance (VULN-07). Actor-only keying
 * ensures the per-actor limit is always enforced regardless of which hashes
 * are submitted.
 *
 * Priority order: merchant_id > api_key_hash > ip_address
 *
 * @param {Object} req - Express request object
 * @returns {string} Rate limit key
 */
export function getTransactionSignerRateLimitKey(req) {
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
 * Generate a burst rate limit key for transaction signer requests.
 * Uses a shorter time window to detect and prevent burst attacks.
 * 
 * @param {Object} req - Express request object
 * @returns {string} Burst rate limit key
 */
export function getTransactionSignerBurstRateLimitKey(req) {
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

  return `burst:${actor}`;
}

/**
 * Set standard rate limit headers on the response.
 * 
 * @param {Object} res - Express response object
 * @param {Object} rateLimitState - Rate limit state from express-rate-limit
 */
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

/**
 * Determine the actor type for metrics.
 * 
 * @param {Object} req - Express request object
 * @returns {string} Actor type (merchant, api_key, ip)
 */
function getActorType(req) {
  if (typeof req?.merchant?.id === "string" && req.merchant.id.length > 0) {
    return "merchant";
  }
  if (typeof req?.headers?.["x-api-key"] === "string" && req.headers["x-api-key"].length > 0) {
    return "api_key";
  }
  return "ip";
}

/**
 * Create a Redis store for rate limiting.
 * 
 * @param {Object} client - Redis client
 * @param {Object} options - Store options
 * @returns {RedisStore} Redis store instance
 */
export function createTransactionSignerRedisStore({
  client,
  StoreClass = RedisStore,
  prefix = TRANSACTION_SIGNER_RATE_LIMIT_PREFIX,
} = {}) {
  return new StoreClass({
    sendCommand: (...args) => client.sendCommand(args),
    prefix,
  });
}

/**
 * Create rate limiter for transaction signer endpoint.
 * 
 * @param {Object} options - Configuration options
 * @param {Object} options.store - Rate limit store (Redis or memory)
 * @param {Function} options.rateLimitFactory - Rate limit factory for testing
 * @param {number} options.windowMs - Time window in milliseconds
 * @param {number} options.max - Maximum requests per window
 * @returns {Object} Express rate limit middleware
 */
export function createTransactionSignerRateLimit({
  store,
  rateLimitFactory = rateLimit,
  windowMs = TRANSACTION_SIGNER_WINDOW_MS,
  max = TRANSACTION_SIGNER_MAX_REQUESTS,
} = {}) {
  return rateLimitFactory({
    windowMs,
    max,
    message: {
      error: "Too many transaction signature verification requests. Please try again later.",
      retryAfter: Math.ceil(windowMs / 1000),
    },
    standardHeaders: true,
    legacyHeaders: false,
    validate: { ip: false },
    keyGenerator: getTransactionSignerRateLimitKey,
    requestWasSuccessful: (req, res) => {
      setStandardRateLimitHeaders(res, req.rateLimit);
      return res.statusCode < 400;
    },
    handler: (req, res, next, options) => {
      const actorType = getActorType(req);
      
      // Record metrics
      rateLimitExceededTotal.inc({
        endpoint: "transaction_signer",
        type: actorType,
      });
      
      logger.warn({
        endpoint: "transaction_signer",
        actorType,
        ip: req.ip,
        merchantId: req.merchant?.id,
        hasApiKey: !!req.headers["x-api-key"],
        limit: options.max,
        windowMs: options.windowMs,
      }, "Transaction signer rate limit exceeded");
      
      res.status(429).json(options.message);
    },
    onLimitReached: (req, res, options) => {
      const actorType = getActorType(req);
      
      logger.info({
        endpoint: "transaction_signer",
        actorType,
        ip: req.ip,
        merchantId: req.merchant?.id,
        limit: options.max,
        windowMs: options.windowMs,
      }, "Transaction signer rate limit reached");
    },
    store,
    passOnStoreError: true, // Allow requests through if Redis is temporarily unavailable
    skipFailedRequests: false, // Count ALL requests (including 4xx) against the limit.
    // Previously true, which let attackers probe with invalid hashes infinitely
    // without consuming rate-limit budget (VULN-10).
    skipSuccessfulRequests: false, // Count successful requests
  });
}

/**
 * Create burst rate limiter for transaction signer endpoint.
 * This prevents burst attacks by limiting requests in a short time window.
 * 
 * @param {Object} options - Configuration options
 * @param {Object} options.store - Rate limit store (Redis or memory)
 * @param {Function} options.rateLimitFactory - Rate limit factory for testing
 * @param {number} options.windowMs - Time window in milliseconds
 * @param {number} options.max - Maximum requests per window
 * @returns {Object} Express rate limit middleware
 */
export function createTransactionSignerBurstRateLimit({
  store,
  rateLimitFactory = rateLimit,
  windowMs = TRANSACTION_SIGNER_BURST_WINDOW_MS,
  max = TRANSACTION_SIGNER_BURST_MAX,
} = {}) {
  return rateLimitFactory({
    windowMs,
    max,
    message: {
      error: "Burst of transaction signature verification requests detected. Please slow down.",
      retryAfter: Math.ceil(windowMs / 1000),
    },
    standardHeaders: true,
    legacyHeaders: false,
    validate: { ip: false },
    keyGenerator: getTransactionSignerBurstRateLimitKey,
    requestWasSuccessful: (req, res) => {
      setStandardRateLimitHeaders(res, req.rateLimit);
      return res.statusCode < 400;
    },
    handler: (req, res, next, options) => {
      const actorType = getActorType(req);
      
      // Record metrics
      rateLimitExceededTotal.inc({
        endpoint: "transaction_signer_burst",
        type: actorType,
      });
      
      logger.warn({
        endpoint: "transaction_signer_burst",
        actorType,
        ip: req.ip,
        merchantId: req.merchant?.id,
        limit: options.max,
        windowMs: options.windowMs,
      }, "Transaction signer burst rate limit exceeded");
      
      res.status(429).json(options.message);
    },
    store,
    passOnStoreError: true, // Allow requests through if Redis is temporarily unavailable
    skipFailedRequests: false, // Count ALL requests against the burst limit (VULN-10).
    skipSuccessfulRequests: false,
  });
}

/**
 * Apply both rate limiters to an Express app.
 * The burst limiter is applied first to catch rapid requests, then the standard limiter.
 * 
 * @param {Object} app - Express app
 * @param {Object} options - Configuration options
 * @param {Object} options.redisClient - Redis client for distributed rate limiting
 * @param {boolean} options.useMemoryStore - Fallback to memory store if Redis unavailable
 */
export function applyTransactionSignerRateLimits(app, options = {}) {
  const { redisClient, useMemoryStore = false } = options;
  
  let store;
  if (redisClient && !useMemoryStore) {
    try {
      store = createTransactionSignerRedisStore({ client: redisClient });
      logger.info("Using Redis store for transaction signer rate limiting");
    } catch (err) {
      logger.warn({
        error: err.message,
      }, "Failed to create Redis store, falling back to memory store");
      store = undefined; // Use default memory store
    }
  } else {
    logger.info("Using memory store for transaction signer rate limiting");
  }
  
  // Apply burst rate limiter first
  app.use("/api/verify-signature", createTransactionSignerBurstRateLimit({ store }));
  
  // Apply standard rate limiter
  app.use("/api/verify-signature", createTransactionSignerRateLimit({ store }));
  
  logger.info({
    burstWindowMs: TRANSACTION_SIGNER_BURST_WINDOW_MS,
    burstMax: TRANSACTION_SIGNER_BURST_MAX,
    standardWindowMs: TRANSACTION_SIGNER_WINDOW_MS,
    standardMax: TRANSACTION_SIGNER_MAX_REQUESTS,
  }, "Transaction signer rate limiting configured");
}

/**
 * Middleware to record rate limit requests for metrics.
 * This should be applied before the rate limiters.
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
export function recordTransactionSignerRequestMetrics(req, res, next) {
  const actorType = getActorType(req);
  
  rateLimitRequestsTotal.inc({
    endpoint: "transaction_signer",
    type: actorType,
  });
  
  next();
}
