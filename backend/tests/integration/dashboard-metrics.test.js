import request from "supertest";
process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
process.env.DATABASE_URL ||= "postgresql://postgres:postgres@127.0.0.1:5432/postgres";
// Nothing is listening on the default Redis port in CI/sandboxed test runs;
// keep the real connectRedisClient() fallback fast rather than waiting out
// its default 4s timeout for every no-op-fallback path exercised below.
process.env.REDIS_CONNECT_TIMEOUT_MS ||= "100";
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { signApiGatewayRequest } from "../../src/lib/api-gateway-signature.js";
import { _resetAuthFailStateForTests } from "../../src/lib/auth.js";
import { _resetApiGatewayRateLimitStateForTests } from "../../src/lib/api-gateway-signature.js";

/**
 * True end-to-end coverage for the Admin Dashboard Service (issue #1091):
 * boots the real Express app and exercises the full /api/metrics/* request
 * cycle - real HMAC request signing/verification, real Zod query validation,
 * the real rate limiter, the real read-through Redis cache, and the real
 * Prometheus instrumentation added in #1093/#1090 - rather than unit-testing
 * the route/service modules in isolation the way routes/metrics.test.js and
 * services/metricService.test.js already do.
 *
 * There's no live Postgres in this environment (matching the other
 * tests/integration/*.test.js files, several of which already fail without
 * one - see e.g. payments.test.js), so the lowest DB boundary - pool-backed
 * queries in lib/db.js and the RLS transaction wrapper in lib/db-rls.js - is
 * stubbed with realistic fixture rows. Everything above that boundary is the
 * real, unmocked application code.
 */

const TEST_API_KEY = "e2e-test-merchant-api-key-000000"; // >= MIN_SECRET_LENGTH (16)
const TEST_MERCHANT_ID = "merchant-e2e-1";

const baseMerchantRow = {
  id: TEST_MERCHANT_ID,
  email: "merchant@example.com",
  business_name: "E2E Test Merchant",
  notification_email: null,
  branding_config: null,
  merchant_settings: null,
  webhook_secret: null,
  webhook_secret_old: null,
  webhook_secret_expiry: null,
  webhook_version: 1,
  payment_limits: null,
  api_key: TEST_API_KEY,
  api_key_expires_at: null,
  api_key_old: null,
  api_key_old_expires_at: null,
};

const mockQueryWithRetry = vi.fn();
const mockWithMerchantContext = vi.fn();
const mockConnectRedisClient = vi.fn();

vi.mock("../../src/lib/db.js", () => ({
  pool: {},
  circuitBreaker: { execute: (fn) => fn() },
  isRetryablePoolError: () => false,
  queryWithRetry: (...args) => mockQueryWithRetry(...args),
  closePool: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/lib/db-rls.js", () => ({
  withMerchantContext: (...args) => mockWithMerchantContext(...args),
}));

vi.mock("../../src/lib/redis.js", () => ({
  connectRedisClient: (...args) => mockConnectRedisClient(...args),
}));

/** In-memory stand-in for a Redis client, backing the read-through cache. */
function createFakeRedisClient() {
  const store = new Map();
  return {
    store,
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async set(key, value) {
      store.set(key, value);
      return "OK";
    },
  };
}

function mockMerchantRow(overrides = {}) {
  return { ...baseMerchantRow, ...overrides };
}

/** Default fixture wiring: a valid merchant + realistic payment aggregates. */
function wireDefaultFixtures({ merchantRow = mockMerchantRow() } = {}) {
  mockQueryWithRetry.mockImplementation(async (text) => {
    if (text.includes("FROM merchants")) {
      return { rows: [merchantRow] };
    }
    if (text.includes("SUM(amount) as total")) {
      return { rows: [{ asset: "USDC", asset_issuer: "GISSUER", total: "500", count: "4" }] };
    }
    if (text.includes("date_trunc")) {
      return {
        rows: [{ date: new Date(), asset: "USDC", volume: "100", count: "2" }],
      };
    }
    return { rows: [] };
  });

  mockWithMerchantContext.mockImplementation(async (_merchantId, callback) =>
    callback({
      query: async () => ({
        rows: [
          {
            asset: "USDC",
            asset_issuer: "GISSUER",
            last_month_total: "200.0000000",
            last_month_count: 2,
            current_month_total: "300.0000000",
            current_month_count: 3,
          },
        ],
      }),
    }),
  );
}

/** Sign and send a GET request the way a real API gateway client would. */
function signedGet(app, path, { apiKey = TEST_API_KEY, omitSignature = false } = {}) {
  const req = request(app).get(path);
  if (!apiKey) {
    return req;
  }
  req.set("x-api-key", apiKey);
  if (omitSignature) {
    return req;
  }
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = signApiGatewayRequest({ secret: apiKey, method: "GET", path, timestamp, body: {} });
  return req.set("x-api-signature", `sha256=${signature}`).set("x-api-timestamp", timestamp);
}

describe("Admin Dashboard Service (Metrics) - end-to-end", () => {
  let app;

  beforeAll(async () => {
    const { createApp } = await import("../../src/app.js");
    // Keep app.locals' redisClient "unavailable" so the dashboard rate
    // limiter uses its in-memory store, matching the other integration
    // tests in this directory (auth.test.js, prometheus.test.js).
    const mockAppRedisClient = { ping: vi.fn().mockResolvedValue("PONG"), on: vi.fn() };
    ({ app } = await createApp({ redisClient: mockAppRedisClient }));
  });

  beforeEach(() => {
    mockQueryWithRetry.mockReset();
    mockWithMerchantContext.mockReset();
    mockConnectRedisClient.mockReset();
    mockConnectRedisClient.mockResolvedValue(createFakeRedisClient());
    _resetAuthFailStateForTests();
    _resetApiGatewayRateLimitStateForTests();
    wireDefaultFixtures();
  });

  describe("authentication", () => {
    it("rejects a request with no x-api-key header", async () => {
      const res = await request(app).get("/api/metrics/summary");
      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/x-api-key/i);
    });

    it("rejects a request missing the required signature headers", async () => {
      const res = await signedGet(app, "/api/metrics/summary", { omitSignature: true });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("API_SIGNATURE_REQUIRED");
    });

    it("rejects a request signed with the wrong secret", async () => {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const badSignature = signApiGatewayRequest({
        secret: "a-completely-different-secret-16",
        method: "GET",
        path: "/api/metrics/summary",
        timestamp,
        body: {},
      });

      const res = await request(app)
        .get("/api/metrics/summary")
        .set("x-api-key", TEST_API_KEY)
        .set("x-api-signature", `sha256=${badSignature}`)
        .set("x-api-timestamp", timestamp);

      expect(res.status).toBe(401);
      expect(res.body.code).toBe("API_SIGNATURE_INVALID");
    });

    it("rejects an unknown API key", async () => {
      mockQueryWithRetry.mockImplementation(async (text) =>
        text.includes("FROM merchants") ? { rows: [] } : { rows: [] },
      );

      const res = await signedGet(app, "/api/metrics/summary", { apiKey: "unknown-key-0000000000000000" });
      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/invalid api key/i);
    });

    it("rejects an expired API key", async () => {
      wireDefaultFixtures({
        merchantRow: mockMerchantRow({ api_key_expires_at: new Date(Date.now() - 60_000).toISOString() }),
      });

      const res = await signedGet(app, "/api/metrics/summary");
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("API_KEY_EXPIRED");
    });
  });

  describe("successful requests", () => {
    it("GET /api/metrics/summary returns the monthly revenue summary", async () => {
      const res = await signedGet(app, "/api/metrics/summary");

      expect(res.status).toBe(200);
      expect(res.body.last_month.by_asset).toEqual([
        { asset: "USDC", asset_issuer: "GISSUER", total: "200.0000000", count: 2 },
      ]);
      expect(res.body.current_month.total).toBe(300);
    });

    it("GET /api/metrics/revenue returns aggregate revenue by asset", async () => {
      const res = await signedGet(app, "/api/metrics/revenue");

      expect(res.status).toBe(200);
      expect(res.body.revenue).toEqual([
        { asset: "USDC", asset_issuer: "GISSUER", total: "500", count: 4 },
      ]);
    });

    it("GET /api/metrics/volume?range=7D returns 7 days of volume data", async () => {
      const res = await signedGet(app, "/api/metrics/volume?range=7D");

      expect(res.status).toBe(200);
      expect(res.body.range).toBe("7D");
      expect(res.body.data).toHaveLength(7);
    });

    it("GET /api/metrics/volume defaults to a 7D range when omitted", async () => {
      const res = await signedGet(app, "/api/metrics/volume");

      expect(res.status).toBe(200);
      expect(res.body.range).toBe("7D");
    });
  });

  describe("input validation", () => {
    it("rejects an invalid volume range before touching the service layer", async () => {
      const res = await signedGet(app, "/api/metrics/volume?range=BOGUS");

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
      expect(mockWithMerchantContext).not.toHaveBeenCalled();
    });
  });

  describe("caching", () => {
    it("serves the second identical request from cache without re-querying the DB", async () => {
      const first = await signedGet(app, "/api/metrics/revenue");
      const dbCallsAfterFirst = mockQueryWithRetry.mock.calls.filter(([text]) =>
        text.includes("SUM(amount) as total"),
      ).length;

      const second = await signedGet(app, "/api/metrics/revenue");
      const dbCallsAfterSecond = mockQueryWithRetry.mock.calls.filter(([text]) =>
        text.includes("SUM(amount) as total"),
      ).length;

      expect(first.status).toBe(200);
      expect(second.body).toEqual(first.body);
      expect(dbCallsAfterFirst).toBe(1);
      expect(dbCallsAfterSecond).toBe(1); // no additional DB hit on the cached call
    });

    it("keeps volume caches distinct per requested range", async () => {
      await signedGet(app, "/api/metrics/volume?range=7D");
      await signedGet(app, "/api/metrics/volume?range=30D");

      const volumeCalls = mockQueryWithRetry.mock.calls.filter(([text]) =>
        text.includes("date_trunc"),
      ).length;
      expect(volumeCalls).toBe(2);
    });
  });

  describe("observability", () => {
    it("exposes granular dashboard request metrics on /metrics after real traffic", async () => {
      await signedGet(app, "/api/metrics/summary");

      const res = await request(app).get("/metrics");

      expect(res.status).toBe(200);
      expect(res.text).toContain("dashboard_metrics_requests_total");
      expect(res.text).toContain("dashboard_metrics_request_duration_seconds");
      expect(res.text).toContain('endpoint="summary"');
    });
  });

  describe("rate limiting", () => {
    // Exercise the real createDashboardMetricsRateLimit (real express-rate-
    // limit + real per-merchant keyGenerator) with a small explicit `max`,
    // mounted directly on the real metrics router. A full second app.js
    // instance (via vi.resetModules()) isn't used here because reloading
    // lib/metrics.js re-registers its Prometheus counters against
    // prom-client's module-level default registry, which persists across
    // resetModules() and throws on the second registration.
    it("returns 429 once a merchant exceeds the dashboard rate limit", async () => {
      const [{ default: createMetricsRouter }, { createDashboardMetricsRateLimit }, expressModule] =
        await Promise.all([
          import("../../src/routes/metrics.js"),
          import("../../src/lib/rate-limit.js"),
          import("express"),
        ]);
      const express = expressModule.default;

      const limitedApp = express();
      limitedApp.use(express.json());
      limitedApp.use(
        "/api",
        createMetricsRouter({
          dashboardMetricsRateLimit: createDashboardMetricsRateLimit({ max: 2 }),
        }),
      );

      await signedGet(limitedApp, "/api/metrics/summary");
      await signedGet(limitedApp, "/api/metrics/summary");
      const third = await signedGet(limitedApp, "/api/metrics/summary");

      expect(third.status).toBe(429);
      expect(third.body.code).toBe("DASHBOARD_METRICS_RATE_LIMITED");
    });
  });
});
