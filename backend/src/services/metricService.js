import { withMerchantContext } from "../lib/db-rls.js";

export const metricService = {
  async getMonthlySummary(pool, merchantId) {
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
    const lastMonthEnd = new Date(
      currentYear,
      currentMonth,
      0,
      23,
      59,
      59,
      999
    );

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

    const { lastMonthResult, currentMonthResult } = await withMerchantContext(
      merchantId,
      async (client) => {
        const last = await client.query(lastMonthQuery, [
          merchantId,
          lastMonthStart,
          lastMonthEnd,
        ]);
        const current = await client.query(currentMonthQuery, [
          merchantId,
          currentMonthStart,
        ]);
        return { lastMonthResult: last, currentMonthResult: current };
      }
    );

    // Format last month data
    const lastMonthByAsset = lastMonthResult.rows.map((row) => ({
      asset: row.asset,
      asset_issuer: row.asset_issuer,
      total: row.total || "0",
      count: parseInt(row.count, 10),
    }));

    const lastMonthTotal = lastMonthByAsset.reduce(
      (sum, item) => sum + parseFloat(item.total),
      0
    );

    // Format current month data
    const currentMonthByAsset = currentMonthResult.rows.map((row) => ({
      asset: row.asset,
      asset_issuer: row.asset_issuer,
      total: row.total || "0",
      count: parseInt(row.count, 10),
    }));

    const currentMonthTotal = currentMonthByAsset.reduce(
      (sum, item) => sum + parseFloat(item.total),
      0
    );

    return {
      last_month: {
        by_asset: lastMonthByAsset,
        total: parseFloat(lastMonthTotal.toFixed(7)),
      },
      current_month: {
        by_asset: currentMonthByAsset,
        total: parseFloat(currentMonthTotal.toFixed(7)),
      },
      period: {
        last_month_start: lastMonthStart.toISOString(),
        last_month_end: lastMonthEnd.toISOString(),
        current_month_start: currentMonthStart.toISOString(),
      },
    };
  },

  async getRevenueByAsset(pool, merchantId) {
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

    return {
      revenue: rows.map((row) => ({
        asset: row.asset,
        asset_issuer: row.asset_issuer,
        total: row.total,
        count: parseInt(row.count, 10),
      })),
    };
  },

  async getVolumeOverTime(pool, merchantId, range) {
    const VALID_RANGES = { "7D": 7, "30D": 30, "1Y": 365 };
    const days = VALID_RANGES[range];

    if (!days) {
      throw new Error("Invalid range. Use 7D, 30D, or 1Y.");
    }

    const query = `
      SELECT
        date_trunc('day', created_at) AS date,
        asset,
        SUM(amount) AS volume
      FROM payments
      WHERE merchant_id = $1
        AND status = 'completed'
        AND created_at >= NOW() - ($2::int * INTERVAL '1 day')
      GROUP BY 1, 2
      ORDER BY 1 ASC, 2 ASC
    `;

    const { rows } = await pool.query(query, [merchantId, days]);

    // Collect all distinct assets across the result set
    const assetSet = new Set(rows.map((r) => r.asset));
    const assets = Array.from(assetSet);

    // Build a date-keyed map
    const byDate = {};
    for (const row of rows) {
      const dateStr = row.date.toISOString().split("T")[0];
      if (!byDate[dateStr]) byDate[dateStr] = { date: dateStr };
      byDate[dateStr][row.asset] = parseFloat(row.volume) || 0;
    }

    // Fill gaps
    const now = new Date();
    const result = [];
    for (let i = days - 1; i >= 0; i -= 1) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split("T")[0];
      const entry = byDate[dateStr] || { date: dateStr };
      for (const asset of assets) {
        if (entry[asset] === undefined) entry[asset] = 0;
      }
      result.push(entry);
    }

    return { range, assets, data: result };
  },
};
