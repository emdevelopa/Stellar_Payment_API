import { createAuditWriter } from "../lib/audit-writer.js";
import { pool } from "../lib/db.js";
import {
  consumeAuditLogRateLimit,
  createAuditLogRateLimitKey,
  hashAuditPayload,
  sanitizeAuditKey,
  sanitizeAuditValue,
  signAuditPayload,
  validateAuditAction,
  verifyRowIntegrity,
} from "../lib/audit-security.js";
import { auditLogRateLimitRejectionsTotal, auditLogIntegrityVerificationsTotal } from "../lib/metrics.js";

const AUDIT_SOURCE = "profile_change";

const auditWriter = createAuditWriter({ source: AUDIT_SOURCE, label: "audit-service" });

export function _resetSvcCircuitForTests() {
  auditWriter.resetForTests();
}

export const auditService = {
  /**
   * Retrieve paginated audit logs for a merchant.
   *
   * Splits paginated queries into parallel count and row retrieval queries (issue #770)
   * executed via optimizedQuery to allow cacheability and avoid full table scan
   * materialization in Postgres.
   */
  async getAuditLogs(merchantId, page = 1, limit = 50) {
    let p = parseInt(page, 10) || 1;
    let l = parseInt(limit, 10) || 50;

    if (p < 1) p = 1;
    if (l < 1) l = 1;
    if (l > 100) l = 100;

    const offset = (p - 1) * l;

    const countResult = await pool.query(
      "SELECT COUNT(*)::int AS total_count FROM audit_logs WHERE merchant_id = $1",
      [merchantId],
    );

    const totalCount = parseInt(countResult.rows[0]?.total_count ?? 0, 10);

    const rowsResult = await pool.query(
      `SELECT id, merchant_id, action, field_changed, old_value, new_value, ip_address, user_agent, timestamp, payload_hash, signature
       FROM audit_logs
       WHERE merchant_id = $1
       ORDER BY timestamp DESC
       LIMIT $2 OFFSET $3`,
      [merchantId, l, offset],
    );

    const logs = rowsResult.rows.map((row) => {
      const integrity = verifyRowIntegrity(row);
      auditLogIntegrityVerificationsTotal.inc({ result: integrity.status });

      const hashVerified = row.payload_hash == null ? null : integrity.verified && integrity.status === "verified";
      const signatureVerified = row.signature == null || !process.env.AUDIT_LOG_SIGNING_SECRET ? null : integrity.verified && integrity.status === "verified";

      return {
        id: row.id,
        action: row.action,
        field_changed: row.field_changed,
        old_value: row.old_value,
        new_value: row.new_value,
        ip_address: row.ip_address,
        user_agent: row.user_agent,
        timestamp: row.timestamp,
        hash_verified: hashVerified,
        signature_verified: signatureVerified,
        integrity_status: integrity.status,
      };
    });

    return {
      logs,
      total_count: totalCount,
      total_pages: Math.ceil(totalCount / l),
      page: p,
      limit: l,
    };
  },

  async logEvent({
    merchantId,
    action,
    fieldChanged,
    oldValue,
    newValue,
    ipAddress,
    userAgent,
  }) {
    // Reject unknown action values to prevent log-injection (issue #772)
    if (!validateAuditAction(action)) {
      console.error(`[auditService] Rejected disallowed audit action: ${action}`);
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
      merchant_id: merchantId,
      action: sanitizeAuditValue(action),
      field_changed: sanitizeAuditKey(fieldChanged),
      old_value: sanitizeAuditValue(oldValue),
      new_value: sanitizeAuditValue(newValue),
      ip_address: sanitizeAuditValue(ipAddress),
      user_agent: sanitizeAuditValue(userAgent),
    };

    const payloadHash = hashAuditPayload(payload);
    const signature = signAuditPayload(payload);

    const result = await auditWriter.write(
      `INSERT INTO audit_logs (merchant_id, action, field_changed, old_value, new_value, ip_address, user_agent, payload_hash, signature)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        payload.merchant_id,
        payload.action,
        payload.field_changed,
        payload.old_value,
        payload.new_value,
        payload.ip_address,
        payload.user_agent,
        payloadHash,
        signature,
      ],
      payload,
    );

    if (!result.success) {
      console.error("Failed to log audit event:", result.error.message);
    }
  },
};
