# Payment Session Validator & Merchant Settings Security Audit

**Modules:**
- `backend/src/lib/payment-session-retry.js` (new)
- `backend/src/lib/payment-session-lock.js` (new)
- `backend/src/lib/merchant-payload-validation.js` (new)
- `backend/src/routes/payments.js`, `backend/src/services/paymentService.js`
- `backend/src/routes/merchants.js`, `backend/src/services/merchantService.js`
- `backend/src/lib/idempotency.js`, `backend/src/lib/request-schemas.js`, `backend/src/lib/webhooks.js`, `backend/src/lib/merchant-settings.js`

**Issues:** #1449 (retry/backoff), #1450 (distributed locking), #1451 (integration & stress tests), #1482 (payload sanitization & strict validation)

## Threat Model

| Threat | Mitigation | Status |
|--------|------------|--------|
| Transient DB/network blip fails session creation | Persistence retried with full-jitter exponential backoff; bounded attempts/delay (#1449) | ✅ Implemented |
| Retry turns a rejected session into an accepted one | Only transport/5xx/429/connection-class Postgres errors retried; 4xx and constraint violations never retried | ✅ Implemented |
| Retry creates duplicate rows after a lost ack | Session id generated before first attempt; `23505` on a *retry* treated as already-persisted, on the *first* attempt surfaced | ✅ Implemented |
| Retry storm / request hang | Attempts clamped to ≤ 6, delay ≤ 10 s, full jitter spreads load | ✅ Implemented |
| Concurrent same-key requests create two sessions | `SET NX PX` lock per (merchant, Idempotency-Key); losers get `409 PAYMENT_SESSION_IN_PROGRESS` (#1450) | ✅ Implemented |
| Twin passes idempotency middleware before cache write | Idempotency cache re-checked *inside* the lock; replayed if present | ✅ Implemented |
| Releasing someone else's lock after TTL expiry | Random per-acquire token + compare-and-delete Lua release | ✅ Implemented |
| Lock key injection / cross-merchant collision | Key = `lock:payment-session:<merchantId>:<sha256(Idempotency-Key)>` | ✅ Implemented |
| Redis outage silently disables locking | No-op Redis client detected (`isOpen:false`); in-process lock fallback | ✅ Implemented |
| Prototype pollution via settings payloads | `__proto__`/`constructor`/`prototype` keys dropped recursively before validation (#1482) | ✅ Implemented |
| Mass assignment (`api_key`, `merchant_id`, `webhook_secret` in body) | `.strict()` schemas reject unknown keys with 400 | ✅ Implemented |
| Control characters / terminal escapes stored in profile fields | NUL and C0 controls (except `\t\n\r`) stripped | ✅ Implemented |
| Resource exhaustion via deep/wide payloads | Depth ≤ 6, ≤ 50 keys/object, ≤ 100 items/array, ≤ 4096 chars/string | ✅ Implemented |
| Webhook header injection (CR/LF) | Header values must be printable ASCII; send-time filter also drops CR/LF/NUL for legacy rows | ✅ Implemented |
| Signature/timestamp/transport header spoofing | Reserved header list enforced at write and send time (incl. `Host`, `Content-Length`, `Transfer-Encoding`) | ✅ Implemented |
| API key expiry lock-out or never-expiring keys | Expiry must be ≥ 1 minute ahead and ≤ 365 days; normalized to UTC | ✅ Implemented |
| Invalid rotate/expiry bodies returned 500 | Validation moved to `validateRequest` → structured 400 | ✅ Fixed |
| Non-HTTP callers bypass route validation | Service-level guards in `merchantService.rotateApiKey` / `setApiKeyExpiry` | ✅ Implemented |

## Design Notes

### Retry (#1449)

`withSessionRetry(fn, opts)` runs `fn({ attempt })` and retries when `isRetryableSessionError(err)` is true. `delay(n) = random(0, min(maxDelayMs, baseDelayMs · 2ⁿ))`. The last error is rethrown with `retryAttempts` set, so upstream status mapping is unchanged.

On-chain issuer verification is **not** wrapped again: `AssetIssuerErrorRecovery.verifyIssuerOnChain` already retries with its own circuit breaker, and nesting the two would multiply attempts.

### Locking (#1450)

Only requests that carry an `Idempotency-Key` are serialized. Requests without a key are independent by definition, and serializing them would only add latency.

The idempotency middleware and the lock share one Redis client. The cached response is written (in `res.json`) *before* the lock is released on the same connection, and Redis runs a connection's commands in order. So a request that gets the lock after its twin finishes is guaranteed to see the cached response.

**Degraded mode (Redis unavailable):** the in-process lock still prevents overlapping creations on one instance. There is no idempotency cache, so a request that arrives *after* its twin completed creates a new session. This matches the existing middleware's fail-open behavior.

### Validation (#1482)

Order on every settings / API-key route: auth → rate limit → `sanitizeMerchantPayload` → `validateRequest(strictSchema)` → handler.

`POST /api/register-merchant` stays lenient at the top level for client compatibility, but `merchant_settings` is strict and `metadata` is sanitized.

## Configuration

| Variable | Default | Bounds |
|----------|---------|--------|
| `PAYMENT_SESSION_RETRY_MAX_ATTEMPTS` | 3 | 1–6 |
| `PAYMENT_SESSION_RETRY_BASE_DELAY_MS` | 100 | 0–10000 |
| `PAYMENT_SESSION_RETRY_MAX_DELAY_MS` | 2000 | base–10000 |
| `PAYMENT_SESSION_LOCK_TTL_MS` | 30000 | 1000–120000 |

## API Behavior Changes

- `POST /api/sessions`, `/api/create-payment`, `/api/support-transactions`: may return **409** `{ code: "PAYMENT_SESSION_IN_PROGRESS" }` when a same-key request is in flight. Clients should retry after a short delay.
- `POST /api/merchants/rotate-api-key`, `PUT /api/merchants/set-api-key-expiry`, `POST /api/merchants/rotate-webhook-secret`, `PUT /api/webhook-settings`: unknown body fields now return **400** (previously ignored, or a 500 on type errors).
- `PUT /api/merchants/set-api-key-expiry`: past dates and dates more than 365 days ahead now return **400**.
- `PUT /api/webhook-settings`: reserved names, duplicate names (case-insensitive), more than 20 headers, and values with line breaks now return **400**.

## Test Coverage

| Suite | Scope |
|-------|-------|
| `src/lib/payment-session-retry.test.js` | Error classification, option clamping, backoff math, retry/exhaustion, lost-ack recovery |
| `src/lib/payment-session-lock.test.js` | Key hashing, SET NX/PX, compare-and-delete, TTL expiry, local fallback, 409 conflict |
| `src/routes/payment-session-validator.integration.test.js` | HTTP end-to-end: rules, retry, concurrency (single and multi-node), replay, Redis-down fallback, stress (200 concurrent at 30% fault rate; 20 keys × 10 duplicates) |
| `src/lib/merchant-payload-validation.test.js` | Sanitizer limits, prototype pollution, strict schemas, header rules, expiry bounds |
| `src/routes/merchant-settings-validation.test.js` | HTTP-level 400s for mass assignment, header injection, expiry abuse, pollution |
| `src/services/merchantService.validation.test.js` | Service-level guards |
