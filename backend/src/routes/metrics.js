import express from "express";
import { requireApiKeyAuth } from "../lib/auth.js";
import { validateRequest } from "../lib/validation.js";
import { metricsVolumeQuerySchema } from "../lib/request-schemas.js";
import { metricService } from "../services/metricService.js";
import { createDashboardMetricsRateLimit } from "../lib/rate-limit.js";
import { connectRedisClient } from "../lib/redis.js";
import {
  dashboardMetricsCacheKey,
  readThroughDashboardCache,
} from "../lib/dashboard-metrics-cache.js";
import {
  dashboardMetricsRequestsTotal,
  dashboardMetricsRequestDuration,
  dashboardMetricsErrorsTotal,
} from "../lib/metrics.js";

const defaultDashboardMetricsRateLimit = createDashboardMetricsRateLimit();

/**
 * Wrap a dashboard endpoint handler with granular request/latency/error
 * tracking (labeled by `endpoint`, not merchant_id - see the cardinality
 * note on the metrics themselves) and centralize the try/catch that was
 * previously duplicated across all three routes.
 */
function withDashboardMetrics(endpoint, handler) {
  return async (req, res, next) => {
    const start = process.hrtime.bigint();
    const recordDuration = () => {
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      dashboardMetricsRequestDuration.observe({ endpoint }, seconds);
    };

    try {
      await handler(req, res);
      recordDuration();
      dashboardMetricsRequestsTotal.inc({
        endpoint,
        status_code: String(res.statusCode),
      });
    } catch (err) {
      recordDuration();
      dashboardMetricsErrorsTotal.inc({ endpoint, error_type: "internal" });
      dashboardMetricsRequestsTotal.inc({ endpoint, status_code: "500" });
      next(err);
    }
  };
}

/**
 * Admin Dashboard Service routes (revenue summary, revenue by asset, volume
 * over time). All routes require a signed, rate-limited API key request:
 *  - requireApiKeyAuth({ requireSignature: true }) enforces HMAC request
 *    signing via the existing x-api-signature/x-api-timestamp headers
 *    (issue #928).
 *  - dashboardMetricsRateLimit caps how often a merchant can poll these
 *    aggregate queries (issue #927).
 *  - withDashboardMetrics records per-endpoint request counts, latency, and
 *    error counts to Prometheus for operational visibility (issue #1093).
 *  - readThroughDashboardCache serves a short-TTL Redis-cached response when
 *    available, falling back to the DB (and re-caching) on a miss or when
 *    Redis is unreachable (issue #1090).
 */
function createMetricsRouter({
  dashboardMetricsRateLimit = defaultDashboardMetricsRateLimit,
} = {}) {
  const router = express.Router();

  /**
   * @swagger
   * /api/metrics/summary:
   *   get:
   *     summary: Get monthly revenue summary grouped by asset
   *     tags: [Metrics]
   *     security:
   *       - ApiKeyAuth: []
   *     responses:
   *       429:
   *         description: Rate limit exceeded
   */
  router.get(
    "/metrics/summary",
    requireApiKeyAuth({ requireSignature: true }),
    dashboardMetricsRateLimit,
    withDashboardMetrics("summary", async (req, res) => {
      const redis = await connectRedisClient();
      const key = dashboardMetricsCacheKey("summary", req.merchant.id);
      const result = await readThroughDashboardCache(redis, "summary", key, () =>
        metricService.getMonthlySummary(req.merchant.id),
      );
      res.json(result);
    }),
  );

  /**
   * @swagger
   * /api/metrics/revenue:
   *   get:
   *     summary: Get aggregate revenue by asset
   *     tags: [Metrics]
   *     security:
   *       - ApiKeyAuth: []
   *     responses:
   *       429:
   *         description: Rate limit exceeded
   */
  router.get(
    "/metrics/revenue",
    requireApiKeyAuth({ requireSignature: true }),
    dashboardMetricsRateLimit,
    withDashboardMetrics("revenue", async (req, res) => {
      const redis = await connectRedisClient();
      const key = dashboardMetricsCacheKey("revenue", req.merchant.id);
      const result = await readThroughDashboardCache(redis, "revenue", key, () =>
        metricService.getRevenueByAsset(req.merchant.id),
      );
      res.json(result);
    }),
  );

  /**
   * @swagger
   * /api/metrics/volume:
   *   get:
   *     summary: Get per-asset daily volume for a time range
   *     tags: [Metrics]
   *     security:
   *       - ApiKeyAuth: []
   *     responses:
   *       429:
   *         description: Rate limit exceeded
   */
  router.get(
    "/metrics/volume",
    requireApiKeyAuth({ requireSignature: true }),
    dashboardMetricsRateLimit,
    validateRequest({ query: metricsVolumeQuerySchema }),
    withDashboardMetrics("volume", async (req, res) => {
      const redis = await connectRedisClient();
      const key = dashboardMetricsCacheKey("volume", req.merchant.id, req.query.range);
      const result = await readThroughDashboardCache(redis, "volume", key, () =>
        metricService.getVolumeOverTime(req.merchant.id, req.query.range),
      );
      res.json(result);
    }),
  );

  return router;
}

export default createMetricsRouter;
