import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { logger } from './logger.js';
import {
  DEFAULT_ORACLE_RETRY_OPTIONS,
  computeOracleBackoffDelay,
  isRetryableOracleError,
  resolveOracleRetryOptions,
  withOracleRetry,
} from './exchange-rate-oracle-retry.js';
import {
  exchangeRateOracleRegister,
  resetExchangeRateOracleHealth,
} from './exchange-rate-oracle-telemetry.js';

const noSleep = vi.fn(async () => {});

function errWith(props) {
  return Object.assign(new Error(props.message ?? 'boom'), props);
}

async function retryCount(result) {
  const metric = exchangeRateOracleRegister.getSingleMetric('exchange_rate_oracle_cache_retries_total');
  const snapshot = await metric.get();
  return snapshot.values
    .filter((entry) => entry.labels.result === result)
    .reduce((sum, entry) => sum + entry.value, 0);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetExchangeRateOracleHealth();
});

describe('isRetryableOracleError (issue #1444)', () => {
  it.each([
    ['HTTP 500', { status: 500 }],
    ['HTTP 502', { status: 502 }],
    ['HTTP 503', { statusCode: 503 }],
    ['HTTP 429', { status: 429 }],
    ['HTTP 408', { status: 408 }],
    ['ECONNRESET', { code: 'ECONNRESET' }],
    ['ETIMEDOUT', { code: 'ETIMEDOUT' }],
    ['fetch failed', { message: 'TypeError: fetch failed' }],
    ['socket hang up', { message: 'socket hang up' }],
    ['explicit retryable flag', { retryable: true, status: 400 }],
  ])('retries %s', (_label, props) => {
    expect(isRetryableOracleError(errWith(props))).toBe(true);
  });

  it.each([
    ['HTTP 400', { status: 400 }],
    ['HTTP 401', { status: 401 }],
    ['HTTP 404', { status: 404 }],
    ['HTTP 409', { status: 409 }],
    ['HTTP 422', { status: 422 }],
    ['HTTP 501', { status: 501 }],
    ['no path', { name: 'NoPathFoundError', statusCode: 404 }],
    ['load timeout', { name: 'CacheLoadTimeoutError', status: 504 }],
    ['opt-out beats 503', { retryable: false, status: 503 }],
    ['plain error', { message: 'something unexpected' }],
  ])('does not retry %s', (_label, props) => {
    expect(isRetryableOracleError(errWith(props))).toBe(false);
  });

  it('does not retry non-object throwables', () => {
    expect(isRetryableOracleError(null)).toBe(false);
    expect(isRetryableOracleError(undefined)).toBe(false);
    expect(isRetryableOracleError('ECONNRESET')).toBe(false);
  });
});

describe('resolveOracleRetryOptions', () => {
  it('uses defaults when nothing is configured', () => {
    expect(resolveOracleRetryOptions({}, {})).toEqual({ ...DEFAULT_ORACLE_RETRY_OPTIONS });
  });

  it('reads env overrides and clamps hostile values', () => {
    expect(resolveOracleRetryOptions({}, {
      EXCHANGE_RATE_ORACLE_RETRY_MAX_ATTEMPTS: '4',
      EXCHANGE_RATE_ORACLE_RETRY_BASE_DELAY_MS: '25',
      EXCHANGE_RATE_ORACLE_RETRY_MAX_DELAY_MS: '400',
    })).toEqual({ maxAttempts: 4, baseDelayMs: 25, maxDelayMs: 400 });

    const hostile = resolveOracleRetryOptions(
      { maxAttempts: 10_000, baseDelayMs: -5, maxDelayMs: 9e9 },
      {},
    );
    expect(hostile).toEqual({ maxAttempts: 6, baseDelayMs: 0, maxDelayMs: 10_000 });
  });

  it('keeps maxDelay at least baseDelay and at least one attempt', () => {
    const opts = resolveOracleRetryOptions({ maxAttempts: 0, baseDelayMs: 400, maxDelayMs: 10 }, {});
    expect(opts.maxAttempts).toBe(1);
    expect(opts.maxDelayMs).toBe(400);
  });
});

describe('computeOracleBackoffDelay', () => {
  const opts = { baseDelayMs: 100, maxDelayMs: 1000 };

  it('grows the ceiling exponentially and caps it', () => {
    const max = () => 0.999999;
    expect(computeOracleBackoffDelay(0, opts, max)).toBe(99);
    expect(computeOracleBackoffDelay(1, opts, max)).toBe(199);
    expect(computeOracleBackoffDelay(2, opts, max)).toBe(399);
    expect(computeOracleBackoffDelay(8, opts, max)).toBe(999);
  });

  it('can delay 0 under full jitter', () => {
    expect(computeOracleBackoffDelay(3, opts, () => 0)).toBe(0);
  });
});

describe('withOracleRetry', () => {
  it('returns the first success without retrying', async () => {
    const operation = vi.fn(async () => 'quote');
    await expect(withOracleRetry(operation, { sleep: noSleep, maxAttempts: 3 })).resolves.toBe('quote');
    expect(operation).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('retries a transient error then recovers', async () => {
    const before = await retryCount('scheduled');
    const operation = vi.fn()
      .mockRejectedValueOnce(errWith({ status: 503, message: 'unavailable' }))
      .mockResolvedValueOnce('quote');

    await expect(withOracleRetry(operation, { sleep: noSleep, random: () => 0, maxAttempts: 3 })).resolves.toBe('quote');
    expect(operation).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(await retryCount('scheduled')).toBe(before + 1);
    expect(await retryCount('recovered')).toBeGreaterThan(0);
  });

  it('does not retry a missing path', async () => {
    const operation = vi.fn(async () => {
      throw errWith({ name: 'NoPathFoundError', statusCode: 404, message: 'no path' });
    });
    await expect(withOracleRetry(operation, { sleep: noSleep, maxAttempts: 3 })).rejects.toThrow('no path');
    expect(operation).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('stops at the attempt ceiling and annotates the last error', async () => {
    const before = await retryCount('exhausted');
    const operation = vi.fn(async () => {
      throw errWith({ status: 502, message: 'bad gateway' });
    });
    await expect(withOracleRetry(operation, { sleep: noSleep, maxAttempts: 3 })).rejects.toMatchObject({
      message: 'bad gateway',
      retryAttempts: 3,
    });
    expect(operation).toHaveBeenCalledTimes(3);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(await retryCount('exhausted')).toBe(before + 1);
  });

  it('passes a 1-based attempt number to the operation', async () => {
    const seen = [];
    await withOracleRetry(
      async ({ attempt }) => {
        seen.push(attempt);
        if (attempt < 2) throw errWith({ code: 'ECONNRESET' });
        return 'ok';
      },
      { sleep: noSleep, maxAttempts: 3 },
    );
    expect(seen).toEqual([1, 2]);
  });
});
