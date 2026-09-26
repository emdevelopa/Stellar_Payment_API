import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { logger } from './logger.js';
import {
  ExchangeRateCoordinator,
  RedisLock,
  isValidQuote,
} from './exchange-rate-coordinator.js';
import { createFakeRedis } from '../../tests/helpers/fake-redis.js';

const QUOTE = Object.freeze({
  sourceAsset: 'XLM',
  sourceAmount: '0.5000000',
  sendMax: '0.5050000',
  path: [],
});

const makeMetrics = () => ({
  lock: { inc: vi.fn() },
  wait: { observe: vi.fn() },
  shared: { inc: vi.fn() },
  fallback: { inc: vi.fn() },
});

const make = (redis, opts = {}) =>
  new ExchangeRateCoordinator({
    redisClient: redis,
    sharedTtlMs: 1_000,
    lockTtlMs: 500,
    waitTimeoutMs: 300,
    pollIntervalMs: 10,
    metrics: makeMetrics(),
    ...opts,
  });

describe('isValidQuote', () => {
  it('accepts a well-formed quote', () => {
    expect(isValidQuote(QUOTE)).toBe(true);
  });

  it.each([
    null,
    'string',
    { ...QUOTE, sendMax: 123 },
    { ...QUOTE, sendMax: '-1' },
    { ...QUOTE, sendMax: '1e9' },
    { ...QUOTE, sourceAmount: '0.12345678' },
    { ...QUOTE, path: 'x' },
    { ...QUOTE, sourceAsset: undefined },
  ])('rejects malformed quote %#', (value) => {
    expect(isValidQuote(value)).toBe(false);
  });
});

describe('RedisLock', () => {
  let redis;
  let lock;

  beforeEach(() => {
    redis = createFakeRedis();
    lock = new RedisLock(redis, { prefix: 't:' });
  });

  afterEach(() => vi.useRealTimers());

  it('grants the lock to exactly one contender', async () => {
    const tokens = await Promise.all(Array.from({ length: 20 }, () => lock.acquire('k', 1000)));
    expect(tokens.filter(Boolean)).toHaveLength(1);
  });

  it('uses SET NX PX with a random token', async () => {
    const token = await lock.acquire('k', 750);
    expect(token).toMatch(/^[0-9a-f-]{36}$/);
    expect(redis.calls[0]).toEqual(['SET', 't:k', token, 'PX', '750', 'NX']);
  });

  it('only the owner can release', async () => {
    const token = await lock.acquire('k', 1000);
    expect(await lock.release('k', 'someone-else')).toBe(false);
    expect(await lock.acquire('k', 1000)).toBeNull();
    expect(await lock.release('k', token)).toBe(true);
    expect(await lock.acquire('k', 1000)).not.toBeNull();
  });

  it('an expired holder cannot delete the next owner’s lock', async () => {
    vi.useFakeTimers();
    const stale = await lock.acquire('k', 100);
    vi.advanceTimersByTime(150);
    const fresh = await lock.acquire('k', 1000);
    expect(fresh).not.toBeNull();
    expect(await lock.release('k', stale)).toBe(false);
    expect(await lock.acquire('k', 1000)).toBeNull(); // fresh lock still held
  });
});

describe('ExchangeRateCoordinator', () => {
  let redis;

  beforeEach(() => {
    redis = createFakeRedis();
    vi.clearAllMocks();
  });

  it('requires a client with sendCommand', () => {
    expect(() => new ExchangeRateCoordinator({ redisClient: {} })).toThrow(TypeError);
    expect(() => new ExchangeRateCoordinator({})).toThrow(TypeError);
  });

  it('leader loads, publishes to the shared store and releases the lock', async () => {
    const c = make(redis);
    const loader = vi.fn(async () => QUOTE);
    const result = await c.load('k', loader);
    expect(result).toEqual({ data: QUOTE, source: 'leader' });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(redis.store.has('exrate:lock:k')).toBe(false);
    const stored = JSON.parse(redis.store.get('exrate:quote:k').value);
    expect(stored).toMatchObject({ v: 1, data: QUOTE });
    expect(c.metrics.lock.inc).toHaveBeenCalledWith({ result: 'acquired' });
  });

  it('serves a peer’s shared quote without calling the loader', async () => {
    await make(redis).load('k', async () => QUOTE);
    const loader = vi.fn();
    const c = make(redis);
    await expect(c.load('k', loader)).resolves.toEqual({ data: QUOTE, source: 'shared' });
    expect(loader).not.toHaveBeenCalled();
    expect(c.metrics.shared.inc).toHaveBeenCalledWith({ result: 'hit' });
  });

  it('shared quotes expire after sharedTtlMs', async () => {
    vi.useFakeTimers();
    await make(redis).load('k', async () => QUOTE);
    vi.advanceTimersByTime(1_001);
    const loader = vi.fn(async () => QUOTE);
    await make(redis).load('k', loader);
    expect(loader).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('followers wait for the leader instead of querying Horizon', async () => {
    const leader = make(redis);
    const follower = make(redis);
    let release;
    const slow = new Promise((resolve) => {
      release = resolve;
    });
    const leaderLoader = vi.fn(() => slow);
    const followerLoader = vi.fn(async () => QUOTE);

    const p1 = leader.load('k', leaderLoader);
    await new Promise((r) => setTimeout(r, 5)); // leader takes the lock first
    const p2 = follower.load('k', followerLoader);
    await new Promise((r) => setTimeout(r, 30));
    release(QUOTE);

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.source).toBe('leader');
    expect(r2).toEqual({ data: QUOTE, source: 'shared' });
    expect(followerLoader).not.toHaveBeenCalled();
    expect(follower.metrics.lock.inc).toHaveBeenCalledWith({ result: 'contended' });
    expect(follower.metrics.wait.observe).toHaveBeenCalledWith({ outcome: 'shared_hit' }, expect.any(Number));
  });

  it('a follower takes over when the leader fails', async () => {
    const leader = make(redis);
    const follower = make(redis);
    let fail;
    const failing = new Promise((_, reject) => {
      fail = reject;
    });

    const p1 = leader.load('k', () => failing);
    await new Promise((r) => setTimeout(r, 5));
    const followerLoader = vi.fn(async () => QUOTE);
    const p2 = follower.load('k', followerLoader);
    await new Promise((r) => setTimeout(r, 20));
    fail(new Error('no path'));

    await expect(p1).rejects.toThrow('no path');
    await expect(p2).resolves.toEqual({ data: QUOTE, source: 'leader' });
    expect(followerLoader).toHaveBeenCalledTimes(1);
  });

  it('a follower takes over when the leader crashes and its lease expires', async () => {
    // Simulate a crashed instance: lock held, never released, no quote written.
    await redis.sendCommand(['SET', 'exrate:lock:k', 'dead-instance', 'PX', '50', 'NX']);
    const loader = vi.fn(async () => QUOTE);
    const result = await make(redis).load('k', loader);
    expect(result.source).toBe('leader');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('falls back to a direct load after waitTimeoutMs', async () => {
    await redis.sendCommand(['SET', 'exrate:lock:k', 'slow-peer', 'PX', '10000', 'NX']);
    const c = make(redis, { waitTimeoutMs: 50 });
    const loader = vi.fn(async () => QUOTE);
    const started = Date.now();
    const result = await c.load('k', loader);
    expect(result).toEqual({ data: QUOTE, source: 'fallback' });
    expect(Date.now() - started).toBeGreaterThanOrEqual(45);
    expect(c.metrics.fallback.inc).toHaveBeenCalledWith({ reason: 'wait_timeout' });
    expect(logger.warn).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('timed out'));
  });

  it('fails open when Redis errors, calling the loader exactly once', async () => {
    redis.setFailure(new Error('ECONNRESET'));
    const c = make(redis);
    const loader = vi.fn(async () => QUOTE);
    await expect(c.load('k', loader)).resolves.toEqual({ data: QUOTE, source: 'fallback' });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(c.metrics.fallback.inc).toHaveBeenCalledWith({ reason: 'redis_error' });
  });

  it('does not retry the loader when the loader itself fails during fallback', async () => {
    await redis.sendCommand(['SET', 'exrate:lock:k', 'slow-peer', 'PX', '10000', 'NX']);
    const c = make(redis, { waitTimeoutMs: 20 });
    const loader = vi.fn(async () => {
      throw new Error('no path');
    });
    await expect(c.load('k', loader)).rejects.toThrow('no path');
    expect(loader).toHaveBeenCalledTimes(1);
    expect(c.metrics.fallback.inc).not.toHaveBeenCalledWith({ reason: 'redis_error' });
  });

  it('still returns the quote if publishing to the shared store fails', async () => {
    const c = make(redis);
    const loader = vi.fn(async () => {
      redis.setFailure(new Error('READONLY'));
      return QUOTE;
    });
    await expect(c.load('k', loader)).resolves.toEqual({ data: QUOTE, source: 'leader' });
    expect(logger.warn).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('publish'));
  });

  it('skips coordination entirely when the client is closed', async () => {
    redis.isOpen = false;
    const loader = vi.fn(async () => QUOTE);
    await expect(make(redis).load('k', loader)).resolves.toEqual({ data: QUOTE, source: 'fallback' });
    expect(redis.calls).toHaveLength(0);
  });

  it.each([
    ['unparsable JSON', 'not-json{'],
    ['wrong version', JSON.stringify({ v: 99, data: QUOTE })],
    ['tampered sendMax', JSON.stringify({ v: 1, data: { ...QUOTE, sendMax: '-5' } })],
    ['foreign value', 'mocked_hash'],
  ])('treats %s in the shared store as a miss', async (_label, raw) => {
    redis.store.set('exrate:quote:k', { value: raw, expiresAt: null });
    const c = make(redis);
    const loader = vi.fn(async () => QUOTE);
    const result = await c.load('k', loader);
    expect(result.source).toBe('leader');
    expect(loader).toHaveBeenCalledTimes(1);
    expect(c.metrics.shared.inc).toHaveBeenCalledWith({ result: 'invalid' });
    // The leader overwrites the bad entry with a valid one.
    expect(JSON.parse(redis.store.get('exrate:quote:k').value).data).toEqual(QUOTE);
  });

  it('invalidate() removes the shared quote', async () => {
    const c = make(redis);
    await c.load('k', async () => QUOTE);
    expect(await c.invalidate('k')).toBe(true);
    expect(redis.store.has('exrate:quote:k')).toBe(false);
    expect(await c.invalidate('k')).toBe(false);
  });

  it('warns when the lease expired before release', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const c = make(redis, { lockTtlMs: 10 });
    await c.load('k', async () => {
      vi.setSystemTime(Date.now() + 50); // loader outlives the lease
      return QUOTE;
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ lockTtlMs: 10 }),
      expect.stringContaining('EXCHANGE_RATE_LOCK_TTL_MS'),
    );
    vi.useRealTimers();
  });
});
