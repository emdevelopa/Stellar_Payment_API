/**
 * Exchange Rate Oracle Cache — stress suite (issue #1446).
 *
 * Hammers the real ExchangeRateCache and ExchangeRateCoordinator with
 * thousands of concurrent requests. Several "instances" (each with its own
 * in-memory cache) share one in-memory Redis with injected latency, which
 * simulates a horizontally scaled deployment. No network and no Horizon.
 *
 * Invariants checked under load:
 *   - Horizon is queried exactly once per key, per process and across instances
 *   - LRU capacity is never exceeded and no in-flight entries or locks leak
 *   - an invalidated load never writes back
 *   - Redis outages and crashed lock holders degrade to direct queries,
 *     never to failed requests
 *
 * Run with:  npm run test:load -- exchange-rate-cache-stress
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/lib/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { ExchangeRateCache } from '../src/lib/exchange-rate-cache.js';
import { ExchangeRateCoordinator } from '../src/lib/exchange-rate-coordinator.js';
import { createFakeRedis } from '../tests/helpers/fake-redis.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const quoteFor = (key, extra = {}) => ({
  sourceAsset: 'XLM',
  sourceAmount: '0.5000000',
  sendMax: '0.5050000',
  path: [],
  key,
  ...extra,
});

/** Horizon stand-in that counts calls per key and takes `latencyMs`. */
function createHorizon({ latencyMs = 20 } = {}) {
  const calls = new Map();
  return {
    calls,
    get total() {
      let n = 0;
      for (const c of calls.values()) n += c;
      return n;
    },
    fetch(key) {
      return async () => {
        calls.set(key, (calls.get(key) ?? 0) + 1);
        await sleep(latencyMs);
        return quoteFor(key);
      };
    },
  };
}

/** One simulated API instance: private L1 cache + shared-Redis coordinator. */
function createInstance(redis, opts = {}) {
  const cache = new ExchangeRateCache({ ttlMs: 30_000, staleToleranceMs: 60_000, maxEntries: 1_000 });
  const coordinator = redis
    ? new ExchangeRateCoordinator({
        redisClient: redis,
        sharedTtlMs: 30_000,
        lockTtlMs: 2_000,
        waitTimeoutMs: 3_000,
        pollIntervalMs: 5,
        metrics: null,
        ...opts,
      })
    : null;
  return {
    cache,
    coordinator,
    get(key, horizon) {
      const load = horizon.fetch(key);
      const loader = coordinator ? async () => (await coordinator.load(key, load)).data : load;
      return cache.getOrLoad(key, loader, { timeoutMs: 10_000 });
    },
  };
}

function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function timed(promises) {
  const started = performance.now();
  const latencies = [];
  const results = await Promise.all(
    promises.map(async (make) => {
      const t0 = performance.now();
      const r = await make();
      latencies.push(performance.now() - t0);
      return r;
    }),
  );
  latencies.sort((a, b) => a - b);
  return {
    results,
    wallMs: performance.now() - started,
    p50: percentile(latencies, 50),
    p99: percentile(latencies, 99),
  };
}

function lockKeys(redis) {
  return [...redis.store.keys()].filter((k) => k.startsWith('exrate:lock:'));
}

describe('Exchange Rate Oracle Cache — stress (issue #1446)', () => {
  let horizon;

  beforeEach(() => {
    horizon = createHorizon();
  });

  describe('single process', () => {
    it('5,000 concurrent requests for one quote → 1 Horizon call', async () => {
      const node = createInstance(null);
      const { results, p99, wallMs } = await timed(
        Array.from({ length: 5_000 }, () => () => node.get('hot', horizon)),
      );
      expect(horizon.total).toBe(1);
      expect(results.every((r) => r.data.key === 'hot')).toBe(true);
      expect(results.filter((r) => r.source === 'loader')).toHaveLength(1);
      expect(node.cache.inflightCount).toBe(0);
      // Everyone waits roughly one Horizon round-trip, not 5,000 of them.
      expect(p99).toBeLessThan(1_000);
      expect(wallMs).toBeLessThan(2_000);
    });

    it('20,000 requests over 250 keys → exactly 250 Horizon calls', async () => {
      const node = createInstance(null);
      const keys = Array.from({ length: 250 }, (_, i) => `pair-${i}`);
      await timed(
        Array.from({ length: 20_000 }, (_, i) => () => node.get(keys[(i * 7919) % keys.length], horizon)),
      );
      expect(horizon.calls.size).toBe(250);
      expect([...horizon.calls.values()].every((c) => c === 1)).toBe(true);
      expect(node.cache.size).toBe(250);
    });

    it('respects LRU capacity under concurrent churn', async () => {
      const cache = new ExchangeRateCache({ ttlMs: 30_000, staleToleranceMs: 60_000, maxEntries: 50 });
      const keys = Array.from({ length: 500 }, (_, i) => `k${i}`);
      let maxObserved = 0;
      await Promise.all(
        Array.from({ length: 5_000 }, (_, i) =>
          cache
            .getOrLoad(keys[(i * 31) % keys.length], horizon.fetch(keys[(i * 31) % keys.length]))
            .then(() => {
              maxObserved = Math.max(maxObserved, cache.size);
            }),
        ),
      );
      expect(maxObserved).toBeLessThanOrEqual(50);
      expect(cache.size).toBeLessThanOrEqual(50);
      expect(cache.inflightCount).toBe(0);
    });

    it('never caches a result from before the latest invalidation (invalidation storm)', async () => {
      const cache = new ExchangeRateCache({ ttlMs: 30_000, staleToleranceMs: 60_000, maxEntries: 1_000 });
      const keys = Array.from({ length: 20 }, (_, i) => `k${i}`);
      const version = new Map(keys.map((k) => [k, 0]));
      const versionedLoader = (key) => async () => {
        const startedAt = version.get(key);
        await sleep(Math.random() * 10);
        return { key, version: startedAt };
      };

      const ops = [];
      for (let i = 0; i < 4_000; i++) {
        const key = keys[i % keys.length];
        if (i % 13 === 0) {
          ops.push(
            sleep(Math.random() * 30).then(() => {
              version.set(key, version.get(key) + 1);
              cache.delete(key);
            }),
          );
        } else {
          ops.push(sleep(Math.random() * 30).then(() => cache.getOrLoad(key, versionedLoader(key))));
        }
      }
      await Promise.all(ops);
      await sleep(20); // let any detached loads settle

      for (const key of keys) {
        const entry = cache.get(key);
        if (entry.hit) {
          expect(entry.data.version).toBe(version.get(key));
        }
      }
      expect(cache.inflightCount).toBe(0);
    });

    it('isolates failures: a failing key does not affect healthy keys', async () => {
      const node = createInstance(null);
      let failures = 0;
      const flaky = {
        fetch: (key) =>
          key === 'broken'
            ? async () => {
                failures++;
                await sleep(5);
                throw new Error('horizon 503');
              }
            : horizon.fetch(key),
      };
      const settled = await Promise.allSettled(
        Array.from({ length: 2_000 }, (_, i) => node.get(i % 2 ? 'broken' : 'healthy', flaky)),
      );
      const ok = settled.filter((s) => s.status === 'fulfilled');
      const bad = settled.filter((s) => s.status === 'rejected');
      expect(ok).toHaveLength(1_000);
      expect(bad).toHaveLength(1_000);
      expect(failures).toBe(1); // coalesced failure, not 1,000 retries
      expect(horizon.calls.get('healthy')).toBe(1);
      expect(node.cache.inflightCount).toBe(0);
    });
  });

  describe('multiple instances sharing Redis', () => {
    it('8 instances × 250 concurrent requests for one quote → 1 Horizon call', async () => {
      const redis = createFakeRedis({ latencyMs: 2 });
      const nodes = Array.from({ length: 8 }, () => createInstance(redis));
      const { results, p99 } = await timed(
        nodes.flatMap((node) => Array.from({ length: 250 }, () => () => node.get('hot', horizon))),
      );
      expect(horizon.total).toBe(1);
      expect(results.every((r) => r.data.key === 'hot')).toBe(true);
      expect(lockKeys(redis)).toEqual([]);
      expect(nodes.every((n) => n.cache.inflightCount === 0)).toBe(true);
      expect(p99).toBeLessThan(2_000);
    });

    it('8 instances × 50 keys → exactly one Horizon call per key', async () => {
      const redis = createFakeRedis({ latencyMs: 1 });
      const nodes = Array.from({ length: 8 }, () => createInstance(redis));
      const keys = Array.from({ length: 50 }, (_, i) => `pair-${i}`);
      await Promise.all(
        nodes.flatMap((node, n) =>
          Array.from({ length: 200 }, (_, i) => node.get(keys[(i + n * 7) % keys.length], horizon)),
        ),
      );
      expect(horizon.calls.size).toBe(50);
      expect([...horizon.calls.values()].every((c) => c === 1)).toBe(true);
      expect(lockKeys(redis)).toEqual([]);
    });

    it('a cold instance reuses quotes published by its peers', async () => {
      const redis = createFakeRedis({ latencyMs: 1 });
      const warm = createInstance(redis);
      await Promise.all(Array.from({ length: 20 }, (_, i) => warm.get(`pair-${i}`, horizon)));
      expect(horizon.total).toBe(20);

      const cold = createInstance(redis);
      const results = await Promise.all(Array.from({ length: 20 }, (_, i) => cold.get(`pair-${i}`, horizon)));
      expect(horizon.total).toBe(20);
      expect(results.every((r, i) => r.data.key === `pair-${i}`)).toBe(true);
    });

    it('recovers when the lock holder crashes (lease expiry)', async () => {
      const redis = createFakeRedis({ latencyMs: 1 });
      // A crashed instance left the lock behind and never published a quote.
      await redis.sendCommand(['SET', 'exrate:lock:hot', 'crashed-node', 'PX', '150', 'NX']);
      const nodes = Array.from({ length: 4 }, () => createInstance(redis));
      const started = performance.now();
      const results = await Promise.all(
        nodes.flatMap((node) => Array.from({ length: 100 }, () => node.get('hot', horizon))),
      );
      const elapsed = performance.now() - started;
      expect(results).toHaveLength(400);
      expect(horizon.total).toBe(1); // one survivor takes over, peers reuse its quote
      expect(elapsed).toBeGreaterThanOrEqual(140);
      expect(elapsed).toBeLessThan(1_500);
    });

    it('keeps serving through a Redis outage mid-burst', async () => {
      const redis = createFakeRedis({ latencyMs: 2 });
      const nodes = Array.from({ length: 6 }, () => createInstance(redis));
      const keys = Array.from({ length: 30 }, (_, i) => `pair-${i}`);

      setTimeout(() => redis.setFailure(new Error('ECONNRESET')), 5);
      const settled = await Promise.allSettled(
        nodes.flatMap((node) => Array.from({ length: 300 }, (_, i) => node.get(keys[i % keys.length], horizon))),
      );

      expect(settled.every((s) => s.status === 'fulfilled')).toBe(true);
      // Fail-open costs at most one query per key per instance, and L1
      // single-flight still holds within each instance.
      expect(horizon.total).toBeLessThanOrEqual(nodes.length * keys.length);
      for (const count of horizon.calls.values()) {
        expect(count).toBeLessThanOrEqual(nodes.length);
      }
    });

    it('falls back to direct queries when a peer holds the lock too long', async () => {
      const redis = createFakeRedis({ latencyMs: 1 });
      await redis.sendCommand(['SET', 'exrate:lock:hot', 'stuck-node', 'PX', '60000', 'NX']);
      const nodes = Array.from({ length: 3 }, () => createInstance(redis, { waitTimeoutMs: 100 }));
      const results = await Promise.all(
        nodes.flatMap((node) => Array.from({ length: 50 }, () => node.get('hot', horizon))),
      );
      expect(results).toHaveLength(150);
      // Each instance falls back once (L1 still coalesces its own callers).
      expect(horizon.total).toBe(3);
    });

    it('does not leak state after a large mixed workload', async () => {
      const redis = createFakeRedis({ latencyMs: 1 });
      const nodes = Array.from({ length: 4 }, () => createInstance(redis));
      const keys = Array.from({ length: 100 }, (_, i) => `pair-${i}`);
      const ops = [];
      for (let i = 0; i < 4_000; i++) {
        const node = nodes[i % nodes.length];
        const key = keys[(i * 17) % keys.length];
        if (i % 50 === 0) {
          node.cache.delete(key);
          ops.push(node.coordinator.invalidate(key));
        } else {
          ops.push(node.get(key, horizon));
        }
      }
      await Promise.all(ops);
      expect(lockKeys(redis)).toEqual([]);
      expect(nodes.every((n) => n.cache.inflightCount === 0)).toBe(true);
      for (const node of nodes) {
        expect(node.cache.size).toBeLessThanOrEqual(keys.length);
      }
    });
  });
});
