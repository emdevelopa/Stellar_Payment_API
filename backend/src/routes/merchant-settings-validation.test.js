/**
 * HTTP-level tests for payload sanitization & strict validation on the
 * Merchant Settings & API Key Service routes (issue #1482).
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { db } = vi.hoisted(() => ({
  db: { updates: [], inserts: [], lookup: null },
}));

function builder(table) {
  let lastPayload = null;
  const b = {
    select: () => b,
    eq: () => b,
    is: () => b,
    update: (payload) => {
      lastPayload = payload;
      db.updates.push({ table, payload });
      return b;
    },
    insert: (payload) => {
      lastPayload = payload;
      db.inserts.push({ table, payload });
      return b;
    },
    maybeSingle: async () => ({ data: db.lookup, error: null }),
    single: async () => ({
      data: { id: "merchant-1", metadata: {}, ...(lastPayload ?? {}) },
      error: null,
    }),
    then: (resolve) => resolve({ data: null, error: null }),
  };
  return b;
}

vi.mock("../lib/supabase.js", () => ({
  supabase: { from: vi.fn((table) => builder(table)) },
}));

vi.mock("../lib/auth.js", () => ({
  requireApiKeyAuth: () => (req, _res, next) => {
    req.merchant = { id: "merchant-1", webhook_secret: "whsec_old" };
    next();
  },
  requireSessionAuth: () => (req, _res, next) => {
    req.merchant = { id: "merchant-1" };
    next();
  },
  hashPassword: vi.fn(async () => "hashed"),
}));

vi.mock("../lib/rate-limit.js", () => ({
  createMerchantSecurityActionRateLimit: () => (_req, _res, next) => next(),
}));

vi.mock("../lib/sep10-auth.js", () => ({
  generateSessionToken: vi.fn(() => "session-token"),
}));

vi.mock("../lib/api-usage.js", () => ({ getMerchantApiUsage: vi.fn() }));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import createMerchantsRouter from "./merchants.js";

const DAY = 24 * 60 * 60 * 1000;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(
    "/api",
    createMerchantsRouter({
      merchantRegistrationRateLimit: (_req, _res, next) => next(),
      merchantSecurityActionRateLimit: (_req, _res, next) => next(),
    }),
  );
  // Mirror app.js: errors carry .status
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message });
  });
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  db.updates = [];
  db.inserts = [];
  // Row returned by `.maybeSingle()` lookups (e.g. current API key).
  db.lookup = { api_key: "sk_old" };
});

describe("POST /api/merchants/rotate-api-key", () => {
  it("rotates with a valid grace period", async () => {
    const res = await request(buildApp())
      .post("/api/merchants/rotate-api-key")
      .send({ grace_period_hours: 12 });
    expect(res.status).toBe(200);
    expect(res.body.grace_period_hours).toBe(12);
    expect(res.body.api_key).toMatch(/^sk_[a-f0-9]{48}$/);
  });

  it("accepts an empty body (default grace period)", async () => {
    const res = await request(buildApp()).post("/api/merchants/rotate-api-key");
    expect(res.status).toBe(200);
    expect(res.body.grace_period_hours).toBe(24);
  });

  it.each([
    ["string grace period", { grace_period_hours: "24" }],
    ["negative grace period", { grace_period_hours: -5 }],
    ["grace period over one week", { grace_period_hours: 500 }],
    ["mass-assignment of api_key", { api_key: "sk_attacker_chosen" }],
    ["unknown field", { grace: 1 }],
  ])("returns 400 (not 500) for %s and never writes", async (_label, body) => {
    const res = await request(buildApp()).post("/api/merchants/rotate-api-key").send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
    expect(db.updates).toHaveLength(0);
  });
});

describe("PUT /api/merchants/set-api-key-expiry", () => {
  it("stores a normalized UTC expiry", async () => {
    const future = new Date(Date.now() + 30 * DAY);
    const withOffset = future.toISOString().replace("Z", "+00:00");
    const res = await request(buildApp())
      .put("/api/merchants/set-api-key-expiry")
      .send({ expires_at: withOffset });
    expect(res.status).toBe(200);
    expect(res.body.api_key_expires_at).toBe(future.toISOString());
    expect(db.updates[0].payload).toEqual({ api_key_expires_at: future.toISOString() });
  });

  it.each([
    ["past expiry (self lock-out)", { expires_at: "2020-01-01T00:00:00Z" }],
    ["expiry beyond 365 days", { expires_at: new Date(Date.now() + 400 * DAY).toISOString() }],
    ["non-ISO string", { expires_at: "next tuesday" }],
    ["missing expires_at", {}],
    [
      "extra field",
      { expires_at: new Date(Date.now() + DAY).toISOString(), api_key_old: "sk_x" },
    ],
  ])("rejects %s with 400", async (_label, body) => {
    const res = await request(buildApp()).put("/api/merchants/set-api-key-expiry").send(body);
    expect(res.status).toBe(400);
    expect(db.updates).toHaveLength(0);
  });
});

describe("POST /api/merchants/rotate-webhook-secret", () => {
  it("rejects unknown fields", async () => {
    const res = await request(buildApp())
      .post("/api/merchants/rotate-webhook-secret")
      .send({ grace_period_hours: 1, webhook_secret: "whsec_mine" });
    expect(res.status).toBe(400);
    expect(db.updates).toHaveLength(0);
  });

  it("rotates with a valid body", async () => {
    const res = await request(buildApp())
      .post("/api/merchants/rotate-webhook-secret")
      .send({ grace_period_hours: 1 });
    expect(res.status).toBe(200);
    expect(res.body.grace_period_hours).toBe(1);
  });
});

describe("PUT /api/webhook-settings", () => {
  it("accepts a valid URL with safe custom headers", async () => {
    const res = await request(buildApp())
      .put("/api/webhook-settings")
      .send({
        webhook_url: "https://hooks.example.com/pluto",
        custom_headers: { "X-Tenant": "acme" },
      });
    expect(res.status).toBe(200);
    expect(db.updates[0].payload.webhook_custom_headers).toEqual({ "X-Tenant": "acme" });
  });

  it.each([
    ["CRLF header injection", { custom_headers: { "X-A": "v\r\nX-Evil: 1" } }],
    ["signature header spoofing", { custom_headers: { "PLUTO-Signature": "forged" } }],
    ["host override", { custom_headers: { Host: "internal.local" } }],
    ["unknown top-level field", { webhook_url: "https://a.example.com", webhook_secret: "x" }],
    ["plain http URL", { webhook_url: "http://a.example.com" }],
  ])("rejects %s with 400", async (_label, body) => {
    const res = await request(buildApp()).put("/api/webhook-settings").send(body);
    expect(res.status).toBe(400);
    expect(db.updates).toHaveLength(0);
  });

  it("rejects oversized payloads before they reach the database", async () => {
    const res = await request(buildApp())
      .put("/api/webhook-settings")
      .send({ webhook_url: "https://a.example.com/" + "x".repeat(5000) });
    expect(res.status).toBe(400);
    expect(db.updates).toHaveLength(0);
  });
});

describe("POST /api/register-merchant", () => {
  const base = { email: "owner@example.com", password: "correct horse battery" };

  beforeEach(() => {
    db.lookup = null; // no existing merchant with this email
  });

  it("persists only canonical merchant_settings", async () => {
    const res = await request(buildApp())
      .post("/api/register-merchant")
      .send({ ...base, merchant_settings: { send_success_emails: false } });
    expect(res.status).toBe(201);
    expect(db.inserts[0].payload.merchant_settings).toEqual({ send_success_emails: false });
  });

  it("rejects unknown merchant_settings keys", async () => {
    const res = await request(buildApp())
      .post("/api/register-merchant")
      .send({ ...base, merchant_settings: { send_success_emails: true, is_admin: true } });
    expect(res.status).toBe(400);
    expect(db.inserts).toHaveLength(0);
  });

  it("strips prototype-pollution keys from metadata and does not pollute Object.prototype", async () => {
    const raw =
      '{"email":"owner@example.com","password":"correct horse battery",' +
      '"metadata":{"industry":"retail","__proto__":{"isAdmin":true}},' +
      '"__proto__":{"polluted":true}}';
    const res = await request(buildApp())
      .post("/api/register-merchant")
      .set("Content-Type", "application/json")
      .send(raw);

    expect(res.status).toBe(201);
    expect(db.inserts[0].payload.metadata).toEqual({ industry: "retail" });
    expect({}.polluted).toBeUndefined();
    expect({}.isAdmin).toBeUndefined();
  });

  it("strips control characters from business_name", async () => {
    const res = await request(buildApp())
      .post("/api/register-merchant")
      .send({ ...base, business_name: "Acme\u0000\u001b Ltd" });
    expect(res.status).toBe(201);
    expect(db.inserts[0].payload.business_name).toBe("Acme Ltd");
  });

  it("rejects deeply nested metadata", async () => {
    let deep = { v: 1 };
    for (let i = 0; i < 10; i += 1) deep = { n: deep };
    const res = await request(buildApp())
      .post("/api/register-merchant")
      .send({ ...base, metadata: deep });
    expect(res.status).toBe(400);
    expect(db.inserts).toHaveLength(0);
  });
});
