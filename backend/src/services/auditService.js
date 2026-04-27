import { pool, isRetryablePoolError } from "../lib/db.js";
import {
  consumeAuditLogRateLimit,
  createAuditLogRateLimitKey,
  hashAuditPayload,
  sanitizeAuditKey,
  sanitizeAuditValue,
  signAuditPayload,
} from "../lib/audit-security.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUDIT_FALLBACK_LOG_PATH = process.env.AUDIT_FALLBACK_LOG_PATH || path.join(__dirname, "../../logs/audit_fallback.log");
const AUDIT_DB_RETRY_ATTEMPTS = Number.parseInt(process.env.AUDIT_DB_RETRY_ATTEMPTS || "2", 10);
const AUDIT_DB_RETRY_DELAY_MS = Number.parseInt(process.env.AUDIT_DB_RETRY_DELAY_MS || "100", 10);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeFallbackLog(payload, error) {
  const timestamp = new Date().toISOString();
  const entry = `${timestamp} | ${JSON.stringify(payload)} | error: ${error.message}\n`;
  try {
    const dir = path.dirname(AUDIT_FALLBACK_LOG_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.appendFileSync(AUDIT_FALLBACK_LOG_PATH, entry);
  } catch (fallbackErr) {
    console.error("Failed to write audit fallback log:", fallbackErr.message);
  }
}

async function insertAuditLog({ payload, payloadHash, signature }) {
  for (let attempt = 0; attempt <= AUDIT_DB_RETRY_ATTEMPTS; attempt += 1) {
    try {
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
        ],
      );
      return { success: true };
    } catch (err) {
      const isRetryable = attempt < AUDIT_DB_RETRY_ATTEMPTS && isRetryablePoolError(err);
      if (!isRetryable) {
        return { success: false, error: err };
      }
      const delayMs = AUDIT_DB_RETRY_DELAY_MS * (attempt + 1);
      console.warn(
        `Audit log DB failed (attempt ${attempt + 1}/${AUDIT_DB_RETRY_ATTEMPTS + 1}): ${err.message}. Retrying in ${delayMs}ms.`,
      );
      await sleep(delayMs);
    }
  }
  return { success: false, error: new Error("Max retry attempts exceeded") };
}

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

    const result = await insertAuditLog({ payload, payloadHash, signature });

    if (!result.success) {
      writeFallbackLog(payload, result.error);
      console.error("Failed to log audit event:", result.error.message);
    }
  },
};
