/**
 * In-memory idempotency cache with TTL.
 * 
 * For production deployments with multiple instances, consider:
 * - Redis: Fast, persistent, cluster-ready
 * - Supabase: Use a dedicated idempotency_keys table with cleanup jobs
 * 
 * Current implementation:
 * - Stored in memory with automatic cleanup after TTL
 * - Single-instance friendly
 * - Does NOT persist across server restarts
 */

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const cache = new Map();

/**
 * Check if an idempotency key exists and is still valid.
 * @param {string} key - The idempotency key
 * @returns {object|null} - Cached response or null if not found
 */
export function getIdempotencyResponse(key) {
  if (!cache.has(key)) return null;

  const entry = cache.get(key);
  const now = Date.now();

  // Check if entry has expired
  if (now > entry.expiresAt) {
    cache.delete(key);
    return null;
  }

  return entry.response;
}

/**
 * Store a response against an idempotency key.
 * @param {string} key - The idempotency key
 * @param {object} response - The response object to cache
 */
export function setIdempotencyResponse(key, response) {
  cache.set(key, {
    response,
    expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
  });
}

/**
 * Idempotency middleware that checks and enforces idempotent requests.
 * Returns cached response if key exists, otherwise calls next.
 */
export function idempotencyMiddleware(req, res, next) {
  const idempotencyKey = req.get("Idempotency-Key");

  if (!idempotencyKey) {
    // Idempotency-Key is optional, but strongly recommended
    return next();
  }

  if (typeof idempotencyKey !== "string" || idempotencyKey.trim().length === 0) {
    return res.status(400).json({
      error: "Idempotency-Key header must be a non-empty string"
    });
  }

  // Check cache
  const cachedResponse = getIdempotencyResponse(idempotencyKey);
  if (cachedResponse) {
    // Return cached response with 200 (not 201) to indicate it's a cached duplicate
    return res.status(200).json(cachedResponse);
  }

  // Store original json method
  const originalJson = res.json.bind(res);

  // Override json to cache responses
  res.json = function (data) {
    // Only cache successful responses (2xx status codes)
    if (res.statusCode >= 200 && res.statusCode < 300) {
      setIdempotencyResponse(idempotencyKey, data);
    }
    return originalJson(data);
  };

  next();
}
