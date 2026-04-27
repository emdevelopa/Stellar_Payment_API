# Audit Logger Security Audit

Date: 2026-04-24
Scope: `backend/src/lib/audit.js`, `backend/src/services/auditService.js`, audit log persistence path

## Findings

1. Unbounded write volume risk
- Risk: repeated login/event writes can flood `audit_logs` and degrade DB performance.
- Mitigation implemented: in-memory per-key fixed-window rate limiting.
- Key shape: `merchantId:action:ipAddress`.

2. Sensitive field leakage risk
- Risk: audit metadata fields can accidentally include secrets or keys.
- Mitigation implemented: sensitive key redaction (`secret`, `token`, `password`, `api_key`, `authorization`, `signature`) and value sanitization with bounded length.

3. Tamper-evidence gap
- Risk: stored audit records had no integrity marker.
- Mitigation implemented: `payload_hash` (SHA-256 over canonical payload) and optional `signature` (HMAC-SHA256 when `AUDIT_LOG_SIGNING_SECRET` is configured).

## Hardening Changes Applied

- Added `payload_hash` and `signature` columns to `audit_logs` via migration.
- Added canonical payload hashing/signing helpers in `backend/src/lib/audit-security.js`.
- Applied sanitization + signing to:
  - `logLoginAttempt` in `backend/src/lib/audit.js`
  - `auditService.logEvent` in `backend/src/services/auditService.js`
- Added write throttling to both login and generic event audit paths.

## Validation

Automated tests added:
- `backend/src/lib/audit-security.test.js`
- `backend/src/services/auditService.test.js`
- Updated `backend/src/lib/audit.test.js`

Focused suite result:
- `32 passed / 32 total` for impacted security and auth test files.

## Operational Notes

Recommended environment variables:
- `AUDIT_LOG_SIGNING_SECRET=<strong-random-secret>`
- `AUDIT_LOG_RATE_LIMIT_MAX=60`
- `AUDIT_LOG_RATE_LIMIT_WINDOW_MS=60000`

If `AUDIT_LOG_SIGNING_SECRET` is unset, `signature` will be `NULL` and `payload_hash` remains available.
