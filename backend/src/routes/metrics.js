import express from "express";
import { requireApiKeyAuth } from "../lib/auth.js";
import { withMerchantContext } from "../lib/db-rls.js";
import { validateRequest } from "../lib/validation.js";
import { metricsVolumeQuerySchema } from "../lib/request-schemas.js";

const router = express.Router();

/**
 * @swagger
 * /api/metrics/summary:
 *   get:
 *     summary: Get monthly revenue summary grouped by asset
 *     tags: [Metrics]
 *     security:
 *       - ApiKeyAuth: []
 */
router.get("/metrics/summary", requireApiKeyAuth(), async (req, res, next) => {
  try {
    const pool = req.app.locals.pool;
    const result = await metricService.getMonthlySummary(pool, req.merchant.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/metrics/revenue:
 *   get:
 *     summary: Get aggregate revenue by asset
 *     tags: [Metrics]
 *     security:
 *       - ApiKeyAuth: []
 */
router.get("/metrics/revenue", requireApiKeyAuth(), async (req, res, next) => {
  try {
    const pool = req.app.locals.pool;
    const result = await metricService.getRevenueByAsset(pool, req.merchant.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/metrics/volume:
 *   get:
 *     summary: Get per-asset daily volume for a time range
 *     tags: [Metrics]
 *     security:
 *       - ApiKeyAuth: []
 */
router.get("/metrics/volume", requireApiKeyAuth(), validateRequest({ query: metricsVolumeQuerySchema }), async (req, res, next) => {
  try {
    const pool = req.app.locals.pool;
    const merchantId = req.merchant.id;
    const VALID_RANGES = { "7D": 7, "30D": 30, "1Y": 365 };
    const range = req.query.range;
    const days = VALID_RANGES[range];

    const query = `
      SELECT
        date_trunc('day', created_at) AS date,
        asset,
        SUM(amount) AS volume,
        COUNT(*) AS count
      FROM payments
      WHERE merchant_id = $1
        AND status = 'completed'
        AND created_at >= NOW() - INTERVAL '${days} days'
      GROUP BY 1, 2
      ORDER BY 1 ASC, 2 ASC
    `;

    const { rows } = await pool.query(query, [merchantId]);
    const assetSet = new Set(rows.map((row) => row.asset));
    const assets = Array.from(assetSet);

    const byDate = {};
    for (const row of rows) {
      const dateStr = row.date.toISOString().split("T")[0];
      if (!byDate[dateStr]) {
        byDate[dateStr] = { date: dateStr, count: 0 };
      }

      byDate[dateStr][row.asset] = parseFloat(row.volume) || 0;
      byDate[dateStr].count += parseInt(row.count, 10) || 0;
    }

    const now = new Date();
    const result = [];
    for (let i = days - 1; i >= 0; i -= 1) {
      const day = new Date(now);
      day.setDate(day.getDate() - i);
      const dateStr = day.toISOString().split("T")[0];
      const entry = byDate[dateStr] || { date: dateStr, count: 0 };

      for (const asset of assets) {
        if (entry[asset] === undefined) entry[asset] = 0;
      }

      result.push(entry);
    }

    res.json({ range, assets, data: result });
  } catch (err) {
    if (err.message.includes("Invalid range")) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

export default router;
