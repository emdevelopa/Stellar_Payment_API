import crypto from "node:crypto";

const SENSITIVE_KEY_RE = /(secret|token|password|api[_-]?key|authorization|signature)/i;
const DEFAULT_AUDIT_RATE_LIMIT_MAX = 60;
const DEFAULT_AUDIT_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_AUDIT_FIELD_MAX_LENGTH = 2048;
const MAX_AUDIT_RATE_LIMIT_KEYS = 10_000;

/**
 * Allowlist of permitted audit action identifiers.
 * Restricting actions to a known set prevents log-injection attacks where
 * a crafted action string embeds control characters or arbitrary content
 * into the audit trail (issue #772).
 */
const ALLOWED_AUDIT_ACTIONS = new Set([
  "login",
  "logout",
  "update",
  "create",
  "delete",
  "export",
  "import",
  "password_change",
  "api_key_rotate",
  "webhook_trigger",
  "payment_initiated",
  "payment_confirmed",
  "payment_failed",
]);

const auditRateLimitState = new Map();

function pruneExpiredAuditRateLimitEntries(now, windowMs) {
  let cleaned = 0;

  for (const [key, state] of auditRateLimitState.entries()) {
    if (now >= state.windowStart + windowMs) {
      auditRateLimitState.delete(key);
      cleaned += 1;
    }
  }

  return cleaned;
}

function stableStringify(value, depth = 0, seen = new WeakSet()) {
  if (depth > 10) {
    return '"[Too Deep]"';
  }
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);

  if (seen.has(value)) {
    return '"[Circular]"';
  }
  seen.add(value);

  if (Array.isArray(value)) {
    const serialized = value.map((item) => stableStringify(item, depth + 1, seen)).join(",");
    seen.delete(value);
    return `[${serialized}]`;
  }

  const entries = Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested, depth + 1, seen)}`);
  seen.delete(value);
  return `{${entries.join(",")}}`;
}

function truncateString(value, maxLength = DEFAULT_AUDIT_FIELD_MAX_LENGTH) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...[truncated]`;
}

export function sanitizeAuditValue(value) {
  if (value === null || value === undefined) return null;

  if (typeof value === "object") {
    const serialized = stableStringify(value);
    return truncateString(serialized);
  }

  if (typeof value === "string") {
    return truncateString(value.trim());
  }

  return truncateString(String(value));
}

export function sanitizeAuditKey(value) {
  const normalized = sanitizeAuditValue(value);
  if (!normalized) return null;

  return SENSITIVE_KEY_RE.test(normalized) ? "[REDACTED]" : normalized;
}

export function hashAuditPayload(payload) {
  return crypto
    .createHash("sha256")
    .update(stableStringify(payload), "utf8")
    .digest("hex");
}

export function signAuditPayload(payload, secret = process.env.AUDIT_LOG_SIGNING_SECRET) {
  if (!secret) {
    return null;
  }

  return crypto
    .createHmac("sha256", secret)
    .update(stableStringify(payload), "utf8")
    .digest("hex");
}

/**
 * Verify a stored HMAC signature against the original payload using a
 * constant-time comparison to prevent timing-oracle attacks (issue #769).
 *
 * @param {object} payload   - The original audit payload object
 * @param {string} signature - The hex-encoded HMAC stored in the database
 * @param {string} [secret]  - Signing secret (defaults to AUDIT_LOG_SIGNING_SECRET env var)
 * @returns {boolean} true if the signature is valid and untampered
 */
export function verifyAuditSignature(payload, signature, secret = process.env.AUDIT_LOG_SIGNING_SECRET) {
  if (!secret || !signature || typeof signature !== "string") return false;

  const expected = signAuditPayload(payload, secret);
  if (!expected) return false;

  try {
    // timingSafeEqual requires same-length Buffers; mismatched lengths → false
    const expectedBuf = Buffer.from(expected, "hex");
    const actualBuf = Buffer.from(signature, "hex");
    if (expectedBuf.length !== actualBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, actualBuf);
  } catch {
    return false;
  }
}

/**
 * Validate that an action string is within the known-safe allowlist before
 * storing it in the audit trail.  Prevents log-injection through crafted
 * action values (issue #772).
 *
 * @param {string} action
 * @returns {boolean}
 */
export function validateAuditAction(action) {
  if (!action || typeof action !== "string") return false;
  return ALLOWED_AUDIT_ACTIONS.has(action.toLowerCase().trim());
}

export function createAuditLogRateLimitKey({ merchantId, action, ipAddress }) {
  return [merchantId || "anonymous", action || "unknown-action", ipAddress || "unknown-ip"].join(":");
}

export function consumeAuditLogRateLimit(
  key,
  {
    now = Date.now(),
    max = Number(process.env.AUDIT_LOG_RATE_LIMIT_MAX || DEFAULT_AUDIT_RATE_LIMIT_MAX),
    windowMs = Number(
      process.env.AUDIT_LOG_RATE_LIMIT_WINDOW_MS || DEFAULT_AUDIT_RATE_LIMIT_WINDOW_MS,
    ),
  } = {},
) {
  if (!key) return { allowed: true, remaining: max, resetTime: now + windowMs };

  pruneExpiredAuditRateLimitEntries(now, windowMs);

  // Evict expired entries if Map size exceeds safety threshold (DoS / OOM protection)
  if (auditRateLimitState.size >= MAX_AUDIT_RATE_LIMIT_KEYS) {
    const oldestKeys = Array.from(auditRateLimitState.entries())
      .sort(([, a], [, b]) => a.windowStart - b.windowStart)
      .slice(0, Math.max(100, Math.ceil(auditRateLimitState.size * 0.1)))
      .map(([k]) => k);

    for (const k of oldestKeys) {
      auditRateLimitState.delete(k);
    }
  }

  const current = auditRateLimitState.get(key);
  if (!current || now >= current.windowStart + windowMs) {
    const next = { count: 1, windowStart: now };
    auditRateLimitState.set(key, next);
    return { allowed: true, remaining: Math.max(0, max - 1), resetTime: now + windowMs };
  }

  current.count += 1;

  if (current.count > max) {
    return {
      allowed: false,
      remaining: 0,
      resetTime: current.windowStart + windowMs,
    };
  }

  return {
    allowed: true,
    remaining: Math.max(0, max - current.count),
    resetTime: current.windowStart + windowMs,
  };
}

/**
 * Get comprehensive rate limit statistics for audit logging (issue #902).
 * Useful for monitoring and debugging rate limit behavior.
 */
export function getAuditRateLimitStats({ now = Date.now() } = {}) {
  const windowMs = Number(
    process.env.AUDIT_LOG_RATE_LIMIT_WINDOW_MS || DEFAULT_AUDIT_RATE_LIMIT_WINDOW_MS,
  );
  pruneExpiredAuditRateLimitEntries(now, windowMs);

  const stats = {
    totalKeys: auditRateLimitState.size,
    activeWindows: 0,
    expiredWindows: 0,
    maxRequestsPerWindow: Number(process.env.AUDIT_LOG_RATE_LIMIT_MAX || DEFAULT_AUDIT_RATE_LIMIT_MAX),
    windowMs,
  };

  for (const [, state] of auditRateLimitState.entries()) {
    if (now >= state.windowStart + stats.windowMs) {
      stats.expiredWindows++;
    } else {
      stats.activeWindows++;
    }
  }

  return stats;
}

/**
 * Cleanup expired audit rate limit entries to prevent memory exhaustion (issue #902).
 * Should be called periodically (e.g., via cron or on a schedule).
 */
export function cleanupExpiredAuditRateLimits({ now = Date.now() } = {}) {
  const windowMs = Number(
    process.env.AUDIT_LOG_RATE_LIMIT_WINDOW_MS || DEFAULT_AUDIT_RATE_LIMIT_WINDOW_MS,
  );
  const staleThreshold = windowMs * 2; // Remove entries older than 2x the window

  let cleaned = 0;
  for (const [key, state] of auditRateLimitState.entries()) {
    if (now - state.windowStart > staleThreshold) {
      auditRateLimitState.delete(key);
      cleaned++;
    }
  }

  return cleaned;
}

export function resetAuditRateLimitStateForTests() {
  auditRateLimitState.clear();
}

/**
 * Reconstructs the original audit log payload from a database row.
 *
 * @param {object} row
 * @returns {object}
 */
export function reconstructPayloadFromRow(row) {
  if (!row) return {};
  if (row.action === "login") {
    return {
      merchant_id: row.merchant_id ?? null,
      action: row.action,
      status: row.status ?? null,
      ip_address: row.ip_address ?? null,
      user_agent: row.user_agent ?? null,
      event_type: "login_attempt",
    };
  } else {
    return {
      merchant_id: row.merchant_id ?? null,
      action: row.action,
      field_changed: row.field_changed ?? null,
      old_value: row.old_value ?? null,
      new_value: row.new_value ?? null,
      ip_address: row.ip_address ?? null,
      user_agent: row.user_agent ?? null,
    };
  }
}

/**
 * Validates the cryptographic integrity of a single audit log database row.
 *
 * @param {object} row
 * @param {string} [secret] - Optional signing secret
 * @returns {{ verified: boolean, status: string, reason?: string }}
 */
export function verifyRowIntegrity(row, secret = process.env.AUDIT_LOG_SIGNING_SECRET) {
  if (!row) {
    return { verified: false, status: "failed", reason: "empty_row" };
  }
  if (!row.payload_hash) {
    return { verified: false, status: "failed", reason: "missing_hash" };
  }

  try {
    const payload = reconstructPayloadFromRow(row);
    const expectedHash = hashAuditPayload(payload);

    if (row.payload_hash !== expectedHash) {
      return { verified: false, status: "failed", reason: "hash_mismatch" };
    }

    if (!row.signature) {
      return { verified: true, status: "unsigned_verified" };
    }

    if (secret) {
      const signatureValid = verifyAuditSignature(payload, row.signature, secret);
      if (!signatureValid) {
        return { verified: false, status: "failed", reason: "signature_invalid" };
      }
      return { verified: true, status: "verified" };
    }

    return { verified: true, status: "unsigned_verified" };
  } catch (err) {
    return { verified: false, status: "failed", reason: `error: ${err.message}` };
  }
}
