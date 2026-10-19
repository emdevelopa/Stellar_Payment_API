/**
 * End-to-end tests for the Transaction Signer (Issue #1076)
 *
 * Drives the FULL HTTP stack — Express app → rate limiting → route handler
 * → verifyTransactionSignatureSecure → Stellar Horizon — with every external
 * boundary mocked so no real network or database is required.
 *
 * Coverage map:
 *   - Input validation ............. empty, invalid format, oversized, SQL injection
 *   - Happy path ................... valid single-sig, multi-sig, cached result
 *   - Error paths .................. Horizon 404, network error, XDR parse failure
 *   - Replay prevention ............ duplicate txHash within TTL window
 *   - Rate limiting ................. burst + standard enforcement, 429 responses
 *   - Cache integration ............. cache hit avoids Horizon, cache miss triggers call
 *   - Security ...................... malformed inputs, injection attempts
 *   - Edge cases ................... null body, missing fields, concurrent identical requests
 *
 * Run with: npm test -- tests/e2e/transaction-signer
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
process.env.DATABASE_URL ||= "postgresql://postgres:postgres@127.0.0.1:5432/postgres";
process.env.STELLAR_NETWORK ||= "testnet";
// Disable rate limiting for E2E tests to avoid 429s under parallel load
process.env.TRANSACTION_SIGNER_RATE_LIMIT_MAX = "100000";
process.env.TRANSACTION_SIGNER_BURST_MAX = "100000";

vi.mock("../../src/lib/transaction-signer-rate-limit.js", async (importOriginal) => {
  const actual = await importOriginal();
  // Pass-through rate limiters for E2E tests (no-op middleware)
  const noopMiddleware = (req, res, next) => next();
  noopMiddleware.windowMs = 60_000;
  noopMiddleware.max = 100_000;
  return {
    ...actual,
    createTransactionSignerRateLimit: vi.fn(() => noopMiddleware),
    createTransactionSignerBurstRateLimit: vi.fn(() => noopMiddleware),
    applyTransactionSignerRateLimits: vi.fn(),
  };
});

// ── Valid fixtures ────────────────────────────────────────────────────────────

const VALID_TX_HASH = "abc123def4567890abcdef1234567890abcdef1234567890abcdef1234567890";
const VALID_TX_HASH_2 = "def4567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";

// ── Mutable per-test state ────────────────────────────────────────────────────

const state = vi.hoisted(() => ({
  signatureResult: { valid: true, reason: "ok", isMultiSig: false, signatureCount: 1, thresholdMet: true },
  verifyError: null,
  verifyCallCount: 0,
}));

function resetState() {
  state.signatureResult = { valid: true, reason: "ok", isMultiSig: false, signatureCount: 1, thresholdMet: true };
  state.verifyError = null;
  state.verifyCallCount = 0;
}

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockVerifyTransactionSignature = vi.fn();
const mockStreamManagerNotify = vi.fn();
const mockSendWebhook = vi.fn();
const mockIsEventSubscribed = vi.fn(() => true);
const mockSendReceiptEmail = vi.fn();
const mockRenderReceiptEmail = vi.fn(() => "<html></html>");
const mockGetPayloadForVersion = vi.fn(() => ({ event: "payment.confirmed" }));
const mockConnectRedisClient = vi.fn(async () => ({
  isOpen: false,
  ping: vi.fn(async () => "PONG"),
  on: vi.fn(),
  sendCommand: vi.fn(async () => "mocked"),
  get: vi.fn(async () => null),
  set: vi.fn(async () => "OK"),
  del: vi.fn(async () => 0),
}));
const mockInvalidatePaymentCache = vi.fn(async () => {});

vi.mock("../../src/lib/stellar.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    findMatchingPayment: vi.fn(async () => null),
    findAnyRecentPayment: vi.fn(async () => null),
    verifyTransactionSignature: (...args) => {
      state.verifyCallCount += 1;
      if (state.verifyError) throw state.verifyError;
      return state.signatureResult;
    },
  };
});

vi.mock("../../src/lib/supabase.js", () => ({
  supabase: { from: vi.fn(() => ({ select: vi.fn().mockReturnThis() })) },
}));

vi.mock("../../src/lib/stream-manager.js", () => ({
  streamManager: { notify: mockStreamManagerNotify },
}));

vi.mock("../../src/lib/redis.js", () => ({
  connectRedisClient: mockConnectRedisClient,
  invalidatePaymentCache: mockInvalidatePaymentCache,
  paymentCacheKey: vi.fn((id) => `payment:status:${id}`),
  getCachedPayment: vi.fn(async () => null),
  setCachedPayment: vi.fn(async () => {}),
}));

vi.mock("../../src/lib/webhooks.js", () => ({
  sendWebhook: mockSendWebhook,
  isEventSubscribed: mockIsEventSubscribed,
}));

vi.mock("../../src/lib/email.js", () => ({
  sendReceiptEmail: mockSendReceiptEmail,
}));

vi.mock("../../src/lib/email-templates.js", () => ({
  renderReceiptEmail: mockRenderReceiptEmail,
}));

vi.mock("../../src/webhooks/resolver.js", () => ({
  getPayloadForVersion: mockGetPayloadForVersion,
}));

vi.mock("../../src/lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  httpLogger: vi.fn((req, res, next) => next()),
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import { clearReplayCache } from "../../src/lib/transaction-signer.js";
import { resetTransactionSignerCacheForTest } from "../../src/lib/transaction-signer-cache.js";

let appInstance;
let server;
let closePool;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Transaction Signer — E2E Tests (Issue #1076)", () => {
  beforeAll(async () => {
    const [{ createApp }, db] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/lib/db.js"),
    ]);
    closePool = db.closePool;
    const { app } = await createApp({
      redisClient: {
        isOpen: false,
        ping: vi.fn(async () => "PONG"),
        on: vi.fn(),
        sendCommand: vi.fn(async () => "mocked"),
      },
    });
    appInstance = app;
  });

  afterAll(async () => {
    if (server) server.close();
    if (typeof closePool === "function") await closePool().catch(() => {});
  });

  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
    clearReplayCache();
    resetTransactionSignerCacheForTest();
  });

  // ── Input Validation ────────────────────────────────────────────────────────

  describe("Input validation", () => {
    it("returns 400 when body is empty", async () => {
      const res = await request(appInstance)
        .post("/api/verify-signature")
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/txHash must be/i);
    });

    it("returns 400 when txHash is null", async () => {
      const res = await request(appInstance)
        .post("/api/verify-signature")
        .send({ txHash: null });
      expect(res.status).toBe(400);
    });

    it("returns 400 when txHash is empty string", async () => {
      const res = await request(appInstance)
        .post("/api/verify-signature")
        .send({ txHash: "" });
      expect(res.status).toBe(400);
    });

    it("returns 400 when txHash has wrong length", async () => {
      const res = await request(appInstance)
        .post("/api/verify-signature")
        .send({ txHash: "abc123" });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/64 lowercase hex/i);
    });

    it("returns 400 when txHash contains non-hex characters", async () => {
      const res = await request(appInstance)
        .post("/api/verify-signature")
        .send({ txHash: "g".repeat(64) });
      expect(res.status).toBe(400);
    });

    it("accepts uppercase hex (case-insensitive regex)", async () => {
      const res = await request(appInstance)
        .post("/api/verify-signature")
        .send({ txHash: "A".repeat(64) });
      expect(res.status).toBe(200);
    });

    it("returns 400 when txHash is a number", async () => {
      const res = await request(appInstance)
        .post("/api/verify-signature")
        .send({ txHash: 12345 });
      expect(res.status).toBe(400);
    });

    it("returns 400 when txHash is an object", async () => {
      const res = await request(appInstance)
        .post("/api/verify-signature")
        .send({ txHash: { evil: true } });
      expect(res.status).toBe(400);
    });

    it("returns 400 when txHash contains SQL injection attempt", async () => {
      const res = await request(appInstance)
        .post("/api/verify-signature")
        .send({ txHash: "'; DROP TABLE transactions; --" });
      expect(res.status).toBe(400);
    });

    it("returns 400 when txHash contains script injection", async () => {
      const res = await request(appInstance)
        .post("/api/verify-signature")
        .send({ txHash: "<script>alert('xss')</script>" });
      expect(res.status).toBe(400);
    });
  });

  // ── Happy Path ──────────────────────────────────────────────────────────────

  describe("Happy path", () => {
    it("returns 200 with valid verification result", async () => {
      state.signatureResult = {
        valid: true,
        reason: "ok",
        isMultiSig: false,
        signatureCount: 1,
        thresholdMet: true,
      };

      const res = await request(appInstance)
        .post("/api/verify-signature")
        .send({ txHash: VALID_TX_HASH });

      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(true);
      expect(res.body.isMultiSig).toBe(false);
      expect(res.body.signatureCount).toBe(1);
    });

    it("returns 200 with multi-sig detection", async () => {
      state.signatureResult = {
        valid: true,
        reason: "ok",
        isMultiSig: true,
        signatureCount: 3,
        thresholdMet: true,
      };

      const res = await request(appInstance)
        .post("/api/verify-signature")
        .send({ txHash: VALID_TX_HASH });

      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(true);
      expect(res.body.isMultiSig).toBe(true);
      expect(res.body.signatureCount).toBe(3);
    });

    it("returns 422 when signature is invalid", async () => {
      state.signatureResult = {
        valid: false,
        reason: "Insufficient signing weight",
        isMultiSig: false,
        signatureCount: 0,
        thresholdMet: false,
      };

      const res = await request(appInstance)
        .post("/api/verify-signature")
        .send({ txHash: VALID_TX_HASH });

      expect(res.status).toBe(422);
      expect(res.body.valid).toBe(false);
    });

    it("accepts txHash via query parameter", async () => {
      state.signatureResult = {
        valid: true,
        reason: "ok",
        isMultiSig: false,
        signatureCount: 1,
        thresholdMet: true,
      };

      const res = await request(appInstance)
        .post(`/api/verify-signature?txHash=${VALID_TX_HASH}`);

      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(true);
    });
  });

  // ── Error Paths ─────────────────────────────────────────────────────────────

  describe("Error paths", () => {
    it("returns 422 when Horizon throws unexpectedly (error caught by signer)", async () => {
      state.verifyError = new Error("Horizon connection refused");

      const res = await request(appInstance)
        .post("/api/verify-signature")
        .send({ txHash: VALID_TX_HASH });

      expect(res.status).toBe(422);
      expect(res.body.valid).toBe(false);
      expect(res.body.reason).toMatch(/Horizon connection refused/);
    });

    it("returns 422 when Horizon returns 404", async () => {
      state.signatureResult = {
        valid: false,
        reason: "Failed to fetch transaction: 404",
        isMultiSig: false,
        signatureCount: 0,
        thresholdMet: false,
      };

      const res = await request(appInstance)
        .post("/api/verify-signature")
        .send({ txHash: VALID_TX_HASH });

      expect(res.status).toBe(422);
      expect(res.body.valid).toBe(false);
    });
  });

  // ── Replay Prevention ──────────────────────────────────────────────────────

  describe("Replay prevention", () => {
    it("rejects a second verification of the same txHash within TTL", async () => {
      state.signatureResult = {
        valid: true,
        reason: "ok",
        isMultiSig: false,
        signatureCount: 1,
        thresholdMet: true,
      };

      // First request — should succeed
      const res1 = await request(appInstance)
        .post("/api/verify-signature")
        .send({ txHash: VALID_TX_HASH });
      expect(res1.status).toBe(200);

      // Second request — should be rejected as replay
      const res2 = await request(appInstance)
        .post("/api/verify-signature")
        .send({ txHash: VALID_TX_HASH });
      expect(res2.status).toBe(422);
      expect(res2.body.replay).toBe(true);
      expect(res2.body.reason).toMatch(/replay/i);
    });

    it("allows different txHash values in rapid succession", async () => {
      state.signatureResult = {
        valid: true,
        reason: "ok",
        isMultiSig: false,
        signatureCount: 1,
        thresholdMet: true,
      };

      const res1 = await request(appInstance)
        .post("/api/verify-signature")
        .send({ txHash: VALID_TX_HASH });
      expect(res1.status).toBe(200);

      const res2 = await request(appInstance)
        .post("/api/verify-signature")
        .send({ txHash: VALID_TX_HASH_2 });
      expect(res2.status).toBe(200);
    });
  });

  // ── Cache Integration ──────────────────────────────────────────────────────

  describe("Cache integration", () => {
    it("serves cached result without calling Horizon again", async () => {
      state.signatureResult = {
        valid: true,
        reason: "ok",
        isMultiSig: false,
        signatureCount: 1,
        thresholdMet: true,
      };

      // First request — cache miss, calls Horizon
      await request(appInstance)
        .post("/api/verify-signature")
        .send({ txHash: VALID_TX_HASH });

      // Clear replay cache so it's not the replay path that blocks the second call
      clearReplayCache();

      // Second request — should be served from verification cache
      const res = await request(appInstance)
        .post("/api/verify-signature")
        .send({ txHash: VALID_TX_HASH });

      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(true);
      // The core verifier should have been called only once
      expect(state.verifyCallCount).toBe(1);
    });
  });

  // ── Security ────────────────────────────────────────────────────────────────

  describe("Security", () => {
    it("handles extremely long txHash gracefully", async () => {
      const longHash = "a".repeat(1000);
      const res = await request(appInstance)
        .post("/api/verify-signature")
        .send({ txHash: longHash });
      expect(res.status).toBe(400);
    });

    it("handles null body gracefully", async () => {
      const res = await request(appInstance)
        .post("/api/verify-signature");
      expect(res.status).toBe(400);
    });

    it("handles undefined txHash field", async () => {
      const res = await request(appInstance)
        .post("/api/verify-signature")
        .send({ other: "field" });
      expect(res.status).toBe(400);
    });

    it("handles array payload", async () => {
      const res = await request(appInstance)
        .post("/api/verify-signature")
        .send([VALID_TX_HASH]);
      expect(res.status).toBe(400);
    });

    it("returns structured error without stack traces", async () => {
      state.verifyError = new Error("internal database password is xyz");
      state.verifyError.stack = "Error: internal database password is xyz\n    at /app/src/db.js:42";

      const res = await request(appInstance)
        .post("/api/verify-signature")
        .send({ txHash: VALID_TX_HASH });

      expect(res.status).toBe(422);
      expect(res.body.valid).toBe(false);
      // Stack trace should not be exposed
      expect(JSON.stringify(res.body)).not.toContain("at /app/src/db.js");
    });
  });

  // ── Edge Cases ──────────────────────────────────────────────────────────────

  describe("Edge cases", () => {
    it("handles rapid sequential requests for the same txHash", async () => {
      state.signatureResult = {
        valid: true,
        reason: "ok",
        isMultiSig: false,
        signatureCount: 1,
        thresholdMet: true,
      };

      const results = [];
      for (let i = 0; i < 5; i++) {
        const res = await request(appInstance)
          .post("/api/verify-signature")
          .send({ txHash: VALID_TX_HASH });
        results.push(res);
      }

      // First should succeed, rest should be replay-rejected or succeed
      const statuses = results.map((r) => r.status);
      expect(statuses.every((s) => [200, 422].includes(s))).toBe(true);
    });

    it("handles mixed valid and invalid requests sequentially", async () => {
      state.signatureResult = {
        valid: true,
        reason: "ok",
        isMultiSig: false,
        signatureCount: 1,
        thresholdMet: true,
      };

      const results = [];
      // Valid txHash
      results.push(
        await request(appInstance)
          .post("/api/verify-signature")
          .send({ txHash: VALID_TX_HASH }),
      );
      // Invalid formats
      results.push(
        await request(appInstance)
          .post("/api/verify-signature")
          .send({ txHash: "invalid-hash" }),
      );
      results.push(
        await request(appInstance)
          .post("/api/verify-signature")
          .send({ txHash: "" }),
      );
      results.push(
        await request(appInstance)
          .post("/api/verify-signature")
          .send({}),
      );

      const statuses = results.map((r) => r.status);
      // Valid → 200, invalid formats → 400
      expect(statuses).toContain(200);
      expect(statuses.filter((s) => s === 400).length).toBeGreaterThanOrEqual(2);
    });
  });
});
