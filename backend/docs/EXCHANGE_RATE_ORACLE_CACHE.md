# Exchange Rate Oracle Cache

Caching and concurrency control for path-payment exchange-rate quotes
(`GET /api/path-payment-quote/:id`).

Covers issues **#1445** (distributed concurrency control and locking) and
**#1446** (integration and stress test suite).

---

## 1. Layout

| File | Role |
|---|---|
| `src/lib/exchange-rate-cache.js` | In-process LRU + TTL cache with single-flight `getOrLoad()` |
| `src/lib/exchange-rate-coordinator.js` | Cross-instance coordination: Redis lock + shared quote store |
| `src/services/exchangeRateService.js` | `getExchangeRateQuote()` composes both layers around the Horizon query |
| `src/lib/path-payment-metrics.js` | Prometheus series (existing cache metrics + concurrency metrics) |

```
getExchangeRateQuote(key)
  │
  ├─ L1: ExchangeRateCache.getOrLoad(key)        per process
  │     fresh hit ─────────────────────────────▶ return (cached: true)
  │     load in flight ────────────────────────▶ join it (cached: true)
  │     otherwise run ONE loader ↓
  │
  └─ L2: ExchangeRateCoordinator.load(key)       across instances (if Redis)
        shared quote present ──────────────────▶ return (cached: true)
        SET exrate:lock:<key> NX PX ── won ─────▶ query Horizon, publish, release
                                    └ lost ────▶ poll shared store / retry lock
                                                  until waitTimeoutMs → direct query
```

## 2. The problems this solves (#1445)

| Problem | Before | After |
|---|---|---|
| Thundering herd, one process | N concurrent misses → N Horizon calls | 1 call; the rest join it |
| Thundering herd, many instances | 1 call per instance | 1 call total (lock leader); peers reuse the shared quote |
| Invalidation race | a load started before `invalidateExchangeRateQuote()` wrote the old quote back afterwards | the detached load serves its own callers but never writes to the cache |
| Hung Horizon call | every waiter hung with it | loads time out (`EXCHANGE_RATE_LOAD_TIMEOUT_MS`, 504) and the slot is freed |
| Invalidation across instances | only the local process forgot the quote | the shared quote is deleted too |

## 3. In-process single-flight (`ExchangeRateCache.getOrLoad`)

- The first miss for a key registers an in-flight entry, then calls the
  loader. Later callers await the same promise.
- The loader is invoked on a later microtask, so a synchronously throwing
  loader still reaches the cleanup code.
- Errors reach every waiter and are **not** cached. The next call retries.
- `delete(key)` / `clear()` flag the in-flight entry as invalidated and
  detach it. The next caller starts a fresh load, and the old load cannot
  write back. Memory is bounded by the number of active loads, with no
  per-key history.
- A stale-but-tolerable entry is refreshed through the same single-flight
  path.

## 4. Distributed coordination (`ExchangeRateCoordinator`)

Enabled by `createApp()` whenever the Redis client is connected
(`configureExchangeRateCoordination`). Without Redis, only the in-process
layer runs.

**Lock.** `SET exrate:lock:<key> <uuid> PX <lockTtlMs> NX`. Release uses a
Lua compare-and-delete, so a holder whose lease expired can never delete the
next owner's lock. No fencing token is needed: the protected work (a
read-only Horizon query followed by an idempotent cache write) is safe to
duplicate in the rare lease-expiry case. That case is logged with a hint to
raise `EXCHANGE_RATE_LOCK_TTL_MS`.

**Shared store.** `exrate:quote:<key>` holds `{ v: 1, insertedAt, data }` with
`PX = sharedTtlMs`, so any present entry is fresh. Keys are SHA-256 hashes, so
client input never reaches Redis key names.

**Follower loop.** Each iteration reads the shared store (hit → done), then
tries the lock (won → become leader, double-check the store, load). If the
lock is still held, the follower sleeps `pollIntervalMs` and repeats. If the
leader fails, or crashes and its lease expires, a follower wins the lock on a
later iteration. After `waitTimeoutMs`, the follower queries Horizon directly.

**Failure policy: fail open.** Any Redis error, or a closed client, falls
back to a direct Horizon query and is counted in
`exchange_rate_coordination_fallbacks_total{reason="redis_error"}`. Loader
errors are never mistaken for Redis errors, so they are never retried by the
coordinator.

**Validation of shared data.** Entries read from Redis must parse, carry
`v: 1` and pass `isValidQuote` (string amounts matching
`^\d{1,19}(\.\d{1,7})?$` and an array `path`). Anything else counts as a miss
(`result="invalid"`) and is overwritten by the next leader. A corrupted or
tampered entry can never reach a payer as `send_max`.

### Configuration

| Variable | Default | Meaning |
|---|---|---|
| `EXCHANGE_RATE_CACHE_TTL_MS` | `30000` | L1 freshness and shared-quote lifetime |
| `EXCHANGE_RATE_LOCK_TTL_MS` | `5000` | Lock lease; keep above a typical Horizon call |
| `EXCHANGE_RATE_LOCK_WAIT_MS` | `2000` | Max follower wait before querying directly |
| `EXCHANGE_RATE_LOCK_POLL_MS` | `50` | Follower poll interval |
| `EXCHANGE_RATE_LOAD_TIMEOUT_MS` | `15000` | Upper bound on one load; waiters get 504 |

## 5. Metrics

Added to the path-payment registry, which `/metrics` already serves:

| Metric | Type | Labels |
|---|---|---|
| `exchange_rate_cache_coalesced_requests_total` | counter | `cache` |
| `exchange_rate_cache_inflight_loads` | gauge | `cache` |
| `exchange_rate_cache_load_timeouts_total` | counter | `cache` |
| `exchange_rate_cache_stale_writes_prevented_total` | counter | `cache` |
| `exchange_rate_lock_acquisitions_total` | counter | `result` (acquired/contended/error) |
| `exchange_rate_lock_wait_seconds` | histogram | `outcome` (shared_hit/acquired/timeout/error) |
| `exchange_rate_shared_cache_lookups_total` | counter | `result` (hit/miss/invalid/error) |
| `exchange_rate_coordination_fallbacks_total` | counter | `reason` (wait_timeout/redis_error) |

`path_payment_quote_cache_size` is now updated on every write and delete,
not only on `prune()`.

## 6. Security notes

- Redis is treated as trusted infrastructure, but its content is still
  validated before use (see above).
- Lock tokens are random UUIDs, and release is owner-checked atomically.
- Fail-open is deliberate: the quote is public DEX data and coordination is
  only an optimization. An attacker who can break Redis gains nothing beyond
  the pre-#1445 behavior of one Horizon query per request.
- The existing per-IP rate limit on the quote endpoint still applies.
  Coalescing reduces the Horizon load an attacker can cause by bursting
  identical requests.
- Unchanged from before: the cache key covers asset pair, amount and issuers,
  not `slippage` or `source_account`. The route always uses the default
  slippage.

## 7. Tests (#1446)

| Suite | Scope |
|---|---|
| `src/lib/exchange-rate-cache.test.js` | LRU/TTL plus single-flight, invalidation races, sync-throwing loaders, timeouts, gauges |
| `src/lib/exchange-rate-coordinator.test.js` | lock ownership and expiry, leader/follower, leader failure and crash takeover, wait-timeout fallback, fail-open, poisoned shared entries |
| `src/services/exchangeRateService.test.js` | service wiring, burst coalescing, `NoPathFoundError` fan-out, shared reuse, cross-instance invalidation, Redis outage |
| `tests/integration/exchange-rate-cache.test.js` | real HTTP stack on `GET /api/path-payment-quote/:id`: 40-request burst → 1 Horizon call, distinct pairs, 404/502 fan-out without caching, 504 on hung Horizon, invalidation mid-flight, `/metrics`, Redis coordination, poisoned entry, Redis down |
| `load-tests/exchange-rate-cache-stress.test.js` | 5k concurrent → 1 call; 20k over 250 keys → 250 calls; LRU churn; invalidation storm; failure isolation; 8 simulated instances sharing Redis → 1 call per key; cold-instance reuse; lock-holder crash; Redis outage mid-burst; stuck lock; leak check |

`tests/helpers/fake-redis.js` is an in-memory Redis (SET NX/PX, GET, DEL,
compare-and-delete EVAL, TTL expiry, injectable latency and failures). Many
coordinators can share one instance to simulate a scaled deployment
deterministically, without a live Redis.

HTTP bursts wait until every request has joined the in-flight load, using
`exchange_rate_cache_coalesced_requests_total`, before releasing the stubbed
Horizon response. supertest opens a separate server per request, so arrival
order is otherwise not guaranteed.

The suites were mutation-checked against `exchange-rate-cache.js`. Disabling
single-flight fails 16 tests. Dropping the invalidation guard fails 4.

```
npx vitest run src/lib/exchange-rate-cache.test.js \
               src/lib/exchange-rate-coordinator.test.js \
               src/services/exchangeRateService.test.js \
               tests/integration/exchange-rate-cache.test.js
npm run test:load -- exchange-rate-cache-stress
```
