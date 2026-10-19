# Database Row-Level Security Service — Telemetry

Issue #1468. Every merchant-scoped transaction runs through `withMerchantContext()`
(`src/lib/db-rls.js`), which sets `app.current_merchant_id` inside a transaction so
Postgres Row-Level Security policies apply. This document covers the Prometheus
metrics, health endpoint and alert rules added for that service.

## Metrics

Exported from `src/lib/db-rls-telemetry.js` on its own registry, merged into the
main `/metrics` scrape by `src/routes/prometheus.js`. Label values are a fixed
server-side set — never merchant ids, SQL text or error strings — so request
traffic cannot inflate series cardinality or leak customer data into scrapes.

| Metric | Type | Labels | Meaning |
| --- | --- | --- | --- |
| `database_rls_transactions_total` | Counter | `outcome` | Transaction attempts by outcome |
| `database_rls_transaction_duration_seconds` | Histogram | `outcome` | Wall time of the whole `withMerchantContext` call |
| `database_rls_active_transactions` | Gauge | — | Transactions currently in flight |
| `database_rls_health_state` | Gauge | — | `0` healthy, `1` degraded, `2` unhealthy (rolling window) |
| `database_rls_error_ratio` | Gauge | — | Share of attempts that failed before completing |
| `database_rls_rollback_ratio` | Gauge | — | Share of attempts rolled back by a failing callback |
| `database_rls_last_transaction_timestamp_seconds` | Gauge | — | Unix time of the most recent attempt |

`outcome` values:

- `committed` — transaction committed successfully
- `rolled_back` — the caller's callback threw; the transaction was rolled back
- `invalid_input` — merchantId or callback failed validation; the pool was never touched
- `connection_error` — `pool.connect()` failed (pool exhausted, DB down)
- `transaction_error` — `BEGIN` / `SET LOCAL` / `COMMIT` failed, or `ROLLBACK` itself failed

## Health endpoint

`GET /health/database-row-level-security` returns the rolling-window snapshot:

```json
{
  "status": "healthy",
  "reasons": [],
  "window_ms": 300000,
  "total": 1421,
  "committed": 1418,
  "rolled_back": 3,
  "invalid_input": 0,
  "connection_error": 0,
  "transaction_error": 0,
  "errors": 0,
  "rollback_ratio": 0.0021,
  "error_ratio": 0,
  "last_transaction_at": "2026-10-17T12:00:00.000Z",
  "thresholds": {
    "min_samples": 20,
    "error_ratio": 0.05,
    "rollback_ratio": 0.5,
    "invalid_input": 10
  }
}
```

Returns 503 only when `status` is `unhealthy`; `degraded` still returns 200. The
same status is reported (informationally) under `services.database_row_level_security`
in the main `GET /health` payload. The body contains no merchant ids, query text
or error strings.

Status rules over the rolling window (default 5 minutes, 20-sample minimum):

- **unhealthy** — connection + transaction errors ≥ 5% of attempts
- **degraded** — rolled-back callbacks ≥ 50% of attempts, or ≥ 10 `invalid_input` outcomes
- **healthy** — everything else

Thresholds are overridable with `DATABASE_RLS_HEALTH_WINDOW_MS`,
`DATABASE_RLS_HEALTH_MIN_SAMPLES`, `DATABASE_RLS_ERROR_RATIO_THRESHOLD`,
`DATABASE_RLS_ROLLBACK_RATIO_THRESHOLD` and `DATABASE_RLS_INVALID_INPUT_THRESHOLD`.

## Alert rules

`docs/alerts/database-row-level-security.rules.yml` — load with
`rule_files` and validate with
`promtool check rules docs/alerts/database-row-level-security.rules.yml`:

- `DatabaseRlsUnhealthy` (critical) — health state ≥ 2 for 5m
- `DatabaseRlsHighErrorRatio` (critical) — > 5% connection/transaction errors over 10m
- `DatabaseRlsHighRollbackRatio` (warning) — > 50% callback rollbacks over 15m
- `DatabaseRlsInvalidInputSpike` (warning) — > 10 invalid merchant ids in 10m (a caller is misbehaving)
- `DatabaseRlsNoTraffic` (info) — no RLS transactions for 2h

## Notes on privacy

Telemetry records only aggregate counts, durations and derived ratios. Merchant
ids are never used as label values or logged into the health snapshot, so the
scrape and health outputs stay safe to expose to the same monitoring stack as the
rest of the API.
