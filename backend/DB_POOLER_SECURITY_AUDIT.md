# Database Pooler Security Audit

## Scope

This audit covers the pool-backed payment query paths and verification flows in:

- `src/lib/db.js`
- `src/services/paymentService.js`
- `src/routes/payments.js`
- `src/services/metricService.js`

## Findings

1. Transaction verification gap
The `verify-payment` route confirmed matched transactions without running cryptographic signature verification. This allowed a payment to be marked confirmed based solely on a Horizon match.

Status: Fixed

2. Search/filter query hardening
Hot merchant payment listing queries relied on string-built filter composition through the Supabase client. While functional, this left less control over escaping and query shape for the highest-traffic path.

Status: Fixed

3. Pooler transient-failure handling
Direct pool usage exposed read paths to transient connection drops, startup restarts, and lock-related failures without a shared retry policy.

Status: Fixed

4. Interval interpolation in analytics SQL
`getVolumeOverTime` interpolated the day range into SQL text. The range was validated before use, but parameterizing the interval removes avoidable risk and keeps the query shape stable.

Status: Fixed

## Mitigations Applied

- Added `queryWithRetry()` and retryable error classification in `src/lib/db.js`.
- Moved merchant payment listing and 7-day rolling metrics to parameterized SQL via the pooler, with Supabase fallback when pooler retries are exhausted.
- Enforced cryptographic transaction signature verification in both the service layer and the `POST /api/verify-payment/:id` route before confirmation.
- Parameterized analytics interval arithmetic in `metricService`.

## Residual Risk

- The fallback path still depends on Supabase availability when pool retries are exhausted.
- Additional pool-backed hot paths such as single-payment lookups can be migrated later for even more consistent behavior.
- Production monitoring should alert on repeated pool retry exhaustion so degraded pooler health is visible before user impact grows.
