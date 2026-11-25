# Public Hosted Checkout Session Route

`src/routes/paymentDetails.js` serves `GET /api/payments/:id`. It returns a
payment's state, branding, and the on-chain `stellar_tx` block that the hosted
checkout page polls. Horizon retry and dead-letter recovery (#1776) are
covered in [RESILIENCE_DLQ_CACHE_CONCURRENCY.md](./RESILIENCE_DLQ_CACHE_CONCURRENCY.md).

## Distributed Redis caching and throughput telemetry (#1775)

Checkout pages poll this endpoint while the customer pays. Without a cache,
each poll costs a database read, and each poll of a completed payment also
costs a Horizon call.

### Keys

```
payment:details:v1:gen:<paymentId>                          generation counter (INCR)
payment:details:v1:<merchantId>:<paymentId>:g<generation>   response body, TTL
```

- **Merchant-scoped.** An entry is only read back under the merchant id that
  loaded it, so a cache hit can never bypass the `merchant_id` filter in the
  database query (the same class of bug as #1311).
- **Invalidation.** `invalidatePaymentCache()` in `lib/redis.js` is already
  called by every payment writer (verify-payment, the Horizon poller, payment
  service). It now also runs `INCR` on the payment's details generation. Soft
  delete (`DELETE /api/payments/:id`) previously invalidated nothing and now
  calls it as well. Readers read the generation before the database, so a
  reader racing a writer only ever stores under the retired generation.

### TTL by state

| State | TTL | Default |
| --- | --- | --- |
| `failed`, `expired`, `refunded`, or `completed` with `stellar_tx` | `PAYMENT_DETAILS_CACHE_TERMINAL_TTL_SECONDS` (1–3600) | 300 s |
| `pending`, `confirmed`, or `completed` without Horizon metadata yet | `PAYMENT_DETAILS_CACHE_ACTIVE_TTL_SECONDS` (0–30, 0 = don't cache) | 2 s |

The short active TTL absorbs polling bursts. Even if a writer skipped
invalidation, a status change would still show within that TTL. A completed
payment whose Horizon lookup failed is not given the long TTL, so the next
poll can pick up the on-chain metadata.

404s and errors are never cached. Responses carry
`Cache-Control: private, no-store` and `X-Cache: HIT | MISS | BYPASS`
(`COALESCED` is added by #1777, below).

### Fault tolerance

Each Redis call has a time limit (`REDIS_CACHE_OP_TIMEOUT_MS`, default 150 ms).
Any Redis error, timeout, unreadable generation, or the no-op client (Redis
down) bypasses the cache and reads the database. A corrupt entry is deleted
and treated as a miss. Ids must match `^[A-Za-z0-9_-]{1,64}$` before they are
used in a key, and the route rejects non-UUID ids with 400 before any lookup.
`PAYMENT_DETAILS_CACHE_ENABLED=false` turns the cache off.

### Metrics (registry merged into `/metrics`)

| Metric | Labels |
| --- | --- |
| `payment_details_cache_operations_total` | `result` = hit \| miss \| bypass \| error \| store \| store_error \| skip_store |
| `payment_details_requests_total` | `route` (`/:id`), `method`, `status_class` |
| `payment_details_request_duration_seconds` | `route`, `method` |
| `payment_details_in_flight_requests` | `route` |

Labels use the route pattern, never the payment id.

## Concurrency control and atomic transaction handling (#1777)

Request path: **single flight → Redis cache → one DB read → bounded Horizon enrichment**.

### Request coalescing

Identical lookups (same merchant **and** payment) that arrive while one is
already running join it instead of starting their own. A burst of N polls costs
one cache read, at most one database read and at most one Horizon call.

- The flight key includes the merchant id, so lookups are never shared
  across merchants.
- Each follower receives a deep copy (`structuredClone`) and is marked
  `X-Cache: COALESCED`.
- The entry is removed as soon as the lookup settles. A failure reaches the
  requests that were waiting on it, but it is never replayed to later ones.
- The map holds at most 10 000 keys. Beyond that, lookups run uncoalesced
  instead of growing memory.

Coalescing is per node. Across nodes, the Redis cache (#1775) absorbs
duplicate work.

### Consistent snapshot

`status` and `tx_id` come from one `SELECT`, so the response never mixes two
versions of the row. `stellar_tx` is attached only when the transaction
Horizon returns has the same hash as the snapshot's `tx_id` (hex comparison,
case-insensitive). On a mismatch `stellar_tx` is set to `null` instead of
pairing the payment with another transaction.

The cache write is guarded the same way. The generation is read again after
the database read, and if a writer invalidated in between, the possibly
superseded body is not stored (`payment_details_cache_operations_total{result="stale_skip"}`).

### Bounded Horizon enrichment

| Variable | Default | Range | Meaning |
| --- | --- | --- | --- |
| `PAYMENT_DETAILS_HORIZON_MAX_CONCURRENCY` | 8 | 1–256 | concurrent Horizon lookups per node |
| `PAYMENT_DETAILS_HORIZON_MAX_QUEUE` | 32 | 0–10000 | lookups allowed to wait |
| `PAYMENT_DETAILS_HORIZON_QUEUE_TIMEOUT_MS` | 1000 | 10–30000 | max wait for a slot |
| `PAYMENT_DETAILS_HORIZON_TIMEOUT_MS` | 4000 | 50–30000 | response deadline for the lookup |

When the bulkhead is full, or the deadline passes, the payment is still
returned (200) with `stellar_tx: null`. The request is never failed with a 503
over data that is best effort. A completed payment without `stellar_tx` is
cached only for the short active TTL, so the next poll tries again. An
abandoned lookup keeps its slot until Horizon actually answers, so the limiter
always matches the real number of outstanding calls, and a slow Horizon cannot
pile up unbounded work.

### Disconnects

When the client's socket closed while the lookup ran, no response is written.

### Metrics

| Metric | Labels |
| --- | --- |
| `payment_details_coalesced_total` | — |
| `payment_details_single_flight_in_flight` | — |
| `payment_details_enrichment_total` | `outcome` = ok \| skipped \| unavailable \| shed \| timeout \| mismatch |

### Security notes

- Coalescing and cache keys are both merchant-scoped, and the ownership
  filter stays in the SQL, so neither path can widen access.
- Followers get copies, so no request can change another request's response.
- Inputs that reach keys are validated (UUID route param, key-safe merchant
  id). Logs and metric labels never include payment ids, amounts or recipients.
