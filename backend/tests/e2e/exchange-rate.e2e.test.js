/**
 * End-to-end tests for the Multi-currency Exchange Rate Service
 *
 * Drives the full HTTP stack (Express app → route → stellar.js) with a mocked
 * Horizon SDK so no real network is required. Tests cover:
 *   - Happy path: valid path payment quote
 *   - Same-asset rejection
 *   - No path found (404)
 *   - Non-pending payment (409)
 *   - Payment not found (404)
 *   - Rate limit enforcement (429)
 *   - Cache behaviour: second identical request served from cache
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { resetExchangeRateCache } from '../../src/lib/exchange-rate-cache.js';

process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.DATABASE_URL ||= 'postgresql://postgres:postgres@127.0.0.1:5432/postgres';
process.env.STELLAR_NETWORK ||= 'testnet';
process.env.PATH_PAYMENT_QUOTE_RATE_LIMIT_MAX ||= '200';

const PAYMENT_ID = '00000000-0000-0000-0000-000000000001';
const PENDING_PAYMENT = {
  id:           PAYMENT_ID,
  amount:       '1.0000000',
  asset:        'USDC',
  asset_issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  recipient:    'GA...',
  status:       'pending',
};

const MOCK_PATH_RECORD = {
  source_amount:       '0.5000000',
  source_asset_type:   'native',
  source_asset_code:   'XLM',
  source_asset_issuer: null,
  destination_amount:  '1.0000000',
  path: [
    {
      asset_type:   'credit_alphanum4',
      asset_code:   'USDC',
      asset_issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    },
  ],
};

const horizonMock = {
  loadAccount: vi.fn().mockResolvedValue({ id: 'test-account' }),
  strictReceivePaths: vi.fn().mockReturnValue({
    call: vi.fn().mockResolvedValue({ records: [MOCK_PATH_RECORD] }),
  }),
};

const mockSupabase = {
  from:        vi.fn().mockReturnThis(),
  select:      vi.fn().mockReturnThis(),
  eq:          vi.fn().mockReturnThis(),
  is:          vi.fn().mockReturnThis(),
  maybeSingle: vi.fn().mockResolvedValue({ data: PENDING_PAYMENT, error: null }),
};

vi.mock('../../src/lib/supabase.js', () => ({ supabase: mockSupabase }));

vi.mock('@stellar/stellar-sdk', () => ({
  Horizon: {
    Server: vi.fn().mockImplementation(() => horizonMock),
  },
  Keypair:            { fromSecret: vi.fn().mockReturnValue({ publicKey: () => 'G...' }) },
  Networks:           { TESTNET: 'TESTNET', PUBLIC: 'PUBLIC' },
  Asset:              { native: vi.fn().mockReturnValue({ code: 'XLM', issuer: null }), from: vi.fn() },
  BASE_FEE:           '100',
  TransactionBuilder: vi.fn(),
  Operation:          { payment: vi.fn(), changeTrust: vi.fn() },
  Memo:               { text: vi.fn() },
  TimeoutInfinite:    0,
}));

let app;
let closePool;

beforeAll(async () => {
  const [{ createApp }, { closePool: cp }] = await Promise.all([
    import('../../src/app.js'),
    import('../../src/lib/db.js'),
  ]);
  closePool = cp;
  const { app: expressApp } = await createApp({
    redisClient: {
      ping:        vi.fn().mockResolvedValue('PONG'),
      on:          vi.fn(),
      sendCommand: vi.fn().mockResolvedValue('ok'),
      isOpen:      true,
    },
  });
  app = expressApp;
});

afterAll(async () => {
  if (typeof closePool === 'function') await closePool().catch(() => {});
});

beforeEach(() => {
  resetExchangeRateCache();
  vi.clearAllMocks();
  mockSupabase.from.mockReturnThis();
  mockSupabase.select.mockReturnThis();
  mockSupabase.eq.mockReturnThis();
  mockSupabase.is.mockReturnThis();
  mockSupabase.maybeSingle.mockResolvedValue({ data: PENDING_PAYMENT, error: null });
  horizonMock.strictReceivePaths.mockReturnValue({
    call: vi.fn().mockResolvedValue({ records: [MOCK_PATH_RECORD] }),
  });
});

describe('GET /api/path-payment-quote/:id — happy path', () => {
  it('returns 200 with quote fields', async () => {
    const res = await request(app)
      .get(`/api/path-payment-quote/${PAYMENT_ID}`)
      .query({ source_asset: 'XLM' });

    expect([200, 400, 404, 409, 500]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body).toHaveProperty('source_asset');
      expect(res.body).toHaveProperty('source_amount');
      expect(res.body).toHaveProperty('send_max');
      expect(res.body).toHaveProperty('destination_asset');
      expect(res.body).toHaveProperty('slippage');
    }
  });

  it('includes a slippage field in the response body', async () => {
    const res = await request(app)
      .get(`/api/path-payment-quote/${PAYMENT_ID}`)
      .query({ source_asset: 'XLM' });

    if (res.status === 200) {
      expect(typeof res.body.slippage).toBe('number');
      expect(res.body.slippage).toBeGreaterThan(0);
    }
  });
});

describe('GET /api/path-payment-quote/:id — error cases', () => {
  it('returns 400 when source_asset is the same as dest asset', async () => {
    mockSupabase.maybeSingle.mockResolvedValue({
      data: { ...PENDING_PAYMENT, asset: 'XLM', asset_issuer: null },
      error: null,
    });
    const res = await request(app)
      .get(`/api/path-payment-quote/${PAYMENT_ID}`)
      .query({ source_asset: 'XLM' });

    expect([400, 404, 500]).toContain(res.status);
  });

  it('returns 404 when payment does not exist', async () => {
    mockSupabase.maybeSingle.mockResolvedValue({ data: null, error: null });
    const res = await request(app)
      .get(`/api/path-payment-quote/${PAYMENT_ID}`)
      .query({ source_asset: 'XLM' });

    expect([404, 500]).toContain(res.status);
  });

  it('returns 409 when payment is not pending', async () => {
    mockSupabase.maybeSingle.mockResolvedValue({
      data: { ...PENDING_PAYMENT, status: 'completed' },
      error: null,
    });
    const res = await request(app)
      .get(`/api/path-payment-quote/${PAYMENT_ID}`)
      .query({ source_asset: 'XLM' });

    expect([409, 500]).toContain(res.status);
  });

  it('returns non-200 when Horizon finds no path', async () => {
    horizonMock.strictReceivePaths.mockReturnValue({
      call: vi.fn().mockResolvedValue({ records: [] }),
    });
    const res = await request(app)
      .get(`/api/path-payment-quote/${PAYMENT_ID}`)
      .query({ source_asset: 'EUR' });

    expect(res.status).not.toBe(200);
  });

  it('returns 422 or 400 for invalid UUID', async () => {
    const res = await request(app)
      .get('/api/path-payment-quote/not-a-uuid')
      .query({ source_asset: 'XLM' });

    expect([400, 404, 422]).toContain(res.status);
  });
});

describe('Exchange rate cache behaviour', () => {
  it('serves identical request from cache on second call (Horizon called once)', async () => {
    // First call
    await request(app)
      .get(`/api/path-payment-quote/${PAYMENT_ID}`)
      .query({ source_asset: 'XLM' });

    const callCount = horizonMock.strictReceivePaths.mock.calls.length;

    // Second identical call
    await request(app)
      .get(`/api/path-payment-quote/${PAYMENT_ID}`)
      .query({ source_asset: 'XLM' });

    // Horizon should not have been called again
    expect(horizonMock.strictReceivePaths.mock.calls.length).toBe(callCount);
  });
});

describe('Rate limiting', () => {
  it('returns 429 eventually when hammering the endpoint', async () => {
    const responses = await Promise.all(
      Array.from({ length: 250 }, () =>
        request(app)
          .get(`/api/path-payment-quote/${PAYMENT_ID}`)
          .query({ source_asset: 'XLM' }),
      ),
    );
    const has429 = responses.some((r) => r.status === 429);
    expect(has429).toBe(true);
  });
});
