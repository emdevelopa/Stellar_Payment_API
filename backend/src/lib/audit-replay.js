import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { pool } from "./db.js";
import { hashAuditPayload, signAuditPayload } from "./audit-security.js";
import { logger } from "./logger.js";
import { auditLogReplayTotal } from "./metrics.js";

let _isReplaying = false;

/**
 * Checks if a replay process is already running.
 * Useful for monitoring and testing.
 *
 * @returns {boolean}
 */
export function isReplaying() {
  return _isReplaying;
}

/**
 * Replays any logged audit items from the fallback log back into the DB
 * once the database is healthy (issue #771).
 *
 * @param {string} fallbackLogPath - Absolute path to the fallback audit log
 * @returns {Promise<void>}
 */
export async function replayFallbackLogs(fallbackLogPath) {
  if (_isReplaying) {
    logger.info("[Audit Replay] Replay already in progress, skipping");
    return;
  }
  if (!fs.existsSync(fallbackLogPath)) {
    return;
  }

  _isReplaying = true;
  logger.info({ fallbackLogPath }, "[Audit Replay] Starting recovery of fallback audit logs...");

  const tempPath = `${fallbackLogPath}.tmp`;
  try {
    // Rename fallback file so that incoming failures during replay write to a new file
    fs.renameSync(fallbackLogPath, tempPath);
  } catch (err) {
    logger.error(err, "[Audit Replay] Failed to rename fallback log file for replay");
    _isReplaying = false;
    return;
  }

  let fileStream;
  try {
    fileStream = fs.createReadStream(tempPath);
  } catch (err) {
    logger.error(err, "[Audit Replay] Failed to create read stream for fallback log");
    _isReplaying = false;
    return;
  }

  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  const failedLines = [];

  for await (const line of rl) {
    if (!line.trim()) continue;

    // Parse the format: ${timestamp} | ${JSON.stringify(payload)} | error: ${error.message}
    const firstPipe = line.indexOf(" | ");
    const lastPipe = line.lastIndexOf(" | error: ");

    if (firstPipe === -1 || lastPipe === -1 || lastPipe <= firstPipe) {
      logger.warn({ line }, "[Audit Replay] Skipping malformed fallback log line");
      continue;
    }

    const timestampStr = line.substring(0, firstPipe);
    const jsonStr = line.substring(firstPipe + 3, lastPipe);

    let payload;
    try {
      payload = JSON.parse(jsonStr);
    } catch (err) {
      logger.warn({ line, err: err.message }, "[Audit Replay] Failed to parse payload JSON");
      continue;
    }

    const payloadHash = hashAuditPayload(payload);
    const signature = signAuditPayload(payload);

    try {
      await pool.query(
        `INSERT INTO audit_logs (merchant_id, action, field_changed, old_value, new_value, ip_address, user_agent, payload_hash, signature, timestamp, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          payload.merchant_id ?? null,
          payload.action,
          payload.field_changed ?? null,
          payload.old_value ?? null,
          payload.new_value ?? null,
          payload.ip_address ?? null,
          payload.user_agent ?? null,
          payloadHash,
          signature,
          new Date(timestampStr),
          payload.status ?? null,
        ]
      );
      auditLogReplayTotal.inc({ result: "success" });
    } catch (dbErr) {
      logger.error(dbErr, `[Audit Replay] Database insert failed during replay for timestamp ${timestampStr}`);
      // Keep track of failed lines to write back to fallback log
      failedLines.push(line);
      auditLogReplayTotal.inc({ result: "failed" });
    }
  }

  fileStream.destroy();

  try {
    fs.unlinkSync(tempPath);
  } catch (err) {
    logger.error(err, "[Audit Replay] Failed to remove temporary fallback log file");
  }

  if (failedLines.length > 0) {
    logger.warn({ count: failedLines.length }, `[Audit Replay] ${failedLines.length} logs failed to replay. Appending back to fallback log.`);
    try {
      const dir = path.dirname(fallbackLogPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.appendFileSync(fallbackLogPath, failedLines.join("\n") + "\n");
    } catch (err) {
      logger.error(err, "[Audit Replay] Failed to write back failed lines to fallback log");
    }
  } else {
    logger.info("[Audit Replay] Successfully replayed all fallback audit logs!");
  }

  _isReplaying = false;
}
