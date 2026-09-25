# Path Payment Service — Security Audit Report

**Issue:** #886  
**Scope:** `backend/src/services/paymentService.js`, `backend/services/path-payment/errorRecovery.ts`, `backend/src/lib/payment-signature-verification.js`  
**Date:** 2026-06-26

---

## Executive Summary

The Path Payment Service implements strong security fundamentals: parameterised SQL queries, timing-safe HMAC signature comparison, replay-protection caching, Redis cache invalidation on confirmation, and circuit-breaker error recovery. No critical vulnerabilities were found. The findings below are low-to-medium severity hardening recommendations.

---

## Findings

### 1. Replay window relies on in-process memory (Medium)

**Location:** `payment-signature-verification.js` — `verifyReplayProtection`

**Issue:** The replay-protection cache is stored in a `Map` inside the Node.js process. A multi-instance deployment (multiple pods / workers) means replay attacks are only caught within a single instance. A request replayed to a different pod passes undetected.

**Recommendation:** Move the replay-protection store to Redis (already used for payment caching) using `SET NX EX <windowSeconds>`. The existing `connectRedisClient` infrastructure makes this straightforward.

**Risk:** Payment replay attacks succeed against horizontally-scaled deployments.

---

### 2. Signature cache size cap uses insertion-order eviction (Low)

**Location:** `payment-signature-verification.js` — `setCachedVerification`

**Issue:** When `paymentSignatureCache.size > 1000` the oldest key is evicted via `Map.keys().next().value`. Under high load this may evict a recently-cached valid signature before it expires, causing unnecessary re-verification calls. It does not represent a security bypass, but increases latency.

**Recommendation:** Use an LRU cache (e.g. `lru-cache`) or enforce eviction based on TTL rather than count alone.

---

### 3. Asset issuer verification fails open on non-404 recovery errors (Low)

**Location:** `paymentService.js` — `createPaymentSession`

```js
if (recoveryError.status !== 404) {
  throw recoveryError;
}
```

**Issue:** If `AssetIssuerErrorRecovery.verifyIssuerOnChain` throws an error without a `.status` property (e.g. a network timeout object), `recoveryError.status` is `undefined`, the condition is false, and the function silently continues with an unverified issuer. A payment session is created with a potentially invalid issuer.

**Recommendation:** Change the guard to `recoveryError.status === 400` (explicit "not found") rather than `!== 404`. Any other error (undefined status, 5xx) should re-throw to fail safely.

---

### 4. Refund destination derived from Horizon without signature verification (Low)

**Location:** `paymentService.js` — `generateRefundTx`

**Issue:** The refund destination is taken directly from `tx.source_account` returned by the Horizon API without verifying the original transaction's signatures. An attacker who can inject a response at the network layer could redirect refunds.

**Recommendation:** Verify the `tx_id` transaction's signatures before trusting `source_account`. The existing `verifyTransactionSignatureIfAvailable` helper should be called here.

---

### 5. Circuit breaker open-state error leaks internal label (Informational)

**Location:** `errorRecovery.ts` — `executeWithRetry`

```ts
const error = new Error(`Circuit breaker is OPEN for ${this.label}`);
```

**Issue:** If this error bubbles up to an API response without sanitisation, it leaks the internal service label (e.g. `horizon-api`, `database`). This is informational only since error middleware should catch it, but worth confirming at the route layer.

**Recommendation:** Confirm that the global error handler in `src/app.js` strips internal error messages before sending 5xx responses. No code change needed if already handled.

---

### 6. `search` filter uses `replaceAll(",", "\\,")` in Supabase path only (Informational)

**Location:** `paymentService.js` — `applyPaymentFilters` (Supabase) vs `buildPaymentListWhereClause` (pool)

**Issue:** The Supabase code path escapes commas in the `or()` query string. The pool path uses `escapeLikePattern` which escapes `\`, `%`, `_` correctly. These are consistent for their respective query builders, but divergence between the two paths is worth noting for future maintenance.

**Recommendation:** Add a comment documenting why the two paths differ to prevent a future developer from "fixing" one to match the other incorrectly.

---

## Items Verified as Secure

| Area | Finding |
|------|---------|
| SQL injection | All pool queries use `$N` parameterised values via `queryWithRetry`. Supabase SDK uses its own parameterisation. No string interpolation into SQL. |
| Timing attacks | `verifyPaymentPayloadSignature` and `verifyRequestTimestamp` use `timingSafeEqual` after length checks. |
| Replay protection | `verifyReplayProtection` is called before confirming a transaction and records seen hashes. |
| Metadata key injection | `SAFE_METADATA_KEY_RE` enforces `[a-zA-Z0-9_-]{1,64}` on all metadata keys before inclusion in queries. |
| Path traversal | No file system access in the payment service path. |
| Timestamp tolerance | `verifyRequestTimestamp` enforces a 300-second default window and rejects non-numeric timestamps. |
| Cache invalidation | `invalidatePaymentCache` is called on the Redis payment cache after confirmation. |
| Error recovery | Circuit breaker prevents cascade failures to Horizon and the database. |

---

## Recommendations Summary

| # | Severity | Item |
|---|----------|------|
| 1 | Medium | Move replay-protection cache to Redis for multi-instance safety |
| 2 | Low | Replace Map eviction with LRU or TTL-based eviction |
| 3 | Low | Fail safe on asset issuer verification for non-explicit-404 errors |
| 4 | Low | Verify refund source transaction signatures before using source_account |
| 5 | Info | Confirm circuit breaker error label is stripped by global error handler |
| 6 | Info | Document Supabase vs pool search escaping difference |
