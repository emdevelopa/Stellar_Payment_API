# Performance Audit — Path Payment Service SQL queries (issue #601)

## Scope & method

Review every DB query in the Path Payment Service flow (`src/routes/payments.js`
path-payment-quote handler + `src/services/paymentService.js`) for N+1 access,
unbounded scans, missing filters/indexes, and avoidable work.

## Findings

| Query | Location | Assessment |
| --- | --- | --- |
| Path-payment quote lookup | `payments.js:1148` | Single-row `maybeSingle()` by **primary key** `id`, scoped by `merchant_id` (when present) and `deleted_at IS NULL`, selecting only the 6 needed columns. **Already optimal** — a PK lookup, no scan. |
| Rolling 7-day metrics (primary) | `paymentService.js` (`rolling-payment-metrics` SQL) | **Aggregated in the database**: a CTE chain with `date_trunc('day', created_at)`, `GROUP BY`, `COUNT(*) FILTER (...)`, and a `totals` CTE — one round trip, no per-row app work. Already optimal. |
| Rolling 7-day metrics (Supabase fallback) | `paymentService.js:getRollingMetricsViaSupabase` | Fetch-all-and-reduce fallback for Supabase-only deployments. Filters by `merchant_id`, `deleted_at`, and a 7-day `created_at` window. **One avoidable cost:** it requested `ORDER BY created_at` even though results are bucketed into a `Map` and read back via a fixed 7-day loop (order-independent). |
| Payments list | `paymentService.js:290` | Column-scoped `select`, `merchant_id` filter, paginated. Fine. |

No N+1 patterns and no unbounded `SELECT *` scans were found in the path-payment
flow. The path-finding step calls Horizon (`findStrictReceivePaths`), not SQL.

## Change applied

Removed the redundant `.order("created_at", { ascending: true })` from the
Supabase metrics fallback (`getRollingMetricsViaSupabase`). The result is
independent of row order (bucketed by day, then read through a fixed 7-day
array), so the sort was pure overhead on a potentially large 7-day window.

## Conclusion

The Path Payment Service's queries were already well-optimized (PK lookups +
in-database `date_trunc` aggregation). The single genuine, safe improvement —
dropping an unnecessary sort in the fallback path — is included in this PR. No
schema/index changes are warranted.
