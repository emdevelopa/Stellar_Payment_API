# Payment Session Validator

Validation stage that runs before a payment session is persisted, used by both
`POST /api/create-payment` / `POST /api/sessions` (`src/routes/payments.js`)
and `paymentService.createPaymentSession` (`src/services/paymentService.js`).

Covers issues **#1447** (payload sanitization and strict validation) and
**#1448** (Prometheus alert metrics and health telemetry). Builds on the shared
rules from #1087 (see `PAYMENT_PROCESSOR.md`).

---

## 1. Layout

| File | Role |
|---|---|
| `src/lib/payment-session-rules.js` | Pure rule functions: no I/O, logging or metrics |
| `src/lib/payment-session-validator.js` | `validatePaymentSession()`: runs the rules in order, records metrics, logs, tracks health |
| `src/lib/payment-session-validator-metrics.js` | Separate Prometheus registry, merged into `/metrics` |
| `docs/alerts/payment-session-validator.rules.yml` | Prometheus alerting rules |

Request pipeline for the HTTP routes:

```
zod schema (paymentSessionZodSchema)   type coercion, required fields, memo rules
sanitizeMetadataMiddleware             metadata XSS/NoSQL scrubbing, forbidden keys → 400
validatePaymentSession({ source: "http" })
  sanitization → payload → issuer → limits → allowlist     first failure → 400
insert into payments                   uses the *sanitized* payload
```

In the service layer, the validator now runs **before** the on-chain issuer
lookup (`AssetIssuerErrorRecovery.verifyIssuerOnChain`). An invalid request
never costs a Horizon round-trip.

## 2. Rules

| Rule | Function | Rejection reasons |
|---|---|---|
| `sanitization` | `sanitizeSessionPayload` | `malformed_payload`, `forbidden_key`, `field_too_long` |
| `payload` | `validateSessionAsset`, `validateSessionAmount` | `invalid_asset`, `invalid_amount` |
| `issuer` | `resolveAndValidateIssuer` | `missing_issuer`, `invalid_issuer` |
| `limits` | `validatePerAssetLimits` | `below_min`, `above_max` (response includes `min`/`max` + `delta`) |
| `allowlist` | `validateAllowedIssuers` | `issuer_not_allowed` |

### Sanitization (#1447)

- The body must be a plain JSON object. Arrays, primitives and class
  instances are rejected.
- `__proto__`, `constructor` and `prototype` keys are rejected at any depth
  (walk capped at 8 levels). `JSON.parse` creates `__proto__` as an own
  property, so the walk sees it.
- For the string fields `asset`, `asset_issuer`, `recipient`, `description`,
  `message`, `memo`, `memo_type`, `webhook_url` and `client_id`, each value is:
  - NFC-normalized
  - stripped of C0/C1 control characters, bidi overrides/isolates
    (U+202A–U+202E, U+2066–U+2069, U+200E/F) and zero-width characters
  - trimmed
  - length-checked **after** stripping (limits in `SESSION_FIELD_MAX_LENGTHS`)
- An optional field that sanitizes to `""` is dropped. A required field
  (`asset`, `recipient`) stays `""` and fails later with an explicit error.
- The input is never mutated. Callers persist `validation.payload`.

### Strict validation (#1447)

- `asset` must match `^[A-Z0-9]{1,12}$` after upper-casing.
- `amount` must be a finite number > 0, ≤ `922337203685.4775807` (int64
  stroops) and have at most 7 decimal places. Floating-point artifacts such as
  `0.1 + 0.2` are rejected.

### Hardening of existing rules

- Limit lookup uses `Object.hasOwn`, so asset codes like `CONSTRUCTOR` or
  `__proto__` can never resolve to inherited properties.
- Limit bounds are coerced with `Number()`, so legacy numeric-string configs
  such as `"10"` keep working. Unusable bounds (`"abc"`, objects) are
  **ignored** and reported as config anomalies instead of silently comparing
  as `NaN`.
- Allowlist entries that are not strings are ignored rather than coerced.

### Related fixes

- `src/lib/request-schemas.js` called `isValidStellarPublicKey` without
  importing it. Every non-XLM session with an issuer hit a `ReferenceError`
  inside schema validation.
- `src/lib/sanitize-metadata.js` copied keys into a fresh object with
  `sanitized[key] = …`. A `__proto__` key therefore replaced that object's
  prototype. Metadata containing forbidden keys is now rejected with 400.

## 3. Metrics (#1448)

Every label value comes from a fixed server-side set. None comes from request
data, so clients cannot inflate cardinality. Unknown `source` values collapse
to `unknown`.

| Metric | Type | Labels |
|---|---|---|
| `payment_session_validator_evaluations_total` | counter | `source` (http/service/unknown), `outcome` (accepted/rejected/error) |
| `payment_session_validator_rejections_total` | counter | `source`, `rule`, `reason` |
| `payment_session_validator_duration_seconds` | histogram | `source`, `outcome` |
| `payment_session_validator_sanitized_fields_total` | counter | `field` |
| `payment_session_validator_suspicious_payloads_total` | counter | `signal` (forbidden_key/malformed_payload/bidi_control/oversized_field) |
| `payment_session_validator_config_anomalies_total` | counter | `kind` (invalid_entry/invalid_min/invalid_max/min_greater_than_max) |
| `payment_session_validator_health_state` | gauge | 0 healthy, 1 degraded, 2 unhealthy |
| `payment_session_validator_rejection_ratio` | gauge | rolling window |
| `payment_session_validator_error_ratio` | gauge | rolling window |
| `payment_session_validator_last_evaluation_timestamp_seconds` | gauge | none |

The rolling-window gauges are recomputed at scrape time, so they decay back to
healthy when traffic stops.

## 4. Health telemetry (#1448)

`GET /health/payment-session-validator` (public, no merchant data):

```json
{
  "status": "healthy",
  "reasons": [],
  "window_ms": 300000,
  "total": 42, "accepted": 40, "rejected": 2, "errors": 0, "suspicious": 0,
  "rejection_ratio": 0.0476, "error_ratio": 0,
  "last_evaluation_at": "2026-09-26T12:00:00.000Z",
  "thresholds": { "min_samples": 20, "error_ratio": 0.05, "rejection_ratio": 0.5, "suspicious": 10 }
}
```

| Status | Condition | HTTP |
|---|---|---|
| `unhealthy` | ≥ `min_samples` evaluations and error ratio ≥ threshold | 503 |
| `degraded` | ≥ `min_samples` and rejection ratio ≥ threshold, **or** suspicious count ≥ threshold | 200 |
| `healthy` | otherwise (including no traffic) | 200 |

`GET /health` also reports `services.payment_session_validator`. The value is
informational only and does not change `ok` or the status code.

The window uses 5-second buckets in a fixed ring, so memory stays constant
under any load. Tuning via environment:

| Variable | Default |
|---|---|
| `PAYMENT_SESSION_VALIDATOR_HEALTH_WINDOW_MS` | `300000` |
| `PAYMENT_SESSION_VALIDATOR_HEALTH_MIN_SAMPLES` | `20` |
| `PAYMENT_SESSION_VALIDATOR_ERROR_RATIO_THRESHOLD` | `0.05` |
| `PAYMENT_SESSION_VALIDATOR_REJECTION_RATIO_THRESHOLD` | `0.5` |
| `PAYMENT_SESSION_VALIDATOR_SUSPICIOUS_THRESHOLD` | `10` |

## 5. Alerts

`docs/alerts/payment-session-validator.rules.yml` defines:

| Alert | Severity | Fires when |
|---|---|---|
| `PaymentSessionValidatorInternalErrors` | critical | any `outcome="error"` in 5m |
| `PaymentSessionValidatorUnhealthy` | critical | `health_state >= 2` for 5m |
| `PaymentSessionValidatorHighRejectionRatio` | warning | > 50% rejected over 10m (≥ 20 samples) |
| `PaymentSessionValidatorSuspiciousPayloadSpike` | warning | > 10 suspicious payloads in 5m |
| `PaymentSessionValidatorPrototypePollutionAttempt` | warning | any `forbidden_key` in 15m |
| `PaymentSessionValidatorMerchantConfigAnomaly` | info | any config anomaly in 30m |
| `PaymentSessionValidatorSlow` | warning | p99 > 25ms for 10m |

A unit test checks that every metric referenced in the rules file exists in
the registry.

## 6. Logging

- Rejection: `info` with `{ merchantId, source, rule, reason }`
- Suspicious payload: `warn` with `{ merchantId, source, signals }`
- Config anomaly: `warn` with `{ merchantId, source, anomalies }`
- Internal error: `error` with `{ err, merchantId, source }`, then rethrown

The raw payload is never logged.

## 7. Security notes

- **Fail-closed on validator errors:** unexpected exceptions are recorded and
  rethrown, so the route returns 500 and no session is created.
- **Config anomalies fail open, but only per bound:** a malformed bound is
  ignored, and the other bound and all other rules still apply. The choice
  favors availability for merchants with bad configs. It is visible through
  the `MerchantConfigAnomaly` alert.
- **Trojan Source / display spoofing:** bidi and zero-width characters are
  stripped before the text reaches the database or the hosted checkout page.
- **DoS:** limits and allowlist checks now run before the Horizon issuer
  lookup, and the forbidden-key walk is depth-capped.
- **Behavior changes clients may notice:** amounts with more than 7 decimals,
  amounts above the Stellar maximum, `description` > 1000 chars and
  `client_id` > 128 chars are now rejected with 400.

## 8. Tests

```
npx vitest run src/lib/payment-session-rules.test.js \
               src/lib/payment-session-validator.test.js \
               src/lib/sanitize-metadata.test.js \
               tests/integration/payment-session-validator.test.js
```
