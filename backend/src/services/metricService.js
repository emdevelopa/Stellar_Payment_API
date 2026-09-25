import { withMerchantContext } from "../lib/db-rls.js";
import { queryWithRetry, circuitBreaker, isRetryablePoolError } from "../lib/db.js";

const VALID_VOLUME_RANGES = { "7D": 7, "30D": 30, "1Y": 365 };
const RLS_QUERY_RETRY_ATTEMPTS = Number.parseInt(
  process.env.DB_POOL_RETRY_ATTEMPTS || "2",
  10,
);
const RLS_QUERY_RETRY_DELAY_MS = Number.parseInt(
  process.env.DB_POOL_RETRY_DELAY_MS || "150",
  10,
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Format a Date as a YYYY-MM-DD string in UTC. */
function toDateStr(date) {
  return date.toISOString().split("T")[0];
}

/**
 * Run an RLS-scoped query (via withMerchantContext) with retry + the shared
 * circuit breaker. A statement can't be retried mid-transaction once the
 * connection drops, so each attempt opens a brand-new transaction on a fresh
 * client instead of retrying within one (issue #930).
 */
async function withMerchantContextRetry(merchantId, callback, { label = "rls-query" } = {}) {
  return circuitBreaker.execute(async () => {
    let lastError;

    for (let attempt = 0; attempt <= RLS_QUERY_RETRY_ATTEMPTS; attempt += 1) {
      try {
        return await withMerchantContext(merchantId, callback);
      } catch (err) {
        lastError = err;
        const shouldRetry = attempt < RLS_QUERY_RETRY_ATTEMPTS && isRetryablePoolError(err);
        if (!shouldRetry) {
          throw err;
        }
        const delayMs = RLS_QUERY_RETRY_DELAY_MS * (attempt + 1);
        console.warn(
          `[metricService] ${label} failed (attempt ${attempt + 1}/${RLS_QUERY_RETRY_ATTEMPTS + 1}): ${err.message}. Retrying in ${delayMs}ms.`,
        );
        await sleep(delayMs);
      }
    }

    throw lastError;
  });
}

export const metricService = {
  /**
   * Retrieve last-month and current-month revenue in a single round trip.
   *
   * Previously this issued two separate sequential queries on the same RLS
   * client. Both share the same WHERE shape (merchant_id, status, GROUP BY
   * asset/asset_issuer) and the same (merchant_id, status, created_at) index,
   * so they are merged into one query using conditional aggregation —
   * halving DB round trips for this endpoint (issue #929).
   */
  async getMonthlySummary(merchantId) {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth(); // 0-indexed (0 = January)

    const lastMonth = currentMonth === 0 ? 11 : currentMonth - 1;
    const lastMonthYear = currentMonth === 0 ? currentYear - 1 : currentYear;

    const currentMonthStart = new Date(currentYear, currentMonth, 1);
    const lastMonthStart = new Date(lastMonthYear, lastMonth, 1);
    const lastMonthEnd = new Date(currentYear, currentMonth, 0, 23, 59, 59, 999);

    const combinedQuery = `
      SELECT
        asset,
        asset_issuer,
        SUM(amount) FILTER (WHERE created_at >= $2 AND created_at <= $3) AS last_month_total,
        COUNT(*) FILTER (WHERE created_at >= $2 AND created_at <= $3) AS last_month_count,
        SUM(amount) FILTER (WHERE created_at >= $4) AS current_month_total,
        COUNT(*) FILTER (WHERE created_at >= $4) AS current_month_count
      FROM payments
      WHERE merchant_id = $1
        AND status = 'completed'
        AND created_at >= $2
      GROUP BY asset, asset_issuer
      ORDER BY asset, asset_issuer
    `;

    const { rows } = await withMerchantContextRetry(
      merchantId,
      (client) =>
        client.query(combinedQuery, [
          merchantId,
          lastMonthStart,
          lastMonthEnd,
          currentMonthStart,
        ]),
      { label: "metrics-monthly-summary" },
    );

    const lastMonthByAsset = [];
    const currentMonthByAsset = [];

    for (const row of rows) {
      if (row.last_month_count > 0) {
        lastMonthByAsset.push({
          asset: row.asset,
          asset_issuer: row.asset_issuer,
          total: row.last_month_total || "0",
          count: parseInt(row.last_month_count, 10),
        });
      }
      if (row.current_month_count > 0) {
        currentMonthByAsset.push({
          asset: row.asset,
          asset_issuer: row.asset_issuer,
          total: row.current_month_total || "0",
          count: parseInt(row.current_month_count, 10),
        });
      }
    }

    const lastMonthTotal = lastMonthByAsset.reduce(
      (sum, item) => sum + parseFloat(item.total),
      0
    );
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

  async getRevenueByAsset(merchantId) {
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

    const { rows } = await queryWithRetry(query, [merchantId], {
      label: "metrics-revenue-by-asset",
    });

    return {
      revenue: rows.map((row) => ({
        asset: row.asset,
        asset_issuer: row.asset_issuer,
        total: row.total,
        count: parseInt(row.count, 10),
      })),
    };
  },

  async getVolumeOverTime(merchantId, range) {
    const days = VALID_VOLUME_RANGES[range];

    if (!days) {
      throw new Error("Invalid range. Use 7D, 30D, or 1Y.");
    }

    const query = `
      SELECT
        date_trunc('day', created_at) AS date,
        asset,
        SUM(amount) AS volume,
        COUNT(*) AS count
      FROM payments
      WHERE merchant_id = $1
        AND status = 'completed'
        AND created_at >= NOW() - ($2::int * INTERVAL '1 day')
      GROUP BY 1, 2
      ORDER BY 1 ASC, 2 ASC
    `;

    const { rows } = await queryWithRetry(query, [merchantId, days], {
      label: "metrics-volume-over-time",
    });

    // Collect all distinct assets across the result set
    const assetSet = new Set(rows.map((r) => r.asset));
    const assets = Array.from(assetSet);

    // Build a date-keyed map
    const byDate = {};
    for (const row of rows) {
      const dateStr = toDateStr(row.date);
      if (!byDate[dateStr]) {
        byDate[dateStr] = { date: dateStr, count: 0 };
      }
      byDate[dateStr][row.asset] = parseFloat(row.volume) || 0;
      byDate[dateStr].count += parseInt(row.count, 10) || 0;
    }

    // Fill gaps
    const now = new Date();
    const result = [];
    for (let i = days - 1; i >= 0; i -= 1) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = toDateStr(d);
      const entry = byDate[dateStr] || { date: dateStr, count: 0 };
      for (const asset of assets) {
        if (entry[asset] === undefined) entry[asset] = 0;
      }
      result.push(entry);
    }

    return { range, assets, data: result };
  },
};
