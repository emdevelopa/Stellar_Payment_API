# SEP-0001 stellar.toml — Distributed Concurrency Control

Issue: #1460

`GET /.well-known/stellar.toml` is public, unauthenticated, and fetched often by
wallets, anchors and crawlers. Before this change, every request read the
merchant row from Supabase and regenerated the TOML, on every API instance.
There was also no way to clear a cached copy when a merchant changed their
branding.

Implementation: `backend/src/lib/sep0001-toml-coordinator.js`.

## Layers

| Layer | Scope | Purpose |
|-------|-------|---------|
| Single-flight | per process | Concurrent requests for one merchant share one in-flight generation. |
| Shared store `sep1:{id}:toml` | cluster | Rendered TOML, SHA-256 digest and generation, stored with a TTL. |
| Lock `sep1:{id}:lock` | cluster | `SET NX PX` with a random owner token. One instance regenerates; the others poll the shared store. |
| Generation `sep1:{id}:gen` | cluster | Fencing counter. Invalidation increments it and deletes the entry in one atomic step. |

All keys for a merchant share the `{id}` hash tag, so the multi-key Lua scripts
work on Redis Cluster.

## Request flow

1. `MGET entry gen`. If the entry is valid and its generation equals `gen`, the
   instance serves it (`source: shared`).
2. Otherwise it tries `SET lock <token> NX PX lockTtl`.
   - **Leader:** loads the merchant, renders and validates the TOML, then
     publishes it with `WRITE_IF_GENERATION_SCRIPT`. The write succeeds only
     if `gen` still equals the value observed in step 1. The leader then
     releases the lock with a compare-and-delete script.
   - **Follower:** sleeps `pollIntervalMs` and goes back to step 1. If the
     leader crashes, its lock expires and the next poll takes over.
3. If `waitTimeoutMs` passes, or any Redis command fails, the instance
   generates the TOML directly (`source: direct`).

## Invalidation

`invalidateStellarToml(merchantId)` runs after `PUT /api/merchant-branding` and
`merchantService.updateMerchantBranding`. It:

- bumps a local counter, so later requests on this instance don't join a
  flight that started before the write, and
- runs `INVALIDATE_SCRIPT` (`INCR gen`, `PEXPIRE gen`, `DEL entry`) atomically.

Fencing covers this race: leader L reads the old row, the merchant updates
their branding (gen 0 → 1), and then L tries to publish. L's conditional write
sees gen 1, which differs from the 0 it observed, so it discards the stale
result. The next request regenerates from fresh data.

Call `invalidateStellarToml` after any future write to `business_name`,
`email`, `notification_email`, `recipient`, `branding_config` or `deleted_at`.

## HTTP behaviour

- `merchant_id` must be a UUID. Anything else, including repeated query
  parameters, gets a 400 before Redis or the database is touched. The id is
  lower-cased so each merchant maps to a single cache key.
- Responses include a strong `ETag` (the SHA-256 of the body). A matching
  `If-None-Match` gets a `304`.
- Unchanged: `Cache-Control: public, max-age=3600`, 404 for unknown or
  soft-deleted merchants.

## Security notes

- **Key injection:** merchant ids are checked twice, as a UUID at the route and
  against `^[A-Za-z0-9_-]{1,128}$` in the coordinator, before they become part
  of a key. `:`, `{`, `}`, `*` and whitespace are rejected.
- **Cache poisoning:** a shared entry is served only if all of these hold:
  - the entry version matches
  - it is bound to the same merchant id
  - its generation is current
  - it is at most 64 KiB
  - its SHA-256 digest matches the body
  - it passes SEP-0001 field validation

  Anything else counts as a miss and is regenerated.
- **Lock safety:** each lock has a random owner token, and release is
  compare-and-delete. A leader whose lease expired can never delete a lock
  that another instance now holds.
- **Fail open:** the data is public and read-only, so Redis outages, and the
  project's no-op Redis fallback client, degrade to direct generation. They
  never produce errors or a lock that every caller wins.
- **No negative caching:** unknown merchants are not cached, so a newly created
  merchant becomes visible immediately.
- **Error hygiene:** database errors are logged server-side. Clients receive a
  generic `Failed to fetch merchant` message.

## Configuration

| Variable | Default | Bounds |
|----------|---------|--------|
| `SEP1_TOML_CACHE_TTL_MS` | 300000 | 1000 – 3600000 |
| `SEP1_TOML_LOCK_TTL_MS` | 10000 | 1000 – 60000 |
| `SEP1_TOML_LOCK_WAIT_MS` | 3000 | 0 – 30000 |
| `SEP1_TOML_LOCK_POLL_MS` | 50 | 10 – 1000 |

## Tests

```
npx vitest run src/lib/sep0001 src/routes/sep0001
```

- `src/lib/sep0001-toml-coordinator.test.js`: single-flight, cross-instance
  leader election, TTL expiry, invalidation, stale-write fencing, crashed-leader
  takeover, lock ownership, wait timeout, tampered entries, Redis failure modes,
  loader errors, and invalid ids.
- `src/routes/sep0001.test.js`: headers, ETag and 304, UUID validation,
  parameter pollution, 404 and 500 responses.
