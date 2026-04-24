import crypto from "node:crypto";

const SENSITIVE_KEY_RE = /(secret|token|password|api[_-]?key|authorization|signature)/i;
const DEFAULT_AUDIT_RATE_LIMIT_MAX = 60;
const DEFAULT_AUDIT_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_AUDIT_FIELD_MAX_LENGTH = 2048;

const auditRateLimitState = new Map();

function stableStringify(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`);
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

export function resetAuditRateLimitStateForTests() {
  auditRateLimitState.clear();
}
