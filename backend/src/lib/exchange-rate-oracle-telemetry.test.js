import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { logger } from './logger.js';
import { ExchangeRateCache } from './exchange-rate-cache.js';
import {
  ExchangeRateOracleHealthMonitor,
  classifyOracleLoadError,
  exchangeRateOracleLoadsTotal,
  exchangeRateOracleRegister,
  getExchangeRateOracleHealth,
  resetExchangeRateOracleHealth,
} from './exchange-rate-oracle-telemetry.js';

function make(overrides = {}) {
  let clock = 1_700_000_000_000;
  const monitor = new ExchangeRateOracleHealthMonitor(
    { windowMs: 60_000, bucketMs: 5_000, minSamples: 10, ...overrides },
    () => clock,
  );
  return {
    monitor,
    advance(ms) {
      clock += ms;
    },
  };
}

beforeEach(() => {
  resetExchangeRateOracleHealth();
  vi.clearAllMocks();
});

describe('classifyOracleLoadError', () => {
  it('treats load timeouts and gateway timeouts as timeout', () => {
    expect(classifyOracleLoadError({ name: 'CacheLoadTimeoutError', status: 504 })).toBe('timeout');
    expect(classifyOracleLoadError({ status: 504 })).toBe('timeout');
    expect(classifyOracleLoadError({ statusCode: 408 })).toBe('timeout');
  });

  it('treats a missing path as not_found, not an internal error', () => {
    expect(classifyOracleLoadError({ name: 'NoPathFoundError', statusCode: 404 })).toBe('not_found');
    expect(classifyOracleLoadError({ status: 404 })).toBe('not_found');
  });

  it('classifies everything else, including non-objects, as error', () => {
    expect(classifyOracleLoadError({ status: 502, message: 'down' })).toBe('error');
    expect(classifyOracleLoadError(null)).toBe('error');
    expect(classifyOracleLoadError('nope')).toBe('error');
  });
});

describe('ExchangeRateOracleHealthMonitor', () => {
  it('stays healthy with no traffic and below the sample floor', () => {
    const { monitor } = make();
    expect(monitor.snapshot().status).toBe('healthy');
    monitor.recordLoad('error');
    expect(monitor.snapshot()).toMatchObject({ status: 'healthy', loads: 1, errors: 1 });
  });

  it('goes unhealthy only on internal errors, not on not_found', () => {
    const failing = make().monitor;
    for (let i = 0; i < 10; i += 1) failing.recordLoad('error');
    expect(failing.snapshot()).toMatchObject({
      status: 'unhealthy',
      reasons: ['error_ratio_exceeded'],
    });

    const empty = make().monitor;
    for (let i = 0; i < 10; i += 1) empty.recordLoad('not_found');
    expect(empty.snapshot()).toMatchObject({ status: 'healthy', not_found: 10, error_ratio: 0 });
  });

  it('goes degraded on timeouts or stale lookups and keeps every reason', () => {
    const timeouts = make().monitor;
    for (let i = 0; i < 8; i += 1) timeouts.recordLoad('success');
    for (let i = 0; i < 2; i += 1) timeouts.recordLoad('timeout');
    expect(timeouts.snapshot()).toMatchObject({
      status: 'degraded',
      reasons: ['timeout_ratio_exceeded'],
    });

    const stale = make().monitor;
    for (let i = 0; i < 5; i += 1) stale.recordLookup('hit');
    for (let i = 0; i < 5; i += 1) stale.recordLookup('stale');
    expect(stale.snapshot()).toMatchObject({
      status: 'degraded',
      reasons: ['stale_ratio_exceeded'],
    });
  });

  it('lets unhealthy take precedence while still reporting degraded reasons', () => {
    const { monitor } = make();
    for (let i = 0; i < 10; i += 1) monitor.recordLoad('error');
    for (let i = 0; i < 10; i += 1) monitor.recordLookup('stale');
    const snap = monitor.snapshot();
    expect(snap.status).toBe('unhealthy');
    expect(snap.reasons).toEqual(['error_ratio_exceeded', 'stale_ratio_exceeded']);
  });

  it('forgets events that fall out of the window', () => {
    const { monitor, advance } = make();
    for (let i = 0; i < 10; i += 1) monitor.recordLoad('error');
    expect(monitor.snapshot().status).toBe('unhealthy');
    advance(61_000);
    const snap = monitor.snapshot();
    expect(snap).toMatchObject({ loads: 0, status: 'healthy' });
    expect(snap.last_load_at).not.toBeNull();
  });

  it('reuses a bucket slot without leaking the previous slot counts', () => {
    let clock = 0;
    const monitor = new ExchangeRateOracleHealthMonitor(
      { windowMs: 5_000, bucketMs: 5_000, minSamples: 1 },
      () => clock,
    );
    monitor.recordLoad('error');
    clock += 5_000;
    monitor.recordLoad('success');
    expect(monitor.snapshot()).toMatchObject({ loads: 1, success: 1, errors: 0 });
  });

  it('keeps a fixed bucket count under heavy load', () => {
    let clock = 0;
    const monitor = new ExchangeRateOracleHealthMonitor(
      { windowMs: 60_000, bucketMs: 5_000, minSamples: 20 },
      () => clock,
    );
    for (let i = 0; i < 20_000; i += 1) {
      clock += 7;
      monitor.recordLoad(i % 2 ? 'success' : 'error');
    }
    expect(monitor.buckets).toHaveLength(12);
    expect(monitor.snapshot().loads).toBeLessThanOrEqual(Math.ceil(60_000 / 7) + 1);
  });
});

describe('cache instrumentation', () => {
  it('records fresh hits, misses, stale lookups, successes, not-found and timeouts', async () => {
    vi.useFakeTimers();
    let snap;
    try {
      const cache = new ExchangeRateCache({ ttlMs: 100, staleToleranceMs: 500, maxEntries: 5 });
      cache.set('fresh', { rate: 1 });
      expect(cache.get('fresh').stale).toBe(false);

      vi.advanceTimersByTime(150);
      expect(cache.get('fresh').stale).toBe(true);
      expect(cache.get('missing').hit).toBe(false);

      await cache.getOrLoad('loaded', async () => ({ rate: 2 }));
      const notFound = Object.assign(new Error('no path'), { name: 'NoPathFoundError', statusCode: 404 });
      await expect(cache.getOrLoad('none', async () => { throw notFound; })).rejects.toThrow('no path');

      const pending = cache.getOrLoad('hung', () => new Promise(() => {}), { timeoutMs: 30 });
      const assertion = expect(pending).rejects.toMatchObject({ name: 'CacheLoadTimeoutError' });
      await vi.advanceTimersByTimeAsync(30);
      await assertion;
      snap = getExchangeRateOracleHealth();
    } finally {
      vi.useRealTimers();
    }
    expect(snap.hits).toBeGreaterThanOrEqual(1);
    expect(snap.stale).toBeGreaterThanOrEqual(1);
    expect(snap.misses).toBeGreaterThanOrEqual(1);
    expect(snap.success).toBe(1);
    expect(snap.not_found).toBe(1);
    expect(snap.timeouts).toBe(1);
    expect(snap.errors).toBe(0);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('does not let a telemetry failure replace the loader error', async () => {
    const cache = new ExchangeRateCache({ ttlMs: 1000 });
    const original = exchangeRateOracleLoadsTotal.inc;
    exchangeRateOracleLoadsTotal.inc = () => {
      throw new Error('metrics down');
    };
    try {
      await expect(cache.getOrLoad('k', async () => {
        throw Object.assign(new Error('horizon down'), { status: 503 });
      })).rejects.toThrow('horizon down');
    } finally {
      exchangeRateOracleLoadsTotal.inc = original;
    }
  });
});

describe('alert rules (issue #1443)', () => {
  it('only reference metrics that the oracle cache registry exposes', () => {
    const rules = readFileSync(
      new URL('../../docs/alerts/exchange-rate-oracle-cache.rules.yml', import.meta.url),
      'utf8',
    );
    const referenced = new Set(
      [...rules.matchAll(/\b(exchange_rate_oracle_cache_[a-z0-9_]+)/g)].map(([, name]) =>
        name.replace(/_(bucket|sum|count)$/, ''),
      ),
    );
    const registered = new Set(
      exchangeRateOracleRegister.getMetricsAsArray().map((metric) => metric.name),
    );
    expect(referenced.size).toBeGreaterThan(0);
    for (const name of referenced) {
      expect(registered, `alert rule references unknown metric ${name}`).toContain(name);
    }
  });
});
