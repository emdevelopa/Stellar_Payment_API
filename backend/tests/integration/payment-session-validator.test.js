/**
 * Payment Session Validator — HTTP integration (issues #1447, #1448).
 *
 * Drives POST /api/sessions through the real Express app (schema validation,
 * metadata sanitizer, route handler, validator) with only the external edges
 * mocked: Stellar/Horizon, Supabase, API-key auth and idempotency storage.
 */
import request from "supertest";
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { createApp } from "../../src/app.js";
import { closePool } from "../../src/lib/db.js";
import { resetPaymentSessionValidatorHealth } from "../../src/lib/payment-session-validator.js";

const VALID_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const OTHER_ISSUER = "GA5XIGA5C7FBPTVQ3CWHKNC7D2ZBHB24G3KUJG5WZ6S4EYWSSBFVL45T";

const mockRedisClient = {
  ping: vi.fn().mockResolvedValue("PONG"),
  on: vi.fn(),
  sendCommand: vi.fn().mockResolvedValue("mocked_hash"),
};

const state = vi.hoisted(() => ({
  merchant: null,
  inserted: [],
}));

vi.mock("../../src/lib/stellar.js", () => ({
  findMatchingPayment: vi.fn(),
  findAnyRecentPayment: vi.fn(),
  findStrictReceivePaths: vi.fn(),
  getNetworkFeeStats: vi.fn(),
  isHorizonReachable: vi.fn(async () => true),
  isValidAssetCode: vi.fn(() => true),
  isValidStellarAccountId: vi.fn(() => true),
  isValidStellarPublicKey: vi.fn((v) => typeof v === "string" && /^G[A-Z2-7]{55}$/.test(v)),
  validateMemo: vi.fn(() => ({ valid: true })),
  verifyTransactionSignature: vi.fn(),
  withHorizonRetry: vi.fn(),
}));

vi.mock("../../src/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
      })),
    })),
  },
}));

vi.mock("../../src/lib/supabase-client.js", () => ({
  getSupabaseClient: vi.fn(async () => ({
    from: vi.fn(() => ({
      insert: vi.fn(async (row) => {
        state.inserted.push(row);
        return { error: null };
      }),
    })),
  })),
}));

vi.mock("../../src/lib/auth.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    requireApiKeyAuth: () => (req, _res, next) => {
      req.merchant = state.merchant;
      next();
    },
  };
});

vi.mock("../../src/lib/idempotency.js", () => ({
  idempotencyMiddleware: (_req, _res, next) => next(),
}));

const baseMerchant = () => ({
  id: "merchant-1",
  payment_limits: null,
  allowed_issuers: [],
  branding_config: null,
});

const validSession = () => ({
  amount: 25,
  asset: "USDC",
  asset_issuer: VALID_ISSUER,
  recipient: VALID_ISSUER,
  description: "Order 1001",
});

describe("Payment Session Validator — HTTP integration", () => {
  let app;

  beforeAll(async () => {
    ({ app } = await createApp({ redisClient: mockRedisClient }));
  });

  beforeEach(() => {
    state.merchant = baseMerchant();
    state.inserted = [];
    resetPaymentSessionValidatorHealth();
  });

  afterAll(async () => {
    await closePool().catch(() => {});
  });

  it("creates a session and persists sanitized fields", async () => {
    const res = await request(app)
      .post("/api/sessions")
      .send({ ...validSession(), description: "Order​ 1001‮", client_id: "cli\u0000ent" });

    expect(res.status).toBe(201);
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]).toMatchObject({
      asset: "USDC",
      asset_issuer: VALID_ISSUER,
      description: "Order 1001",
      client_id: "client",
    });
  });

  it.each([
    ["an amount with more than 7 decimals", { amount: 1.123456789 }, /7 decimal places/],
    ["an amount above the Stellar maximum", { amount: 1e13 }, /must not exceed/],
    ["an asset code with symbols", { asset: "US$C" }, /alphanumeric/],
    ["an oversized description", { description: "x".repeat(1001) }, /description must be at most 1000/],
  ])("rejects %s with 400 and persists nothing", async (_label, patch, message) => {
    const res = await request(app).post("/api/sessions").send({ ...validSession(), ...patch });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
    expect(state.inserted).toHaveLength(0);
  });

  it("rejects prototype-pollution keys in metadata", async () => {
    const res = await request(app)
      .post("/api/sessions")
      .set("Content-Type", "application/json")
      .send(`{"amount":25,"asset":"USDC","asset_issuer":"${VALID_ISSUER}","recipient":"${VALID_ISSUER}","metadata":{"__proto__":{"isAdmin":true}}}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/forbidden key/);
    expect({}.isAdmin).toBeUndefined();
    expect(state.inserted).toHaveLength(0);
  });

  it("enforces merchant limits and returns limit details", async () => {
    state.merchant.payment_limits = { USDC: { max: 10 } };
    const res = await request(app).post("/api/sessions").send(validSession());
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "Amount exceeds the maximum for USDC", max: 10, delta: 15 });
  });

  it("does not resolve limits from Object.prototype for exotic asset codes", async () => {
    state.merchant.payment_limits = {};
    const res = await request(app)
      .post("/api/sessions")
      .send({ ...validSession(), asset: "CONSTRUCTOR" });
    expect(res.status).toBe(201);
  });

  it("enforces the merchant issuer allowlist", async () => {
    state.merchant.allowed_issuers = [OTHER_ISSUER];
    const res = await request(app).post("/api/sessions").send(validSession());
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/allowed issuers/);
  });

  it("exposes validator metrics on /metrics", async () => {
    await request(app).post("/api/sessions").send(validSession());
    await request(app).post("/api/sessions").send({ ...validSession(), amount: 0.123456789 });

    const res = await request(app).get("/metrics");
    expect(res.status).toBe(200);
    expect(res.text).toMatch(
      /payment_session_validator_evaluations_total\{[^}]*source="http"[^}]*outcome="accepted"[^}]*\} [1-9]/,
    );
    expect(res.text).toMatch(
      /payment_session_validator_rejections_total\{[^}]*rule="payload"[^}]*reason="invalid_amount"[^}]*\} [1-9]/,
    );
    expect(res.text).toContain("payment_session_validator_duration_seconds_bucket");
    expect(res.text).toContain("payment_session_validator_health_state");
  });

  it("reports validator health on /health/payment-session-validator and /health", async () => {
    await request(app).post("/api/sessions").send(validSession());

    const res = await request(app).get("/health/payment-session-validator");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "healthy", accepted: 1, total: 1 });
    expect(res.body.thresholds).toBeDefined();

    const health = await request(app).get("/health");
    expect(health.body.services.payment_session_validator).toBe("healthy");
  });

  it("reports degraded (still 200) when most sessions are rejected", async () => {
    for (let i = 0; i < 20; i++) {
      await request(app).post("/api/sessions").send({ ...validSession(), asset: "BAD-ASSET" });
    }
    const res = await request(app).get("/health/payment-session-validator");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("degraded");
    expect(res.body.reasons).toContain("rejection_ratio_exceeded");
  });
});
