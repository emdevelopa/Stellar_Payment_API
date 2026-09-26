/**
 * Exchange Rate Oracle Cache — HTTP integration (issue #1446).
 *
 * Drives GET /api/path-payment-quote/:id through the real Express app, the
 * real ExchangeRateCache / ExchangeRateCoordinator and the real service.
 * Only the external edges are mocked: Horizon (findStrictReceivePaths),
 * Supabase and Redis (in-memory fake).
 */
import request from 'supertest';
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';

vi.hoisted(() => {
  process.env.PATH_PAYMENT_QUOTE_RATE_LIMIT_MAX = '100000';
  // Wide enough that every request in a burst joins the load before it times out.
  process.env.EXCHANGE_RATE_LOAD_TIMEOUT_MS = '1000';
});

import { createApp } from '../../src/app.js';
import { closePool } from '../../src/lib/db.js';
import { findStrictReceivePaths } from '../../src/lib/stellar.js';
import { resetExchangeRateCache, generateRateCacheKey } from '../../src/lib/exchange-rate-cache.js';
import {
  configureExchangeRateCoordination,
  resetExchangeRateCoordination,
  invalidateExchangeRateQuote,
} from '../../src/services/exchangeRateService.js';
import { exchangeRateCacheCoalescedRequests } from '../../src/lib/path-payment-metrics.js';
import { createFakeRedis } from '../helpers/fake-redis.js';

const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const SOURCE_ACCOUNT = 'GA5XIGA5C7FBPTVQ3CWHKNC7D2ZBHB24G3KUJG5WZ6S4EYWSSBFVL45T';

const payments = vi.hoisted(() => new Map());

vi.mock('../../src/lib/stellar.js', () => ({
  findMatchingPayment: vi.fn(),
  findAnyRecentPayment: vi.fn(),
  findStrictReceivePaths: vi.fn(),
  getNetworkFeeStats: vi.fn(),
  isHorizonReachable: vi.fn(async () => true),
  isValidAssetCode: vi.fn((v) => typeof v === 'string' && /^[A-Z0-9]{1,12}$/.test(v.trim().toUpperCase())),
  isValidStellarAccountId: vi.fn((v) => typeof v === 'string' && /^G[A-Z2-7]{55}$/.test(v)),
  isValidStellarPublicKey: vi.fn((v) => typeof v === 'string' && /^G[A-Z2-7]{55}$/.test(v)),
  validateMemo: vi.fn(() => ({ valid: true })),
  verifyTransactionSignature: vi.fn(),
  withHorizonRetry: vi.fn(),
}));

vi.mock('../../src/lib/supabase.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({ limit: vi.fn(() => Promise.resolve({ data: [], error: null })) })),
    })),
  },
}));

vi.mock('../../src/lib/supabase-client.js', () => ({
  getSupabaseClient: vi.fn(async () => {
    const filters = {};
    const query = {
      select: () => query,
      eq: (col, val) => {
        filters[col] = val;
        return query;
      },
      is: () => query,
      maybeSingle: async () => ({ data: payments.get(filters.id) ?? null, error: null }),
    };
    return { from: () => query };
  }),
}));

const paymentId = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function seedPayment(n, amount) {
  payments.set(paymentId(n), {
    id: paymentId(n),
    amount,
    asset: 'USDC',
    asset_issuer: USDC_ISSUER,
    recipient: SOURCE_ACCOUNT,
    status: 'pending',
  });
}

const horizonPath = (destAmount) => ({
  source_asset_code: 'XLM',
  source_asset_issuer: null,
  source_amount: (Number(destAmount) * 0.5).toFixed(7),
  destination_amount: destAmount,
  path: [],
});

const quote = (app, n = 1) =>
  request(app)
    .get(`/api/path-payment-quote/${paymentId(n)}`)
    .query({ source_asset: 'XLM', source_account: SOURCE_ACCOUNT });

async function coalescedCount() {
  const { values } = await exchangeRateCacheCoalescedRequests.get();
  return values.reduce((sum, v) => sum + v.value, 0);
}

/**
 * Fire `n` identical requests and wait until all of them are attached to the
 * single in-flight load (1 leader + n-1 coalesced). supertest opens a
 * separate server per request, so arrival order is otherwise not guaranteed.
 */
async function burstJoined(app, horizon, n) {
  const before = await coalescedCount();
  const burst = Array.from({ length: n }, () => quote(app).then((r) => r));
  await vi.waitFor(async () => {
    expect(horizon.pending).toBe(1);
    expect((await coalescedCount()) - before).toBe(n - 1);
  }, { timeout: 5_000, interval: 10 });
  return burst;
}

/** Horizon stub whose responses are released manually. */
function gatedHorizon() {
  const gates = [];
  findStrictReceivePaths.mockImplementation(
    ({ destAmount }) =>
      new Promise((resolve, reject) =>
        gates.push({ resolve: (value = horizonPath(destAmount)) => resolve(value), reject }),
      ),
  );
  return {
    get pending() {
      return gates.length;
    },
    releaseAll(value) {
      gates.splice(0).forEach((g) => g.resolve(value));
    },
    failAll(err) {
      gates.splice(0).forEach((g) => g.reject(err));
    },
  };
}

describe('Exchange Rate Oracle Cache — HTTP integration', () => {
  let app;

  beforeAll(async () => {
    ({ app } = await createApp({ redisClient: null }));
  });

  beforeEach(() => {
    payments.clear();
    for (let i = 1; i <= 5; i++) seedPayment(i, `${i}.0000000`);
    resetExchangeRateCache();
    resetExchangeRateCoordination();
    findStrictReceivePaths.mockReset();
    findStrictReceivePaths.mockImplementation(async ({ destAmount }) => horizonPath(destAmount));
  });

  afterEach(() => {
    resetExchangeRateCoordination();
  });

  afterAll(async () => {
    await closePool().catch(() => {});
  });

  it('serves a quote and then serves it from cache', async () => {
    const first = await quote(app);
    const second = await quote(app);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ source_asset: 'XLM', source_amount: '0.5000000', send_max: '0.5050000' });
    expect(second.body).toEqual(first.body);
    expect(findStrictReceivePaths).toHaveBeenCalledTimes(1);
  });

  it('coalesces a burst of identical requests into one Horizon call', async () => {
    const horizon = gatedHorizon();
    const burst = await burstJoined(app, horizon, 40);
    horizon.releaseAll();
    const responses = await Promise.all(burst);

    expect(findStrictReceivePaths).toHaveBeenCalledTimes(1);
    expect(responses.every((r) => r.status === 200)).toBe(true);
    expect(new Set(responses.map((r) => r.body.send_max))).toEqual(new Set(['0.5050000']));
  });

  it('keeps distinct asset/amount pairs independent under concurrency', async () => {
    const responses = await Promise.all(
      [1, 2, 3, 4, 5, 1, 2, 3, 4, 5].map((n) => quote(app, n)),
    );
    expect(findStrictReceivePaths).toHaveBeenCalledTimes(5);
    for (const [i, res] of responses.entries()) {
      const n = (i % 5) + 1;
      expect(res.body.destination_amount).toBe(`${n}.0000000`);
      expect(res.body.source_amount).toBe((n * 0.5).toFixed(7));
    }
  });

  it('returns 404 to every coalesced caller when no path exists, then retries', async () => {
    const horizon = gatedHorizon();
    const burst = await burstJoined(app, horizon, 10);
    horizon.releaseAll(null); // Horizon found no path
    const responses = await Promise.all(burst);
    expect(responses.every((r) => r.status === 404)).toBe(true);
    expect(findStrictReceivePaths).toHaveBeenCalledTimes(1);

    findStrictReceivePaths.mockImplementation(async ({ destAmount }) => horizonPath(destAmount));
    expect((await quote(app)).status).toBe(200);
    expect(findStrictReceivePaths).toHaveBeenCalledTimes(2);
  });

  it('fails every waiter on a Horizon error without caching it', async () => {
    const horizon = gatedHorizon();
    const burst = await burstJoined(app, horizon, 10);
    horizon.failAll(Object.assign(new Error('Horizon 503'), { status: 502 }));
    const responses = await Promise.all(burst);
    expect(responses.every((r) => r.status === 502)).toBe(true);

    findStrictReceivePaths.mockImplementation(async ({ destAmount }) => horizonPath(destAmount));
    expect((await quote(app)).status).toBe(200);
  });

  it('returns 504 when Horizon hangs past the load timeout and recovers afterwards', async () => {
    findStrictReceivePaths.mockImplementation(() => new Promise(() => {}));
    const responses = await Promise.all(Array.from({ length: 5 }, () => quote(app)));
    expect(responses.every((r) => r.status === 504)).toBe(true);
    expect(findStrictReceivePaths).toHaveBeenCalledTimes(1);

    findStrictReceivePaths.mockImplementation(async ({ destAmount }) => horizonPath(destAmount));
    expect((await quote(app)).status).toBe(200);
  });

  it('does not let an invalidated in-flight quote repopulate the cache', async () => {
    const horizon = gatedHorizon();
    const inflight = quote(app).then((r) => r);
    await vi.waitFor(() => expect(horizon.pending).toBe(1));

    invalidateExchangeRateQuote('XLM', 'USDC', '1.0000000', null, USDC_ISSUER);
    horizon.releaseAll();
    expect((await inflight).status).toBe(200);

    findStrictReceivePaths.mockImplementation(async ({ destAmount }) => horizonPath(destAmount));
    await quote(app);
    expect(findStrictReceivePaths).toHaveBeenCalledTimes(2); // re-queried, not served stale
  });

  it('exposes concurrency metrics on /metrics', async () => {
    const horizon = gatedHorizon();
    const burst = await burstJoined(app, horizon, 5);
    horizon.releaseAll();
    await Promise.all(burst);

    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/exchange_rate_cache_coalesced_requests_total\{[^}]*\} [1-9]/);
    expect(res.text).toContain('exchange_rate_cache_inflight_loads');
    expect(res.text).toContain('exchange_rate_lock_acquisitions_total');
    expect(res.text).toContain('exchange_rate_coordination_fallbacks_total');
  });

  describe('with Redis coordination', () => {
    let redis;

    beforeEach(() => {
      redis = createFakeRedis({ latencyMs: 1 });
      expect(configureExchangeRateCoordination({ redisClient: redis, pollIntervalMs: 5 })).toBe(true);
    });

    it('publishes the quote and lets a cold instance reuse it without Horizon', async () => {
      const first = await quote(app);
      expect(first.status).toBe(200);
      const key = generateRateCacheKey('XLM', 'USDC', '1.0000000', null, USDC_ISSUER);
      expect(redis.store.has(`exrate:quote:${key}`)).toBe(true);
      expect(redis.store.has(`exrate:lock:${key}`)).toBe(false);

      resetExchangeRateCache(); // simulate a different instance's empty L1
      const second = await quote(app);
      expect(second.body).toEqual(first.body);
      expect(findStrictReceivePaths).toHaveBeenCalledTimes(1);
    });

    it('ignores a poisoned shared entry and serves a verified quote', async () => {
      const key = generateRateCacheKey('XLM', 'USDC', '1.0000000', null, USDC_ISSUER);
      redis.store.set(`exrate:quote:${key}`, {
        value: JSON.stringify({ v: 1, data: { sourceAsset: 'XLM', sourceAmount: '0.0000001', sendMax: '-1', path: [] } }),
        expiresAt: null,
      });
      const res = await quote(app);
      expect(res.status).toBe(200);
      expect(res.body.send_max).toBe('0.5050000');
      expect(findStrictReceivePaths).toHaveBeenCalledTimes(1);
    });

    it('keeps serving quotes while Redis is down', async () => {
      redis.setFailure(new Error('ECONNREFUSED'));
      const horizon = gatedHorizon();
      const burst = await burstJoined(app, horizon, 10);
      horizon.releaseAll();
      const responses = await Promise.all(burst);
      expect(responses.every((r) => r.status === 200)).toBe(true);
      expect(findStrictReceivePaths).toHaveBeenCalledTimes(1); // L1 single-flight still applies
    });
  });
});
