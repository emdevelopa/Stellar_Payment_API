# API Gateway Signature: Payload Sanitization & Strict Validation

Modules: `src/lib/api-gateway-payload-validation.js`, used by `src/lib/api-gateway-signature.js` and `src/lib/auth.js`.

Signed requests send `x-api-key`, `x-api-timestamp` (Unix seconds) and `x-api-signature: sha256=<64 hex>`. The signature is an HMAC-SHA256 over:

```
METHOD \n PATH \n TIMESTAMP \n sha256(JSON.stringify(body))
```

Because the HMAC covers the exact body, the verifier **never rewrites the body**. Input that cannot be signed unambiguously is rejected instead, and sanitization is applied to log output.

## Validation rules

Checks run after the circuit-breaker, rate-limit and secret checks, and before any hashing.

| Input | Rule | Code on failure |
|---|---|---|
| Method | One of `GET HEAD POST PUT PATCH DELETE OPTIONS` (case-insensitive) | `API_GATEWAY_INVALID_REQUEST` |
| Path | String starting with `/`, ≤ 2048 chars, no control characters (blocks CR/LF injection into the newline-delimited canonical payload) | `API_GATEWAY_INVALID_REQUEST` |
| `x-api-timestamp` | String or number, ≤ 12 chars (then the existing digits-only, safe-integer and time-window checks) | `API_GATEWAY_INVALID_REQUEST` |
| `x-api-signature` | String, ≤ 128 chars (then the existing `sha256=` + 64 hex check) | `API_GATEWAY_INVALID_REQUEST` |
| Body | JSON-safe values only; no `__proto__`, `constructor` or `prototype` keys; depth ≤ 20; ≤ 10,000 nodes | `API_GATEWAY_INVALID_PAYLOAD` |
| Secret | Must be a string ≥ 16 chars | *(existing reason)* |

The API responds `401` with `{ error, code, reason }`, the same shape as other signature failures.

### Why non-JSON values are rejected

`JSON.stringify` silently rewrites some values, which would let two different bodies share one signature:

- `NaN` and `Infinity` become `null`
- `undefined` properties and functions are dropped
- `Date` becomes a string and `Buffer` becomes `{ type, data }`
- `BigInt` and circular structures throw

Bodies parsed from JSON never contain these values. Programmatic callers that pass them now get a clear rejection instead of a signature that collides with another body.

### Signing

`signApiGatewayRequest` applies the same body validation and returns `null` for invalid bodies. Previously, a body that failed to serialize was hashed as an empty string, so its signature matched an empty request.

## Configuration

`API_GATEWAY_SIGNATURE_TOLERANCE_SECONDS` sets the accepted clock skew in seconds, resolved by `resolveSignatureToleranceSeconds()`:

| Value | Result |
|---|---|
| unset / empty | `300` (default) |
| valid positive number | used as-is |
| non-numeric, `NaN`, `0`, negative | `300`, with a warning logged |
| above `3600` | capped at `3600`, with a warning logged |

Previously, a non-numeric value produced `NaN`. The comparison `delta > NaN` is always false, so the timestamp window was silently disabled.

## Key rotation

`verifyApiGatewayRequestSignatureWithRotation` honours at most `MAX_KEY_ROTATION_DEPTH` (2: current and previous) secrets and skips non-string entries. Extra keys are ignored, with a warning logged.

## Logging

`sanitizeForLog()` is applied to every attacker-controlled value the verifier logs: client IP, method, path, timestamp header and signature header.

- Control characters are replaced with `?`, so CR/LF cannot forge log lines.
- Strings are truncated to 80 chars, with the number of dropped chars noted.
- Objects and arrays are logged as `[object]` / `[array]`, never dumped.

## Tests

```bash
cd backend
npx vitest run src/lib/api-gateway-payload-validation.test.js src/lib/api-gateway-signature.test.js src/lib/auth.test.js
npx vitest run tests/e2e/api-gateway-security.e2e.test.js
```
