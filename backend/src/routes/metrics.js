import express from "express";
import { requireApiKeyAuth } from "../lib/auth.js";

const router = express.Router();

/**
 * @swagger
 * /api/metrics/summary:
 *   get:
 *     summary: Get monthly revenue summary grouped by asset
 *     description: Returns total revenue for last month and current month, grouped by asset (XLM, USDC, etc.)
 *     tags: [Metrics]
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Monthly revenue summary grouped by asset
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 last_month:
 *                   type: object
 *                   description: Revenue totals for last calendar month
 *                   properties:
 *                     by_asset:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           asset:
 *                             type: string
 *                             description: Asset code (e.g., XLM, USDC)
 *                           asset_issuer:
 *                             type: string
 *                             nullable: true
 *                             description: Asset issuer (null for native XLM)
 *                           total:
 *                             type: string
 *                             description: Total amount for this asset
 *                           count:
 *                             type: integer
 *                             description: Number of completed payments
 *                     total:
 *                       type: number
 *                       description: Grand total across all assets
 *                 current_month:
 *                   type: object
 *                   description: Revenue totals for current calendar month
 *                   properties:
 *                     by_asset:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           asset:
 *                             type: string
 *                           asset_issuer:
 *                             type: string
 *                             nullable: true
 *                           total:
 *                             type: string
 *                           count:
 *                             type: integer
 *                     total:
 *                       type: number
 *                       description: Grand total across all assets
 *                 period:
 *                   type: object
 *                   properties:
 *                     last_month_start:
 *                       type: string
 *                       format: date-time
 *                     last_month_end:
 *                       type: string
 *                       format: date-time
 *                     current_month_start:
 *                       type: string
 *                       format: date-time
 *       401:
 *         description: Unauthorized - invalid API key
 *       500:
 *         description: Server error
 */
router.get("/metrics/summary", requireApiKeyAuth(), async (req, res, next) => {
  try {
    const pool = req.app.locals.pool;
    const merchantId = req.merchant.id;

    // Calculate date ranges for last month and current month
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth(); // 0-indexed (0 = January)

    // Last month
    const lastMonth = currentMonth === 0 ? 11 : currentMonth - 1;
    const lastMonthYear = currentMonth === 0 ? currentYear - 1 : currentYear;

    // First day of current month
    const currentMonthStart = new Date(currentYear, currentMonth, 1);
    // First day of last month
    const lastMonthStart = new Date(lastMonthYear, lastMonth, 1);
    // Last day of last month (day before first day of current month)
    const lastMonthEnd = new Date(currentYear, currentMonth, 0, 23, 59, 59, 999);

    // Query for last month's revenue
    const lastMonthQuery = `
      SELECT
        asset,
        asset_issuer,
        SUM(amount) as total,
        COUNT(*) as count
      FROM payments
      WHERE merchant_id = $1 
        AND status = 'completed'
        AND created_at >= $2 
        AND created_at <= $3
      GROUP BY asset, asset_issuer
      ORDER BY asset, asset_issuer
    `;

    // Query for current month's revenue
    const currentMonthQuery = `
      SELECT
        asset,
        asset_issuer,
        SUM(amount) as total,
        COUNT(*) as count
      FROM payments
      WHERE merchant_id = $1 
        AND status = 'completed'
        AND created_at >= $2
      GROUP BY asset, asset_issuer
      ORDER BY asset, asset_issuer
    `;

    const [lastMonthResult, currentMonthResult] = await Promise.all([
      pool.query(lastMonthQuery, [merchantId, lastMonthStart, lastMonthEnd]),
      pool.query(currentMonthQuery, [merchantId, currentMonthStart]),
    ]);

    // Format last month data
    const lastMonthByAsset = lastMonthResult.rows.map(row => ({
      asset: row.asset,
      asset_issuer: row.asset_issuer,
      total: row.total || "0",
      count: parseInt(row.count)
    }));

    const lastMonthTotal = lastMonthByAsset.reduce(
      (sum, item) => sum + parseFloat(item.total),
      0
    );

    // Format current month data
    const currentMonthByAsset = currentMonthResult.rows.map(row => ({
      asset: row.asset,
      asset_issuer: row.asset_issuer,
      total: row.total || "0",
      count: parseInt(row.count)
    }));

    const currentMonthTotal = currentMonthByAsset.reduce(
      (sum, item) => sum + parseFloat(item.total),
      0
    );

    res.json({
      last_month: {
        by_asset: lastMonthByAsset,
        total: parseFloat(lastMonthTotal.toFixed(7))
      },
      current_month: {
        by_asset: currentMonthByAsset,
        total: parseFloat(currentMonthTotal.toFixed(7))
      },
      period: {
        last_month_start: lastMonthStart.toISOString(),
        last_month_end: lastMonthEnd.toISOString(),
        current_month_start: currentMonthStart.toISOString()
      }
    });
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
 *     responses:
 *       200:
 *         description: Revenue data grouped by asset
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 revenue:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       asset:
 *                         type: string
 *                         description: Asset code (e.g., XLM, USDC)
 *                       asset_issuer:
 *                         type: string
 *                         nullable: true
 *                         description: Asset issuer (null for native XLM)
 *                       total:
 *                         type: string
 *                         description: Sum of amounts for this asset
 *                       count:
 *                         type: integer
 *                         description: Number of completed payments for this asset
 *       401:
 *         description: Unauthorized - invalid API key
 *       500:
 *         description: Server error
 */
router.get("/metrics/revenue", requireApiKeyAuth(), async (req, res, next) => {
  try {
    const pool = req.app.locals.pool;
    const merchantId = req.merchant.id;

    const query = `
      SELECT
        asset,
        asset_issuer,
        SUM(amount) as total,
        COUNT(*) as count
      FROM payments
      WHERE merchant_id = $1 AND status = 'completed'
      GROUP BY asset, asset_issuer
      ORDER BY asset, asset_issuer
    `;

    const { rows } = await pool.query(query, [merchantId]);

    res.json({
      revenue: rows.map(row => ({
        asset: row.asset,
        asset_issuer: row.asset_issuer,
        total: row.total,
        count: parseInt(row.count)
      }))
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/metrics/volume:
 *   get:
 *     summary: Get per-asset daily volume for a time range
 *     description: Returns daily payment volume broken down by asset for use in multi-asset comparison charts. Supports 7D, 30D, and 1Y time ranges.
 *     tags: [Metrics]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: range
 *         schema:
 *           type: string
 *           enum: [7D, 30D, 1Y]
 *           default: 7D
 *         description: Time range for the volume data
 *     responses:
 *       200:
 *         description: Per-asset daily volume data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 range:
 *                   type: string
 *                 assets:
 *                   type: array
 *                   items:
 *                     type: string
 *                   description: Distinct asset codes present in the data
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       date:
 *                         type: string
 *                         format: date
 *                       XLM:
 *                         type: number
 *                       USDC:
 *                         type: number
 *       400:
 *         description: Invalid range parameter
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get("/metrics/volume", requireApiKeyAuth(), async (req, res, next) => {
  try {
    const pool = req.app.locals.pool;
    const merchantId = req.merchant.id;

    const VALID_RANGES = { "7D": 7, "30D": 30, "1Y": 365 };
    const range = (req.query.range || "7D").toUpperCase();

    if (!VALID_RANGES[range]) {
      return res.status(400).json({ error: "Invalid range. Use 7D, 30D, or 1Y." });
    }

    const days = VALID_RANGES[range];

    const query = `
      SELECT
        date_trunc('day', created_at) AS date,
        asset,
        SUM(amount) AS volume
      FROM payments
      WHERE merchant_id = $1
        AND status = 'completed'
        AND created_at >= NOW() - INTERVAL '${days} days'
      GROUP BY 1, 2
      ORDER BY 1 ASC, 2 ASC
    `;

    const { rows } = await pool.query(query, [merchantId]);

    // Collect all distinct assets across the result set
    const assetSet = new Set(rows.map(r => r.asset));
    const assets = Array.from(assetSet);

    // Build a date-keyed map: { "2026-03-01": { XLM: 5.0, USDC: 100.0 } }
    const byDate = {};
    for (const row of rows) {
      const dateStr = row.date.toISOString().split("T")[0];
      if (!byDate[dateStr]) byDate[dateStr] = { date: dateStr };
      byDate[dateStr][row.asset] = parseFloat(row.volume) || 0;
    }

    // Fill gaps so every date in the range has an entry (0 for missing assets)
    const now = new Date();
    const result = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split("T")[0];
      const entry = byDate[dateStr] || { date: dateStr };
      for (const asset of assets) {
        if (entry[asset] === undefined) entry[asset] = 0;
      }
      result.push(entry);
    }

    res.json({ range, assets, data: result });
  } catch (err) {
    next(err);
  }
});

export default router;
