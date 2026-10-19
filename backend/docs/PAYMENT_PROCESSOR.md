# Payment Processor

Architecture, granular metrics, and testing guide for the Payment Processor
module (`src/routes/payments.js` + `src/services/paymentService.js`).

Covers issues **#1086** (end-to-end testing), **#1087** (legacy refactor),
**#1088** (granular metrics) and **#1089** (load testing).

---

## 1. Architecture after refactor (#1087)

```
HTTP request
  │
  ├─ requireApiKeyAuth            x-api-key → merchant lookup (queryWithRetry)
  ├─ rate limiters                create / verify / path-quote budgets
  ├─ zod validation               paymentSessionZodSchema / paymentZodSchema
  ├─ sanitizeMetadataMiddleware   drops unsafe metadata keys
  │
  └─ routes/payments.js           transport layer (HTTP responses, counters)
       │
       ├─ lib/payment-session-rules.js    ← shared business rules (NEW)
       ├─ lib/supabase-client.js          ← shared lazy Supabase accessor (NEW)
       ├─ lib/payment-processor-metrics.js← granular metrics (NEW)
       │
       └─ services/paymentService.js      service layer (pool-first, Supabase fallback)
```

### Shared session rules (`lib/payment-session-rules.js`)

Pure functions with no I/O — previously duplicated across route and service
with drift risk:

| Function | Rule |
|---|---|
| `resolveAndValidateIssuer` | non-native assets require an issuer; issuer must be a valid `G…` key |
| `validatePerAssetLimits`   | merchant-configured per-asset `min`/`max`, delta rounded to 7 dp |
| `validateAllowedIssuers`   | merchant allowlist enforcement when configured |

Rule order is identical in both layers: **issuer presence → issuer format →
per-asset limits → allowlist**. Callers map rejections to their own transport
(HTTP 400 JSON vs thrown `err.status = 400`).

---

## 2. Granular metrics (#1088)

Exposed on `GET /metrics` (merged into the core registry output).

| Series | Type | Labels | Answers |
|---|---|---|---|
| `payment_processor_sessions_total` | counter | `asset`, `outcome` | created / validation_failed / persistence_failed split |
| `payment_processor_session_duration_seconds` | histogram | `asset`, `outcome` | how long creation attempts take per outcome |
| `payment_processor_verifications_total` | counter | `asset`, `outcome` | confirmed, already_confirmed, pending_no_match, signature_invalid, underpayment, overpayment, tx_claim_conflict, error |
| `payment_processor_verification_duration_seconds` | histogram | `asset`, `outcome` | verification latency per outcome |
| `payment_processor_status_cache_hits_total` | counter | – | status-poll cache effectiveness |
| `payment_processor_status_cache_misses_total` | counter | – | ” |
| `payment_processor_refunds_total` | counter | `stage`, `outcome` | generate/confirm funnel incl. rejections |
| `payment_processor_list_requests_total` | counter | `outcome` | list endpoint health incl. pool fallback |

Useful queries:

```promql
sum(rate(payment_processor_sessions_total{outcome="validation_failed"}[5m]))
  by (asset)
histogram_quantile(0.95,
  sum(rate(payment_processor_verification_duration_seconds_bucket[5m])) by (le))
sum(rate(payment_processor_status_cache_hits_total[5m]))
 /
(sum(rate(payment_processor_status_cache_hits_total[5m]))
  + sum(rate(payment_processor_status_cache_misses_total[5m])))
```

---

## 3. End-to-end suite (#1086)

`tests/e2e/payment-processor.e2e.test.js` — full HTTP stack via supertest;
Supabase / Postgres pool / Redis / Horizon / webhooks / email are mocked.
~30 scenarios: auth, metadata sanitization, session validation matrix,
status caching semantics, the complete verification lifecycle (incl.
underpayment/overpayment/claim races), refund funnel, `/metrics` exposure,
rate limiting.

```bash
npx vitest run tests/e2e/payment-processor.e2e.test.js
```

---

## 4. Load testing (#1089)

`load-tests/payment-processor-load.test.js` — autocannon against a real
`listen()` server with mocked boundaries.

| Scenario | Profile | Pass criteria |
|---|---|---|
| Session-creation throughput | 10s × 10 conns | zero errors/timeouts |
| Status-poll storm | 10s × 20 conns | zero timeouts, 2xx served |
| Mixed poll+verify workload | 8s × 8 conns | zero timeouts (429s allowed) |
| Rate-limit budget | 120 fixed requests × 1 conn | ≥1 429, zero timeouts |
| Connection burst | 10s × 50 conns | zero timeouts |

```bash
npm run test:load -- payment-processor
```

Include the printed percentile tables in PRs touching the processor.

---

## 5. Security notes

- API keys are hashed for rate-limit bucketing (`getCreatePaymentRateLimitKey`)
- Metadata keys must match `^[a-zA-Z0-9_-]{1,64}$`; unsafe keys never reach SQL
- Refunds require a confirmed payment and are single-use (`refund_status`)
- Verification uses a DB-level conditional update so a `tx_hash` can only be
  claimed once even under concurrent confirmation attempts
- Signature verification failure keeps payments pending (fail-closed)
