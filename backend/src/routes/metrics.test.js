import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRequireApiKeyAuth,
  mockAuthMiddleware,
  mockGetMonthlySummary,
  mockGetRevenueByAsset,
  mockGetVolumeOverTime,
  mockConnectRedisClient,
} = vi.hoisted(() => ({
  mockAuthMiddleware: (req, _res, next) => {
    req.merchant = { id: "merchant_123" };
    next();
  },
  mockRequireApiKeyAuth: vi.fn(),
  mockGetMonthlySummary: vi.fn(),
  mockGetRevenueByAsset: vi.fn(),
  mockGetVolumeOverTime: vi.fn(),
  mockConnectRedisClient: vi.fn(),
}));

vi.mock("../lib/auth.js", () => ({
  requireApiKeyAuth: mockRequireApiKeyAuth,
}));

vi.mock("../services/metricService.js", () => ({
  metricService: {
    getMonthlySummary: mockGetMonthlySummary,
    getRevenueByAsset: mockGetRevenueByAsset,
    getVolumeOverTime: mockGetVolumeOverTime,
  },
}));

vi.mock("../lib/redis.js", () => ({
  connectRedisClient: mockConnectRedisClient,
}));

import createMetricsRouter from "./metrics.js";
import {
  dashboardMetricsRequestsTotal,
  dashboardMetricsRequestDuration,
  dashboardMetricsErrorsTotal,
  dashboardMetricsCacheHitTotal,
  dashboardMetricsCacheMissTotal,
} from "../lib/metrics.js";

/** In-memory stand-in for a Redis client, backing the read-through cache. */
function createFakeRedisClient({ failGet = false, failSet = false } = {}) {
  const store = new Map();
  return {
    store,
    async get(key) {
      if (failGet) throw new Error("redis get failed");
      return store.has(key) ? store.get(key) : null;
    },
    async set(key, value) {
      if (failSet) throw new Error("redis set failed");
      store.set(key, value);
      return "OK";
    },
  };
}

function createApp({ dashboardMetricsRateLimit } = {}) {
  const app = express();
  app.use(express.json());
  app.locals.pool = {};
  app.use("/api", createMetricsRouter({ dashboardMetricsRateLimit }));
  return app;
}

describe("Metrics (Admin Dashboard) routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireApiKeyAuth.mockReturnValue(mockAuthMiddleware);
    // Fresh, empty-store client per test so every request is a cache miss
    // and existing assertions about metricService being called still hold.
    mockConnectRedisClient.mockResolvedValue(createFakeRedisClient());
  });

  it("requires a signed API key request (requireApiKeyAuth invoked with requireSignature: true)", async () => {
    mockGetMonthlySummary.mockResolvedValue({ last_month: {}, current_month: {} });

    const app = createApp({ dashboardMetricsRateLimit: (_req, _res, next) => next() });
    await request(app).get("/api/metrics/summary");

    expect(mockRequireApiKeyAuth).toHaveBeenCalledWith({ requireSignature: true });
  });

  it("returns 429 when the dashboard rate limit rejects the request", async () => {
    const rateLimited = (_req, res) =>
      res.status(429).json({ error: "Too many dashboard requests, please try again later." });

    const app = createApp({ dashboardMetricsRateLimit: rateLimited });
    const response = await request(app).get("/api/metrics/revenue");

    expect(response.status).toBe(429);
    expect(mockGetRevenueByAsset).not.toHaveBeenCalled();
  });

  it("GET /api/metrics/summary returns the monthly summary for the authenticated merchant", async () => {
    mockGetMonthlySummary.mockResolvedValue({
      last_month: { by_asset: [], total: 0 },
      current_month: { by_asset: [], total: 0 },
    });

    const app = createApp({ dashboardMetricsRateLimit: (_req, _res, next) => next() });
    const response = await request(app).get("/api/metrics/summary");

    expect(response.status).toBe(200);
    expect(mockGetMonthlySummary).toHaveBeenCalledWith("merchant_123");
  });

  it("GET /api/metrics/volume validates the range query param", async () => {
    const app = createApp({ dashboardMetricsRateLimit: (_req, _res, next) => next() });
    const response = await request(app).get("/api/metrics/volume?range=BOGUS");

    expect(response.status).toBe(400);
    expect(mockGetVolumeOverTime).not.toHaveBeenCalled();
  });

  it("GET /api/metrics/volume delegates to metricService for a valid range", async () => {
    mockGetVolumeOverTime.mockResolvedValue({ range: "7D", assets: [], data: [] });

    const app = createApp({ dashboardMetricsRateLimit: (_req, _res, next) => next() });
    const response = await request(app).get("/api/metrics/volume?range=7D");

    expect(response.status).toBe(200);
    expect(mockGetVolumeOverTime).toHaveBeenCalledWith("merchant_123", "7D");
  });
});

describe("Metrics (Admin Dashboard) granular request tracking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireApiKeyAuth.mockReturnValue(mockAuthMiddleware);
    mockConnectRedisClient.mockResolvedValue(createFakeRedisClient());
    dashboardMetricsRequestsTotal.reset();
    dashboardMetricsRequestDuration.reset();
    dashboardMetricsErrorsTotal.reset();
  });

  it("records a request count and latency observation for a successful call", async () => {
    mockGetRevenueByAsset.mockResolvedValue({ revenue: [] });

    const app = createApp({ dashboardMetricsRateLimit: (_req, _res, next) => next() });
    await request(app).get("/api/metrics/revenue");

    const requests = await dashboardMetricsRequestsTotal.get();
    expect(requests.values).toContainEqual(
      expect.objectContaining({
        labels: { endpoint: "revenue", status_code: "200" },
        value: 1,
      }),
    );

    const duration = await dashboardMetricsRequestDuration.get();
    const revenueDuration = duration.values.find(
      (v) => v.labels.endpoint === "revenue" && v.metricName?.endsWith("_count"),
    );
    expect(revenueDuration?.value).toBe(1);
  });

  it("records an error count and a 500 request count when the service throws", async () => {
    mockGetMonthlySummary.mockRejectedValue(new Error("db unavailable"));

    const app = createApp({ dashboardMetricsRateLimit: (_req, _res, next) => next() });
    const response = await request(app).get("/api/metrics/summary");

    expect(response.status).toBe(500);

    const errors = await dashboardMetricsErrorsTotal.get();
    expect(errors.values).toContainEqual(
      expect.objectContaining({
        labels: { endpoint: "summary", error_type: "internal" },
        value: 1,
      }),
    );

    const requests = await dashboardMetricsRequestsTotal.get();
    expect(requests.values).toContainEqual(
      expect.objectContaining({
        labels: { endpoint: "summary", status_code: "500" },
        value: 1,
      }),
    );
  });

  it("does not record dashboard metrics when the rate limiter rejects the request first", async () => {
    const rateLimited = (_req, res) => res.status(429).json({ error: "rate limited" });
    const app = createApp({ dashboardMetricsRateLimit: rateLimited });

    await request(app).get("/api/metrics/summary");

    const requests = await dashboardMetricsRequestsTotal.get();
    expect(requests.values).toHaveLength(0);
  });
});

describe("Metrics (Admin Dashboard) caching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireApiKeyAuth.mockReturnValue(mockAuthMiddleware);
    dashboardMetricsCacheHitTotal.reset();
    dashboardMetricsCacheMissTotal.reset();
  });

  it("serves the second request from cache without calling metricService again", async () => {
    const redis = createFakeRedisClient();
    mockConnectRedisClient.mockResolvedValue(redis);
    mockGetRevenueByAsset.mockResolvedValue({ revenue: [{ asset: "USDC", total: "10" }] });

    const app = createApp({ dashboardMetricsRateLimit: (_req, _res, next) => next() });

    const first = await request(app).get("/api/metrics/revenue");
    const second = await request(app).get("/api/metrics/revenue");

    expect(first.body).toEqual({ revenue: [{ asset: "USDC", total: "10" }] });
    expect(second.body).toEqual(first.body);
    expect(mockGetRevenueByAsset).toHaveBeenCalledTimes(1);

    const hits = await dashboardMetricsCacheHitTotal.get();
    expect(hits.values).toContainEqual(
      expect.objectContaining({ labels: { endpoint: "revenue" }, value: 1 }),
    );
  });

  it("scopes the volume cache key by range so different ranges don't collide", async () => {
    const redis = createFakeRedisClient();
    mockConnectRedisClient.mockResolvedValue(redis);
    mockGetVolumeOverTime
      .mockResolvedValueOnce({ range: "7D", assets: [], data: [] })
      .mockResolvedValueOnce({ range: "30D", assets: [], data: [] });

    const app = createApp({ dashboardMetricsRateLimit: (_req, _res, next) => next() });

    await request(app).get("/api/metrics/volume?range=7D");
    await request(app).get("/api/metrics/volume?range=30D");
    await request(app).get("/api/metrics/volume?range=7D");

    // Two distinct ranges each fetched once; the repeated 7D request hit cache.
    expect(mockGetVolumeOverTime).toHaveBeenCalledTimes(2);
    expect(redis.store.size).toBe(2);
  });

  it("falls back to the DB and still responds when the cache read fails", async () => {
    mockConnectRedisClient.mockResolvedValue(createFakeRedisClient({ failGet: true, failSet: true }));
    mockGetMonthlySummary.mockResolvedValue({ last_month: {}, current_month: {} });

    const app = createApp({ dashboardMetricsRateLimit: (_req, _res, next) => next() });
    const response = await request(app).get("/api/metrics/summary");

    expect(response.status).toBe(200);
    expect(mockGetMonthlySummary).toHaveBeenCalledTimes(1);

    const misses = await dashboardMetricsCacheMissTotal.get();
    expect(misses.values).toContainEqual(
      expect.objectContaining({ labels: { endpoint: "summary" }, value: 1 }),
    );
  });

  it("never leaks a cached response across merchants", async () => {
    const redis = createFakeRedisClient();
    mockConnectRedisClient.mockResolvedValue(redis);
    mockGetRevenueByAsset
      .mockResolvedValueOnce({ revenue: [{ asset: "USDC", total: "1" }] })
      .mockResolvedValueOnce({ revenue: [{ asset: "USDC", total: "2" }] });

    const authAsMerchant = (id) => (req, _res, next) => {
      req.merchant = { id };
      next();
    };

    mockRequireApiKeyAuth.mockReturnValue(authAsMerchant("merchant_A"));
    const appA = createApp({ dashboardMetricsRateLimit: (_req, _res, next) => next() });
    const responseA = await request(appA).get("/api/metrics/revenue");

    mockRequireApiKeyAuth.mockReturnValue(authAsMerchant("merchant_B"));
    const appB = createApp({ dashboardMetricsRateLimit: (_req, _res, next) => next() });
    const responseB = await request(appB).get("/api/metrics/revenue");

    expect(responseA.body).toEqual({ revenue: [{ asset: "USDC", total: "1" }] });
    expect(responseB.body).toEqual({ revenue: [{ asset: "USDC", total: "2" }] });
    expect(mockGetRevenueByAsset).toHaveBeenCalledTimes(2);
  });
});
