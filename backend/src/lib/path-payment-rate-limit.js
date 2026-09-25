/**
 * Path Payment Service Rate Limiting
 * Task #882: Implement comprehensive rate limiting for Path Payment Service
 *
 * This module provides rate limiting for all path payment operations:
 * - Path payment execution (distinct from quote fetching)
 * - Per-merchant and per-IP rate limits
 * - Adaptive rate limiting based on account tier
 * - Integration with existing quote rate limiter
 */

import { createHash } from "node:crypto";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import {
  createRedisRateLimitStore,
  RATE_LIMIT_REDIS_PREFIX,
} from "./rate-limit.js";

// Rate limiting constants for path payment operations
export const PATH_PAYMENT_EXECUTION_RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
export const PATH_PAYMENT_EXECUTION_RATE_LIMIT_MAX = 15; // 15 executions per window
export const PATH_PAYMENT_SUBMIT_RATE_LIMIT_MAX = 30; // 30 submissions per window
export const PATH_PAYMENT_STATUS_RATE_LIMIT_MAX = 100; // 100 status checks per window

/**
 * Rate limiter for path payment executions
 */
export class PathPaymentRateLimiter {
  /**
   * Generate rate limit key for path payment executions
   */
  static getPathPaymentExecutionKey(req) {
    const merchantId = req?.merchant?.id;
    const apiKey = req?.headers?.["x-api-key"];
    const ipKey = ipKeyGenerator(
      req?.ip ?? req?.socket?.remoteAddress ?? "unknown-ip",
    );

    const hashedApiKey = apiKey
      ? createHash("sha256").update(apiKey).digest("hex").substring(0, 16)
      : null;

    const actor = merchantId
      ? `merchant:${merchantId}`
      : hashedApiKey
        ? `api:${hashedApiKey}`
        : `ip:${ipKey}`;

    return `path-payment:exec:${actor}`;
  }

  /**
   * Generate rate limit key for path payment submissions
   */
  static getPathPaymentSubmitKey(req) {
    const merchantId = req?.merchant?.id;
    const ipKey = ipKeyGenerator(
      req?.ip ?? req?.socket?.remoteAddress ?? "unknown-ip",
    );

    const actor = merchantId ? `merchant:${merchantId}` : `ip:${ipKey}`;
    return `path-payment:submit:${actor}`;
  }

  /**
   * Generate rate limit key for path payment status checks
   */
  static getPathPaymentStatusKey(req) {
    const merchantId = req?.merchant?.id;
    const ipKey = ipKeyGenerator(
      req?.ip ?? req?.socket?.remoteAddress ?? "unknown-ip",
    );

    const actor = merchantId ? `merchant:${merchantId}` : `ip:${ipKey}`;
    return `path-payment:status:${actor}`;
  }

  /**
   * Create rate limiter for path payment executions
   */
  static createPathPaymentExecutionRateLimit({
    store,
    rateLimitFactory = rateLimit,
  } = {}) {
    return rateLimitFactory({
      windowMs: PATH_PAYMENT_EXECUTION_RATE_LIMIT_WINDOW_MS,
      max: PATH_PAYMENT_EXECUTION_RATE_LIMIT_MAX,
      message: {
        error:
          "Too many path payment executions. Please wait before executing more path payments.",
        retryAfter: Math.ceil(
          PATH_PAYMENT_EXECUTION_RATE_LIMIT_WINDOW_MS / 1000,
        ),
      },
      standardHeaders: true,
      legacyHeaders: false,
      validate: { ip: false },
      keyGenerator: this.getPathPaymentExecutionKey,
      requestWasSuccessful: (_req, res) => res.statusCode < 400,
      store,
      passOnStoreError: true,
      // Skip rate limiting for high-tier merchants
      skip: (req) => {
        const merchantTier = req?.merchant?.metadata?.tier;
        return merchantTier === "enterprise" || merchantTier === "premium";
      },
    });
  }

  /**
   * Create rate limiter for path payment submissions
   */
  static createPathPaymentSubmitRateLimit({
    store,
    rateLimitFactory = rateLimit,
  } = {}) {
    return rateLimitFactory({
      windowMs: PATH_PAYMENT_EXECUTION_RATE_LIMIT_WINDOW_MS,
      max: PATH_PAYMENT_SUBMIT_RATE_LIMIT_MAX,
      message: {
        error: "Too many path payment submission requests. Please slow down.",
        retryAfter: Math.ceil(
          PATH_PAYMENT_EXECUTION_RATE_LIMIT_WINDOW_MS / 1000,
        ),
      },
      standardHeaders: true,
      legacyHeaders: false,
      validate: { ip: false },
      keyGenerator: this.getPathPaymentSubmitKey,
      requestWasSuccessful: (_req, res) => res.statusCode < 400,
      store,
      passOnStoreError: true,
    });
  }

  /**
   * Create rate limiter for path payment status checks
   */
  static createPathPaymentStatusRateLimit({
    store,
    rateLimitFactory = rateLimit,
  } = {}) {
    return rateLimitFactory({
      windowMs: PATH_PAYMENT_EXECUTION_RATE_LIMIT_WINDOW_MS,
      max: PATH_PAYMENT_STATUS_RATE_LIMIT_MAX,
      message: {
        error: "Too many path payment status check requests. Please slow down.",
        retryAfter: Math.ceil(
          PATH_PAYMENT_EXECUTION_RATE_LIMIT_WINDOW_MS / 1000,
        ),
      },
      standardHeaders: true,
      legacyHeaders: false,
      validate: { ip: false },
      keyGenerator: this.getPathPaymentStatusKey,
      requestWasSuccessful: (_req, res) => res.statusCode < 400,
      store,
      passOnStoreError: true,
    });
  }
}

/**
 * Factory function to create all path payment rate limiters
 */
export const createPathPaymentRateLimits = (redisClient) => {
  const store = createRedisRateLimitStore({
    client: redisClient,
    prefix: `${RATE_LIMIT_REDIS_PREFIX}path-payment:`,
  });

  return {
    execution: PathPaymentRateLimiter.createPathPaymentExecutionRateLimit({
      store,
    }),
    submit: PathPaymentRateLimiter.createPathPaymentSubmitRateLimit({ store }),
    status: PathPaymentRateLimiter.createPathPaymentStatusRateLimit({ store }),
  };
};

export { createRedisRateLimitStore, RATE_LIMIT_REDIS_PREFIX };
