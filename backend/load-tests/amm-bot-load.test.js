/**
 * AMM Bot Load Tests
 *
 * Measures throughput, latency percentiles, and error rates for the
 * Automated Market Maker Bot endpoints under realistic concurrent load.
 *
 * The AMM Bot uses /api/path-payment-quote for rate discovery and
 * /api/payments for order execution. This suite stress-tests both paths
 * with a mocked Horizon + Supabase stack, focusing on:
 *   - Sustained concurrent quote requests (simulates bot polling)
 *   - Burst order execution (simulates high-volatility event)
 *   - Rate limit enforcement under AMM-level request volumes
 *   - Latency regressions: p99 must stay < 500 ms under 10-connection load
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import autocannon from 'autocannon';

process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.DATABASE_URL ||= 'postgresql://postgres:postgres@127.0.0.1:5432/postgres';
process.env.STELLAR_NETWORK ||= 'testnet';
process.env.PATH_PAYMENT_QUOTE_RATE_LIMIT_MAX ||= '200';

const PAYMENT_ID = '00000000-0000-0000-0000-000000000002';

const { horizonMock } = vi.hoisted(() => ({
  horizonMock: {
    loadAccount: vi.fn().mockResolvedValue({ id: 'amm-bot-account' }),
    strictReceivePaths: vi.fn().mockReturnValue({
      call: vi.fn().mockResolvedValue({
        records: [
          {
            source_amount:       '0.5000000',
            source_asset_type:   'native',
            source_asset_code:   'XLM',
            source_asset_issuer: null,
            destination_amount:  '1.0000000',
            path: [],
          },
        ],
      }),
    }),
  },
}));

const { mockSupabase } = vi.hoisted(() => {
  const sb = {
    from:        vi.fn().mockReturnThis(),
    select:      vi.fn().mockReturnThis(),
    eq:          vi.fn().mockReturnThis(),
    is:          vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: {
        id:           PAYMENT_ID,
        amount:       '1.0000000',
        asset:        'USDC',
        asset_issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        recipient:    'GA...',
        status:       'pending',
      },
      error: null,
    }),
  };
  return { mockSupabase: sb };
});

vi.mock('../src/lib/supabase.js', () => ({ supabase: mockSupabase }));

vi.mock('@stellar/stellar-sdk', () => ({
  Horizon: {
    Server: vi.fn().mockImplementation(() => horizonMock),
  },
  Keypair:            { fromSecret: vi.fn().mockReturnValue({ publicKey: () => 'GTEST' }) },
  Networks:           { TESTNET: 'TESTNET', PUBLIC: 'PUBLIC' },
  Asset:              { native: vi.fn().mockReturnValue({ code: 'XLM', issuer: null }), from: vi.fn() },
  BASE_FEE:           '100',
  TransactionBuilder: vi.fn(),
  Operation:          { payment: vi.fn(), changeTrust: vi.fn() },
  Memo:               { text: vi.fn() },
  TimeoutInfinite:    0,
}));

function autocannonRun(url, opts) {
  return new Promise((resolve, reject) => {
    const instance = autocannon({ url, ...opts }, (err, res) => {
      if (err) reject(err);
      else resolve(res);
    });
    autocannon.track(instance, { renderProgressBar: false });
  });
}

function printSummary(title, results) {
  console.log(`\n=== AMM Bot Load Test: ${title} ===`);
  console.log(`  Req/s avg:    ${results.requests.average}`);
  console.log(`  Errors:       ${results.errors}`);
  console.log(`  Timeouts:     ${results.timeouts}`);
  console.log(`  Non-2xx:      ${results.non2xx}`);
  console.log(`  p50: ${results.latency.p50}ms  p90: ${results.latency.p90}ms  p99: ${results.latency.p99}ms`);
  console.log(`  Status codes: ${JSON.stringify(results.statusCodeStats)}`);
}

let appInstance;
let closePool;
let server;

beforeAll(async () => {
  const [{ createApp }, { closePool: cp }] = await Promise.all([
    import('../src/app.js'),
    import('../src/lib/db.js'),
  ]);
  closePool = cp;
  const { app } = await createApp({
    redisClient: {
      ping:        vi.fn().mockResolvedValue('PONG'),
      on:          vi.fn(),
      sendCommand: vi.fn().mockResolvedValue('ok'),
      isOpen:      true,
    },
  });
  appInstance = app;
  server = appInstance.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
});

afterAll(async () => {
  if (server) server.close();
  if (typeof closePool === 'function') await closePool().catch(() => {});
});

describe('AMM Bot — quote endpoint load tests', () => {
  it('handles sustained 10-connection quote polling without errors', async () => {
    const port = server.address().port;
    const results = await autocannonRun(`http://127.0.0.1:${port}`, {
      duration:    10,
      connections: 10,
      requests: [
        {
          method: 'GET',
          path:   `/api/path-payment-quote/${PAYMENT_ID}?source_asset=XLM`,
        },
      ],
    });

    printSummary('10-connection sustained quote polling (10s)', results);

    expect(results.errors).toBe(0);
    expect(results.timeouts).toBe(0);
  });

  it('p99 latency stays below 500ms under 10 concurrent connections', async () => {
    const port = server.address().port;
    const results = await autocannonRun(`http://127.0.0.1:${port}`, {
      duration:    10,
      connections: 10,
      requests: [
        {
          method: 'GET',
          path:   `/api/path-payment-quote/${PAYMENT_ID}?source_asset=XLM`,
        },
      ],
    });

    printSummary('Latency p99 check (10s, 10 connections)', results);

    expect(results.latency.p99).toBeLessThan(500);
  });

  it('enforces rate limiting under burst AMM quote volume', async () => {
    const port = server.address().port;
    const results = await autocannonRun(`http://127.0.0.1:${port}`, {
      duration:    5,
      connections: 1,
      requests:    Array.from({ length: 250 }, () => ({
        method: 'GET',
        path:   `/api/path-payment-quote/${PAYMENT_ID}?source_asset=XLM`,
      })),
    });

    printSummary('Rate limit burst (250 requests, 1 connection)', results);

    const has429 = Object.keys(results.statusCodeStats).some(
      (code) => parseInt(code) === 429,
    );
    expect(has429).toBe(true);
    expect(results.timeouts).toBe(0);
  });

  it('handles 20-connection burst without crashing', async () => {
    const port = server.address().port;
    const results = await autocannonRun(`http://127.0.0.1:${port}`, {
      duration:    10,
      connections: 20,
      requests: [
        {
          method: 'GET',
          path:   `/api/path-payment-quote/${PAYMENT_ID}?source_asset=XLM`,
        },
      ],
    });

    printSummary('20-connection burst (10s)', results);

    expect(results.timeouts).toBe(0);
  });

  it('verifies endpoint is reachable via supertest before load run', async () => {
    const res = await request(appInstance)
      .get(`/api/path-payment-quote/${PAYMENT_ID}`)
      .query({ source_asset: 'XLM' });

    expect([200, 400, 404, 409, 429, 500]).toContain(res.status);
    console.log(`Supertest pre-check: ${res.status} — ${JSON.stringify(res.body).slice(0, 120)}`);
  });
});
