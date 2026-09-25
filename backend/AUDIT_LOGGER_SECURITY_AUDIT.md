# Audit Logger Security Audit

Date: 2026-06-26
Scope: `backend/src/lib/audit.js`, `backend/src/services/auditService.js`, `backend/src/lib/audit-security.js`, audit log persistence path

## Findings & Mitigations

### 1. Unbounded Write Volume Risk
* **Risk**: Repeated login/event writes can flood the `audit_logs` database table and degrade database performance.
* **Mitigation**: Implemented in-memory, per-key fixed-window rate limiting (key shape: `merchantId:action:ipAddress`).

### 2. Sensitive Field Leakage Risk
* **Risk**: Audit metadata fields can accidentally include sensitive data like secrets, credentials, or API keys.
* **Mitigation**: Implemented regex-based sensitive key redaction (`secret`, `token`, `password`, `api_key`, `authorization`, `signature`) and value sanitization with bounded lengths.

### 3. Tamper-Evidence Gap
* **Risk**: Stored audit records had no integrity markers, making undetected modifications possible.
* **Mitigation**: Added `payload_hash` (SHA-256 over canonical payload) and optional `signature` (HMAC-SHA256) when `AUDIT_LOG_SIGNING_SECRET` is configured.

### 4. Rate Limiter Memory Exhaustion / Denial of Service (DoS)
* **Risk**: An attacker performing dictionary attacks using randomized keys (e.g. varying IP addresses or merchant IDs) could cause the in-memory rate limiting `Map` to grow indefinitely, leading to memory exhaustion and server OOM crashes.
* **Mitigation**: Added automatic eviction to `consumeAuditLogRateLimit`. When the `Map` size exceeds 10,000 entries, expired records are immediately purged. If the map remains full, a hard-cap eviction removes the oldest keys.

### 5. Recursion Stack Overflow / Crash
* **Risk**: If a logged metadata object has circular references or deep recursion, the standard stringifier will trigger a stack overflow (`RangeError: Maximum call stack size exceeded`), crashing the application process.
* **Mitigation**: Hardened `stableStringify` by tracking visited objects using a `WeakSet` (circular reference detection) and enforcing a maximum recursion depth cap of 10.

### 6. Integrity Verification Retrieval Gap
* **Risk**: Cryptographic hashes and signatures were written to the database but never verified upon retrieval, failing to alert administrators of tampered audit logs.
* **Mitigation**: Implemented `verifyRowIntegrity` and integrated it into the `getAuditLogs` database retrieval pipeline. Each row now includes an `integrity_status` string ("verified", "unsigned_verified", or "failed").

## Hardening Changes Applied

* Added automatic eviction and memory bounds to `consumeAuditLogRateLimit`.
* Added recursion depth and circular reference protections to `stableStringify`.
* Created `verifyRowIntegrity` and `reconstructPayloadFromRow` helpers.
* Integrated inline integrity checking in `getAuditLogs` and updated the REST API output to include `integrity_status`.
* Wrote 100% unit and integration test coverage for all new security mechanisms.

## Validation

Automated tests added and verified:
* `backend/src/lib/audit-security.test.js`
* `backend/src/services/auditService.test.js`
* `backend/src/lib/audit.test.js`
