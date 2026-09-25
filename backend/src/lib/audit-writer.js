/**
 * Shared audit-log write pipeline (issue #1067).
 *
 * `lib/audit.js` (login attempts) and `services/auditService.js` (profile
 * changes) each need their own independent circuit breaker so that an
 * outage on one path doesn't suppress the other, but the retry loop,
 * fallback-file logging, and metrics emission around that breaker were
 * previously duplicated between the two modules. `createAuditWriter`
 * centralizes that shared mechanics behind a small per-source instance.
 */

import { AuditCircuitBreaker, CircuitState } from "./audit-circuit-breaker.js";
import { replayFallbackLogs } from "./audit-replay.js";
import { pool, isRetryablePoolError } from "./db.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditLogWritesTotal,
  auditLogWriteDuration,
  auditLogFallbackWritesTotal,
  auditLogCircuitBreakerTrips,
  auditLogCircuitBreakerState,
} from "./metrics.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUDIT_FALLBACK_LOG_PATH = process.env.AUDIT_FALLBACK_LOG_PATH || path.join(__dirname, "../../logs/audit_fallback.log");
const AUDIT_DB_RETRY_ATTEMPTS = Number.parseInt(process.env.AUDIT_DB_RETRY_ATTEMPTS || "2", 10);
const AUDIT_DB_RETRY_DELAY_MS = Number.parseInt(process.env.AUDIT_DB_RETRY_DELAY_MS || "100", 10);
const CIRCUIT_FAILURE_THRESHOLD = Number.parseInt(process.env.AUDIT_CIRCUIT_FAILURE_THRESHOLD || "5", 10);
const CIRCUIT_RESET_MS = Number.parseInt(process.env.AUDIT_CIRCUIT_RESET_MS || "60000", 10);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeFallbackLog(source, payload, error) {
  const timestamp = new Date().toISOString();
  const entry = `${timestamp} | ${JSON.stringify(payload)} | error: ${error.message}\n`;
  try {
    const dir = path.dirname(AUDIT_FALLBACK_LOG_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.appendFileSync(AUDIT_FALLBACK_LOG_PATH, entry);
    auditLogFallbackWritesTotal.inc({ source });
  } catch (fallbackErr) {
    console.error("Failed to write audit fallback log:", fallbackErr.message);
  }
}

/**
 * Creates an audit writer with its own circuit breaker (issue #771),
 * DB retry loop, fallback logging, and metrics — labeled by `source`.
 *
 * @param {object} opts
 * @param {string} opts.source - Metric label, e.g. "login_attempt" | "profile_change"
 * @param {string} opts.label  - Circuit-breaker log label, e.g. "audit-helper"
 */
export function createAuditWriter({ source, label }) {
  const circuitBreaker = new AuditCircuitBreaker({
    failureThreshold: CIRCUIT_FAILURE_THRESHOLD,
    resetTimeoutMs: CIRCUIT_RESET_MS,
    label,
    onClose: () => {
      auditLogCircuitBreakerState.set({ source }, 0);
      replayFallbackLogs(AUDIT_FALLBACK_LOG_PATH).catch((err) => {
        console.error("[Audit Replay] Fallback log replay failed:", err.message);
      });
    },
    onOpen: () => {
      auditLogCircuitBreakerTrips.inc({ source });
      auditLogCircuitBreakerState.set({ source }, 1);
    },
    onHalfOpen: () => {
      auditLogCircuitBreakerState.set({ source }, 2);
    },
  });

  async function insertWithRetry(sql, params) {
    if (circuitBreaker.isOpen()) {
      return { success: false, error: new Error("Circuit breaker open: DB writes suspended"), circuitOpen: true };
    }

    for (let attempt = 0; attempt <= AUDIT_DB_RETRY_ATTEMPTS; attempt += 1) {
      try {
        await pool.query(sql, params);
        circuitBreaker.recordSuccess();
        return { success: true };
      } catch (err) {
        const isRetryable = attempt < AUDIT_DB_RETRY_ATTEMPTS && isRetryablePoolError(err);
        if (!isRetryable) {
          circuitBreaker.recordFailure();
          return { success: false, error: err };
        }
        const delayMs = AUDIT_DB_RETRY_DELAY_MS * (attempt + 1);
        console.warn(
          `Audit log DB failed (attempt ${attempt + 1}/${AUDIT_DB_RETRY_ATTEMPTS + 1}): ${err.message}. Retrying in ${delayMs}ms.`,
        );
        await sleep(delayMs);
      }
    }
    circuitBreaker.recordFailure();
    return { success: false, error: new Error("Max retry attempts exceeded") };
  }

  /**
   * Writes an audit row, falling back to the file log on failure.
   * `payload` is the original (pre-SQL) object, used only for fallback logging.
   */
  async function write(sql, params, payload) {
    const writeStart = process.hrtime.bigint();
    const result = await insertWithRetry(sql, params);
    const durationSeconds = Number(process.hrtime.bigint() - writeStart) / 1e9;

    const resultTag = result.success ? "success" : result.circuitOpen ? "circuit_open" : "failure";
    auditLogWritesTotal.inc({ source, result: resultTag });
    auditLogWriteDuration.observe({ source, result: resultTag }, durationSeconds);

    if (!result.success) {
      writeFallbackLog(source, payload, result.error);
    }

    return result;
  }

  return {
    write,
    getState: () => ({
      open: circuitBreaker.state === CircuitState.OPEN,
      failures: circuitBreaker.failures,
      openedAt: circuitBreaker.openedAt,
      state: circuitBreaker.state,
    }),
    resetForTests: () => circuitBreaker.reset(),
  };
}
