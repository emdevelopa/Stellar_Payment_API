/**
 * payment-rate-limiter.js
 *
 * In-memory sliding-window rate limiter for the payment processor.
 *
 * Designed to be a zero-dependency fallback when Redis is not available.
 * Each key (e.g. client IP) maintains a { count, windowStart } record.
 * Stale entries from previous windows are evicted on every request so the
 * Map does not grow unboundedly in long-running processes.
 *
 * Usage example:
 *
 *   const { createPaymentRateLimiter } = require('./middleware/payment-rate-limiter')
 *
 *   // Mount on the router (uncomment to activate):
 *   // router.use(createPaymentRateLimiter({ windowMs: 60000, maxRequests: 100 }))
 *
 *   // Or on a specific route:
 *   // router.post('/create-payment', createPaymentRateLimiter({ windowMs: 60000, maxRequests: 10 }), handler)
 */

/**
 * Create an Express middleware that enforces a sliding-window rate limit.
 *
 * @param {object}   [opts]
 * @param {number}   [opts.windowMs=60000]      - Time window length in milliseconds (default: 1 minute)
 * @param {number}   [opts.maxRequests=100]     - Maximum number of requests allowed per key per window
 * @param {Function} [opts.keyFn]               - Extract the rate-limit key from the request.
 *                                                Defaults to req.ip. Return null/undefined to skip limiting.
 * @param {Function} [opts.now]                 - Injectable clock function returning a timestamp in ms; defaults to Date.now
 * @returns {Function} Express middleware (req, res, next)
 */
function createPaymentRateLimiter(opts = {}) {
  const {
    windowMs = 60_000,
    maxRequests = 100,
    keyFn = (req) => req.ip,
    now = Date.now,
  } = opts;

  /** @type {Map<string, { count: number, windowStart: number }>} */
  const store = new Map();

  return function paymentRateLimiterMiddleware(req, res, next) {
    const key = keyFn(req);

    // If the key function returns nothing, skip limiting for this request
    if (key == null) {
      return next();
    }

    const currentTime = now();

    // Evict all expired entries on every request to bound memory growth
    for (const [k, entry] of store) {
      if (currentTime - entry.windowStart >= windowMs) {
        store.delete(k);
      }
    }

    const entry = store.get(key);
    const windowStart = entry && currentTime - entry.windowStart < windowMs
      ? entry.windowStart
      : currentTime;

    const count = entry && currentTime - entry.windowStart < windowMs
      ? entry.count
      : 0;

    const newCount = count + 1;
    store.set(key, { count: newCount, windowStart });

    const remaining = Math.max(0, maxRequests - newCount);
    const resetMs = windowStart + windowMs;
    const resetSec = Math.ceil(resetMs / 1000);

    res.setHeader("X-RateLimit-Limit", String(maxRequests));
    res.setHeader("X-RateLimit-Remaining", String(remaining));
    res.setHeader("X-RateLimit-Reset", String(resetSec));

    if (newCount > maxRequests) {
      const retryAfterSec = Math.ceil((resetMs - currentTime) / 1000);
      res.setHeader("Retry-After", String(Math.max(0, retryAfterSec)));
      return res.status(429).json({
        error: "Too many requests",
        retryAfter: Math.max(0, retryAfterSec),
      });
    }

    return next();
  };
}

export { createPaymentRateLimiter };
