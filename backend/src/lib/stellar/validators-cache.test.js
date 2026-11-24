import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ValidatorCache,
  buildValidatorCacheKey,
  resolveCacheTtlSeconds,
  DEFAULT_CACHE_TTL_SECONDS,
} from "./validators-cache.js";
import {
  resolveFederatedAddress,
  getValidatorThroughput,
  isValidStellarPublicKey,
} from "./validators.js";
import {
  validatorRegister,
  validatorCacheOperationsTotal,
  recordValidatorThroughput,
  resetValidatorMetrics,
  THROUGHPUT_WINDOW_SECONDS,
} from "./validators-metrics.js";

const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const ACCOUNT = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";

function fakeRedis() {
  const store = new Map();
  return {
    isOpen: true,
    store,
    get: vi.fn(async (k) => store.get(k) ?? null),
    set: vi.fn(async (k, v) => {
      store.set(k, v);
      return "OK";
    }),
    del: vi.fn(async (k) => (store.delete(k) ? 1 : 0)),
  };
}

function cacheWith(redis, extra = {}) {
  return new ValidatorCache({
    getRedis: async () => redis,
    logger: silentLogger,
    ...extra,
  });
}

async function cacheCount(labels) {
  const metric = await validatorCacheOperationsTotal.get();
  const hit = metric.values.find((v) =>
    Object.entries(labels).every(([k, val]) => v.labels[k] === val),
  );
  return hit ? hit.value : 0;
}

const parseAccount = (raw) => (raw && isValidStellarPublicKey(raw.account_id) ? raw : null);

describe("buildValidatorCacheKey", () => {
  it("hashes input so it cannot inject key separators", () => {
    const key = buildValidatorCacheKey("federation", "bob*example.com:evil\nflush");
    expect(key).toMatch(/^validator:v1:federation:[0-9a-f]{64}$/);
  });

  it("is case-insensitive and stable", () => {
    expect(buildValidatorCacheKey("federation", "Bob*Example.com")).toBe(
      buildValidatorCacheKey("federation", "bob*example.com"),
    );
  });

  it("rejects an unsafe namespace", () => {
    expect(() => buildValidatorCacheKey("bad:ns", "x")).toThrow(TypeError);
    expect(() => buildValidatorCacheKey("", "x")).toThrow(TypeError);
  });
});

describe("resolveCacheTtlSeconds", () => {
  it("clamps to 1s..1h and falls back on garbage", () => {
    expect(resolveCacheTtlSeconds(0)).toBe(1);
    expect(resolveCacheTtlSeconds(999_999)).toBe(3_600);
    expect(resolveCacheTtlSeconds("abc", {})).toBe(DEFAULT_CACHE_TTL_SECONDS);
    expect(resolveCacheTtlSeconds(undefined, { VALIDATOR_CACHE_TTL_SECONDS: "60" })).toBe(60);
  });
});

describe("ValidatorCache", () => {
  beforeEach(() => {
    resetValidatorMetrics();
    vi.clearAllMocks();
  });

  it("stores in Redis with an expiry and reads it back", async () => {
    const redis = fakeRedis();
    const cache = cacheWith(redis);
    const key = buildValidatorCacheKey("federation", "a*b.com");

    await cache.set("federation_resolve", key, { account_id: ACCOUNT }, 120);
    const value = await cache.get("federation_resolve", key, parseAccount);

    expect(value).toEqual({ account_id: ACCOUNT });
    expect(redis.set).toHaveBeenCalledWith(key, JSON.stringify({ account_id: ACCOUNT }), { EX: 120 });
    expect(await cacheCount({ result: "hit", backend: "redis" })).toBe(1);
  });

  it("shares entries across instances through Redis", async () => {
    const redis = fakeRedis();
    const key = buildValidatorCacheKey("federation", "a*b.com");
    await cacheWith(redis).set("federation_resolve", key, { account_id: ACCOUNT });

    const other = cacheWith(redis); // fresh memory, same Redis
    expect(await other.get("federation_resolve", key, parseAccount)).toEqual({ account_id: ACCOUNT });
  });

  it("misses on an unknown key", async () => {
    const cache = cacheWith(fakeRedis());
    expect(await cache.get("federation_resolve", "validator:v1:federation:x", parseAccount)).toBeNull();
    expect(await cacheCount({ result: "miss" })).toBe(1);
  });

  it("falls back to memory when Redis is a no-op client", async () => {
    const cache = cacheWith({ isOpen: false });
    const key = buildValidatorCacheKey("federation", "a*b.com");

    await cache.set("federation_resolve", key, { account_id: ACCOUNT });
    expect(await cache.get("federation_resolve", key, parseAccount)).toEqual({ account_id: ACCOUNT });
    expect(await cacheCount({ result: "hit", backend: "memory" })).toBe(1);
  });

  it("falls back to memory when getRedis throws", async () => {
    const cache = new ValidatorCache({
      getRedis: async () => {
        throw new Error("redis down");
      },
      logger: silentLogger,
    });
    const key = buildValidatorCacheKey("federation", "a*b.com");

    await cache.set("federation_resolve", key, { account_id: ACCOUNT });
    expect(await cache.get("federation_resolve", key, parseAccount)).toEqual({ account_id: ACCOUNT });
  });

  it("survives Redis command errors, serving from memory", async () => {
    const redis = fakeRedis();
    redis.get.mockRejectedValue(new Error("boom"));
    redis.set.mockRejectedValue(new Error("boom"));
    const cache = cacheWith(redis);
    const key = buildValidatorCacheKey("federation", "a*b.com");

    await expect(cache.set("federation_resolve", key, { account_id: ACCOUNT })).resolves.toBe(true);
    expect(await cache.get("federation_resolve", key, parseAccount)).toEqual({ account_id: ACCOUNT });
    expect(await cacheCount({ result: "error", backend: "redis" })).toBeGreaterThan(0);
  });

  it("discards and deletes a poisoned entry instead of trusting it", async () => {
    const redis = fakeRedis();
    const cache = cacheWith(redis);
    const key = buildValidatorCacheKey("federation", "a*b.com");
    redis.store.set(key, JSON.stringify({ account_id: "not-a-stellar-key" }));

    expect(await cache.get("federation_resolve", key, parseAccount)).toBeNull();
    expect(redis.store.has(key)).toBe(false);
    expect(await cacheCount({ result: "invalid" })).toBe(1);
  });

  it("discards corrupt JSON", async () => {
    const redis = fakeRedis();
    const cache = cacheWith(redis);
    const key = buildValidatorCacheKey("federation", "a*b.com");
    redis.store.set(key, "{not json");

    expect(await cache.get("federation_resolve", key, parseAccount)).toBeNull();
  });

  it("expires in-memory entries after the TTL", async () => {
    let now = 1_000_000;
    const cache = cacheWith({ isOpen: false }, { now: () => now });
    const key = buildValidatorCacheKey("federation", "a*b.com");

    await cache.set("federation_resolve", key, { account_id: ACCOUNT }, 10);
    now += 9_000;
    expect(await cache.get("federation_resolve", key, parseAccount)).not.toBeNull();
    now += 2_000;
    expect(await cache.get("federation_resolve", key, parseAccount)).toBeNull();
    expect(cache.memorySize).toBe(0);
  });

  it("bounds memory with LRU eviction", async () => {
    const cache = cacheWith({ isOpen: false }, { maxMemoryEntries: 2 });
    await cache.set("op", "k1", { account_id: ACCOUNT });
    await cache.set("op", "k2", { account_id: ACCOUNT });
    await cache.get("op", "k1", parseAccount); // k1 becomes most recent
    await cache.set("op", "k3", { account_id: ACCOUNT });

    expect(cache.memorySize).toBe(2);
    expect(await cache.get("op", "k2", parseAccount)).toBeNull(); // evicted
    expect(await cache.get("op", "k1", parseAccount)).not.toBeNull();
  });

  it("delete and clearMemory remove entries", async () => {
    const redis = fakeRedis();
    const cache = cacheWith(redis);
    await cache.set("op", "k1", { account_id: ACCOUNT });
    await cache.delete("k1");
    expect(redis.store.has("k1")).toBe(false);
    expect(cache.memorySize).toBe(0);

    await cache.set("op", "k2", { account_id: ACCOUNT });
    cache.clearMemory();
    expect(cache.memorySize).toBe(0);
  });
});

describe("resolveFederatedAddress with the cache", () => {
  const tomlResponse = {
    ok: true,
    status: 200,
    text: async () => 'FEDERATION_SERVER="https://fed.example.com/federation"',
  };

  function makeFetch() {
    return vi.fn(async (url) => {
      if (String(url).includes("stellar.toml")) return tomlResponse;
      return { ok: true, status: 200, json: async () => ({ account_id: ACCOUNT }) };
    });
  }

  beforeEach(() => resetValidatorMetrics());

  it("resolves once, then serves repeats from the cache", async () => {
    const fetchFn = makeFetch();
    const cache = cacheWith({ isOpen: false });

    const first = await resolveFederatedAddress("bob*example.com", { fetchFn, cache });
    const second = await resolveFederatedAddress("bob*example.com", { fetchFn, cache });

    expect(first).toEqual({ account_id: ACCOUNT });
    expect(second).toEqual(first);
    expect(fetchFn).toHaveBeenCalledTimes(2); // toml + federation, once
    expect(await cacheCount({ result: "hit" })).toBe(1);
  });

  it("coalesces concurrent identical lookups into one network resolution", async () => {
    const fetchFn = makeFetch();
    const cache = cacheWith({ isOpen: false });

    const results = await Promise.all([
      resolveFederatedAddress("bob*example.com", { fetchFn, cache }),
      resolveFederatedAddress("bob*example.com", { fetchFn, cache }),
      resolveFederatedAddress("bob*example.com", { fetchFn, cache }),
    ]);

    expect(results.every((r) => r.account_id === ACCOUNT)).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(await cacheCount({ result: "coalesced" })).toBe(2);
  });

  it("does not cache failures", async () => {
    const failing = vi.fn(async () => ({ ok: false, status: 404 }));
    const cache = cacheWith({ isOpen: false });

    await expect(resolveFederatedAddress("bob*example.com", { fetchFn: failing, cache, maxRetries: 0 })).rejects.toThrow();
    const fetchFn = makeFetch();
    await expect(resolveFederatedAddress("bob*example.com", { fetchFn, cache })).resolves.toEqual({
      account_id: ACCOUNT,
    });
    expect(fetchFn).toHaveBeenCalled();
  });

  it("clears the in-flight entry after a failure so a retry can succeed", async () => {
    const cache = cacheWith({ isOpen: false });
    const failing = vi.fn(async () => ({ ok: false, status: 404 }));
    await expect(resolveFederatedAddress("bob*example.com", { fetchFn: failing, cache, maxRetries: 0 })).rejects.toThrow();

    const fetchFn = makeFetch();
    expect(await resolveFederatedAddress("bob*example.com", { fetchFn, cache })).toEqual({ account_id: ACCOUNT });
  });

  it("rejects invalid syntax before touching the cache", async () => {
    const cache = cacheWith({ isOpen: false });
    const getSpy = vi.spyOn(cache, "get");
    await expect(resolveFederatedAddress("not-an-address", { fetchFn: makeFetch(), cache })).rejects.toThrow();
    expect(getSpy).not.toHaveBeenCalled();
  });

  it("bypasses the cache with cache: false", async () => {
    const fetchFn = makeFetch();
    await resolveFederatedAddress("bob*example.com", { fetchFn, cache: false });
    await resolveFederatedAddress("bob*example.com", { fetchFn, cache: false });
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });

  it("does not use a cache by default unless VALIDATOR_CACHE_ENABLED=true", async () => {
    const fetchFn = makeFetch();
    delete process.env.VALIDATOR_CACHE_ENABLED;
    await resolveFederatedAddress("bob*example.com", { fetchFn });
    await resolveFederatedAddress("bob*example.com", { fetchFn });
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });

  it("ignores a poisoned cached value and re-resolves", async () => {
    const redis = fakeRedis();
    const cache = cacheWith(redis);
    const key = buildValidatorCacheKey("federation", "bob*example.com");
    redis.store.set(key, JSON.stringify({ account_id: "GBAD" }));

    const fetchFn = makeFetch();
    expect(await resolveFederatedAddress("bob*example.com", { fetchFn, cache })).toEqual({ account_id: ACCOUNT });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});

describe("validator throughput telemetry", () => {
  beforeEach(() => resetValidatorMetrics());

  it("reports evaluations per second per operation over the window", () => {
    const now = 10_000_000;
    for (let i = 0; i < 120; i += 1) recordValidatorThroughput("public_key", now);
    recordValidatorThroughput("signature_verify", now);

    const rates = getValidatorThroughput(now);
    expect(rates.public_key).toBe(120 / THROUGHPUT_WINDOW_SECONDS);
    expect(rates.signature_verify).toBe(1 / THROUGHPUT_WINDOW_SECONDS);
  });

  it("decays to zero once traffic leaves the window", () => {
    const now = 10_000_000;
    recordValidatorThroughput("public_key", now);
    expect(getValidatorThroughput(now + (THROUGHPUT_WINDOW_SECONDS + 1) * 1000)).toEqual({});
  });

  it("bounds the tracked operations", () => {
    for (let i = 0; i < 100; i += 1) recordValidatorThroughput(`op_${i}`);
    expect(Object.keys(getValidatorThroughput()).length).toBeLessThanOrEqual(32);
  });

  it("is fed by real validator calls and exported as a gauge", async () => {
    isValidStellarPublicKey(ACCOUNT);
    isValidStellarPublicKey("nope");

    expect(getValidatorThroughput().public_key).toBeGreaterThan(0);
    const text = await validatorRegister.metrics();
    expect(text).toContain("stellar_validator_throughput_per_second");
    expect(text).toContain("stellar_validator_cache_operations_total");
  });
});
