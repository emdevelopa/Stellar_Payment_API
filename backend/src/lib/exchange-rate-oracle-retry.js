/**
 * Automated retry with exponential backoff for Exchange Rate Oracle Cache
 * loads (issue #1444).
 *
 * The quote fetch is a read of public DEX data. Retrying it cannot create a
 * payment or change a balance. Only transient failures are retried: network
 * errors, 408, 429 and 5xx (except 501). A missing path (404), validation
 * failures and CacheLoadTimeoutError are never retried, so a deterministic
 * rejection cannot be turned into a quote by repetition.
 *
 * The wrapper runs inside the single-flight loader, so a burst of identical
 * requests shares one retry loop instead of one loop per caller.
 *
 * Delay schedule: full jitter
 *   delay(n) = random(0, min(maxDelayMs, baseDelayMs * 2^n))
 */

import { logger } from './logger.js';
import { recordOracleRetry } from './exchange-rate-oracle-telemetry.js';

export const DEFAULT_ORACLE_RETRY_OPTIONS = Object.freeze({
  maxAttempts: 3,
  baseDelayMs: 100,
  maxDelayMs: 1000,
});

const MAX_ATTEMPTS_CEILING = 6;
const MAX_DELAY_CEILING_MS = 10_000;

const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
]);

function getStatus(err) {
  const status = err?.status ?? err?.statusCode ?? err?.response?.status;
  return typeof status === 'number' ? status : null;
}

/**
 * @param {unknown} err
 * @returns {boolean}
 */
export function isRetryableOracleError(err) {
  if (!err || typeof err !== 'object') return false;
  if (err.name === 'NoPathFoundError' || err.name === 'CacheLoadTimeoutError') return false;
  if (err.retryable === false) return false;
  if (err.retryable === true) return true;

  const status = getStatus(err);
  if (status !== null) {
    if (status === 408 || status === 429) return true;
    if (status >= 500 && status !== 501) return true;
    if (status >= 400) return false;
  }

  if (RETRYABLE_NETWORK_CODES.has(err.code)) return true;

  const message = typeof err.message === 'string' ? err.message : '';
  if (/fetch failed|socket hang up|network error|timed? ?out/i.test(message)) return true;
  return false;
}

function clampInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

export function resolveOracleRetryOptions(options = {}, env = process.env) {
  const maxAttempts = clampInt(
    options.maxAttempts ?? env.EXCHANGE_RATE_ORACLE_RETRY_MAX_ATTEMPTS,
    DEFAULT_ORACLE_RETRY_OPTIONS.maxAttempts,
    1,
    MAX_ATTEMPTS_CEILING,
  );
  const baseDelayMs = clampInt(
    options.baseDelayMs ?? env.EXCHANGE_RATE_ORACLE_RETRY_BASE_DELAY_MS,
    DEFAULT_ORACLE_RETRY_OPTIONS.baseDelayMs,
    0,
    MAX_DELAY_CEILING_MS,
  );
  const maxDelayMs = clampInt(
    options.maxDelayMs ?? env.EXCHANGE_RATE_ORACLE_RETRY_MAX_DELAY_MS,
    DEFAULT_ORACLE_RETRY_OPTIONS.maxDelayMs,
    baseDelayMs,
    MAX_DELAY_CEILING_MS,
  );
  return { maxAttempts, baseDelayMs, maxDelayMs };
}

/**
 * @param {number} retryIndex 0 for the first retry
 * @param {{baseDelayMs:number, maxDelayMs:number}} opts
 * @param {() => number} [random]
 */
export function computeOracleBackoffDelay(retryIndex, { baseDelayMs, maxDelayMs }, random = Math.random) {
  const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** retryIndex);
  if (ceiling <= 0) return 0;
  return Math.floor(random() * ceiling);
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @template T
 * @param {(ctx:{attempt:number}) => Promise<T>} operation
 * @param {object} [options]
 */
export async function withOracleRetry(operation, options = {}) {
  const {
    label = 'exchange-rate-oracle-fetch',
    shouldRetry = isRetryableOracleError,
    sleep = defaultSleep,
    random = Math.random,
    context = {},
  } = options;
  const resolved = resolveOracleRetryOptions(options);

  let lastError;
  for (let attempt = 1; attempt <= resolved.maxAttempts; attempt += 1) {
    try {
      const result = await operation({ attempt });
      if (attempt > 1) recordOracleRetry('recovered');
      return result;
    } catch (err) {
      lastError = err;
      const retryable = shouldRetry(err);
      const exhausted = attempt >= resolved.maxAttempts;

      if (!retryable || exhausted) {
        if (err && typeof err === 'object') err.retryAttempts = attempt;
        if (retryable && exhausted) {
          recordOracleRetry('exhausted');
          logger.error(
            { ...context, label, attempts: attempt, err: err?.message, code: err?.code, status: getStatus(err) },
            'Exchange rate oracle fetch failed after exhausting retries',
          );
        }
        throw err;
      }

      const delayMs = computeOracleBackoffDelay(attempt - 1, resolved, random);
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
        'Exchange rate oracle fetch failed, retrying with backoff',
      );
      recordOracleRetry('scheduled');
      await sleep(delayMs);
    }
  }

  throw lastError;
}
