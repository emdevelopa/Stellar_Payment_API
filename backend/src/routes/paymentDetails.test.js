/**
 * Route-level tests for GET /api/payments/:id — the Public Hosted Checkout
 * Session Route (#1775 caching + telemetry).
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, fake, horizon } = vi.hoisted(() => ({
  db: { rows: new Map(), reads: 0, fail: false },
  fake: { redis: null },
  horizon: { calls: 0 },
}));

vi.mock("../lib/supabase.js", () => ({
  supabase: {
    from: () => {
      const filters = {};
      const b = {
        select: () => b,
        eq: (col, val) => {
          filters[col] = val;
          return b;
        },
        is: () => b,
        maybeSingle: async () => {
          db.reads += 1;
          if (db.fail) return { data: null, error: { message: "db down" } };
          const row = db.rows.get(filters.id);
          return { data: row && row.merchant_id === filters.merchant_id ? { ...row } : null, error: null };
        },
      };
      return b;
    },
  },
}));

vi.mock("../lib/redis.js", async (importOriginal) => {
  const actual = await importOriginal();
  const { createFakeRedis } = await import("../../tests/helpers/fake-redis.js");
  fake.redis = createFakeRedis();
  return { ...actual, connectRedisClient: async () => fake.redis };
});

vi.mock("../lib/payment-details-recovery.js", () => ({
  fetchTxMetaWithRecovery: vi.fn(async (txId) => {
    horizon.calls += 1;
    return { tx_hash: txId, ledger: 42, timestamp: "2026-01-01T00:00:00Z" };
  }),
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import paymentDetailsRouter from "./paymentDetails.js";
import { invalidatePaymentCache } from "../lib/redis.js";
import { paymentDetailsRegister, resetPaymentDetailsMetrics } from "../lib/payment-details-metrics.js";

const M = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const OTHER = "9b2c0b8e-0000-4000-8000-000000000000";
const PAID = "6fa459ea-ee8a-4ca4-894e-db77e160355e";
const PENDING = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const TX = "a".repeat(64);

function buildApp() {
  const app = express();
  app.use("/api/payments", (req, _res, next) => {
    req.merchant = { id: req.get("x-test-merchant") || M };
    next();
  });
  app.use("/api/payments", paymentDetailsRouter);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: "Internal" }));
  return app;
}

async function metric(name) {
  return (await paymentDetailsRegister.getSingleMetric(name).get()).values;
}

beforeEach(() => {
  resetPaymentDetailsMetrics();
  fake.redis.store.clear();
  fake.redis.setFailure(null);
  fake.redis.calls.length = 0;
  db.reads = 0;
  db.fail = false;
  horizon.calls = 0;
  db.rows = new Map([
    [PAID, { id: PAID, merchant_id: M, status: "completed", tx_id: TX, amount: 5, metadata: null, merchants: { branding_config: { primary_color: "#000000" } } }],
    [PENDING, { id: PENDING, merchant_id: M, status: "pending", tx_id: null, amount: 1, metadata: null, merchants: null }],
  ]);
});

describe("GET /api/payments/:id", () => {
  it("returns the payment with branding and on-chain metadata", async () => {
    const res = await request(buildApp()).get(`/api/payments/${PAID}`);
    expect(res.status).toBe(200);
    expect(res.body.payment).toMatchObject({ id: PAID, status: "completed", branding_config: { primary_color: "#000000" } });
    expect(res.body.payment).not.toHaveProperty("merchants");
    expect(res.body.stellar_tx).toEqual({ tx_hash: TX, ledger: 42, timestamp: "2026-01-01T00:00:00Z" });
  });

  it("serves repeat polls of a completed payment without the DB or Horizon", async () => {
    const app = buildApp();
    const first = await request(app).get(`/api/payments/${PAID}`);
    const second = await request(app).get(`/api/payments/${PAID}`);

    expect(first.headers["x-cache"]).toBe("MISS");
    expect(second.headers["x-cache"]).toBe("HIT");
    expect(second.headers["cache-control"]).toBe("private, no-store");
    expect(second.body).toEqual(first.body);
    expect(db.reads).toBe(1);
    expect(horizon.calls).toBe(1);
  });

  it("shows a status change as soon as the writer invalidates", async () => {
    const app = buildApp();
    expect((await request(app).get(`/api/payments/${PENDING}`)).body.payment.status).toBe("pending");

    db.rows.set(PENDING, { ...db.rows.get(PENDING), status: "completed", tx_id: TX });
    await invalidatePaymentCache(fake.redis, PENDING);

    const after = await request(app).get(`/api/payments/${PENDING}`);
    expect(after.headers["x-cache"]).toBe("MISS");
    expect(after.body.payment.status).toBe("completed");
  });

  it("never serves a cached payment to another merchant", async () => {
    const app = buildApp();
    await request(app).get(`/api/payments/${PAID}`);
    const res = await request(app).get(`/api/payments/${PAID}`).set("x-test-merchant", OTHER);
    expect(res.status).toBe(404);
  });

  it("returns 404 for unknown payments and does not cache it", async () => {
    const app = buildApp();
    const id = "00000000-0000-4000-8000-000000000000";
    expect((await request(app).get(`/api/payments/${id}`)).status).toBe(404);
    expect((await request(app).get(`/api/payments/${id}`)).status).toBe(404);
    expect(db.reads).toBe(2);
  });

  it("rejects a malformed id before any lookup", async () => {
    const res = await request(buildApp()).get("/api/payments/not-a-uuid");
    expect(res.status).toBe(400);
    expect(db.reads).toBe(0);
    expect(fake.redis.calls).toHaveLength(0);
  });

  it("returns 500 on a database error without caching", async () => {
    db.fail = true;
    const res = await request(buildApp()).get(`/api/payments/${PAID}`);
    expect(res.status).toBe(500);
    expect(fake.redis.keys("payment:details:v1:3f")).toHaveLength(0);
  });

  it("keeps serving when Redis fails", async () => {
    fake.redis.setFailure(new Error("ECONNRESET"));
    const res = await request(buildApp()).get(`/api/payments/${PAID}`);
    expect(res.status).toBe(200);
    expect(res.headers["x-cache"]).toBe("BYPASS");
  });

  it("records throughput telemetry by route pattern", async () => {
    const app = buildApp();
    await request(app).get(`/api/payments/${PAID}`);
    await request(app).get(`/api/payments/${PAID}`);
    await request(app).get("/api/payments/00000000-0000-4000-8000-000000000000");

    const counts = await metric("payment_details_requests_total");
    expect(counts.find((v) => v.labels.status_class === "2xx")).toMatchObject({ value: 2, labels: { route: "/:id", method: "GET" } });
    expect(counts.find((v) => v.labels.status_class === "4xx").value).toBe(1);
    expect(JSON.stringify(counts)).not.toContain(PAID);

    const ops = await metric("payment_details_cache_operations_total");
    expect(ops.find((v) => v.labels.result === "hit").value).toBe(1);
  });
});
