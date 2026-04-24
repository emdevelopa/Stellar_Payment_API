import { pool } from "../lib/db.js";
import {
  consumeAuditLogRateLimit,
  createAuditLogRateLimitKey,
  hashAuditPayload,
  sanitizeAuditKey,
  sanitizeAuditValue,
  signAuditPayload,
} from "../lib/audit-security.js";

export const auditService = {
  async getAuditLogs(merchantId, page = 1, limit = 50) {
    let p = parseInt(page, 10) || 1;
    let l = parseInt(limit, 10) || 50;

    if (p < 1) p = 1;
    if (l < 1) l = 1;
    if (l > 100) l = 100;

    const offset = (p - 1) * l;

    // Get total count
    const countResult = await pool.query(
      "SELECT COUNT(*) FROM audit_logs WHERE merchant_id = $1",
      [merchantId]
    );
    const totalCount = parseInt(countResult.rows[0].count, 10);

    // Get paginated logs
    const logsResult = await pool.query(
      `SELECT id, action, field_changed, old_value, new_value, ip_address, user_agent, timestamp
       FROM audit_logs
       WHERE merchant_id = $1
       ORDER BY timestamp DESC
       LIMIT $2 OFFSET $3`,
      [merchantId, l, offset]
    );

    return {
      logs: logsResult.rows,
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
    try {
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

      await pool.query(
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
        ]
      );
    } catch (err) {
      console.error("Failed to log audit event:", err);
    }
  },
};
