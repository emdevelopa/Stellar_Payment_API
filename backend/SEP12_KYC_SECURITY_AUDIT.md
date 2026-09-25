# SEP-12 KYC Integration — Security Audit

Scope: `src/lib/sep12-kyc.js`, `src/routes/sep12.js`, and the
`sep12_kyc_customers` table (migration `20260527000000`).

## Threat model & controls

| Threat | Control | Where |
| --- | --- | --- |
| **Unauthorized writes** (anyone updating another account's KYC) | Every `PUT` must carry a signature from the account's own Stellar key, verified with `Keypair.verify` | `verifyCustomerSignature` (#590) |
| **Replay** of a captured request | Signature binds a unix `timestamp`; requests older than `SIGNATURE_MAX_AGE_SECONDS` (300s) are rejected | `verifyCustomerSignature` |
| **Signature reuse against different data** | The signed payload includes a SHA-256 of the canonical (sorted-key) field set, so a signature is valid only for the exact fields submitted | `buildSignaturePayload` |
| **SQL injection** | All queries are parameterised (`$1..$n`); no string interpolation of user input | `putCustomer` / `getCustomer` / `deleteCustomer` |
| **Mass-assignment / junk data** | `zod` schema with `.strict()` rejects unknown keys and validates types/lengths/email/date | `fieldsSchema` |
| **Invalid account identifiers** | `Keypair.fromPublicKey` validates the account before any DB access | `assertValidAccount` |
| **PII leakage via logs** | Field values are never logged; only operation labels and error codes are recorded | `withRecovery`, route `handleError` |
| **Information leakage on errors** | Internal errors are surfaced as a generic 500/`INTERNAL_ERROR`; structured `KycError` codes are deliberate and non-sensitive | `handleError` |
| **Race / stale overwrite** (concurrent or replayed older PUTs clobbering newer data) | Upsert only updates when the request's signed timestamp is strictly newer than the stored `signed_at`; otherwise `409 STALE_REQUEST` | `putCustomer` |
| **Memory growth / bad input** (huge account keys in the limiter, non-string memos) | Rate-limit account key truncated to 56 chars; memo must be a string of at most 64 chars | `buildSep12RateLimitKey`, `normalizeMemo` |
| **Availability under DB stress** | Transient pool failures are retried, then surfaced as a retryable `503` so clients back off rather than hammering | `withRecovery` (#592), `queryWithRetry` |

## Residual risks / recommendations

- **Rate limiting:** route-level throttling is enabled for all SEP-12 endpoints
  at `50 requests / 15 minutes` per `account + IP` key to blunt brute-force and
  enumeration attacks. Redis-backed enforcement can still be layered in front
  of the route if stronger distributed limits are required.
- **PII at rest:** `fields` is stored as `jsonb` in plaintext. For regulated
  deployments, consider column-level encryption or a dedicated KYC vault.
- **Right to erasure:** `DELETE /sep12/customer/:account` supports hard
  deletion; retention policy should be defined by compliance.
- **Signature algorithm:** verification is Ed25519 over a SHA-256 digest of the
  canonical payload, matching Stellar account keys.

## Test coverage

`src/lib/sep12-kyc.test.js` covers: valid/forged/stale/wrong-key/missing
signatures, parameterised upsert shape, field validation, invalid account,
status derivation, get/delete hit & miss, and both error-recovery branches
(retryable 503 vs non-leaky 500).
