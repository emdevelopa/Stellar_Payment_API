import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ExchangeRateCache,
  generateRateCacheKey,
  getExchangeRateCache,
  resetExchangeRateCache,
} from './exchange-rate-cache.js';

describe('generateRateCacheKey', () => {
  it('returns a 64-char hex string', () => {
    const key = generateRateCacheKey('XLM', 'USDC', '1.0000000');
    expect(key).toMatch(/^[a-f0-9]{64}$/);
  });

  it('produces the same key for equivalent inputs regardless of case', () => {
    const a = generateRateCacheKey('xlm', 'usdc', '1.0000000');
    const b = generateRateCacheKey('XLM', 'USDC', '1.0000000');
    expect(a).toBe(b);
  });

  it('produces different keys for different dest amounts', () => {
    const a = generateRateCacheKey('XLM', 'USDC', '1.0');
    const b = generateRateCacheKey('XLM', 'USDC', '2.0');
    expect(a).not.toBe(b);
  });

  it('includes issuer in the key', () => {
    const a = generateRateCacheKey('USDC', 'USDT', '5.0', 'issuer-a');
    const b = generateRateCacheKey('USDC', 'USDT', '5.0', 'issuer-b');
    expect(a).not.toBe(b);
  });
});

describe('ExchangeRateCache', () => {
  let cache;

  beforeEach(() => {
    cache = new ExchangeRateCache({ ttlMs: 100, maxEntries: 3, staleToleranceMs: 200 });
  });

  it('returns miss for unknown key', () => {
    const result = cache.get('unknown');
    expect(result.hit).toBe(false);
    expect(result.data).toBeNull();
  });

  it('returns hit for a recently set key', () => {
    cache.set('k1', { rate: 1.5 });
    const result = cache.get('k1');
    expect(result.hit).toBe(true);
    expect(result.stale).toBe(false);
    expect(result.data).toEqual({ rate: 1.5 });
  });

  it('returns stale=true for entries between ttlMs and staleToleranceMs', async () => {
    vi.useFakeTimers();
    cache.set('k2', { rate: 2.0 });
    vi.advanceTimersByTime(150); // past ttlMs=100, within staleToleranceMs=200
    const result = cache.get('k2');
    expect(result.hit).toBe(true);
    expect(result.stale).toBe(true);
    vi.useRealTimers();
  });

  it('returns miss for entries past staleToleranceMs', async () => {
    vi.useFakeTimers();
    cache.set('k3', { rate: 3.0 });
    vi.advanceTimersByTime(250); // past staleToleranceMs=200
    const result = cache.get('k3');
    expect(result.hit).toBe(false);
    vi.useRealTimers();
  });

  it('evicts oldest entry when maxEntries exceeded', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.set('d', 4); // should evict 'a'
    expect(cache.get('a').hit).toBe(false);
    expect(cache.get('d').hit).toBe(true);
    expect(cache.size).toBe(3);
  });

  it('delete removes a specific entry', () => {
    cache.set('del', 'value');
    expect(cache.get('del').hit).toBe(true);
    cache.delete('del');
    expect(cache.get('del').hit).toBe(false);
  });

  it('prune removes only expired entries', () => {
    vi.useFakeTimers();
    cache.set('fresh', 'value');
    vi.advanceTimersByTime(50);
    cache.set('stale-but-tolerable', 'value2');
    vi.advanceTimersByTime(300); // moves first entry past staleToleranceMs
    const pruned = cache.prune();
    expect(pruned).toBe(1);
    vi.useRealTimers();
  });

  it('clear empties the cache', () => {
    cache.set('x', 1);
    cache.set('y', 2);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it('increments metrics counters on hit/miss', () => {
    const mockMetrics = {
      hit:  { inc: vi.fn() },
      miss: { inc: vi.fn() },
      eviction: { inc: vi.fn() },
    };
    const c = new ExchangeRateCache({ ttlMs: 1000, maxEntries: 10, metrics: mockMetrics });
    c.get('nonexistent');
    expect(mockMetrics.miss.inc).toHaveBeenCalledWith({ cache: 'exchange_rate' });
    c.set('exists', { rate: 1 });
    c.get('exists');
    expect(mockMetrics.hit.inc).toHaveBeenCalledWith({ cache: 'exchange_rate', stale: '0' });
  });
});

describe('getExchangeRateCache singleton', () => {
  beforeEach(() => resetExchangeRateCache());
  afterEach(() => resetExchangeRateCache());

  it('returns the same instance on repeated calls', () => {
    const a = getExchangeRateCache();
    const b = getExchangeRateCache();
    expect(a).toBe(b);
  });

  it('returns a new instance after resetExchangeRateCache', () => {
    const a = getExchangeRateCache();
    resetExchangeRateCache();
    const b = getExchangeRateCache();
    expect(a).not.toBe(b);
  });
});
