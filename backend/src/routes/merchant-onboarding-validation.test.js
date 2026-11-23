/**
 * HTTP-level tests for input validation and payload sanitization on the
 * Merchant Onboarding and Key Lifecycle Route (#1769).
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, sendWebhookMock } = vi.hoisted(() => ({
  db: { updates: [], inserts: [], lookup: null },
  sendWebhookMock: vi.fn(),
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
    then: (resolve) =>
      resolve({ data: lastPayload ? [{ id: "merchant-1" }] : null, error: null }),
  };
  return b;
}

vi.mock("../lib/supabase.js", () => ({
  supabase: { from: vi.fn((table) => builder(table)) },
}));

const MERCHANT = {
  id: "merchant-1",
  api_key: "sk_old",
  webhook_secret: "whsec_old",
  business_name: "<b>Shop</b>",
};

vi.mock("../lib/auth.js", () => ({
  requireApiKeyAuth: () => (req, _res, next) => {
    req.merchant = { ...MERCHANT };
    next();
  },
  requireSessionAuth: () => (req, _res, next) => {
    req.merchant = { ...MERCHANT };
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

vi.mock("../lib/webhooks.js", () => ({ sendWebhook: sendWebhookMock }));

// Locks and the merchant cache use an in-memory Redis, so this file never
// shares state with other test files or a developer's local Redis.
vi.mock("../lib/redis.js", async () => {
  const { createFakeRedis } = await import("../../tests/helpers/fake-redis.js");
  const fake = createFakeRedis();
  return { connectRedisClient: async () => fake };
});

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import createMerchantsRouter from "./merchants.js";
import { logger } from "../lib/logger.js";
import {
  merchantLifecycleRegister,
  resetMerchantLifecycleMetrics,
} from "../lib/merchant-lifecycle-metrics.js";

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  // app.js authenticates these two prefixes before the router runs.
  app.use(["/api/rotate-key", "/api/merchant-branding"], (req, _res, next) => {
    req.merchant = { ...MERCHANT };
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
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message });
  });
  return app;
}

async function rejectionCount(route, reason) {
  const metric = await merchantLifecycleRegister
    .getSingleMetric("merchant_payload_rejections_total")
    .get();
  const hit = metric.values.find(
    (v) => v.labels.route === route && v.labels.reason === reason,
  );
  return hit ? hit.value : 0;
}

const VALID_REGISTRATION = {
  email: "Owner@Example.COM",
  password: "correct horse battery",
  business_name: "Stellar Shop",
};

beforeEach(() => {
  vi.clearAllMocks();
  resetMerchantLifecycleMetrics();
  db.updates = [];
  db.inserts = [];
  db.lookup = null;
});

describe("POST /api/register-merchant", () => {
  it("normalizes the email to lower case before the duplicate check and insert", async () => {
    const res = await request(buildApp())
      .post("/api/register-merchant")
      .send({ ...VALID_REGISTRATION, notification_email: "  Alerts@Example.com " });

    expect(res.status).toBe(201);
    expect(db.inserts).toHaveLength(1);
    expect(db.inserts[0].payload.email).toBe("owner@example.com");
    expect(db.inserts[0].payload.notification_email).toBe("alerts@example.com");
  });

  it("treats a blank notification_email as absent", async () => {
    const res = await request(buildApp())
      .post("/api/register-merchant")
      .send({ ...VALID_REGISTRATION, notification_email: "   " });
    expect(res.status).toBe(201);
    expect(db.inserts[0].payload.notification_email).toBe("owner@example.com");
  });

  it.each([
    ["mass-assignment of api_key", { api_key: "sk_attacker" }],
    ["mass-assignment of webhook_secret", { webhook_secret: "whsec_attacker" }],
    ["mass-assignment of password_hash", { password_hash: "$2a$10$x" }],
    ["an unknown field", { plan: "enterprise" }],
    ["a password longer than bcrypt's 72-byte limit", { password: "é".repeat(40) }],
    ["a password shorter than 8 characters", { password: "short" }],
    ["an over-long email", { email: `${"a".repeat(250)}@x.io` }],
    ["a malformed email", { email: "not-an-email" }],
    ["a malformed notification_email", { notification_email: "nope" }],
    ["HTML in business_name", { business_name: "<script>alert(1)</script>" }],
    ["an over-long business_name", { business_name: "x".repeat(121) }],
    ["a javascript: logo_url", { branding_config: { logo_url: "javascript:alert(1)" } }],
    ["an unknown merchant_settings key", { merchant_settings: { send_sms: true } }],
  ])("rejects %s with 400 and writes nothing", async (_label, patch) => {
    const res = await request(buildApp())
      .post("/api/register-merchant")
      .send({ ...VALID_REGISTRATION, ...patch });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
    expect(db.inserts).toHaveLength(0);
  });

  it("strips control characters from free-text fields before validation", async () => {
    const res = await request(buildApp())
      .post("/api/register-merchant")
      .send({ ...VALID_REGISTRATION, business_name: "Sh\u0007op\u0000" });
    expect(res.status).toBe(201);
    expect(db.inserts[0].payload.business_name).toBe("Shop");
  });

  it("counts schema rejections by route and never logs submitted values", async () => {
    await request(buildApp())
      .post("/api/register-merchant")
      .send({ ...VALID_REGISTRATION, password: "tiny", api_key: "sk_attacker" });

    expect(await rejectionCount("/register-merchant", "schema")).toBe(1);
    const logged = JSON.stringify(logger.warn.mock.calls);
    expect(logged).toContain("password");
    expect(logged).not.toContain("tiny");
    expect(logged).not.toContain("sk_attacker");
  });

  it("counts structural sanitization rejections separately", async () => {
    let deep = { leaf: 1 };
    for (let i = 0; i < 10; i += 1) deep = { deep };
    const res = await request(buildApp())
      .post("/api/register-merchant")
      .send({ ...VALID_REGISTRATION, metadata: deep });

    expect(res.status).toBe(400);
    expect(await rejectionCount("/register-merchant", "sanitize")).toBe(1);
    expect(db.inserts).toHaveLength(0);
  });

  it("drops prototype-pollution keys instead of persisting them", async () => {
    const res = await request(buildApp())
      .post("/api/register-merchant")
      .set("Content-Type", "application/json")
      .send(
        '{"email":"a@b.io","password":"long enough pw","metadata":{"__proto__":{"admin":true},"industry":"retail"}}',
      );

    expect(res.status).toBe(201);
    const { metadata } = db.inserts[0].payload;
    expect(metadata).toEqual({ industry: "retail" });
    expect(Object.prototype.hasOwnProperty.call(metadata, "__proto__")).toBe(false);
    expect({}.admin).toBeUndefined();
  });
});

describe.each([
  ["post", "/api/rotate-key"],
  ["post", "/api/regenerate-webhook-secret"],
  ["post", "/api/merchants/generate-api-key"],
  ["post", "/api/webhook-settings/verify"],
])("%s %s takes no input", (method, path) => {
  it("rejects any body field with 400 before touching the database", async () => {
    const res = await request(buildApp())[method](path).send({ api_key: "sk_attacker" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
    expect(db.updates).toHaveLength(0);
  });
});

describe("credential routes still work with an empty body", () => {
  it.each(["/api/rotate-key", "/api/regenerate-webhook-secret", "/api/merchants/generate-api-key"])(
    "%s",
    async (path) => {
      const res = await request(buildApp()).post(path);
      expect(res.status).toBe(200);
      expect(db.updates).toHaveLength(1);
    },
  );
});

describe("merchant branding", () => {
  it("GET /api/merchant-branding resolves the stored branding", async () => {
    db.lookup = { branding_config: { primary_color: "#112233" } };
    const res = await request(buildApp()).get("/api/merchant-branding");
    expect(res.status).toBe(200);
    expect(res.body.branding_config.primary_color).toBe("#112233");
  });

  it.each([
    ["an https URL", "https://cdn.example.com/logo.png"],
    ["a base64 PNG data URI", "data:image/png;base64,iVBORw0KGgo="],
    ["an empty string (clears the logo)", ""],
  ])("accepts %s as logo_url", async (_label, logo_url) => {
    const res = await request(buildApp()).put("/api/merchant-branding").send({ logo_url });
    expect(res.status).toBe(200);
  });

  it.each([
    ["javascript: URL", "javascript:alert(1)"],
    ["http: URL", "http://cdn.example.com/logo.png"],
    ["SVG data URI", "data:image/svg+xml;base64,PHN2Zz4="],
    ["HTML data URI", "data:text/html;base64,PHNjcmlwdD4="],
    ["attribute break-out", 'https://x.io/a.png" onerror="alert(1)'],
    ["embedded credentials", "https://user:pass@cdn.example.com/logo.png"],
  ])("rejects a %s logo_url", async (_label, logo_url) => {
    const res = await request(buildApp()).put("/api/merchant-branding").send({ logo_url });
    expect(res.status).toBe(400);
    expect(db.updates).toHaveLength(0);
  });

  it("rejects unknown branding keys", async () => {
    const res = await request(buildApp())
      .put("/api/merchant-branding")
      .send({ primary_color: "#000000", font: "Comic Sans" });
    expect(res.status).toBe(400);
  });

  it("POST /api/preview-receipt escapes merchant-controlled HTML", async () => {
    const res = await request(buildApp())
      .post("/api/preview-receipt")
      .send({ logo_url: "https://cdn.example.com/logo.png" });
    expect(res.status).toBe(200);
    expect(res.text).toContain("&lt;b&gt;Shop&lt;/b&gt;");
    expect(res.text).not.toContain("<b>Shop</b>");
  });
});

describe("POST /api/test-webhook", () => {
  it.each([
    ["plain http", { webhook_url: "http://hooks.example.com" }],
    ["embedded credentials", { webhook_url: "https://u:p@hooks.example.com" }],
    ["a non-URL", { webhook_url: "hooks" }],
    ["an over-long URL", { webhook_url: `https://h.io/${"a".repeat(2100)}` }],
    ["an unknown field", { webhook_url: "https://hooks.example.com", secret: "x" }],
  ])("rejects %s without sending anything", async (_label, body) => {
    const res = await request(buildApp()).post("/api/test-webhook").send(body);
    expect(res.status).toBe(400);
    expect(sendWebhookMock).not.toHaveBeenCalled();
  });

  it("sends a signed ping and clips the echoed receiver body", async () => {
    sendWebhookMock.mockResolvedValue({
      ok: true,
      status: 200,
      body: `ok\u0000${"x".repeat(5000)}`,
      signed: true,
    });

    const res = await request(buildApp())
      .post("/api/test-webhook")
      .send({ webhook_url: "https://hooks.example.com/pluto" });

    expect(res.status).toBe(200);
    expect(sendWebhookMock).toHaveBeenCalledWith(
      "https://hooks.example.com/pluto",
      expect.objectContaining({}),
      "whsec_old",
    );
    expect(res.body.body).not.toContain("\u0000");
    expect(res.body.body.length).toBeLessThan(2100);
    expect(res.body.body.endsWith("[truncated]")).toBe(true);
  });
});

describe("PUT /api/webhook-settings", () => {
  it("rejects a webhook URL with embedded credentials", async () => {
    const res = await request(buildApp())
      .put("/api/webhook-settings")
      .send({ webhook_url: "https://user:secret@hooks.example.com" });
    expect(res.status).toBe(400);
    expect(db.updates).toHaveLength(0);
  });
});
