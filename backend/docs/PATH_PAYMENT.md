# Path Payment Service

Architecture, end-to-end testing, granular metrics, and load-testing guide for
the Path Payment Service module (`src/routes/payments.js` path-payment-quote
flow + `src/services/exchangeRateService.js` + `src/lib/exchange-rate-cache.js`).

Covers issues **#1046** (end-to-end testing), **#1047** (legacy refactor),
**#1048** (granular metrics) and **#1049** (load testing).

---

## 1. Architecture after refactor (#1047)

```
HTTP request
  │
  ├─ pathPaymentQuoteRateLimit    per payment-id + API-key/merchant/IP bucket
  ├─ validateUuidParam            rejects malformed payment ids (400)
  ├─ validateRequest              zod query schema (source_asset, issuers, source_account)
  │
  └─ routes/payments.js           transport layer (payment lookup + HTTP statuses)
       │
       ├─ payments not found ......... 404
       ├─ payment not pending ........ 409
       ├─ source asset == dest asset . 400
       │
       └─ services/exchangeRateService.js   quote pipeline (NEW wiring)
            ├─ lib/exchange-rate-cache.js   TTL + stale-tolerance LRU cache
            ├─ lib/stellar.js               strict-receive-path resolution
            └─ throws NoPathFoundError ..... mapped to 404 by the route
```

Before this refactor the route handler carried its own copy of the quote
pipeline (Horizon call, slippage math, response shaping) while
`exchangeRateService.getExchangeRateQuote` already provided a cache-first,
single-source implementation. The route now delegates all exchange-rate
concerns to the service and only handles HTTP/payment-level outcomes, so each
quote outcome is counted exactly once:

| Outcome | Counted by |
|---|---|
| payment not found / not pending / same asset / lookup error | route (`exchange_rate_quote_requests_total`) |
| Horizon success / no path / Horizon error | `lib/stellar.js` `findStrictReceivePaths` |
| cache hits / misses / evictions | `lib/exchange-rate-cache.js` hooks (see #1048) |

---

## 2. End-to-end suite (#1046)

`tests/e2e/path-payment.e2e.test.js` — full HTTP stack via supertest;
Supabase / Horizon are mocked so no real network or database is required.
Covers: happy-path quote shape incl. send-max math, source-account validation,
request-validation matrix, payment guards (404/409/400), Horizon failure
modes (no path, account not found, malformed quote), cache behaviour and
rate limiting.

```bash
npx vitest run tests/e2e/path-payment.e2e.test.js
```

---

## 3. Granular metrics (#1048)

Exposed on `GET /metrics` (merged into the core registry output).

| Series | Type | Labels | Answers |
|---|---|---|---|
| `path_payment_quote_requests_total` | counter | `source_asset`, `dest_asset`, `outcome` | success / no_path / not_found / not_pending / same_asset / error — incl. cached quotes the Horizon-level series cannot see |
| `path_payment_quote_stage_duration_seconds` | histogram | `stage` | how long the payment lookup and the Horizon quote each take |
| `path_payment_quote_cache_hits_total` | counter | `cache`, `stale` | read-through cache effectiveness |
| `path_payment_quote_cache_misses_total` | counter | `cache` | ” |
| `path_payment_quote_cache_evictions_total` | counter | `cache` | LRU pressure |
| `path_payment_quote_cache_size` | gauge | `cache` | live cache occupancy |
| `path_payment_quote_path_hops` | histogram | – | multi-hop path complexity distribution |
| `path_payment_quote_rate` | histogram | `source_asset`, `dest_asset` | exchange-rate distribution per pair (source_amount / destination_amount) |

Useful queries:

```promql
sum(rate(path_payment_quote_requests_total{outcome="no_path"}[5m])) by (dest_asset)
histogram_quantile(0.95,
  sum(rate(path_payment_quote_stage_duration_seconds_bucket[5m])) by (le, stage))
sum(rate(path_payment_quote_cache_hits_total[5m]))
 /
(sum(rate(path_payment_quote_cache_hits_total[5m]))
  + sum(rate(path_payment_quote_cache_misses_total[5m])))
```

---

## 4. Load testing (#1049)

`load-tests/path-payment-load.test.js` — autocannon against a real `listen()`
server with mocked boundaries.

| Scenario | Profile | Pass criteria |
|---|---|---|
| Supertest smoke check | single request | sane status before load runs |
| Sustained quote polling | 10s × 10 conns | zero errors/timeouts |
| Latency regression guard | 10s × 10 conns | p99 < 500 ms |
| Rate-limit budget | 250 fixed requests × 1 conn | ≥1 429, zero timeouts |
| Connection burst | 10s × 20 conns | zero timeouts |

```bash
npm run test:load -- path-payment
```

Include the printed percentile tables in PRs touching the service.

---

## 5. Security notes

- Quote rate limiting keys on the payment id plus API-key hash / merchant id /
  IP, so one merchant cannot exhaust another merchant's quote budget
- `source_account` must be a valid Stellar account id and is validated against
  Horizon before a quote is computed; the validated account is included in the
  quote pipeline only on cache misses
- Source asset issuer is required for non-native assets and must be a valid
  Stellar account id (zod schema)
- send_max adds a 1% slippage buffer (`PATH_PAYMENT_SLIPPAGE` overridable) so
  the merchant never overpays beyond the configured tolerance
- Payment lookup filters soft-deleted payments (`deleted_at IS NULL`) and
  scoped merchant access via `merchant_id` when authenticated
