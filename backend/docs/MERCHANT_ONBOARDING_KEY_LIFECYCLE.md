# Merchant Onboarding and Key Lifecycle Route

`src/routes/merchants.js` handles merchant registration, API key and webhook
secret rotation, branding and webhook settings. Concurrency control (#1772) and
dead-letter recovery (#1771) are covered in
[RESILIENCE_DLQ_CACHE_CONCURRENCY.md](./RESILIENCE_DLQ_CACHE_CONCURRENCY.md).

## Input validation and payload sanitization (#1769)

Every route that takes a body runs two layers, in this order:

1. **`sanitizeMerchantPayload`** drops prototype-pollution keys, strips
   control characters, and enforces limits on depth, key count, array length
   and string length (#1482).
2. **`validateMerchantRequest(schema)`** parses the body with a strict Zod
   schema. On failure it returns the same `400 { error: "Validation failed", errors }`
   as `lib/validation.js`, so existing clients see no change.

| Route | Schema | Notes |
| --- | --- | --- |
| `POST /register-merchant` | `registerMerchantSchema` | strict; emails lower-cased; password 8 chars to 72 **bytes**; `business_name` ≤120 chars, no HTML meta characters |
| `POST /rotate-key`, `POST /regenerate-webhook-secret`, `POST /merchants/generate-api-key`, `POST /webhook-settings/verify` | `emptyBodySchema` | these routes take no input, so any body field is rejected |
| `PUT /merchant-branding`, `POST /preview-receipt` | `merchantBrandingSchema` | strict; hex colours; `logo_url` must be `https:` or a base64 PNG/JPEG/GIF/WebP data URI |
| `POST /test-webhook` | `testWebhookRequestSchema` | HTTPS only, ≤2048 chars, no `user:pass@` |
| `PUT /webhook-settings` | `webhookSettingsSchema` | URL rules shared with `/test-webhook` |
| key rotation / expiry | `rotateApiKeySchema`, `rotateWebhookSecretSchema`, `setApiKeyExpirySchema` | unchanged (#1482) |

### Security notes

- **Duplicate accounts by email case.** The registration lock hashed the
  lower-cased email, but the existence check and insert used the raw value, so
  `A@x.com` and `a@x.com` could both register. Emails are now stored lower-cased.
- **bcrypt truncation.** bcrypt ignores everything after 72 bytes. A longer
  password used to be accepted, but only its first 72 bytes were checked at
  login. It is now rejected. The limit is in bytes, so multi-byte characters count.
- **Mass assignment.** Registration is `.strict()`, so `api_key`,
  `webhook_secret`, `password_hash` or `id` in the body return 400.
- **Stored/reflected HTML injection.** `logo_url` and `business_name` were
  interpolated raw into the receipt HTML, and `/preview-receipt` serves that as
  `text/html`. Input is now validated, and `renderReceiptEmail` escapes every
  value and re-checks the logo scheme, which also covers rows saved before
  this change.
- **`/test-webhook` echo.** The receiver's response body is truncated to 2048
  characters and has control characters stripped before it is returned. The
  existing SSRF guard in `sendWebhook` still applies.
- **Logs.** Rejections log the route pattern, field paths and Zod issue codes.
  They never log submitted values, which can include passwords and secrets.

### Metrics

| Metric | Labels |
| --- | --- |
| `merchant_payload_rejections_total` | `route` (Express pattern), `reason` = `sanitize` \| `schema` |
| `merchant_payload_keys_dropped_total` | `route` |

`route` comes from `req.route.path`, never from the raw URL, so request input
cannot create new label values.

## Distributed Redis caching and throughput telemetry (#1770)

### What is cached

| Endpoint | Resource | Cached value |
| --- | --- | --- |
| `GET /merchant-profile` | `profile` | id, email, names, settings, created_at |
| `GET /merchant-branding` | `branding` | resolved branding config |
| `GET /webhook-settings` | `webhook_settings` | the masked response; the raw `webhook_secret` never reaches Redis |

These are never cached: API keys, raw webhook secrets, password hashes, and
`GET /merchants/api-key-status`, which depends on the clock and is
security-relevant. `null` results (404) and errors are not cached either.

Responses carry `Cache-Control: private, no-store` so shared proxies never store
them, and `X-Cache: HIT | MISS | BYPASS` for debugging.

### Keys and invalidation

```
merchant:cache:v1:gen:<merchantId>                       generation counter (INCR)
merchant:cache:v1:<resource>:<merchantId>:g<generation>  JSON value, TTL
```

A writer commits to the database first and then runs `INCR` on the merchant's
generation. `INCR` is atomic, so concurrent writers on different nodes cannot
lose an invalidation. A reader reads the generation **before** the database. If
a write lands in between, the reader stores the old row under the old
generation, which nobody reads again. Deleting keys directly would allow that
stale row to be written back.

These writes invalidate the cache: `PUT /merchant-branding`,
`PUT /webhook-settings`, `POST /webhook-settings/verify` (when persisted, and
again when a dead-lettered verification is recovered),
`POST /merchants/rotate-webhook-secret` and `POST /regenerate-webhook-secret`.
Code outside this route that writes these columns should call
`invalidateMerchantCache(merchantId)`. Otherwise readers may see the old value
for up to one TTL.

### Fault tolerance

- Every Redis call has a time limit (`REDIS_CACHE_OP_TIMEOUT_MS`, default 150 ms).
  A timeout or error falls back to the database, so a cache problem never
  produces an error response.
- If the generation cannot be read, the cache is bypassed rather than read
  under an unconfirmed generation.
- When Redis is down (the no-op client), reads bypass the cache and
  invalidations are counted as `invalidate_skipped`.
- A corrupt entry is deleted and treated as a miss.
- Merchant ids must match `^[A-Za-z0-9_-]{1,64}$` before they are used in a
  key, so request input cannot shape the key namespace.

### Configuration

| Variable | Default | Range |
| --- | --- | --- |
| `MERCHANT_CACHE_ENABLED` | `true` | `false` disables the cache |
| `MERCHANT_CACHE_TTL_SECONDS` | `60` | 1–900 |
| `REDIS_CACHE_OP_TIMEOUT_MS` | `150` | 10–5000 |

### Metrics

| Metric | Labels |
| --- | --- |
| `merchant_cache_operations_total` | `resource`, `result` = hit \| miss \| bypass \| error \| store \| store_error \| invalidate \| invalidate_error \| invalidate_skipped |
| `merchant_route_requests_total` | `route`, `method`, `status_class` (2xx…5xx, `aborted`) |
| `merchant_route_request_duration_seconds` | `route`, `method` |
| `merchant_route_in_flight_requests` | `route` |

The telemetry middleware runs before validation and rate limiting, so it also
counts rejected requests. It records only requests that one of this router's
routes serves, and labels them with the route pattern.
