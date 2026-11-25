import { describe, expect, it, vi } from "vitest";
import { createFakeRedis } from "../../tests/helpers/fake-redis.js";
import {
  cacheBumpGeneration,
  cacheDelete,
  cacheGetGeneration,
  cacheGetJson,
  cacheSetJson,
  resolveBoundedInt,
  resolveCacheClient,
  resolveCacheOpTimeoutMs,
  withTimeout,
} from "./redis-json-cache.js";

describe("resolveBoundedInt / resolveCacheOpTimeoutMs", () => {
  it("falls back on junk and clamps to bounds", () => {
    const opts = { fallback: 5, min: 1, max: 10 };
    expect(resolveBoundedInt(undefined, opts)).toBe(5);
    expect(resolveBoundedInt("abc", opts)).toBe(5);
    expect(resolveBoundedInt("0", opts)).toBe(1);
    expect(resolveBoundedInt("999", opts)).toBe(10);
    expect(resolveBoundedInt("7", opts)).toBe(7);
    expect(resolveCacheOpTimeoutMs({})).toBe(150);
    expect(resolveCacheOpTimeoutMs({ REDIS_CACHE_OP_TIMEOUT_MS: "1" })).toBe(10);
  });
});

describe("withTimeout", () => {
  it("rejects when the operation is slower than the budget", async () => {
    await expect(withTimeout(new Promise(() => {}), 10)).rejects.toThrow(/timed out/);
    await expect(withTimeout(Promise.resolve(1), 50)).resolves.toBe(1);
  });
});

describe("resolveCacheClient", () => {
  it("treats the no-op fallback (isOpen:false), errors and slow connects as unavailable", async () => {
    expect(await resolveCacheClient(async () => ({ isOpen: false }))).toBeNull();
    expect(await resolveCacheClient(async () => { throw new Error("down"); })).toBeNull();
    expect(await resolveCacheClient(() => new Promise(() => {}), 10)).toBeNull();
    const fake = createFakeRedis();
    expect(await resolveCacheClient(async () => fake)).toBe(fake);
  });
});

describe("JSON get/set/delete", () => {
  it("round-trips values with a TTL", async () => {
    const redis = createFakeRedis();
    expect((await cacheGetJson(redis, "k")).status).toBe("miss");
    expect(await cacheSetJson(redis, "k", { a: 1 }, 30)).toBe(true);
    expect(await cacheGetJson(redis, "k")).toEqual({ status: "hit", value: { a: 1 } });
    expect(redis.store.get("k").expiresAt).toBeGreaterThan(Date.now());
    expect(await cacheDelete(redis, ["k"])).toBe(true);
    expect((await cacheGetJson(redis, "k")).status).toBe("miss");
  });

  it("refuses invalid TTLs and undefined values", async () => {
    const redis = createFakeRedis();
    expect(await cacheSetJson(redis, "k", 1, 0)).toBe(false);
    expect(await cacheSetJson(redis, "k", 1, 1.5)).toBe(false);
    expect(await cacheSetJson(redis, "k", undefined, 10)).toBe(false);
    expect(redis.store.size).toBe(0);
  });

  it("reports and evicts corrupt entries instead of serving them", async () => {
    const redis = createFakeRedis();
    await redis.set("k", "{not json");
    const result = await cacheGetJson(redis, "k");
    expect(result.status).toBe("error");
    await new Promise((r) => setTimeout(r, 0));
    expect(redis.store.has("k")).toBe(false);
  });

  it("never throws when Redis fails or is missing", async () => {
    const redis = createFakeRedis();
    redis.setFailure(new Error("READONLY"));
    expect((await cacheGetJson(redis, "k")).status).toBe("error");
    expect(await cacheSetJson(redis, "k", 1, 10)).toBe(false);
    expect(await cacheDelete(redis, ["k"])).toBe(false);
    expect((await cacheGetJson(null, "k")).status).toBe("error");
    expect(await cacheSetJson(null, "k", 1, 10)).toBe(false);
  });

  it("times out a hung Redis call", async () => {
    const hung = { get: () => new Promise(() => {}) };
    const result = await cacheGetJson(hung, "k", { timeoutMs: 10 });
    expect(result.status).toBe("error");
  });
});

describe("generation counters", () => {
  it("reads a missing generation as 0 and bumps it atomically with a TTL", async () => {
    const redis = createFakeRedis();
    expect(await cacheGetGeneration(redis, "g")).toBe("0");
    expect(await cacheBumpGeneration(redis, "g", 60)).toBe(true);
    expect(await cacheBumpGeneration(redis, "g", 60)).toBe(true);
    expect(await cacheGetGeneration(redis, "g")).toBe("2");
    expect(redis.store.get("g").expiresAt).toBeGreaterThan(Date.now());
  });

  it("returns null for unreadable or tampered generations", async () => {
    const redis = createFakeRedis();
    await redis.set("g", "not-a-number");
    expect(await cacheGetGeneration(redis, "g")).toBeNull();
    redis.setFailure(new Error("down"));
    expect(await cacheGetGeneration(redis, "g")).toBeNull();
    expect(await cacheBumpGeneration(redis, "g", 60)).toBe(false);
    expect(await cacheBumpGeneration({}, "g", 60)).toBe(false);
  });
});
