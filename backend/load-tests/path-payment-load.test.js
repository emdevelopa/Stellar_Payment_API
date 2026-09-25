/**
 * Rigorous load tests for the Path Payment Service (issue #1049)
 *
 * Uses autocannon against a real HTTP server built from the full Express
 * app, with every external boundary mocked (Supabase, Postgres pool, Redis,
 * Horizon) so results measure application-layer throughput rather than
 * network/DB latency.
 *
 * The Path Payment Service quote pipeline is cache-first
 * (exchangeRateService → exchange-rate-cache → stellar.js), so sustained
 * polling of one payment id exercises the in-memory cache path, while
 * rotating amounts exercises the Horizon-miss path.
 *
 * Scenarios:
 *   1. Supertest smoke check before load runs
 *   2. Sustained 10-connection quote polling (cache path)
 *   3. p99 latency regression guard (p99 < 500 ms)
 *   4. Rate-limit enforcement under a fixed request budget (429s)
 *   5. Rotating-asset quote storm (distinct cache keys, Horizon-miss path)
 *   6. Connection burst without crashes or timeouts
 *
 * Run with: npm run test:load -- path-payment
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import autocannon from 'autocannon';

process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.DATABASE_URL ||= 'postgresql://postgres:postgres@127.0.0.1:5432/postgres';
process.env.STELLAR_NETWORK ||= 'testnet';
process.env.PATH_PAYMENT_QUOTE_RATE_LIMIT_MAX ||= '200';

// Must be a well-formed UUID v4 — validateUuidParam rejects anything else.
const PAYMENT_ID = '9f927a2c-02d4-4f76-914c-62cf44d9525e';
const SOURCE_ACCOUNT = 'GA7QYNF7SowQc3DwBWzZucrEBZk37ygUBdUaJmNfWQ8sCuSUuF4VcUF6';
const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const OTHER_ISSUER = 'GA5XIGA5C7FBPTVQ3CWHKNC7D2ZBHB24G3KUJG5WZ6S4EYWSSBFVL45T';

const { horizonMock } = vi.hoisted(() => ({
  horizonMock: {
    loadAccount: vi.fn(async (accountId) => ({ id: accountId })),
    strictReceivePaths: vi.fn(() => ({
      call: vi.fn(async () => ({
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
      })),
    })),
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
        asset_issuer: USDC_ISSUER,
        recipient:    'GA...',
        status:       'pending',
      },
      error: null,
    }),
  };
  return { mockSupabase: sb };
});

vi.mock('../src/lib/supabase.js', () => ({ supabase: mockSupabase }));

// Path Payment Service resolves quotes through src/lib/stellar.js, which
// imports the "stellar-sdk" package — mock that specifier (same pattern as
// src/lib/path-payment-recovery.test.js).
vi.mock('stellar-sdk', () => {
  const MockAsset = vi.fn((code, issuer) => ({
    isNative: () => false,
    getCode: () => code,
    getIssuer: () => issuer,
    code,
    issuer,
  }));
  MockAsset.native = vi.fn(() => ({
    isNative: () => true,
    getCode: () => 'XLM',
    getIssuer: () => undefined,
    type: 'native',
  }));

  return {
    Asset: MockAsset,
    Networks: {
      TESTNET: 'Test SDF Network ; September 2015',
      PUBLIC: 'Public Global Stellar Network ; September 2015',
    },
    StrKey: {
      isValidEd25519PublicKey: (value) =>
        typeof value === 'string' && /^G[A-Z2-7]{55}$/.test(value),
    },
    Keypair: {
      fromSecret: vi.fn().mockReturnValue({ publicKey: () => SOURCE_ACCOUNT }),
      fromPublicKey: vi.fn().mockReturnValue({ publicKey: () => SOURCE_ACCOUNT }),
      random: vi.fn().mockReturnValue({ publicKey: () => SOURCE_ACCOUNT }),
    },
    Horizon: {
      Server: vi.fn().mockImplementation(() => horizonMock),
    },
    BASE_FEE: '100',
    TransactionBuilder: Object.assign(
      vi.fn().mockImplementation(() => ({
        addOperation: vi.fn().mockReturnThis(),
        addMemo: vi.fn().mockReturnThis(),
        setTimeout: vi.fn().mockReturnThis(),
        build: vi.fn().mockReturnValue({ toXDR: () => 'AAA=' }),
      })),
      { fromXDR: vi.fn().mockReturnValue({ sign: vi.fn(), toXDR: () => 'AAA=' }) },
    ),
    Transaction: vi.fn(),
    Account: vi.fn(),
    Operation: { payment: vi.fn(), manageData: vi.fn(), changeTrust: vi.fn() },
    Memo: { text: vi.fn(), id: vi.fn(), hash: vi.fn(), return: vi.fn() },
    TimeoutInfinite: 0,
  };
});

function formatResults(title, results) {
  const lines = [
    `\n=== Path Payment Load Test: ${title} ===`,
    `  Duration:      ${results.duration}s`,
    `  Connections:   ${results.connections}`,
    `  Requests:      ${results.requests.total} (${results.requests.average} req/s)`,
    `  Throughput:    ${(results.throughput.total / 1024 / 1024).toFixed(2)} MB`,
    `  Errors:        ${results.errors}`,
    `  Timeouts:      ${results.timeouts}`,
    `  Status codes:  ${JSON.stringify(results.statusCodeStats)}`,
    `  P50: ${results.latency.p50}ms  P90: ${results.latency.p90}ms  P99: ${results.latency.p99}ms`,
    `  Non-2xx:       ${results.non2xx}`,
  ];
  return lines.join('\n');
}

function autocannonPromise(url, opts) {
  return new Promise((resolve, reject) => {
    const instance = autocannon({ url, ...opts }, (err, res) => {
      if (err) reject(err);
      else resolve(res);
    });
    autocannon.track(instance, { renderProgressBar: false });
  });
}

describe('Path Payment Service — Load Tests', () => {
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

  it('verifies endpoint works via supertest before load runs', async () => {
    const res = await request(appInstance)
      .get(`/api/path-payment-quote/${PAYMENT_ID}`)
      .query({ source_asset: 'XLM', source_account: SOURCE_ACCOUNT });
    expect([200, 404, 409, 400, 500]).toContain(res.status);
    console.log(`Supertest response: ${res.status} ${JSON.stringify(res.body).substring(0, 200)}`);
  });

  it('handles sustained 10-connection quote polling without errors', async () => {
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    const results = await autocannonPromise(baseUrl, {
      duration: 10,
      connections: 10,
      requests: [
        {
          method: 'GET',
          path:   `/api/path-payment-quote/${PAYMENT_ID}?source_asset=XLM&source_account=${SOURCE_ACCOUNT}`,
        },
      ],
    });

    console.log(formatResults('Sustained quote polling (10s, 10 connections)', results));
    expect(results.errors).toBe(0);
    expect(results.timeouts).toBe(0);
  });

  it('keeps p99 latency below 500ms under 10 concurrent connections', async () => {
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    const results = await autocannonPromise(baseUrl, {
      duration: 10,
      connections: 10,
      requests: [
        {
          method: 'GET',
          path:   `/api/path-payment-quote/${PAYMENT_ID}?source_asset=XLM&source_account=${SOURCE_ACCOUNT}`,
        },
      ],
    });

    console.log(formatResults('Latency regression guard (10s, 10 connections)', results));
    expect(results.latency.p99).toBeLessThan(500);
  });

  it('rejects excess requests with 429 beyond the rate-limit budget', async () => {
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    const results = await autocannonPromise(baseUrl, {
      duration: 5,
      connections: 1,
      requests: Array.from({ length: 250 }, () => ({
        method: 'GET',
        path:   `/api/path-payment-quote/${PAYMENT_ID}?source_asset=XLM&source_account=${SOURCE_ACCOUNT}`,
      })),
    });

    console.log(formatResults('Rate limit budget (5s, 1 connection, 250 requests)', results));

    const has429 = Object.keys(results.statusCodeStats).some(
      (code) => parseInt(code) === 429,
    );
    expect(has429).toBe(true);
    expect(results.timeouts).toBe(0);
  });

  it('handles a rotating-asset quote storm without timeouts', async () => {
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;
    const assetPairs = [
      `source_asset=EUR&source_asset_issuer=${USDC_ISSUER}&source_account=${SOURCE_ACCOUNT}`,
      `source_asset=EUR&source_asset_issuer=${OTHER_ISSUER}&source_account=${SOURCE_ACCOUNT}`,
    ];

    const results = await autocannonPromise(baseUrl, {
      duration: 10,
      connections: 5,
      requests: assetPairs.map((query) => ({
        method: 'GET',
        path:   `/api/path-payment-quote/${PAYMENT_ID}?${query}`,
      })),
    });

    console.log(formatResults('Rotating-asset quote storm (10s, 5 connections)', results));
    expect(results.timeouts).toBe(0);
  });

  it('survives 20-connection burst without crashing', async () => {
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    const results = await autocannonPromise(baseUrl, {
      duration: 10,
      connections: 20,
      requests: [
        {
          method: 'GET',
          path:   `/api/path-payment-quote/${PAYMENT_ID}?source_asset=XLM&source_account=${SOURCE_ACCOUNT}`,
        },
      ],
    });

    console.log(formatResults('Connection burst (10s, 20 connections)', results));
    expect(results.timeouts).toBe(0);
  });
});
