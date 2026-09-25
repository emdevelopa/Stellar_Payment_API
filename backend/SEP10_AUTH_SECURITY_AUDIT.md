# SEP-10 Authentication Security Audit

**Module:** `backend/src/lib/sep10-auth.js`, `backend/src/routes/auth.js`  
**Issues:** #588 (audit), #587 (error recovery), #733 (rate limiting), #1292–#1295 (hardening)  
**Date:** 2026-06-23

## Scope

This audit covers the SEP-0010 Web Authentication flow: challenge generation, signed transaction verification, merchant lookup, and session token issuance.

## Threat Model

| Threat | Mitigation | Status |
|--------|------------|--------|
| Challenge replay | In-memory nonce cache rejects reused nonces; entries live until the challenge expires (#1292) | ✅ Implemented |
| Nonce burning / verify races | Nonce claimed atomically only after all checks pass; released if no token is issued (#1295) | ✅ Fixed |
| Forged or non-conforming challenges | Server source account, sequence 0, bounded time window, no unrecognized signers (#1294) | ✅ Fixed |
| JWT algorithm confusion | Session tokens signed and verified with HS256 only (#1294) | ✅ Fixed |
| Oversized/malformed XDR | `validateChallengeXdr` enforces size (8 KB) and base64 charset | ✅ Implemented |
| Home-domain spoofing | Challenge and verify both use `getHomeDomain()`; mismatch returns `HOME_DOMAIN_MISMATCH` | ✅ Fixed |
| Missing server/client signatures | Both signatures verified against transaction hash | ✅ Implemented |
| Expired challenges | Time bounds checked against server clock | ✅ Implemented |
| Brute-force challenge/verify | Per-account+IP and per-IP challenge limits; per-IP verify limits (#733, #584) | ✅ Implemented |
| JWT secret fallback | `JWT_SECRET` required at runtime; no default secret | ✅ Implemented |
| Store outage during verify | Transient Supabase errors retried; retryable 503 returned (#587) | ✅ Implemented |
| Information leakage via errors | Generic `AUTHENTICATION_FAILED` for parse failures; structured codes for known cases | ✅ Implemented |

## Findings & Remediation

### High — Home domain inconsistency (fixed)

**Issue:** Challenge generation defaulted to `localhost` while verification used `process.env.HOME_DOMAIN`, allowing valid-looking challenges to fail verification in production.

**Fix:** Centralized domain resolution in `getHomeDomain()` and used it in both `generateChallenge` and `verifyChallenge`.

### Medium — Missing XDR size guard (fixed)

**Issue:** Unbounded XDR input could be used for DoS via expensive parsing.

**Fix:** `MAX_CHALLENGE_XDR_BYTES` (8192) enforced before Stellar SDK parsing.

### Medium — No structured error recovery on merchant lookup (fixed)

**Issue:** Transient database errors surfaced as opaque 500 responses.

**Fix:** `lookupMerchantByStellarAddress` wraps Supabase calls with `withSep10StoreRecovery`, returning retryable `503 SERVICE_UNAVAILABLE`.

### Low — Generic catch in verifyChallenge (accepted)

**Issue:** Unexpected parse errors return a generic message without leaking SDK internals.

**Status:** Accepted — intentional fail-closed behavior.

### High — Nonce claimed before verification (#1295, fixed)

**Issue:** `verifyChallenge` recorded the nonce before checking time bounds and signatures. Anyone who saw a challenge (unsigned or with a bogus signature) could submit it first and lock the real client out with `NONCE_REPLAY`. The nonce was also consumed when the merchant store returned a retryable 503, so the retry the API asked for always failed.

**Fix:** The nonce is claimed with an atomic check-and-set (`consumeChallengeNonce`) as the last step of verification. `/auth/verify` calls `releaseChallengeNonce` when it fails before issuing a token. A nonce stays consumed once a token is issued or once the account is found to have no merchant.

### High — Replay cache wiped under load / unbounded growth (#1292, fixed)

**Issue:** Used nonces lived in a `Set` that was checked every 10 minutes and fully cleared once it held more than 10k entries. Memory grew without bound between sweeps, stale nonces were never dropped below the threshold, and a clear removed every *live* nonce, reopening replay for challenges that were still valid.

**Fix:** A `Map` of nonce → challenge expiry. Expired entries are swept every 60s and the timer stops when the cache is empty. A hard cap (`SEP10_NONCE_CACHE_MAX`, default 10000) prunes expired entries first and then evicts the oldest live entries with a warning log. The cache is never cleared wholesale.

### Medium — Incomplete SEP-10 challenge validation (#1294, fixed)

**Issue:** The transaction source account, sequence number, time-bound window and extra signers were not checked, as SEP-10 requires. Session JWTs accepted any HMAC algorithm (e.g. HS512). `/auth/challenge` compared `STELLAR_NETWORK` case-sensitively while the signer lower-cased it, so `STELLAR_NETWORK=PUBLIC` advertised the testnet passphrase for a public-network challenge.

**Fix:** Challenges are rejected unless they are sourced from the server account with sequence 0, have a finite window no longer than `CHALLENGE_EXPIRES_IN`, and are signed only by the server and the client. Tokens use HS256 only. The route advertises `getNetworkPassphrase()`.

### Medium — Null dereferences hidden by catch-all (#1293, fixed)

**Issue:** A fee-bump-wrapped challenge passed the operations check and then crashed reading `timeBounds`. A store rejecting with `undefined` was rethrown as-is, and `next(undefined)` left the request hanging. A token could be signed with a `null` merchant id.

**Fix:** Explicit guards with specific error codes (`INVALID_STRUCTURE`, `INVALID_TIME_BOUNDS`). Unexpected verification errors are logged, non-Error rejections are normalised, and tokens are never minted without a merchant id.

### Medium — Signature verification cost unbounded (#585, fixed)

**Issue:** Every decorated signature on a submitted challenge was run through Ed25519 verification against both the server and client keys, and again in the "unrecognized signature" pass. A forged challenge carrying the network maximum of 20 signatures forced ~60 verifications per request, before rejection.

**Fix:** `verifyChallengeSignatures()` rejects more than `SEP10_MAX_CHALLENGE_SIGNATURES` (2) signatures before any cryptographic work, requires each signature's 4-byte hint to match the candidate signer's `signatureHint()` before verifying against the transaction hash, and classifies each signature exactly once (server, client, or unrecognized). A valid challenge costs exactly two verifications.

**Impact:** Cryptographic work per `/auth/verify` is bounded at two Ed25519 verifications. Error codes (`SERVER_SIGNATURE_MISSING`, `CLIENT_SIGNATURE_INVALID`, `UNRECOGNIZED_SIGNATURE`) are unchanged.

### Error codes returned by `/auth/verify`

`INVALID_XDR`, `INVALID_ACCOUNT`, `INVALID_STRUCTURE`, `INVALID_OPERATION`, `ACCOUNT_MISMATCH`, `HOME_DOMAIN_MISMATCH`, `INVALID_NONCE`, `INVALID_TIME_BOUNDS`, `CHALLENGE_EXPIRED`, `SERVER_SIGNATURE_MISSING`, `CLIENT_SIGNATURE_INVALID`, `UNRECOGNIZED_SIGNATURE`, `NONCE_REPLAY`, `AUTHENTICATION_FAILED`.

## Rate Limiting (#733)

| Endpoint | Key | Default window | Default max |
|----------|-----|----------------|-------------|
| `POST /api/auth/challenge` (per IP, all accounts — #584) | `sep10:challenge-ip:{ip}` | 60s | 60 |
| `POST /api/auth/challenge` | `sep10:challenge:{account}:{ip}` | 60s | 20 |
| `POST /api/auth/verify` | `sep10:verify:{ip}` | 60s | 10 |

Both challenge limiters apply: the per-IP ceiling runs first, so a client can't bypass the per-account limit by rotating the (caller-supplied) `account` value to get a fresh bucket for every request, which previously let one IP mint unlimited server-signed challenges. It runs before body validation, so malformed requests count against it too. Limited responses return `429` with `code: "SEP10_RATE_LIMITED"` and `X-RateLimit-*` / `RateLimit-*` headers.

Redis-backed store (`rl:sep10:` prefix) is used when `REDIS_URL` is available; in-memory fallback otherwise.

### Environment variables

```
SEP10_CHALLENGE_RATE_LIMIT_WINDOW_MS=60000
SEP10_CHALLENGE_RATE_LIMIT_MAX=20
SEP10_CHALLENGE_IP_RATE_LIMIT_WINDOW_MS=60000
SEP10_CHALLENGE_IP_RATE_LIMIT_MAX=60
SEP10_VERIFY_RATE_LIMIT_WINDOW_MS=60000
SEP10_VERIFY_RATE_LIMIT_MAX=10
SEP10_NONCE_CACHE_MAX=10000
```

## Recommendations (future work)

1. **Distributed nonce store:** Replace in-process nonce cache with Redis for multi-instance deployments.
2. **Audit logging:** Include SEP-10 error codes in login audit events for security monitoring.
3. **Challenge binding:** Optionally bind challenges to a client-supplied `client_domain` query param per SEP-10 spec.

## Test Coverage

- `backend/src/lib/sep10-auth.test.js` — nonce replay, home domain, XDR validation, store recovery, null guards (#1293), nonce claim ordering (#1295), cache expiry/cap (#1292), challenge integrity and JWT algorithm (#1294), signature verification bounds, hint filtering and forged/duplicated/tampered signatures (#585)
- `backend/src/routes/auth.routes.test.js` — rate limits, retryable 503 on store failure, concurrent verify / retry-after-503 (#1295), advertised network passphrase (#1294)
- `backend/src/lib/sep10-auth.test.js` — nonce replay, home domain, XDR validation, store recovery, null guards (#1293), nonce claim ordering (#1295), cache expiry/cap (#1292), challenge integrity and JWT algorithm (#1294)
- `backend/src/routes/auth.routes.test.js` — rate limits (incl. per-IP challenge ceiling under account rotation, #584), retryable 503 on store failure, concurrent verify / retry-after-503 (#1295), advertised network passphrase (#1294)
- `backend/src/lib/rate-limit.test.js` — SEP-10 key generation and limiter factories

## Security Assumptions

- `SEP10_SERVER_SIGNING_KEY` and `JWT_SECRET` are stored securely and rotated periodically.
- `HOME_DOMAIN` matches the domain published in `stellar.toml`.
- Redis (when used) is network-isolated and authenticated.
- The nonce cache is per process. Behind multiple instances, the same signed challenge could be accepted once per instance until it expires (at most `CHALLENGE_EXPIRES_IN` seconds). See recommendation 1.
