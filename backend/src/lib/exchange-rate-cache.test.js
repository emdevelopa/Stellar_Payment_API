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
    vi.advanceTimersByTime(160); // first entry at 210ms (> staleToleranceMs=200), second at 160ms
    const pruned = cache.prune();
    expect(pruned).toBe(1);
    expect(cache.get('stale-but-tolerable').hit).toBe(true);
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

describe('ExchangeRateCache.getOrLoad — concurrency control (issue #1445)', () => {
  const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };

  const makeMetrics = () => ({
    hit: { inc: vi.fn() },
    miss: { inc: vi.fn() },
    eviction: { inc: vi.fn() },
    size: { set: vi.fn() },
    coalesced: { inc: vi.fn() },
    inflight: { set: vi.fn() },
    loadTimeout: { inc: vi.fn() },
    staleWritePrevented: { inc: vi.fn() },
  });

  let cache;
  let metrics;

  beforeEach(() => {
    metrics = makeMetrics();
    cache = new ExchangeRateCache({ ttlMs: 1000, maxEntries: 100, staleToleranceMs: 2000, metrics });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('serves fresh entries without calling the loader', async () => {
    cache.set('k', { rate: 1 });
    const loader = vi.fn();
    await expect(cache.getOrLoad('k', loader)).resolves.toEqual({ data: { rate: 1 }, source: 'cache' });
    expect(loader).not.toHaveBeenCalled();
  });

  it('coalesces concurrent misses into a single loader call', async () => {
    const d = deferred();
    const loader = vi.fn(() => d.promise);

    const pending = Array.from({ length: 50 }, () => cache.getOrLoad('k', loader));
    expect(cache.inflightCount).toBe(1);
    d.resolve({ rate: 2 });
    const results = await Promise.all(pending);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(results.filter((r) => r.source === 'loader')).toHaveLength(1);
    expect(results.filter((r) => r.source === 'coalesced')).toHaveLength(49);
    expect(results.every((r) => r.data.rate === 2)).toBe(true);
    expect(metrics.coalesced.inc).toHaveBeenCalledTimes(49);
    expect(cache.inflightCount).toBe(0);
    expect(cache.get('k').data).toEqual({ rate: 2 });
  });

  it('keeps different keys independent', async () => {
    const loader = vi.fn(async () => ({ rate: Math.random() }));
    await Promise.all([cache.getOrLoad('a', loader), cache.getOrLoad('b', loader), cache.getOrLoad('a', loader)]);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('refreshes a stale entry through a single load', async () => {
    vi.useFakeTimers();
    cache.set('k', { rate: 1 });
    vi.advanceTimersByTime(1500); // stale but tolerable
    const loader = vi.fn(async () => ({ rate: 9 }));
    const [a, b] = await Promise.all([cache.getOrLoad('k', loader), cache.getOrLoad('k', loader)]);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(a.data).toEqual({ rate: 9 });
    expect(b.data).toEqual({ rate: 9 });
  });

  it('propagates loader errors to every waiter and caches nothing', async () => {
    const d = deferred();
    const loader = vi.fn(() => d.promise);
    const pending = [cache.getOrLoad('k', loader), cache.getOrLoad('k', loader)];
    d.reject(new Error('horizon down'));
    const settled = await Promise.allSettled(pending);
    expect(settled.every((s) => s.status === 'rejected' && s.reason.message === 'horizon down')).toBe(true);
    expect(cache.inflightCount).toBe(0);
    expect(cache.size).toBe(0);

    // The next call retries rather than replaying the failure.
    const ok = await cache.getOrLoad('k', async () => ({ rate: 3 }));
    expect(ok.source).toBe('loader');
  });

  it('cleans up after a synchronously throwing loader', async () => {
    const loader = () => {
      throw new Error('sync boom');
    };
    await expect(cache.getOrLoad('k', loader)).rejects.toThrow('sync boom');
    expect(cache.inflightCount).toBe(0);
  });

  it('does not write back a load that was invalidated mid-flight', async () => {
    const first = deferred();
    const pending = cache.getOrLoad('k', () => first.promise);

    cache.delete('k'); // e.g. payment status changed
    expect(cache.inflightCount).toBe(0);

    // A caller after the invalidation must start a fresh load, not join the old one.
    const second = vi.fn(async () => ({ rate: 'new' }));
    const fresh = await cache.getOrLoad('k', second);
    expect(second).toHaveBeenCalledTimes(1);
    expect(fresh.data).toEqual({ rate: 'new' });

    first.resolve({ rate: 'old' });
    const old = await pending;
    expect(old.data).toEqual({ rate: 'old' }); // original caller still served
    expect(cache.get('k').data).toEqual({ rate: 'new' }); // but cache not clobbered
    expect(metrics.staleWritePrevented.inc).toHaveBeenCalledTimes(1);
  });

  it('clear() invalidates every in-flight load', async () => {
    const a = deferred();
    const b = deferred();
    const pa = cache.getOrLoad('a', () => a.promise);
    const pb = cache.getOrLoad('b', () => b.promise);
    cache.clear();
    a.resolve(1);
    b.resolve(2);
    await Promise.all([pa, pb]);
    expect(cache.size).toBe(0);
    expect(cache.inflightCount).toBe(0);
    expect(metrics.staleWritePrevented.inc).toHaveBeenCalledTimes(2);
  });

  it('times out a hung loader, rejects waiters and frees the slot', async () => {
    vi.useFakeTimers();
    const hung = new Promise(() => {});
    const pending = [
      cache.getOrLoad('k', () => hung, { timeoutMs: 100 }),
      cache.getOrLoad('k', () => hung, { timeoutMs: 100 }),
    ];
    const assertion = expect(Promise.all(pending)).rejects.toMatchObject({
      name: 'CacheLoadTimeoutError',
      statusCode: 504,
    });
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    expect(metrics.loadTimeout.inc).toHaveBeenCalledTimes(1);
    expect(cache.inflightCount).toBe(0);
  });

  it('reports the in-flight gauge as loads start and finish', async () => {
    const d = deferred();
    const pending = cache.getOrLoad('k', () => d.promise);
    expect(metrics.inflight.set).toHaveBeenLastCalledWith({ cache: 'exchange_rate' }, 1);
    d.resolve(1);
    await pending;
    expect(metrics.inflight.set).toHaveBeenLastCalledWith({ cache: 'exchange_rate' }, 0);
  });

  it('works without any metrics object', async () => {
    const bare = new ExchangeRateCache({ ttlMs: 1000 });
    await expect(bare.getOrLoad('k', async () => 1)).resolves.toEqual({ data: 1, source: 'loader' });
    bare.delete('k');
    bare.clear();
  });
});
