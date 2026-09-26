/**
 * payment-session-retry.js
 *
 * Automated retry with exponential backoff for the Payment Session Validator
 * (issue #1449).
 *
 * Session creation performs two kinds of I/O that can fail transiently:
 *
 *   - on-chain issuer verification (Horizon)
 *   - persisting the session row (Supabase / Postgres)
 *
 * A single dropped connection or 503 used to fail the whole request. This
 * module retries ONLY failures that are safe and meaningful to retry
 * (network errors, 5xx, 429, connection-class Postgres errors). Validation
 * failures, auth failures and constraint violations are never retried, so a
 * retry can never turn a rejected session into an accepted one.
 *
 * Delay schedule: "full jitter" exponential backoff
 *   delay(n) = random(0, min(maxDelayMs, baseDelayMs * 2^n))
 * which spreads retries from many instances and avoids a thundering herd
 * against a recovering dependency.
 */

import { logger } from "./logger.js";

export const DEFAULT_RETRY_OPTIONS = Object.freeze({
  maxAttempts: 3,
  baseDelayMs: 100,
  maxDelayMs: 2000,
});

/** Hard ceilings so env/config can never make a request hang indefinitely. */
const MAX_ATTEMPTS_CEILING = 6;
const MAX_DELAY_CEILING_MS = 10_000;

const RETRYABLE_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "ETIMEDOUT",
  "EPIPE",
  "EAI_AGAIN",
  "ENOTFOUND",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
]);

/**
 * Postgres SQLSTATE classes that indicate a transient server-side condition:
 *   08xxx connection exception, 40001 serialization failure,
 *   40P01 deadlock, 53xxx insufficient resources, 57P01-03 shutdown/cannot connect.
 */
function isRetryablePgCode(code) {
  if (typeof code !== "string") return false;
  return (
    code.startsWith("08") ||
    code === "40001" ||
    code === "40P01" ||
    code.startsWith("53") ||
    code === "57P01" ||
    code === "57P02" ||
    code === "57P03"
  );
}

/** Postgres unique_violation. */
export const UNIQUE_VIOLATION = "23505";

function getStatus(err) {
  const status = err?.status ?? err?.statusCode ?? err?.response?.status;
  return typeof status === "number" ? status : null;
}

/**
 * Decide whether an error is transient and safe to retry.
 *
 * @param {unknown} err
 * @returns {boolean}
 */
export function isRetryableSessionError(err) {
  if (!err || typeof err !== "object") return false;

  // Explicit opt-out wins over every heuristic below.
  if (err.retryable === false) return false;
  if (err.retryable === true) return true;

  const status = getStatus(err);
  if (status !== null) {
    if (status === 408 || status === 429) return true;
    if (status >= 500 && status !== 501) return true;
    // Every other status (4xx validation/auth/not-found) is deterministic.
    if (status >= 400) return false;
  }

  if (RETRYABLE_NETWORK_CODES.has(err.code)) return true;
  if (isRetryablePgCode(err.code)) return true;

  const message = typeof err.message === "string" ? err.message : "";
  if (/fetch failed|socket hang up|network error|timed? ?out/i.test(message)) {
    return true;
  }

  return false;
}

function clampInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

/**
 * Normalize user/env supplied options into safe bounds.
 */
export function resolveRetryOptions(options = {}, env = process.env) {
  const maxAttempts = clampInt(
    options.maxAttempts ?? env.PAYMENT_SESSION_RETRY_MAX_ATTEMPTS,
    DEFAULT_RETRY_OPTIONS.maxAttempts,
    1,
    MAX_ATTEMPTS_CEILING,
  );
  const baseDelayMs = clampInt(
    options.baseDelayMs ?? env.PAYMENT_SESSION_RETRY_BASE_DELAY_MS,
    DEFAULT_RETRY_OPTIONS.baseDelayMs,
    0,
    MAX_DELAY_CEILING_MS,
  );
  const maxDelayMs = clampInt(
    options.maxDelayMs ?? env.PAYMENT_SESSION_RETRY_MAX_DELAY_MS,
    DEFAULT_RETRY_OPTIONS.maxDelayMs,
    baseDelayMs,
    MAX_DELAY_CEILING_MS,
  );
  return { maxAttempts, baseDelayMs, maxDelayMs };
}

/**
 * Full-jitter exponential backoff delay for a zero-based retry index.
 *
 * @param {number} retryIndex 0 for the first retry, 1 for the second, ...
 * @param {{baseDelayMs:number, maxDelayMs:number}} opts
 * @param {() => number} [random=Math.random]
 */
export function computeBackoffDelay(retryIndex, { baseDelayMs, maxDelayMs }, random = Math.random) {
  const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** retryIndex);
  return Math.floor(random() * ceiling);
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `operation` with retry + exponential backoff.
 *
 * `operation` receives `{ attempt }` (1-based) so callers can adapt, e.g.
 * treat a duplicate-key error on a retried insert as "already persisted".
 *
 * On exhaustion the LAST error is rethrown, annotated with `retryAttempts`,
 * so upstream error handling and status codes are unchanged.
 *
 * @template T
 * @param {(ctx:{attempt:number}) => Promise<T>} operation
 * @param {object} [options]
 * @param {string} [options.label]           Log label for the operation
 * @param {number} [options.maxAttempts]     Total attempts, including the first
 * @param {number} [options.baseDelayMs]
 * @param {number} [options.maxDelayMs]
 * @param {(err:unknown) => boolean} [options.shouldRetry]
 * @param {(ms:number) => Promise<void>} [options.sleep]  Injected for tests
 * @param {() => number} [options.random]                Injected for tests
 * @param {(info:object) => void} [options.onRetry]      Hook for metrics
 * @param {object} [options.context]         Extra structured log fields
 * @returns {Promise<T>}
 */
export async function withSessionRetry(operation, options = {}) {
  const {
    label = "payment-session-operation",
    shouldRetry = isRetryableSessionError,
    sleep = defaultSleep,
    random = Math.random,
    onRetry,
    context = {},
  } = options;
  const resolved = resolveRetryOptions(options);

  let lastError;
  for (let attempt = 1; attempt <= resolved.maxAttempts; attempt += 1) {
    try {
      return await operation({ attempt });
    } catch (err) {
      lastError = err;
      const retryable = shouldRetry(err);
      const exhausted = attempt >= resolved.maxAttempts;

      if (!retryable || exhausted) {
        if (err && typeof err === "object") {
          err.retryAttempts = attempt;
        }
        if (retryable && exhausted) {
          logger.error(
            { ...context, label, attempts: attempt, err: err?.message, code: err?.code },
            "Payment session operation failed after exhausting retries",
          );
        }
        throw err;
      }

      const delayMs = computeBackoffDelay(attempt - 1, resolved, random);
      logger.warn(
        {
          ...context,
          label,
          attempt,
          maxAttempts: resolved.maxAttempts,
          delayMs,
          err: err?.message,
          code: err?.code,
          status: getStatus(err),
        },
        "Payment session operation failed, retrying with backoff",
      );
      onRetry?.({ label, attempt, delayMs, error: err });
      await sleep(delayMs);
    }
  }

  // Unreachable: the loop either returns or throws.
  throw lastError;
}

/**
 * Insert a payment session row with retry.
 *
 * The session id is generated by the server BEFORE the first attempt, so the
 * insert is naturally idempotent: if attempt N committed but its response was
 * lost, attempt N+1 hits a unique_violation on the primary key. That case is
 * treated as success ONLY on a retry, never on the first attempt, so a real
 * duplicate is still surfaced.
 *
 * @param {object} supabase  Supabase client
 * @param {object} payload   Row to insert (must include server-generated `id`)
 * @param {object} [options] Forwarded to withSessionRetry
 * @returns {Promise<{ error: null, recoveredDuplicate: boolean }>}
 * @throws the Supabase error (non-retryable or exhausted)
 */
export async function insertPaymentSessionWithRetry(supabase, payload, options = {}) {
  let recoveredDuplicate = false;

  await withSessionRetry(
    async ({ attempt }) => {
      const { error } = await supabase.from("payments").insert(payload);
      if (!error) return;

      if (attempt > 1 && error.code === UNIQUE_VIOLATION) {
        recoveredDuplicate = true;
        logger.warn(
          { paymentId: payload.id, attempt },
          "Payment session already persisted by an earlier attempt; treating retry as success",
        );
        return;
      }
      throw error;
    },
    {
      label: "payment-session-insert",
      ...options,
      context: { paymentId: payload.id, merchantId: payload.merchant_id, ...options.context },
    },
  );

  return { error: null, recoveredDuplicate };
}
