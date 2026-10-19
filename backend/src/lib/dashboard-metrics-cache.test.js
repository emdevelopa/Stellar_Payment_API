import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dashboardMetricsCacheKey,
  getCachedDashboardMetrics,
  setCachedDashboardMetrics,
  readThroughDashboardCache,
  DASHBOARD_METRICS_CACHE_TTL_SECONDS,
} from "./dashboard-metrics-cache.js";
import { dashboardMetricsCacheHitTotal, dashboardMetricsCacheMissTotal } from "./metrics.js";

function createFakeRedisClient() {
  const store = new Map();
  return {
    store,
    get: vi.fn(async (key) => (store.has(key) ? store.get(key) : null)),
    set: vi.fn(async (key, value) => {
      store.set(key, value);
      return "OK";
    }),
  };
}

describe("dashboardMetricsCacheKey", () => {
  it("scopes the key by endpoint and merchant", () => {
    expect(dashboardMetricsCacheKey("summary", "merchant-1")).toBe(
      "dashboard:summary:merchant-1",
    );
  });

  it("appends a variant segment when provided (e.g. volume range)", () => {
    expect(dashboardMetricsCacheKey("volume", "merchant-1", "7D")).toBe(
      "dashboard:volume:merchant-1:7D",
    );
  });

  it("produces distinct keys for different merchants", () => {
    expect(dashboardMetricsCacheKey("revenue", "merchant-1")).not.toBe(
      dashboardMetricsCacheKey("revenue", "merchant-2"),
    );
  });
});

describe("getCachedDashboardMetrics / setCachedDashboardMetrics", () => {
  beforeEach(() => {
    dashboardMetricsCacheHitTotal.reset();
    dashboardMetricsCacheMissTotal.reset();
  });

  it("returns null and records a miss when the key is absent", async () => {
    const client = createFakeRedisClient();

    const result = await getCachedDashboardMetrics(client, "summary", "dashboard:summary:m1");

    expect(result).toBeNull();
    const misses = await dashboardMetricsCacheMissTotal.get();
    expect(misses.values).toContainEqual(
      expect.objectContaining({ labels: { endpoint: "summary" }, value: 1 }),
    );
  });

  it("stores JSON and reads it back as an object, recording a hit", async () => {
    const client = createFakeRedisClient();
    await setCachedDashboardMetrics(client, "dashboard:revenue:m1", { revenue: [1, 2] });

    const result = await getCachedDashboardMetrics(client, "revenue", "dashboard:revenue:m1");

    expect(result).toEqual({ revenue: [1, 2] });
    const hits = await dashboardMetricsCacheHitTotal.get();
    expect(hits.values).toContainEqual(
      expect.objectContaining({ labels: { endpoint: "revenue" }, value: 1 }),
    );
  });

  it("passes the configured TTL to the underlying client on set", async () => {
    const client = createFakeRedisClient();
    await setCachedDashboardMetrics(client, "dashboard:summary:m1", { ok: true });

    expect(client.set).toHaveBeenCalledWith(
      "dashboard:summary:m1",
      JSON.stringify({ ok: true }),
      { EX: DASHBOARD_METRICS_CACHE_TTL_SECONDS },
    );
  });

  it("treats a GET error as a miss instead of throwing", async () => {
    const client = { get: vi.fn().mockRejectedValue(new Error("connection reset")) };

    const result = await getCachedDashboardMetrics(client, "summary", "dashboard:summary:m1");

    expect(result).toBeNull();
    const misses = await dashboardMetricsCacheMissTotal.get();
    expect(misses.values).toContainEqual(
      expect.objectContaining({ labels: { endpoint: "summary" }, value: 1 }),
    );
  });

  it("swallows a SET error without throwing", async () => {
    const client = { set: vi.fn().mockRejectedValue(new Error("connection reset")) };

    await expect(
      setCachedDashboardMetrics(client, "dashboard:summary:m1", { ok: true }),
    ).resolves.toBeUndefined();
  });
});

describe("readThroughDashboardCache", () => {
  it("calls the loader and caches its result on a miss", async () => {
    const client = createFakeRedisClient();
    const loader = vi.fn().mockResolvedValue({ total: 42 });

    const result = await readThroughDashboardCache(client, "summary", "dashboard:summary:m1", loader);

    expect(result).toEqual({ total: 42 });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(client.store.get("dashboard:summary:m1")).toBe(JSON.stringify({ total: 42 }));
  });

  it("returns the cached value without calling the loader on a hit", async () => {
    const client = createFakeRedisClient();
    client.store.set("dashboard:summary:m1", JSON.stringify({ total: 99 }));
    const loader = vi.fn();

    const result = await readThroughDashboardCache(client, "summary", "dashboard:summary:m1", loader);

    expect(result).toEqual({ total: 99 });
    expect(loader).not.toHaveBeenCalled();
  });

  it("propagates a loader error uncached", async () => {
    const client = createFakeRedisClient();
    const loader = vi.fn().mockRejectedValue(new Error("db down"));

    await expect(
      readThroughDashboardCache(client, "summary", "dashboard:summary:m1", loader),
    ).rejects.toThrow("db down");
    expect(client.store.has("dashboard:summary:m1")).toBe(false);
  });
});
