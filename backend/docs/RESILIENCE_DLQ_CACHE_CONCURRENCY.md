# Dead-letter recovery, validator caching and merchant concurrency control

Covers issues #1776, #1765, #1772 and #1771.

## Shared building block: `RecoveryQueue` (`src/lib/recovery-queue.js`)

A bounded in-memory dead-letter queue used by #1776 and #1771.

| Property | Behaviour |
|----------|-----------|
| Capacity | 500 entries; when full, the oldest _exhausted_ entry is evicted first, then the oldest pending one |
| De-duplication | Re-enqueueing a key refreshes the entry instead of adding another |
| Backoff | Full-jitter exponential, base 2s, capped at 60s |
| Poison pills | After 5 failed recoveries, or an error with `retryable === false`, an entry is isolated as `exhausted` and never retried automatically |
| Safety | No overlapping recovery runs; bounded batch size; `list()` never exposes payloads; error messages are control-character stripped and truncated |

Entries live in process memory and are lost on restart. They absorb transient outages; they are not a durable store.

## #1776 Public Hosted Checkout Session Route (`routes/paymentDetails.js`)

The Horizon transaction lookup behind `GET /api/payments/:id` used to drop the `stellar_tx` block on any transient failure.

1. Transient failures (network errors, 408, 429, 5xx) are retried with backoff inside the request (3 attempts, <= 1.5s delay).
2. 404 (not yet propagated) and other 4xx are never retried.
3. A lookup that still fails transiently is dead-lettered **by transaction id only**, then re-driven in the background (throttled to one run per 15s, started only after a failure, `unref`'d).
4. A recovered lookup is cached for 10 minutes (max 1,000 entries), so the next request is served without another Horizon call.
5. `tx_id` must be a 64-hex hash before it is used in a Horizon request.

The response shape is unchanged. Metrics: `payment_details_horizon_fetch_total{outcome}`, `payment_details_horizon_retries_total`, `payment_details_dlq_depth`, `payment_details_dlq_operations_total{action,status}`.

Config: `PAYMENT_DETAILS_RETRY_MAX_ATTEMPTS` (1-5), `PAYMENT_DETAILS_RETRY_BASE_DELAY_MS`, `PAYMENT_DETAILS_RETRY_MAX_DELAY_MS`.

## #1765 Stellar Account & Ledger Key Validator (`lib/stellar/validators*.js`)

`resolveFederatedAddress` costs two HTTPS round trips, so successful results are now cached and concurrent identical lookups are coalesced.

- Redis (shared across instances) with an in-memory LRU fallback (1,000 entries). A Redis outage degrades to per-instance caching and never fails a validation.
- **Opt-in:** set `VALIDATOR_CACHE_ENABLED=true`. Per call, `{ cache: false }` bypasses and `{ cache: <ValidatorCache> }` supplies a store.
- TTL: `VALIDATOR_CACHE_TTL_SECONDS`, default 300, clamped to 1s-1h.
- Only successes are cached. Keys are `validator:v1:federation:<sha256(address)>`. Anything read back is re-validated (account id must be a valid public key, memo must pass `validateMemo`); a poisoned or corrupt entry is deleted and treated as a miss.

Telemetry: `stellar_validator_throughput_per_second{operation}` (60s rolling window, refreshed at scrape time and bounded to 32 operations) and `stellar_validator_cache_operations_total{operation,result,backend}` where `result` is `hit | miss | set | invalid | error | coalesced`. `getValidatorThroughput()` is exported for in-process use.

## #1772 Merchant Onboarding and Key Lifecycle Route (`routes/merchants.js`)

Concurrency control and atomic credential writes (`lib/merchant-key-lifecycle.js`).

- **Locking:** registration is serialized per email (SHA-256 of the lowercased address) and every key or secret operation per merchant id, using the Redis `SET NX PX` + compare-and-delete lock from `payment-session-lock.js` (in-process fallback when Redis is down). A losing request gets **409** `MERCHANT_LIFECYCLE_BUSY`; nothing queues.
- **Compare-and-swap:** `rotate-key`, `generate-api-key`, `regenerate-webhook-secret` and `rotate-webhook-secret` now update with `WHERE id = ? AND <credential column> = <value read>`. If it no longer matches, the request gets **409** `MERCHANT_CREDENTIAL_CONFLICT` instead of overwriting the newer credential. The CAS is the correctness backstop if a lock expires or Redis is unreachable on one node.
- **Registration:** a unique violation (`23505`) on insert maps to the same 409 as the existence check.

Metrics: `merchant_lifecycle_lock_total{operation,outcome}`, `merchant_lifecycle_lock_held_seconds`, `merchant_credential_conflicts_total`.

## #1771 Merchant dead-letter recovery (`lib/merchant-recovery.js`)

`POST /webhook-settings/verify` fetches a proof file from the merchant's domain and then persists the result. A transient persistence failure used to discard that result with a 500.

1. The write is retried with backoff (3 attempts) on transient errors.
2. If it still fails, the verification result is dead-lettered (one entry per merchant) and the route answers **202** `{ webhook_domain_verification, persisted: false, recovery: "queued" }`.
3. Recovery does a read-merge-write of **only** the `webhook_domain_verification` metadata key, so a late recovery cannot overwrite other metadata. A merchant that no longer exists, or a non-transient error, isolates the entry immediately.

Credential rotations are deliberately **not** retried or dead-lettered: they are not idempotent, and queueing a secret would hold it in memory. Locking plus compare-and-swap protect them instead.

Metrics: `merchant_lifecycle_dlq_depth`, `merchant_lifecycle_dlq_operations_total{action,status}`, `merchant_lifecycle_persist_retries_total`. Config: `MERCHANT_PERSIST_RETRY_MAX_ATTEMPTS` (1-5), `..._BASE_DELAY_MS`, `..._MAX_DELAY_MS`.

## Security notes

- No secret (API key, webhook secret, password) is ever placed in a queue entry, lock key, metric label, log line or error message.
- Cache and lock keys are hashed/namespaced, so user input cannot inject separators or create oversized keys.
- Cached data is treated as untrusted on read.
- Memory is bounded everywhere (queue capacity, cache size, tracked operations); there are no import-time timers.
- Background recovery is throttled and non-overlapping, so a failing dependency cannot cause a retry storm.
