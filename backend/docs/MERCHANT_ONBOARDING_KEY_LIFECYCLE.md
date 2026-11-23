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
