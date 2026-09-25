# Trustline Manager — Security & Performance Audit

Scope: `src/lib/trustline-manager.js`, `src/routes/trustlines.js`, and database migrations.

## Implementation Status

### Issue #744: Cryptographic Signature Verification ✓
**Status**: Complete

**Implementation**: `TrustlineSignatureVerifier` class provides:
- Multi-signature account verification with threshold checking
- Ed25519 signature verification using Stellar SDK
- Transaction operation validation (changeTrust, allowTrust)
- Asset code and issuer validation
- 5-minute verification result caching to reduce Horizon API calls
- Comprehensive error handling with specific failure reasons

**Controls**:
- All signatures verified against Stellar public keys
- Transaction operations inspected to ensure trustline-specific operations
- Asset codes and issuers validated against Stellar standards
- No cache poisoning: signatures validated on each first lookup

**Verification Endpoint**: `POST /trustlines/verify/:txHash`

---

### Issue #743: Rate Limiting ✓
**Status**: Complete

**Implementation**: `TrustlineRateLimiter` class provides:
- Per-merchant, per-API-key, or per-IP rate limiting
- Trustline operations: 20 ops/5min per merchant
- Trustline verifications: 50 verifications/5min per merchant
- Premium/enterprise merchants skip standard rate limits
- Standard HTTP headers: X-RateLimit-{Limit, Remaining, Reset}

**Controls**:
- Redis-backed distributed rate limiting
- Graceful degradation: requests pass through if Redis unavailable
- Key hierarchy: merchant ID > API key hash > IP address
- Separate rate limit tracks for operations vs. verifications

**Protected Endpoints**:
- `POST /trustlines/verify/:txHash` - verification rate limit
- `POST /trustlines/create` - operation rate limit
- `GET /trustlines/...` - operation rate limit

---

### Issue #741: Error Recovery ✓
**Status**: Complete

**Implementation**: `TrustlineErrorRecovery` class provides:
- Per-context circuit breaker pattern with half-open probes
- Exponential backoff with 25% jitter (max 30 sec)
- Timeout wrapper: 15-second operation timeout per attempt
- Dead-letter queue (100 items max) for unrecoverable failures
- Retry logic: 3 attempts by default, 1 for circuit breaker probes
- Error classification: retryable (network, timeout, rate-limit) vs. terminal (auth, schema, 404)

**Controls**:
- Circuit breaker thresholds: 5 consecutive failures trigger open state
- Half-open: one probe attempt allowed after 30-second cool-off
- Timeout per operation: 15 seconds hard cap
- Dead-letter queue: FIFO eviction when full (100 items)
- Metrics tracking: total failures, recoveries, last error timestamp

**Error Classification**:
- **Retryable**: network, timeout, rate-limit (429), server errors (5xx)
- **Terminal**: auth errors (401/403), schema conflicts, 404 not found, client errors (4xx)

**Monitoring**: Access circuit breaker metrics via `TrustlineErrorRecovery.getCircuitBreakerMetrics()`

---

### Issue #742: Security Audit (SEP-12 KYC) ✓
**Status**: Complete

**See**: [SEP12_KYC_SECURITY_AUDIT.md](./SEP12_KYC_SECURITY_AUDIT.md) for detailed threat model.

**Enhancement**: Rate limiting now applied to all SEP-12 routes (addresses audit recommendation):
- Rate limit: 50 requests/15min per account+IP combination
- Protects against brute-force enumeration of KYC status
- Standard HTTP headers included in responses

**Database Access**:
- `sep12_kyc_customers` table with unique composite index `(stellar_account, memo)`
- `withRecovery` wrapper ensures all DB operations have retry logic
- Parameterized queries prevent SQL injection

---

## Threat Model & Residual Risks

| Threat | Control | Mitigation |
| --- | --- | --- |
| **Brute-force signature guessing** | Rate limiting (50 verifications/5min) + circuit breaker | Attackers rate-limited; failed probes trigger circuit breaker |
| **Denial of service (Horizon API)** | Rate limit + circuit breaker + timeout | Limits per-operation load; circuit breaker stops cascading failures |
| **Invalid/malicious signatures** | Ed25519 verification + operation type validation | Only Stellar account holders can verify; operations inspected |
| **Network timeouts/flaky APIs** | Exponential backoff + circuit breaker + dead-letter queue | Automatic retry on transient failures; circuit breaker prevents hammering |
| **Asset issuer spoofing** | Asset code/issuer validation + Stellar SDK validation | Validated against Stellar standards; SDK prevents invalid keys |
| **Cache poisoning** | Cache only after successful verification | Verification rerun on cache misses; no false positives |
| **PII in logs** | Error messages sanitized (no field values logged) | Error codes only; internal details never exposed |

**Residual Risks**:
- **Horizon API availability**: Relies on external Stellar API; circuit breaker mitigates cascading failures
- **Redis availability**: Graceful degradation; rate limiting bypassed if Redis unavailable
- **Database scaling**: Monitor connection pool; use `queryWithRetry` for automatic retry

---

## Test Coverage

### Trustline Manager Tests (`src/lib/trustline-manager.test.js`)
- **Signature verification**: valid/invalid signatures, operation type validation, asset validation, caching
- **Rate limiting**: merchant/API-key/IP key generation, premium tier bypass
- **Error recovery**: retry logic, error classification, circuit breaker state transitions, timeout handling, dead-letter queue
- **Query optimization**: index creation, health metrics, payment statistics by asset

### SEP-12 KYC Tests (`src/lib/sep12-kyc.test.js`)
- **Signature verification**: valid/forged/stale/wrong-key signatures
- **Field validation**: schema strictness, unknown field rejection
- **Error recovery**: retryable 503 vs. terminal 500 errors
- **Database operations**: parameterized queries, upsert behavior, get/delete hit/miss

---

## Deployment Checklist

- [ ] Redis configured and available for rate limiting
- [ ] Database migrations applied (`20260527*` series)
- [ ] Rate limit keys properly configured in routes
- [ ] Circuit breaker metrics exposed to monitoring
- [ ] Dead-letter queue monitored for failures
- [ ] Stellar Horizon API URL configured
- [ ] Error logs do not leak PII (audit field values)
- [ ] Timeout values tuned for production latency SLAs

---

## Performance Metrics

- **Signature verification**: ~200ms (Horizon API call) + caching (5 min)
- **Rate limit check**: ~5ms (Redis lookup)
- **Error recovery**: Exponential backoff: 1s → 2s → 4s (max 30s)
- **Circuit breaker**: 5 failure threshold, 30-sec reset window, 1 probe allowed in half-open
