/**
 * End-to-end tests for the Audit Logger (Issue #1066)
 *
 * Drives the FULL HTTP stack — Express app (src/app.js) → API-key auth →
 * route handler → auditService/audit write pipeline — with the DB and
 * Supabase boundaries mocked by an in-memory fake `audit_logs`/`merchants`
 * table, so no real network or database is required.
 *
 * Coverage map:
 *   - Access control ................ missing/invalid API key on the read endpoint
 *   - Full write path via routes .... POST /api/auth/login -> logLoginAttempt -> DB row
 *   - Read endpoint .................. pagination, clamping, next/previous links
 *   - Merchant isolation ............. one merchant cannot read another's logs
 *   - Integrity verification ........ verified / tampered rows on read
 *   - Rate limiting .................. per-merchant 429 enforcement on reads
 *   - Resilience ..................... DB failure on read surfaces as a 500
 *
 * Run with: npm test -- tests/e2e/audit-logger
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
process.env.DATABASE_URL ||= "postgresql://postgres:postgres@127.0.0.1:5432/postgres";
process.env.AUDIT_LOG_SIGNING_SECRET ||= "e2e-audit-signing-secret";
// Small, deterministic limit so the rate-limit scenario doesn't need dozens of requests.
process.env.AUDIT_READ_RATE_LIMIT_MAX = "5";
process.env.AUDIT_READ_RATE_LIMIT_WINDOW_MS = "60000";

// ── Hoisted mutable state + fake `audit_logs`/`merchants` query router ─────────
// Everything referenced inside a vi.mock(...) factory must be created here,
// since vi.mock factories run before this file's own top-level consts do.

const h = vi.hoisted(() => {
  const state = {
    merchants: [],
    loginLookupResult: null,
  };
  const fakeAuditLogs = [];
  const idCounter = { next: 1 };

  const mockPoolQuery = vi.fn(async (text, params = []) => {
    const sql = text.trim();

    if (/^INSERT INTO audit_logs/i.test(sql)) {
      let row;
      if (params.length === 7) {
        // login-attempt insert: merchant_id, action, status, ip_address, user_agent, payload_hash, signature
        row = {
          id: idCounter.next++,
          merchant_id: params[0],
          action: params[1],
          status: params[2],
          field_changed: null,
          old_value: null,
          new_value: null,
          ip_address: params[3],
          user_agent: params[4],
          payload_hash: params[5],
          signature: params[6],
          timestamp: new Date().toISOString(),
        };
      } else {
        // profile-change insert: merchant_id, action, field_changed, old_value, new_value, ip_address, user_agent, payload_hash, signature
        row = {
          id: idCounter.next++,
          merchant_id: params[0],
          action: params[1],
          field_changed: params[2],
          old_value: params[3],
          new_value: params[4],
          ip_address: params[5],
          user_agent: params[6],
          payload_hash: params[7],
          signature: params[8],
          status: null,
          timestamp: new Date().toISOString(),
        };
      }
      fakeAuditLogs.push(row);
      return { rows: [] };
    }

    if (/FROM audit_logs/i.test(sql)) {
      const [merchantId, limit, offset] = params;
      const matches = fakeAuditLogs
        .filter((r) => r.merchant_id === merchantId)
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      return {
        rows: matches.slice(offset, offset + limit).map((r) => ({ ...r, total_count: String(matches.length) })),
      };
    }

    if (/FROM merchants/i.test(sql)) {
      const [apiKey] = params;
      const merchant = state.merchants.find((m) => m.api_key === apiKey || m.api_key_old === apiKey);
      return { rows: merchant ? [merchant] : [] };
    }

    return { rows: [] };
  });

  return { state, fakeAuditLogs, idCounter, mockPoolQuery };
});

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("../../src/lib/db.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    pool: { query: h.mockPoolQuery },
    queryWithRetry: h.mockPoolQuery,
    isRetryablePoolError: () => false,
  };
});

vi.mock("../../src/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(async () => ({ data: h.state.loginLookupResult, error: null })),
    })),
  },
}));

vi.mock("../../src/lib/redis.js", () => ({
  connectRedisClient: vi.fn(async () => ({
    isOpen: false,
    ping: vi.fn(async () => "PONG"),
    on: vi.fn(),
    hIncrBy: vi.fn(async () => 1),
    expire: vi.fn(async () => 1),
    get: vi.fn(async () => null),
    set: vi.fn(async () => "OK"),
  })),
}));

vi.mock("../../src/lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  httpLogger: vi.fn((req, res, next) => next()),
}));

// app.js eagerly imports every router at module load, so these boundaries
// (unrelated to the audit logger itself) are neutralized the same way the
// Transaction Signer E2E suite does, purely so importing app.js is safe.
vi.mock("../../src/lib/stellar.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    findMatchingPayment: vi.fn(async () => null),
    findAnyRecentPayment: vi.fn(async () => null),
    verifyTransactionSignature: vi.fn(() => ({ valid: true, reason: "ok" })),
  };
});

vi.mock("../../src/lib/stream-manager.js", () => ({
  streamManager: { notify: vi.fn() },
}));

vi.mock("../../src/lib/webhooks.js", () => ({
  sendWebhook: vi.fn(),
  isEventSubscribed: vi.fn(() => true),
}));

vi.mock("../../src/lib/email.js", () => ({
  sendReceiptEmail: vi.fn(),
}));

vi.mock("../../src/lib/email-templates.js", () => ({
  renderReceiptEmail: vi.fn(() => "<html></html>"),
}));

vi.mock("../../src/webhooks/resolver.js", () => ({
  getPayloadForVersion: vi.fn(() => ({ event: "payment.confirmed" })),
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import { resetAuditRateLimitStateForTests } from "../../src/lib/audit-security.js";
import { _resetAuditCircuitForTests } from "../../src/lib/audit.js";
import { _resetSvcCircuitForTests } from "../../src/services/auditService.js";

let appInstance;
let closePool;

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MERCHANT_A = {
  id: "merchant-e2e-aaaa",
  email: "merchant-a@example.com",
  business_name: "Merchant A",
  notification_email: "merchant-a@example.com",
  api_key: "test-api-key-a",
  api_key_old: null,
  api_key_expires_at: null,
  api_key_old_expires_at: null,
  webhook_secret: "secret-a",
  merchant_settings: {},
};

const MERCHANT_B = {
  id: "merchant-e2e-bbbb",
  email: "merchant-b@example.com",
  business_name: "Merchant B",
  api_key: "test-api-key-b",
  api_key_old: null,
  api_key_expires_at: null,
  api_key_old_expires_at: null,
  webhook_secret: "secret-b",
  merchant_settings: {},
};

let PASSWORD_HASH;

describe("Audit Logger — E2E Tests (Issue #1066)", () => {
  beforeAll(async () => {
    PASSWORD_HASH = await bcrypt.hash("correct-horse-battery-staple", 10);

    const [{ createApp }, db] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/lib/db.js"),
    ]);
    closePool = db.closePool;
    const { app } = await createApp({ redisClient: { isOpen: false } });
    appInstance = app;
  });

  afterAll(async () => {
    if (typeof closePool === "function") await closePool().catch(() => {});
  });

  beforeEach(() => {
    h.state.merchants = [MERCHANT_A, MERCHANT_B];
    h.state.loginLookupResult = null;
    h.fakeAuditLogs.length = 0;
    h.idCounter.next = 1;
    h.mockPoolQuery.mockClear();
    resetAuditRateLimitStateForTests();
    _resetAuditCircuitForTests();
    _resetSvcCircuitForTests();
  });

  // ── Access control ──────────────────────────────────────────────────────────

  describe("GET /api/audit-logs — access control", () => {
    it("rejects requests with no API key", async () => {
      const res = await request(appInstance).get("/api/audit-logs");
      expect(res.status).toBe(401);
    });

    it("rejects requests with an unknown API key", async () => {
      const res = await request(appInstance).get("/api/audit-logs").set("x-api-key", "not-a-real-key");
      expect(res.status).toBe(401);
    });

    it("accepts requests with a valid API key", async () => {
      const res = await request(appInstance).get("/api/audit-logs").set("x-api-key", MERCHANT_A.api_key);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ logs: [], total_count: 0, page: 1, limit: 50 });
    });
  });

  // ── Full write path via the real login route ────────────────────────────────

  describe("Login flow -> audit trail", () => {
    it("records a success row for a valid login and it is retrievable via the read endpoint", async () => {
      h.state.loginLookupResult = { ...MERCHANT_A, password_hash: PASSWORD_HASH };

      const loginRes = await request(appInstance)
        .post("/api/auth/login")
        .send({ email: MERCHANT_A.email, password: "correct-horse-battery-staple" });
      expect(loginRes.status).toBe(200);

      const readRes = await request(appInstance).get("/api/audit-logs").set("x-api-key", MERCHANT_A.api_key);
      expect(readRes.status).toBe(200);
      expect(readRes.body.total_count).toBe(1);
      expect(readRes.body.logs[0]).toMatchObject({ action: "login", integrity_status: "verified" });
    });

    it("records a failure row for a wrong password", async () => {
      h.state.loginLookupResult = { ...MERCHANT_A, password_hash: PASSWORD_HASH };

      const loginRes = await request(appInstance)
        .post("/api/auth/login")
        .send({ email: MERCHANT_A.email, password: "wrong-password" });
      expect(loginRes.status).toBe(401);

      const readRes = await request(appInstance).get("/api/audit-logs").set("x-api-key", MERCHANT_A.api_key);
      expect(readRes.body.total_count).toBe(1);
      expect(readRes.body.logs[0].integrity_status).not.toBe("failed");
    });

    it("does not crash the login route for an unknown email (merchantId null, not retrievable)", async () => {
      h.state.loginLookupResult = null;

      const loginRes = await request(appInstance)
        .post("/api/auth/login")
        .send({ email: "nobody@example.com", password: "whatever" });
      expect(loginRes.status).toBe(401);

      // Row was written with merchant_id null; not visible on any merchant's read.
      const readRes = await request(appInstance).get("/api/audit-logs").set("x-api-key", MERCHANT_A.api_key);
      expect(readRes.body.total_count).toBe(0);
      expect(h.fakeAuditLogs.some((r) => r.merchant_id === null)).toBe(true);
    });
  });

  // ── Read endpoint: pagination ────────────────────────────────────────────────

  describe("GET /api/audit-logs — pagination", () => {
    beforeEach(() => {
      for (let i = 0; i < 12; i += 1) {
        h.fakeAuditLogs.push({
          id: h.idCounter.next++,
          merchant_id: MERCHANT_A.id,
          action: "update",
          field_changed: "email",
          old_value: "a",
          new_value: "b",
          ip_address: "127.0.0.1",
          user_agent: "e2e",
          payload_hash: null,
          signature: null,
          status: null,
          timestamp: new Date(Date.now() - i * 1000).toISOString(),
        });
      }
    });

    it("defaults to page 1, limit 50", async () => {
      const res = await request(appInstance).get("/api/audit-logs").set("x-api-key", MERCHANT_A.api_key);
      expect(res.body.page).toBe(1);
      expect(res.body.limit).toBe(50);
      expect(res.body.logs).toHaveLength(12);
      expect(res.body.total_pages).toBe(1);
      expect(res.body.links).toBeUndefined();
    });

    it("paginates with custom page/limit and exposes next/previous links", async () => {
      const res = await request(appInstance)
        .get("/api/audit-logs")
        .query({ page: 2, limit: 5 })
        .set("x-api-key", MERCHANT_A.api_key);

      expect(res.body.logs).toHaveLength(5);
      expect(res.body.total_pages).toBe(3);
      expect(res.body.links.next).toContain("page=3");
      expect(res.body.links.previous).toContain("page=1");
    });

    it("clamps limit to a maximum of 100 and page to a minimum of 1", async () => {
      const res = await request(appInstance)
        .get("/api/audit-logs")
        .query({ page: -5, limit: 999 })
        .set("x-api-key", MERCHANT_A.api_key);

      expect(res.body.page).toBe(1);
      expect(res.body.limit).toBe(100);
    });
  });

  // ── Merchant isolation ────────────────────────────────────────────────────────

  describe("Merchant isolation", () => {
    it("does not leak another merchant's audit logs", async () => {
      h.fakeAuditLogs.push({
        id: h.idCounter.next++,
        merchant_id: MERCHANT_B.id,
        action: "login",
        status: "success",
        field_changed: null,
        old_value: null,
        new_value: null,
        ip_address: "1.1.1.1",
        user_agent: "e2e",
        payload_hash: null,
        signature: null,
        timestamp: new Date().toISOString(),
      });

      const res = await request(appInstance).get("/api/audit-logs").set("x-api-key", MERCHANT_A.api_key);
      expect(res.body.total_count).toBe(0);
    });
  });

  // ── Integrity verification on read ───────────────────────────────────────────

  describe("Row integrity verification", () => {
    it("flags a tampered row (hash mismatch) as failed without breaking the response", async () => {
      h.fakeAuditLogs.push({
        id: h.idCounter.next++,
        merchant_id: MERCHANT_A.id,
        action: "update",
        field_changed: "email",
        old_value: "a",
        new_value: "b",
        ip_address: "127.0.0.1",
        user_agent: "e2e",
        payload_hash: "0".repeat(64), // does not match the reconstructed payload
        signature: null,
        status: null,
        timestamp: new Date().toISOString(),
      });

      const res = await request(appInstance).get("/api/audit-logs").set("x-api-key", MERCHANT_A.api_key);
      expect(res.status).toBe(200);
      expect(res.body.logs[0].integrity_status).toBe("failed");
    });

    it("marks a row with no hash at all as failed", async () => {
      h.fakeAuditLogs.push({
        id: h.idCounter.next++,
        merchant_id: MERCHANT_A.id,
        action: "login",
        status: "success",
        field_changed: null,
        old_value: null,
        new_value: null,
        ip_address: "127.0.0.1",
        user_agent: "e2e",
        payload_hash: null,
        signature: null,
        timestamp: new Date().toISOString(),
      });

      const res = await request(appInstance).get("/api/audit-logs").set("x-api-key", MERCHANT_A.api_key);
      expect(res.body.logs[0].integrity_status).toBe("failed");
    });
  });

  // ── Rate limiting ─────────────────────────────────────────────────────────────

  describe("GET /api/audit-logs — rate limiting", () => {
    it("returns 429 once the per-merchant read limit is exceeded", async () => {
      const max = Number(process.env.AUDIT_READ_RATE_LIMIT_MAX);
      let lastRes;
      for (let i = 0; i < max + 1; i += 1) {
        lastRes = await request(appInstance).get("/api/audit-logs").set("x-api-key", MERCHANT_A.api_key);
      }

      expect(lastRes.status).toBe(429);
      expect(lastRes.body.code).toBe("AUDIT_READ_RATE_LIMITED");
    });

    it("does not rate-limit a different merchant independently of the first", async () => {
      const max = Number(process.env.AUDIT_READ_RATE_LIMIT_MAX);
      for (let i = 0; i < max + 1; i += 1) {
        await request(appInstance).get("/api/audit-logs").set("x-api-key", MERCHANT_A.api_key);
      }

      const res = await request(appInstance).get("/api/audit-logs").set("x-api-key", MERCHANT_B.api_key);
      expect(res.status).toBe(200);
    });
  });

  // ── Resilience ────────────────────────────────────────────────────────────────

  describe("Resilience", () => {
    it("surfaces a DB read failure as a 500 without crashing the server", async () => {
      const defaultImpl = h.mockPoolQuery.getMockImplementation();
      h.mockPoolQuery.mockImplementation(async (text, params) => {
        if (/FROM audit_logs/i.test(text)) throw new Error("simulated DB outage");
        return defaultImpl(text, params);
      });

      const res = await request(appInstance).get("/api/audit-logs").set("x-api-key", MERCHANT_A.api_key);
      expect(res.status).toBe(500);

      h.mockPoolQuery.mockImplementation(defaultImpl);
    });
  });
});
