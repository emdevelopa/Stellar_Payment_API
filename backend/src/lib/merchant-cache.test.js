import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeRedis } from "../../tests/helpers/fake-redis.js";
import {
  invalidateMerchantCache,
  merchantCacheKey,
  merchantGenerationKey,
  readThroughMerchantCache,
  resolveMerchantCacheTtlSeconds,
} from "./merchant-cache.js";
import {
  merchantLifecycleRegister,
  resetMerchantLifecycleMetrics,
} from "./merchant-lifecycle-metrics.js";

const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() };
const M = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

async function count(resource, result) {
  const metric = await merchantLifecycleRegister.getSingleMetric("merchant_cache_operations_total").get();
  return metric.values.find((v) => v.labels.resource === resource && v.labels.result === result)?.value ?? 0;
}

let redis;
let opts;

beforeEach(() => {
  vi.clearAllMocks();
  resetMerchantLifecycleMetrics();
  redis = createFakeRedis();
  opts = { getClient: async () => redis, logger, env: {} };
});

describe("readThroughMerchantCache", () => {
  it("loads once, then serves from Redis", async () => {
    const loader = vi.fn(async () => ({ merchant: { id: M } }));
    const first = await readThroughMerchantCache("profile", M, loader, opts);
    const second = await readThroughMerchantCache("profile", M, loader, opts);

    expect(first).toEqual({ value: { merchant: { id: M } }, cache: "miss" });
    expect(second).toEqual({ value: { merchant: { id: M } }, cache: "hit" });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(await count("profile", "hit")).toBe(1);
    expect(await count("profile", "miss")).toBe(1);
    expect(await count("profile", "store")).toBe(1);
  });

  it("stores entries with the configured TTL", async () => {
    await readThroughMerchantCache("branding", M, async () => ({ a: 1 }), {
      ...opts,
      env: { MERCHANT_CACHE_TTL_SECONDS: "5" },
    });
    const entry = redis.store.get(merchantCacheKey("branding", M, "0"));
    expect(entry.expiresAt - Date.now()).toBeLessThanOrEqual(5_000);
  });

  it("keeps merchants and resources apart", async () => {
    const other = "9b2c0b8e-0000-4000-8000-000000000000";
    await readThroughMerchantCache("profile", M, async () => ({ who: "A" }), opts);
    const b = await readThroughMerchantCache("profile", other, async () => ({ who: "B" }), opts);
    const c = await readThroughMerchantCache("branding", M, async () => ({ what: "branding" }), opts);
    expect(b.value).toEqual({ who: "B" });
    expect(c.value).toEqual({ what: "branding" });
  });

  it("does not cache null (e.g. 404) results", async () => {
    const loader = vi.fn(async () => null);
    await readThroughMerchantCache("profile", M, loader, opts);
    await readThroughMerchantCache("profile", M, loader, opts);
    expect(loader).toHaveBeenCalledTimes(2);
    expect(redis.keys("merchant:cache:v1:profile")).toHaveLength(0);
  });

  it("propagates loader errors without caching", async () => {
    const boom = Object.assign(new Error("db down"), { status: 500 });
    await expect(readThroughMerchantCache("profile", M, async () => { throw boom; }, opts)).rejects.toBe(boom);
    expect(redis.keys("merchant:cache:v1:profile")).toHaveLength(0);
  });

  it("falls back to the database when Redis fails, and says so", async () => {
    redis.setFailure(new Error("ECONNRESET"));
    const loader = vi.fn(async () => ({ ok: true }));
    const result = await readThroughMerchantCache("profile", M, loader, opts);
    expect(result).toEqual({ value: { ok: true }, cache: "bypass" });
    expect(await count("profile", "bypass")).toBe(1);
  });

  it("bypasses when Redis is unavailable (no-op client)", async () => {
    const result = await readThroughMerchantCache("profile", M, async () => 1, {
      ...opts,
      getClient: async () => ({ isOpen: false }),
    });
    expect(result.cache).toBe("bypass");
  });

  it("bypasses when disabled or when the merchant id is not key-safe", async () => {
    const disabled = await readThroughMerchantCache("profile", M, async () => 1, {
      ...opts,
      env: { MERCHANT_CACHE_ENABLED: "false" },
    });
    const unsafe = await readThroughMerchantCache("profile", "a:b*c", async () => 2, opts);
    expect(disabled.cache).toBe("bypass");
    expect(unsafe.cache).toBe("bypass");
    expect(redis.calls).toHaveLength(0);
  });

  it("treats a corrupt entry as a miss and reloads", async () => {
    await redis.set(merchantCacheKey("profile", M, "0"), "{oops");
    const loader = vi.fn(async () => ({ fresh: true }));
    const result = await readThroughMerchantCache("profile", M, loader, opts);
    expect(result).toEqual({ value: { fresh: true }, cache: "miss" });
    expect(await count("profile", "error")).toBe(1);
  });

  it("rejects unknown resources", async () => {
    await expect(readThroughMerchantCache("api_key", M, async () => 1, opts)).rejects.toThrow(TypeError);
  });
});

describe("invalidateMerchantCache", () => {
  it("makes the next read go to the database", async () => {
    let version = 1;
    const loader = vi.fn(async () => ({ version }));
    await readThroughMerchantCache("branding", M, loader, opts);
    version = 2;
    expect(await invalidateMerchantCache(M, opts)).toBe(true);
    const after = await readThroughMerchantCache("branding", M, loader, opts);
    expect(after).toEqual({ value: { version: 2 }, cache: "miss" });
    expect(await redis.get(merchantGenerationKey(M))).toBe("1");
  });

  it("a reader racing a writer cannot re-populate the stale value", async () => {
    // Reader reads the generation, then the DB (old row) ...
    let release;
    const gate = new Promise((r) => { release = r; });
    const slowRead = readThroughMerchantCache("profile", M, async () => {
      await gate;
      return { version: "old" };
    }, opts);
    await new Promise((r) => setTimeout(r, 5));

    // ... meanwhile the writer commits and invalidates.
    await invalidateMerchantCache(M, opts);
    release();
    await slowRead;

    // The stale row went to the old generation; readers now see the new one.
    const next = await readThroughMerchantCache("profile", M, async () => ({ version: "new" }), opts);
    expect(next).toEqual({ value: { version: "new" }, cache: "miss" });
  });

  it("never throws; failures are logged and counted", async () => {
    redis.setFailure(new Error("down"));
    expect(await invalidateMerchantCache(M, opts)).toBe(false);
    expect(logger.warn).toHaveBeenCalled();
    expect(await count("all", "invalidate_error")).toBe(1);
  });

  it("is a counted no-op when Redis is unavailable", async () => {
    const ok = await invalidateMerchantCache(M, { ...opts, getClient: async () => ({ isOpen: false }) });
    expect(ok).toBe(false);
    expect(await count("all", "invalidate_skipped")).toBe(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("ignores unsafe ids", async () => {
    expect(await invalidateMerchantCache("x y", opts)).toBe(false);
    expect(redis.calls).toHaveLength(0);
  });
});

describe("resolveMerchantCacheTtlSeconds", () => {
  it("defaults to 60s and clamps to [1, 900]", () => {
    expect(resolveMerchantCacheTtlSeconds({})).toBe(60);
    expect(resolveMerchantCacheTtlSeconds({ MERCHANT_CACHE_TTL_SECONDS: "100000" })).toBe(900);
    expect(resolveMerchantCacheTtlSeconds({ MERCHANT_CACHE_TTL_SECONDS: "-3" })).toBe(1);
  });
});
