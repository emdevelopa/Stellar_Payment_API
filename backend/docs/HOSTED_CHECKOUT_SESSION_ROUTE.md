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
`Cache-Control: private, no-store` and `X-Cache: HIT | MISS | BYPASS`.

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
