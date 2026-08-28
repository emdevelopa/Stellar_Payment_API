/**
 * Audit Logging Helper
 *
 * Provides a lightweight helper to record merchant login attempts
 * (success and failure) into the `audit_logs` table for security monitoring.
 *
 * Design notes:
 * - All errors are swallowed so audit logging never blocks or crashes auth.
 * - `merchantId` is required (NOT NULL FK); only call this after merchant lookup.
 * - `status` is stored as a suffix of the `action` field: 'login_success' | 'login_failure'.
 */

import { createAuditWriter } from "./audit-writer.js";
import { createQueuedAuditWriter } from "./audit-writer-queue.js";
import {
  consumeAuditLogRateLimit,
  createAuditLogRateLimitKey,
  hashAuditPayload,
  sanitizeAuditValue,
  signAuditPayload,
  validateAuditAction,
} from "./audit-security.js";
import { auditLogRateLimitRejectionsTotal } from "./metrics.js";

const AUDIT_SOURCE = "login_attempt";

const baseWriter = createAuditWriter({ source: AUDIT_SOURCE, label: "audit-helper" });
const auditWriter = createQueuedAuditWriter(baseWriter, "login-audit-queue");

export function getAuditCircuitState() {
  return auditWriter.getState();
}

export function _resetAuditCircuitForTests() {
  auditWriter.resetForTests();
}

/**
 * Record a merchant login attempt in the audit_logs table.
 *
 * @param {object} opts
 * @param {string|null} opts.merchantId  - UUID of the merchant (null if unknown)
 * @param {string|null} opts.ipAddress   - Remote IP from req.ip
 * @param {string|null} opts.userAgent   - User-Agent header value
 * @param {'success'|'failure'} opts.status - Outcome of the login attempt
 * @returns {Promise<void>}
 */
export async function logLoginAttempt({ merchantId, ipAddress, userAgent, status }) {
  const action = "login";

  // Guard against unexpected action values reaching the DB (issue #772)
  if (!validateAuditAction(action)) {
    console.error(`[audit] Rejected disallowed action: ${action}`);
    return;
  }
  const rateLimitKey = createAuditLogRateLimitKey({
    merchantId,
    action,
    ipAddress,
  });
  const rateLimitResult = consumeAuditLogRateLimit(rateLimitKey);
  if (!rateLimitResult.allowed) {
    auditLogRateLimitRejectionsTotal.inc({ source: AUDIT_SOURCE });
    return;
  }

  const payload = {
    merchant_id: merchantId ?? null,
    action,
    status: sanitizeAuditValue(status),
    ip_address: sanitizeAuditValue(ipAddress),
    user_agent: sanitizeAuditValue(userAgent),
    event_type: "login_attempt",
  };

  const payloadHash = hashAuditPayload(payload);
  const signature = signAuditPayload(payload);

  const result = await auditWriter.write(
    `INSERT INTO audit_logs (merchant_id, action, status, ip_address, user_agent, payload_hash, signature)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      payload.merchant_id,
      payload.action,
      payload.status,
      payload.ip_address,
      payload.user_agent,
      payloadHash,
      signature,
    ],
    payload,
  );

  if (!result.success) {
    console.error("Failed to write audit log:", result.error.message);
  }
}
