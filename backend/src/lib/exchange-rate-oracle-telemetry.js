/**
 * Exchange Rate Oracle Cache telemetry (issue #1443).
 *
 * Prometheus series and a rolling-window health snapshot for the in-process
 * quote cache (exchange-rate-cache.js). Label values are a fixed server-side
 * set — never asset codes, issuers, or amounts — so quote traffic cannot
 * inflate cardinality.
 *
 * The metrics live in their own registry so they can be tested in isolation.
 * /metrics merges this registry with the others.
 */

import client from 'prom-client';
import { logger } from './logger.js';

const register = new client.Registry();

register.setDefaultLabels({
  app: 'stellar-payment-api',
});

/** result: hit | miss | stale */
export const exchangeRateOracleLookupsTotal = new client.Counter({
  name: 'exchange_rate_oracle_cache_lookups_total',
  help: 'Exchange-rate oracle cache lookups, by result',
  labelNames: ['result'],
});

/**
 * outcome: success | error | timeout | not_found
 * not_found is a normal "no path" result and is not an internal error.
 */
export const exchangeRateOracleLoadsTotal = new client.Counter({
  name: 'exchange_rate_oracle_cache_loads_total',
  help: 'Exchange-rate oracle cache loads that called the upstream quote source, by outcome',
  labelNames: ['outcome'],
});

export const exchangeRateOracleLoadDuration = new client.Histogram({
  name: 'exchange_rate_oracle_cache_load_duration_seconds',
  help: 'Wall time of an exchange-rate oracle cache load, including upstream time',
  labelNames: ['outcome'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 15],
});

/**
 * Rolling-window gauges. Refreshed at scrape time so they decay when idle.
 * health_state: 0 = healthy, 1 = degraded, 2 = unhealthy
 */
export const exchangeRateOracleHealthState = new client.Gauge({
  name: 'exchange_rate_oracle_cache_health_state',
  help: 'Exchange-rate oracle cache health (0 = healthy, 1 = degraded, 2 = unhealthy)',
});

export const exchangeRateOracleErrorRatio = new client.Gauge({
  name: 'exchange_rate_oracle_cache_error_ratio',
  help: 'Share of oracle cache loads that failed with an internal error over the rolling window',
});

export const exchangeRateOracleTimeoutRatio = new client.Gauge({
  name: 'exchange_rate_oracle_cache_timeout_ratio',
  help: 'Share of oracle cache loads that timed out over the rolling window',
});

export const exchangeRateOracleStaleRatio = new client.Gauge({
  name: 'exchange_rate_oracle_cache_stale_ratio',
  help: 'Share of oracle cache lookups that found a stale-but-tolerable entry over the rolling window',
});

export const exchangeRateOracleLastLoadTimestamp = new client.Gauge({
  name: 'exchange_rate_oracle_cache_last_load_timestamp_seconds',
  help: 'Unix time of the most recent exchange-rate oracle cache load',
});

/** result: scheduled | recovered | exhausted (issue #1444) */
export const exchangeRateOracleRetriesTotal = new client.Counter({
  name: 'exchange_rate_oracle_cache_retries_total',
  help: 'Exchange-rate oracle fetch retries with exponential backoff, by result',
  labelNames: ['result'],
});

const LOOKUP_RESULTS = new Set(['hit', 'miss', 'stale']);
const LOAD_OUTCOMES = new Set(['success', 'error', 'timeout', 'not_found']);
const RETRY_RESULTS = new Set(['scheduled', 'recovered', 'exhausted']);

export const HEALTH_STATE_VALUES = Object.freeze({ healthy: 0, degraded: 1, unhealthy: 2 });

function readNumberEnv(name, fallback) {
  const raw = Number.parseFloat(process.env[name] ?? '');
  return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
}

export const DEFAULT_HEALTH_OPTIONS = Object.freeze({
  windowMs: readNumberEnv('EXCHANGE_RATE_ORACLE_HEALTH_WINDOW_MS', 300_000),
  bucketMs: 5_000,
  minSamples: readNumberEnv('EXCHANGE_RATE_ORACLE_HEALTH_MIN_SAMPLES', 20),
  errorRatioThreshold: readNumberEnv('EXCHANGE_RATE_ORACLE_ERROR_RATIO_THRESHOLD', 0.05),
  timeoutRatioThreshold: readNumberEnv('EXCHANGE_RATE_ORACLE_TIMEOUT_RATIO_THRESHOLD', 0.2),
  staleRatioThreshold: readNumberEnv('EXCHANGE_RATE_ORACLE_STALE_RATIO_THRESHOLD', 0.5),
});

function emptyBucket() {
  return {
    slot: -1,
    hits: 0,
    misses: 0,
    stale: 0,
    success: 0,
    errors: 0,
    timeouts: 0,
    notFound: 0,
  };
}

/**
 * Rolling-window health tracker. Counts live in a fixed ring of time buckets
 * so memory stays constant regardless of traffic.
 */
export class ExchangeRateOracleHealthMonitor {
  constructor(options = {}, now = () => Date.now()) {
    this.options = { ...DEFAULT_HEALTH_OPTIONS, ...options };
    this.now = now;
    this.bucketCount = Math.max(1, Math.ceil(this.options.windowMs / this.options.bucketMs));
    this.reset();
  }

  reset() {
    this.buckets = Array.from({ length: this.bucketCount }, () => emptyBucket());
    this.lastLoadAt = null;
  }

  _bucketFor(time) {
    const slot = Math.floor(time / this.options.bucketMs);
    const bucket = this.buckets[slot % this.bucketCount];
    if (bucket.slot !== slot) {
      Object.assign(bucket, emptyBucket(), { slot });
    }
    return bucket;
  }

  /** @param {'hit'|'miss'|'stale'} result */
  recordLookup(result) {
    const bucket = this._bucketFor(this.now());
    if (result === 'hit') bucket.hits += 1;
    else if (result === 'stale') bucket.stale += 1;
    else bucket.misses += 1;
  }

  /** @param {'success'|'error'|'timeout'|'not_found'} outcome */
  recordLoad(outcome) {
    const time = this.now();
    const bucket = this._bucketFor(time);
    if (outcome === 'success') bucket.success += 1;
    else if (outcome === 'timeout') bucket.timeouts += 1;
    else if (outcome === 'not_found') bucket.notFound += 1;
    else bucket.errors += 1;
    this.lastLoadAt = time;
  }

  snapshot() {
    const time = this.now();
    const currentSlot = Math.floor(time / this.options.bucketMs);
    const oldestSlot = currentSlot - this.bucketCount + 1;
    const counts = {
      hits: 0,
      misses: 0,
      stale: 0,
      success: 0,
      errors: 0,
      timeouts: 0,
      notFound: 0,
    };

    for (const bucket of this.buckets) {
      if (bucket.slot < oldestSlot || bucket.slot > currentSlot) continue;
      counts.hits += bucket.hits;
      counts.misses += bucket.misses;
      counts.stale += bucket.stale;
      counts.success += bucket.success;
      counts.errors += bucket.errors;
      counts.timeouts += bucket.timeouts;
      counts.notFound += bucket.notFound;
    }

    const loads = counts.success + counts.errors + counts.timeouts + counts.notFound;
    const lookups = counts.hits + counts.misses + counts.stale;
    const errorRatio = loads > 0 ? counts.errors / loads : 0;
    const timeoutRatio = loads > 0 ? counts.timeouts / loads : 0;
    const staleRatio = lookups > 0 ? counts.stale / lookups : 0;
    const { minSamples, errorRatioThreshold, timeoutRatioThreshold, staleRatioThreshold } =
      this.options;

    const reasons = [];
    let status = 'healthy';
    if (loads >= minSamples && errorRatio >= errorRatioThreshold) {
      status = 'unhealthy';
      reasons.push('error_ratio_exceeded');
    }
    if (loads >= minSamples && timeoutRatio >= timeoutRatioThreshold) {
      if (status === 'healthy') status = 'degraded';
      reasons.push('timeout_ratio_exceeded');
    }
    if (lookups >= minSamples && staleRatio >= staleRatioThreshold) {
      if (status === 'healthy') status = 'degraded';
      reasons.push('stale_ratio_exceeded');
    }

    return {
      status,
      reasons,
      window_ms: this.bucketCount * this.options.bucketMs,
      loads,
      success: counts.success,
      errors: counts.errors,
      timeouts: counts.timeouts,
      not_found: counts.notFound,
      lookups,
      hits: counts.hits,
      misses: counts.misses,
      stale: counts.stale,
      error_ratio: Number(errorRatio.toFixed(4)),
      timeout_ratio: Number(timeoutRatio.toFixed(4)),
      stale_ratio: Number(staleRatio.toFixed(4)),
      last_load_at: this.lastLoadAt === null ? null : new Date(this.lastLoadAt).toISOString(),
      thresholds: {
        min_samples: minSamples,
        error_ratio: errorRatioThreshold,
        timeout_ratio: timeoutRatioThreshold,
        stale_ratio: staleRatioThreshold,
      },
    };
  }
}

const healthMonitor = new ExchangeRateOracleHealthMonitor();

exchangeRateOracleHealthState.collect = function collectOracleHealth() {
  const snap = healthMonitor.snapshot();
  this.set(HEALTH_STATE_VALUES[snap.status] ?? 0);
  exchangeRateOracleErrorRatio.set(snap.error_ratio);
  exchangeRateOracleTimeoutRatio.set(snap.timeout_ratio);
  exchangeRateOracleStaleRatio.set(snap.stale_ratio);
  if (healthMonitor.lastLoadAt !== null) {
    exchangeRateOracleLastLoadTimestamp.set(healthMonitor.lastLoadAt / 1000);
  }
};

/** Current cache health, for /health endpoints. No quote or account data. */
export function getExchangeRateOracleHealth() {
  return healthMonitor.snapshot();
}

/** Test-only: clear the rolling health window. Counters are left intact. */
export function resetExchangeRateOracleHealth() {
  healthMonitor.reset();
}

function safeRecord(fn) {
  try {
    fn();
  } catch (err) {
    logger.error({ err: err?.message }, 'Failed to record exchange-rate oracle telemetry');
  }
}

/**
 * Classify a failed load without reading caller-controlled strings into labels.
 * @param {unknown} err
 * @returns {'timeout'|'not_found'|'error'}
 */
export function classifyOracleLoadError(err) {
  if (!err || typeof err !== 'object') return 'error';
  if (err.name === 'CacheLoadTimeoutError') return 'timeout';
  const status = err.status ?? err.statusCode ?? err.response?.status ?? null;
  if (status === 504 || status === 408) return 'timeout';
  if (status === 404 || err.name === 'NoPathFoundError') return 'not_found';
  return 'error';
}

/** @param {'hit'|'miss'|'stale'} result */
export function recordOracleLookup(result) {
  const safe = LOOKUP_RESULTS.has(result) ? result : 'miss';
  safeRecord(() => {
    exchangeRateOracleLookupsTotal.inc({ result: safe });
    healthMonitor.recordLookup(safe);
  });
}

/**
 * @param {'success'|'error'|'timeout'|'not_found'} outcome
 * @param {number} durationMs
 * @param {unknown} [err]
 */
export function recordOracleLoad(outcome, durationMs, err) {
  const safeOutcome = LOAD_OUTCOMES.has(outcome) ? outcome : 'error';
  const ms = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
  safeRecord(() => {
    exchangeRateOracleLoadsTotal.inc({ outcome: safeOutcome });
    exchangeRateOracleLoadDuration.observe({ outcome: safeOutcome }, ms / 1000);
    healthMonitor.recordLoad(safeOutcome);
  });
  if (safeOutcome === 'error' || safeOutcome === 'timeout') {
    logger.warn(
      {
        outcome: safeOutcome,
        durationMs: ms,
        err: err && typeof err === 'object' ? err.message : undefined,
        code: err && typeof err === 'object' ? err.code : undefined,
        status: err && typeof err === 'object' ? (err.status ?? err.statusCode) : undefined,
      },
      'Exchange rate oracle cache load failed',
    );
  }
}

register.registerMetric(exchangeRateOracleLookupsTotal);
register.registerMetric(exchangeRateOracleLoadsTotal);
register.registerMetric(exchangeRateOracleLoadDuration);
register.registerMetric(exchangeRateOracleHealthState);
register.registerMetric(exchangeRateOracleErrorRatio);
register.registerMetric(exchangeRateOracleTimeoutRatio);
register.registerMetric(exchangeRateOracleStaleRatio);
register.registerMetric(exchangeRateOracleLastLoadTimestamp);
register.registerMetric(exchangeRateOracleRetriesTotal);

/** @param {'scheduled'|'recovered'|'exhausted'} result */
export function recordOracleRetry(result) {
  const safe = RETRY_RESULTS.has(result) ? result : 'exhausted';
  safeRecord(() => {
    exchangeRateOracleRetriesTotal.inc({ result: safe });
  });
}

export { register as exchangeRateOracleRegister };
