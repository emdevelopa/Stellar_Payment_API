import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getExchangeRateQuote,
  invalidateExchangeRateQuote,
  configureExchangeRateCoordination,
  resetExchangeRateCoordination,
  NoPathFoundError,
  ExchangeRateError,
} from './exchangeRateService.js';
import { resetExchangeRateCache, generateRateCacheKey } from '../lib/exchange-rate-cache.js';
import { createFakeRedis } from '../../tests/helpers/fake-redis.js';

vi.mock('../lib/stellar.js', () => ({
  findStrictReceivePaths: vi.fn(),
}));

vi.mock('../lib/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { findStrictReceivePaths } from '../lib/stellar.js';

const MOCK_PATH = {
  source_asset_code:   'XLM',
  source_asset_issuer: null,
  source_amount:       '0.5000000',
  destination_amount:  '1.0000000',
  path: [
    { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5' },
  ],
};

describe('getExchangeRateQuote', () => {
  beforeEach(() => {
    resetExchangeRateCache();
    vi.clearAllMocks();
    findStrictReceivePaths.mockResolvedValue(MOCK_PATH);
  });

  afterEach(() => {
    resetExchangeRateCache();
  });

  it('returns a quote with correct fields', async () => {
    const quote = await getExchangeRateQuote({
      sourceAssetCode: 'XLM',
      destAssetCode:   'USDC',
      destAmount:      '1.0000000',
    });

    expect(quote.sourceAsset).toBe('XLM');
    expect(quote.destinationAsset).toBe('USDC');
    expect(quote.sourceAmount).toBe('0.5000000');
    expect(quote.slippage).toBeCloseTo(0.01);
    expect(quote.sendMax).toBe('0.5050000');
    expect(quote.cached).toBe(false);
  });

  it('calls findStrictReceivePaths exactly once on first call', async () => {
    await getExchangeRateQuote({ sourceAssetCode: 'XLM', destAssetCode: 'USDC', destAmount: '1.0' });
    expect(findStrictReceivePaths).toHaveBeenCalledTimes(1);
  });

  it('returns cached result on second identical call without hitting Horizon', async () => {
    await getExchangeRateQuote({ sourceAssetCode: 'XLM', destAssetCode: 'USDC', destAmount: '1.0' });
    const second = await getExchangeRateQuote({ sourceAssetCode: 'XLM', destAssetCode: 'USDC', destAmount: '1.0' });
    expect(findStrictReceivePaths).toHaveBeenCalledTimes(1);
    expect(second.cached).toBe(true);
  });

  it('does not share cache between different dest amounts', async () => {
    await getExchangeRateQuote({ sourceAssetCode: 'XLM', destAssetCode: 'USDC', destAmount: '1.0' });
    await getExchangeRateQuote({ sourceAssetCode: 'XLM', destAssetCode: 'USDC', destAmount: '2.0' });
    expect(findStrictReceivePaths).toHaveBeenCalledTimes(2);
  });

  it('does not share cache between different asset pairs', async () => {
    await getExchangeRateQuote({ sourceAssetCode: 'XLM', destAssetCode: 'USDC', destAmount: '1.0' });
    await getExchangeRateQuote({ sourceAssetCode: 'BTC', destAssetCode: 'USDC', destAmount: '1.0' });
    expect(findStrictReceivePaths).toHaveBeenCalledTimes(2);
  });

  it('throws NoPathFoundError when Horizon returns null', async () => {
    findStrictReceivePaths.mockResolvedValue(null);
    await expect(
      getExchangeRateQuote({ sourceAssetCode: 'XLM', destAssetCode: 'USDC', destAmount: '1.0' }),
    ).rejects.toThrow(NoPathFoundError);
  });

  it('NoPathFoundError has statusCode 404', async () => {
    findStrictReceivePaths.mockResolvedValue(null);
    try {
      await getExchangeRateQuote({ sourceAssetCode: 'XLM', destAssetCode: 'USDC', destAmount: '1.0' });
    } catch (err) {
      expect(err.statusCode).toBe(404);
    }
  });

  it('propagates Horizon errors as-is', async () => {
    const horizonErr = new Error('Horizon unavailable');
    horizonErr.status = 503;
    findStrictReceivePaths.mockRejectedValue(horizonErr);
    await expect(
      getExchangeRateQuote({ sourceAssetCode: 'XLM', destAssetCode: 'USDC', destAmount: '1.0' }),
    ).rejects.toThrow('Horizon unavailable');
  });

  it('applies custom slippage correctly', async () => {
    const quote = await getExchangeRateQuote({
      sourceAssetCode: 'XLM',
      destAssetCode:   'USDC',
      destAmount:      '1.0000000',
      slippage:        0.02,
    });
    const expected = (0.5 * 1.02).toFixed(7);
    expect(quote.sendMax).toBe(expected);
  });
});

describe('invalidateExchangeRateQuote', () => {
  beforeEach(() => {
    resetExchangeRateCache();
    vi.clearAllMocks();
    findStrictReceivePaths.mockResolvedValue(MOCK_PATH);
  });

  afterEach(() => {
    resetExchangeRateCache();
  });

  it('forces re-query after invalidation', async () => {
    await getExchangeRateQuote({ sourceAssetCode: 'XLM', destAssetCode: 'USDC', destAmount: '1.0' });
    invalidateExchangeRateQuote('XLM', 'USDC', '1.0');
    await getExchangeRateQuote({ sourceAssetCode: 'XLM', destAssetCode: 'USDC', destAmount: '1.0' });
    expect(findStrictReceivePaths).toHaveBeenCalledTimes(2);
  });

  it('does not affect cache entries for different amounts', async () => {
    await getExchangeRateQuote({ sourceAssetCode: 'XLM', destAssetCode: 'USDC', destAmount: '1.0' });
    await getExchangeRateQuote({ sourceAssetCode: 'XLM', destAssetCode: 'USDC', destAmount: '2.0' });
    invalidateExchangeRateQuote('XLM', 'USDC', '1.0');
    const quote = await getExchangeRateQuote({ sourceAssetCode: 'XLM', destAssetCode: 'USDC', destAmount: '2.0' });
    // The 2.0 quote is still cached, so no third Horizon call is made.
    expect(findStrictReceivePaths).toHaveBeenCalledTimes(2);
    expect(quote.cached).toBe(true);
  });
});

describe('concurrency control (issue #1445)', () => {
  const params = { sourceAssetCode: 'XLM', destAssetCode: 'USDC', destAmount: '1.0' };

  beforeEach(() => {
    resetExchangeRateCache();
    resetExchangeRateCoordination();
    vi.clearAllMocks();
    findStrictReceivePaths.mockResolvedValue(MOCK_PATH);
  });

  afterEach(() => {
    resetExchangeRateCache();
    resetExchangeRateCoordination();
  });

  it('coalesces a burst of identical requests into one Horizon call', async () => {
    let release;
    findStrictReceivePaths.mockImplementation(
      () => new Promise((resolve) => { release = () => resolve(MOCK_PATH); }),
    );
    const pending = Array.from({ length: 25 }, () => getExchangeRateQuote(params));
    await vi.waitFor(() => expect(findStrictReceivePaths).toHaveBeenCalled());
    release();
    const quotes = await Promise.all(pending);
    expect(findStrictReceivePaths).toHaveBeenCalledTimes(1);
    expect(quotes.filter((q) => q.cached === false)).toHaveLength(1);
    expect(quotes.filter((q) => q.cached === true)).toHaveLength(24);
    expect(new Set(quotes.map((q) => q.sendMax))).toEqual(new Set(['0.5050000']));
  });

  it('propagates NoPathFoundError to every coalesced caller', async () => {
    findStrictReceivePaths.mockResolvedValue(null);
    const settled = await Promise.allSettled([getExchangeRateQuote(params), getExchangeRateQuote(params)]);
    expect(settled.every((s) => s.status === 'rejected' && s.reason instanceof NoPathFoundError)).toBe(true);
    expect(findStrictReceivePaths).toHaveBeenCalledTimes(1);
  });

  it('configureExchangeRateCoordination ignores missing or closed clients', () => {
    expect(configureExchangeRateCoordination({ redisClient: null })).toBe(false);
    expect(configureExchangeRateCoordination({ redisClient: { isOpen: false, sendCommand: vi.fn() } })).toBe(false);
    expect(configureExchangeRateCoordination({ redisClient: { isOpen: true } })).toBe(false);
    expect(configureExchangeRateCoordination()).toBe(false);
    expect(configureExchangeRateCoordination({ redisClient: createFakeRedis() })).toBe(true);
  });

  it('publishes quotes to the shared store and reuses a peer’s quote', async () => {
    const redis = createFakeRedis();
    configureExchangeRateCoordination({ redisClient: redis, pollIntervalMs: 5 });

    const first = await getExchangeRateQuote(params);
    expect(first.cached).toBe(false);
    const key = generateRateCacheKey('XLM', 'USDC', '1.0');
    expect(redis.store.has(`exrate:quote:${key}`)).toBe(true);

    // A second instance with an empty in-memory cache.
    resetExchangeRateCache();
    const second = await getExchangeRateQuote(params);
    expect(second.cached).toBe(true);
    expect(second.sendMax).toBe(first.sendMax);
    expect(findStrictReceivePaths).toHaveBeenCalledTimes(1);
  });

  it('invalidation also clears the shared quote', async () => {
    const redis = createFakeRedis();
    configureExchangeRateCoordination({ redisClient: redis });
    await getExchangeRateQuote(params);
    invalidateExchangeRateQuote('XLM', 'USDC', '1.0');
    await vi.waitFor(() => expect(redis.count('DEL')).toBe(1));
    expect(redis.store.size).toBe(0);
  });

  it('keeps serving quotes when Redis fails', async () => {
    const redis = createFakeRedis();
    configureExchangeRateCoordination({ redisClient: redis });
    redis.setFailure(new Error('ECONNREFUSED'));
    const quote = await getExchangeRateQuote(params);
    expect(quote.sourceAmount).toBe('0.5000000');
    expect(() => invalidateExchangeRateQuote('XLM', 'USDC', '1.0')).not.toThrow();
  });
});
