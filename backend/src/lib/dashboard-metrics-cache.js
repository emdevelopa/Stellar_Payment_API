import { dashboardMetricsCacheHitTotal, dashboardMetricsCacheMissTotal } from "./metrics.js";

/**
 * Redis-backed read-through cache for the Admin Dashboard Service metrics
 * endpoints (summary/revenue/volume). These are aggregate queries over the
 * full payments history for a merchant, so they're relatively expensive and
 * tolerate a short TTL of staleness far better than the payment-status cache
 * in lib/redis.js (which needs near-real-time freshness).
 */

/** TTL in seconds for Admin Dashboard Service metrics cache entries. */
export const DASHBOARD_METRICS_CACHE_TTL_SECONDS = Number.parseInt(
  process.env.DASHBOARD_METRICS_CACHE_TTL_SECONDS || "30",
  10,
);

/**
 * Build a merchant-scoped cache key for a dashboard metrics endpoint.
 * Always includes merchantId so cached responses can never leak across
 * merchants; `variant` further scopes it (e.g. the requested volume range).
 */
export function dashboardMetricsCacheKey(endpoint, merchantId, variant) {
  return variant
    ? `dashboard:${endpoint}:${merchantId}:${variant}`
    : `dashboard:${endpoint}:${merchantId}`;
}

/**
 * Return the cached response for a dashboard metrics endpoint, or null on a
 * cache miss / Redis error. A cache failure must never block the request -
 * callers fall through to the DB on a null return.
 */
export async function getCachedDashboardMetrics(client, endpoint, key) {
  try {
    const raw = await client.get(key);
    if (!raw) {
      dashboardMetricsCacheMissTotal.inc({ endpoint });
      return null;
    }
    dashboardMetricsCacheHitTotal.inc({ endpoint });
    return JSON.parse(raw);
  } catch (err) {
    console.error(`Redis GET error (dashboard:${endpoint}):`, err.message);
    dashboardMetricsCacheMissTotal.inc({ endpoint });
    return null;
  }
}

/** Store a dashboard metrics response with the standard cache TTL. */
export async function setCachedDashboardMetrics(client, key, data) {
  try {
    await client.set(key, JSON.stringify(data), {
      EX: DASHBOARD_METRICS_CACHE_TTL_SECONDS,
    });
  } catch (err) {
    console.error("Redis SET error (dashboard metrics):", err.message);
  }
}

/**
 * Read-through cache: return the cached value for `key` if present,
 * otherwise call `loader`, cache its result, and return it. `loader`
 * failures propagate to the caller uncached.
 */
export async function readThroughDashboardCache(client, endpoint, key, loader) {
  const cached = await getCachedDashboardMetrics(client, endpoint, key);
  if (cached) {
    return cached;
  }
  const fresh = await loader();
  await setCachedDashboardMetrics(client, key, fresh);
  return fresh;
}
