/**
 * End-to-end tests for the Path Payment Service
 *
 * Drives the full HTTP stack (Express app → rate limit → UUID/zod validation →
 * route → Supabase → exchangeRateService → stellar.js → Horizon) with every
 * external boundary mocked so no real network or database is required.
 *
 * Coverage map:
 *   - Happy path ............ quote shape, send_max math, Horizon account validation
 *   - Validation ............ UUID, source asset code/issuer, source account
 *   - Payment guards ........ not found 404, not pending 409, same asset 400
 *   - Horizon failures ...... no path, account not found, malformed quote
 *   - Cache ................. second identical request served from cache
 *   - Rate limiting ......... burst traffic eventually 429s with Retry-After
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { resetExchangeRateCache } from '../../src/lib/exchange-rate-cache.js';

process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.DATABASE_URL ||= 'postgresql://postgres:postgres@127.0.0.1:5432/postgres';
process.env.STELLAR_NETWORK ||= 'testnet';
process.env.PATH_PAYMENT_QUOTE_RATE_LIMIT_MAX ||= '200';

// Must be a well-formed UUID v4 — validateUuidParam rejects anything else.
const PAYMENT_ID = '9f927a2c-02d4-4f76-914c-62cf44d9525e';
const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const OTHER_ISSUER = 'GA5XIGA5C7FBPTVQ3CWHKNC7D2ZBHB24G3KUJG5WZ6S4EYWSSBFVL45T';
const SOURCE_ACCOUNT = 'GA7QYNF7SowQc3DwBWzZucrEBZk37ygUBdUaJmNfWQ8sCuSUuF4VcUF6';

const PENDING_PAYMENT = {
  id:           PAYMENT_ID,
  amount:       '1.0000000',
  asset:        'USDC',
  asset_issuer: USDC_ISSUER,
  recipient:    'GA...',
  status:       'pending',
};

/** Horizon path record: 0.5 XLM buys 1 USDC. */
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
      asset_issuer: USDC_ISSUER,
    },
  ],
};

const state = vi.hoisted(() => ({
  paymentRow: null,
  loadAccountError: null,
  pathRecords: null,
}));

const horizonMock = {
  loadAccount: vi.fn(async (accountId) => {
    if (state.loadAccountError) throw state.loadAccountError;
    return { id: accountId };
  }),
  strictReceivePaths: vi.fn(() => ({
    call: vi.fn(async () => ({ records: state.pathRecords })),
  })),
};

const { mockSupabase } = vi.hoisted(() => {
  const sb = {
    from:        vi.fn().mockReturnThis(),
    select:      vi.fn().mockReturnThis(),
    eq:          vi.fn().mockReturnThis(),
    is:          vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(async () => ({ data: null, error: null })),
  };
  return { mockSupabase: sb };
});

vi.mock('../../src/lib/supabase.js', () => ({ supabase: mockSupabase }));

// Path Payment Service resolves quotes through src/lib/stellar.js, which
// imports the "stellar-sdk" package — mock that specifier (the same pattern
// used by src/lib/path-payment-recovery.test.js).
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
    Networks: { TESTNET: 'Test SDF Network ; September 2015', PUBLIC: 'Public Global Stellar Network ; September 2015' },
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
  state.paymentRow = { ...PENDING_PAYMENT };
  state.loadAccountError = null;
  state.pathRecords = [MOCK_PATH_RECORD];

  resetExchangeRateCache();
  vi.clearAllMocks();
  mockSupabase.from.mockReturnThis();
  mockSupabase.select.mockReturnThis();
  mockSupabase.eq.mockReturnThis();
  mockSupabase.is.mockReturnThis();
  mockSupabase.maybeSingle.mockImplementation(async () => ({
    data: state.paymentRow,
    error: null,
  }));
});

const quoteUrl = (id = PAYMENT_ID, query = { source_asset: 'XLM', source_account: SOURCE_ACCOUNT }) =>
  request(app).get(`/api/path-payment-quote/${id}`).query(query);

describe('Path Payment E2E · happy path', () => {
  it('returns 200 with the full quote shape for XLM → USDC', async () => {
    const res = await quoteUrl();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      source_asset:             'XLM',
      source_asset_issuer:      null,
      source_amount:            '0.5000000',
      send_max:                 '0.5050000', // 0.5 * 1.01 slippage
      destination_asset:        'USDC',
      destination_asset_issuer: USDC_ISSUER,
      destination_amount:       '1.0000000',
      path:                     [{ asset_code: 'USDC', asset_issuer: USDC_ISSUER }],
      slippage:                 0.01,
    });
  });

  it('validates the source account on Horizon when supplied', async () => {
    const res = await quoteUrl();

    expect(res.status).toBe(200);
    expect(horizonMock.loadAccount).toHaveBeenCalledWith(SOURCE_ACCOUNT);
  });
});

describe('Path Payment E2E · request validation', () => {
  it('returns 400 for a malformed payment id', async () => {
    const res = await quoteUrl('not-a-uuid');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/uuid/i);
  });

  it('returns 400 when source_asset is missing', async () => {
    const res = await request(app).get(`/api/path-payment-quote/${PAYMENT_ID}`);
    expect(res.status).toBe(400);
  });

  it('returns 400 when source_asset is an invalid asset code', async () => {
    const res = await quoteUrl(PAYMENT_ID, {
      source_asset:   'TOOLONGASSETCODE',
      source_account: SOURCE_ACCOUNT,
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when a non-native source asset has no issuer', async () => {
    const res = await quoteUrl(PAYMENT_ID, {
      source_asset:   'EUR',
      source_account: SOURCE_ACCOUNT,
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when XLM source asset carries an issuer', async () => {
    const res = await quoteUrl(PAYMENT_ID, {
      source_asset:        'XLM',
      source_asset_issuer: USDC_ISSUER,
      source_account:      SOURCE_ACCOUNT,
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when source_account is not a valid Stellar account id', async () => {
    const res = await quoteUrl(PAYMENT_ID, {
      source_asset:   'XLM',
      source_account: 'not-a-stellar-account',
    });
    expect(res.status).toBe(400);
  });
});

describe('Path Payment E2E · payment guards', () => {
  it('returns 404 when the payment does not exist', async () => {
    state.paymentRow = null;
    const res = await quoteUrl();
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Payment not found');
  });

  it('returns 500 when the payment lookup errors', async () => {
    mockSupabase.maybeSingle.mockImplementation(async () => ({
      data: null,
      error: { message: 'db down' },
    }));
    const res = await quoteUrl();
    expect(res.status).toBe(500);
  });

  it('returns 409 when the payment is not pending', async () => {
    state.paymentRow = { ...PENDING_PAYMENT, status: 'completed' };
    const res = await quoteUrl();
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/only available for pending payments/i);
    expect(res.body.status).toBe('completed');
  });

  it('returns 400 when the source asset is the destination asset', async () => {
    const res = await quoteUrl(PAYMENT_ID, {
      source_asset:        'USDC',
      source_asset_issuer: USDC_ISSUER,
      source_account:      SOURCE_ACCOUNT,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/same as destination asset/i);
  });

  it('treats the same asset code with a different issuer as a valid pair', async () => {
    const res = await quoteUrl(PAYMENT_ID, {
      source_asset:        'USDC',
      source_asset_issuer: OTHER_ISSUER,
      source_account:      SOURCE_ACCOUNT,
    });
    expect(res.status).toBe(200);
  });
});

describe('Path Payment E2E · Horizon failures', () => {
  it('returns 404 when Horizon finds no path', async () => {
    state.pathRecords = [];
    const res = await quoteUrl();
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/no path found/i);
  });

  it('returns 404 when the source account does not exist on Horizon', async () => {
    state.loadAccountError = Object.assign(new Error('Account not found'), {
      response: { status: 404 },
    });
    const res = await quoteUrl();
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('returns 502 when Horizon returns a malformed quote', async () => {
    state.pathRecords = [
      { ...MOCK_PATH_RECORD, source_amount: 'not-a-number' },
    ];
    const res = await quoteUrl();
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/invalid path payment quote/i);
  });
});

describe('Path Payment E2E · cache behaviour', () => {
  it('serves identical requests from cache without hitting Horizon again', async () => {
    await quoteUrl();
    const callsAfterFirst = horizonMock.strictReceivePaths.mock.calls.length;

    const second = await quoteUrl();

    expect(second.status).toBe(200);
    expect(horizonMock.strictReceivePaths.mock.calls.length).toBe(callsAfterFirst);
  });

  it('does not share cached quotes between different asset pairs', async () => {
    await quoteUrl();
    await quoteUrl(PAYMENT_ID, {
      source_asset:        'EUR',
      source_asset_issuer: OTHER_ISSUER,
      source_account:      SOURCE_ACCOUNT,
    });
    expect(horizonMock.strictReceivePaths.mock.calls.length).toBe(2);
  });
});

describe('Path Payment E2E · rate limiting', () => {
  it('returns 429 with Retry-After once the budget is exhausted', async () => {
    const responses = await Promise.all(
      Array.from({ length: 250 }, () =>
        request(app)
          .get(`/api/path-payment-quote/${PAYMENT_ID}`)
          .query({ source_asset: 'XLM' }),
      ),
    );
    const limited = responses.find((r) => r.status === 429);
    expect(limited).toBeDefined();
    expect(limited.body.error).toMatch(/too many path payment quote requests/i);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  });
});
