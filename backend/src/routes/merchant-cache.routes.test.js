/**
 * Route-level tests for the Merchant Onboarding and Key Lifecycle Route's
 * distributed cache and throughput telemetry (#1770).
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, fake } = vi.hoisted(() => ({
  db: { reads: 0, row: null, failReads: false },
  fake: { redis: null },
}));

function builder() {
  let lastPayload = null;
  const b = {
    select: () => b,
    eq: () => b,
    is: () => b,
    update: (payload) => {
      lastPayload = payload;
      db.row = { ...db.row, ...payload };
      return b;
    },
    maybeSingle: async () => {
      db.reads += 1;
      if (db.failReads) return { data: null, error: { message: "db down" } };
      return { data: db.row, error: null };
    },
    single: async () => {
      if (lastPayload) return { data: db.row, error: null };
      db.reads += 1;
      if (db.failReads) return { data: null, error: { message: "db down" } };
      return { data: db.row, error: null };
    },
    then: (resolve) => resolve({ data: lastPayload ? [{ id: db.row.id }] : null, error: null }),
  };
  return b;
}

vi.mock("../lib/supabase.js", () => ({ supabase: { from: vi.fn(() => builder()) } }));

vi.mock("../lib/redis.js", async () => {
  const { createFakeRedis } = await import("../../tests/helpers/fake-redis.js");
  fake.redis = createFakeRedis();
  return { connectRedisClient: async () => fake.redis };
});

const MERCHANT_ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const OTHER_ID = "9b2c0b8e-0000-4000-8000-000000000000";

vi.mock("../lib/auth.js", () => ({
  requireApiKeyAuth: () => (req, _res, next) => {
    const id = req.get("x-test-merchant") || MERCHANT_ID;
    req.merchant = { id, webhook_secret: db.row?.webhook_secret ?? null };
    next();
  },
  requireSessionAuth: () => (req, _res, next) => {
    req.merchant = { id: MERCHANT_ID };
    next();
  },
  hashPassword: vi.fn(async () => "hashed"),
}));

vi.mock("../lib/rate-limit.js", () => ({
  createMerchantSecurityActionRateLimit: () => (_req, _res, next) => next(),
}));
vi.mock("../lib/sep10-auth.js", () => ({ generateSessionToken: vi.fn(() => "t") }));
vi.mock("../lib/api-usage.js", () => ({ getMerchantApiUsage: vi.fn() }));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import createMerchantsRouter from "./merchants.js";
import {
  merchantLifecycleRegister,
  resetMerchantLifecycleMetrics,
} from "../lib/merchant-lifecycle-metrics.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/merchant-branding", (req, _res, next) => {
    req.merchant = { id: req.get("x-test-merchant") || MERCHANT_ID };
    next();
  });
  app.use(
    "/api",
    createMerchantsRouter({
      merchantRegistrationRateLimit: (_req, _res, next) => next(),
      merchantSecurityActionRateLimit: (_req, _res, next) => next(),
    }),
  );
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  return app;
}

async function metric(name) {
  return (await merchantLifecycleRegister.getSingleMetric(name).get()).values;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetMerchantLifecycleMetrics();
  fake.redis.store.clear();
  db.reads = 0;
  db.failReads = false;
  db.row = {
    id: MERCHANT_ID,
    email: "m@example.com",
    business_name: "Shop",
    notification_email: "m@example.com",
    merchant_settings: null,
    created_at: "2026-01-01T00:00:00.000Z",
    branding_config: { primary_color: "#111111" },
    webhook_url: "https://hooks.example.com",
    webhook_secret: "whsec_supersecretvalue1234567890",
    subscribed_events: null,
    metadata: {},
  };
});

describe("GET /api/merchant-profile", () => {
  it("serves the second read from Redis", async () => {
    const app = buildApp();
    const first = await request(app).get("/api/merchant-profile");
    const second = await request(app).get("/api/merchant-profile");

    expect(first.status).toBe(200);
    expect(first.headers["x-cache"]).toBe("MISS");
    expect(second.headers["x-cache"]).toBe("HIT");
    expect(second.headers["cache-control"]).toBe("private, no-store");
    expect(second.body).toEqual(first.body);
    expect(db.reads).toBe(1);
  });

  it("never serves one merchant's cached profile to another", async () => {
    const app = buildApp();
    await request(app).get("/api/merchant-profile");
    db.row = { ...db.row, id: OTHER_ID, email: "other@example.com" };
    const other = await request(app).get("/api/merchant-profile").set("x-test-merchant", OTHER_ID);
    expect(other.headers["x-cache"]).toBe("MISS");
    expect(other.body.merchant.email).toBe("other@example.com");
  });

  it("does not cache a 404", async () => {
    db.row = null;
    const app = buildApp();
    expect((await request(app).get("/api/merchant-profile")).status).toBe(404);
    expect((await request(app).get("/api/merchant-profile")).status).toBe(404);
    expect(db.reads).toBe(2);
  });

  it("returns 500 on a database error and caches nothing", async () => {
    db.failReads = true;
    const app = buildApp();
    expect((await request(app).get("/api/merchant-profile")).status).toBe(500);
    expect(fake.redis.keys("merchant:cache:v1:profile")).toHaveLength(0);
  });

  it("keeps serving from the database when Redis fails", async () => {
    const app = buildApp();
    fake.redis.setFailure(new Error("ECONNRESET"));
    try {
      const res = await request(app).get("/api/merchant-profile");
      expect(res.status).toBe(200);
      expect(res.headers["x-cache"]).toBe("BYPASS");
    } finally {
      fake.redis.setFailure(null);
    }
  });
});

describe("branding cache invalidation", () => {
  it("PUT /api/merchant-branding makes the next GET read the new value", async () => {
    const app = buildApp();
    await request(app).get("/api/merchant-branding");
    expect((await request(app).get("/api/merchant-branding")).headers["x-cache"]).toBe("HIT");

    const put = await request(app).put("/api/merchant-branding").send({ primary_color: "#222222" });
    expect(put.status).toBe(200);

    const after = await request(app).get("/api/merchant-branding");
    expect(after.headers["x-cache"]).toBe("MISS");
    expect(after.body.branding_config.primary_color).toBe("#222222");
  });
});

describe("webhook settings cache", () => {
  it("stores only the masked secret in Redis", async () => {
    const app = buildApp();
    const res = await request(app).get("/api/webhook-settings");
    expect(res.status).toBe(200);
    expect(res.body.webhook_secret_masked.startsWith("whsec_supe")).toBe(true);

    const dump = JSON.stringify([...fake.redis.store.values()]);
    expect(dump).not.toContain("whsec_supersecretvalue1234567890");
    expect(dump).toContain("webhook_secret_masked");
  });

  it.each([
    ["PUT /api/webhook-settings", (app) => request(app).put("/api/webhook-settings").send({ webhook_url: "https://new.example.com" })],
    ["POST /api/regenerate-webhook-secret", (app) => request(app).post("/api/regenerate-webhook-secret")],
    ["POST /api/merchants/rotate-webhook-secret", (app) => request(app).post("/api/merchants/rotate-webhook-secret").send({})],
  ])("%s invalidates it", async (_label, write) => {
    const app = buildApp();
    await request(app).get("/api/webhook-settings");
    expect((await request(app).get("/api/webhook-settings")).headers["x-cache"]).toBe("HIT");

    const w = await write(app);
    expect(w.status).toBe(200);

    expect((await request(app).get("/api/webhook-settings")).headers["x-cache"]).toBe("MISS");
  });
});

describe("throughput telemetry", () => {
  it("counts requests per route pattern and status class, including rejected ones", async () => {
    const app = buildApp();
    await request(app).get("/api/merchant-profile");
    await request(app).get("/api/merchant-profile");
    await request(app).post("/api/rotate-key").send({ unexpected: true });

    const counts = await metric("merchant_route_requests_total");
    const profile = counts.find((v) => v.labels.route === "/merchant-profile");
    expect(profile).toMatchObject({ value: 2, labels: { method: "GET", status_class: "2xx" } });
    const rotate = counts.find((v) => v.labels.route === "/rotate-key");
    expect(rotate.labels.status_class).toBe("4xx");

    const inFlight = await metric("merchant_route_in_flight_requests");
    expect(inFlight.every((v) => v.value === 0)).toBe(true);

    const cacheOps = await metric("merchant_cache_operations_total");
    expect(cacheOps.find((v) => v.labels.resource === "profile" && v.labels.result === "hit").value).toBe(1);
  });
});
