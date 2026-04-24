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

import { pool } from "./db.js";
import {
  consumeAuditLogRateLimit,
  createAuditLogRateLimitKey,
  hashAuditPayload,
  sanitizeAuditValue,
  signAuditPayload,
} from "./audit-security.js";

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
  try {
    const action = "login";
    const rateLimitKey = createAuditLogRateLimitKey({
      merchantId,
      action,
      ipAddress,
    });
    const rateLimitResult = consumeAuditLogRateLimit(rateLimitKey);
    if (!rateLimitResult.allowed) {
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

    await pool.query(
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
    );
  } catch (err) {
    // Audit logging should never break the auth flow.
    console.error("Failed to write audit log:", err.message);
  }
}

