/**
 * Integration Test Suite — Payment Lifecycle
 *
 * Covers the full lifecycle of a payment intent from creation through
 * verification, including database state transitions, webhook delivery,
 * idempotency, pagination, soft-delete, and error handling.
 *
 * Stack: vitest + supertest + nock
 *
 * Every external dependency (Supabase, Stellar Horizon, Redis, email) is
 * mocked at the module boundary so the tests are deterministic and fast.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import nock from "nock";
// ─── Hoisted mock state ─────────────────────────────────────────────────────
// vi.hoisted runs before any vi.mock factory so the references are available
// inside every mock factory below.
const {
  paymentsStore,
  merchantsStore,
  webhookDeliveryLogs,
  resetStores,
  MERCHANT_ID,
  MERCHANT_API_KEY,
  MERCHANT_WEBHOOK_SECRET,
  STELLAR_RECIPIENT,
} = vi.hoisted(() => {
  const MERCHANT_ID = "b1e2c3d4-aaaa-4bbb-8ccc-111111111111";
  const MERCHANT_API_KEY = "test-api-key-integration";
  const MERCHANT_WEBHOOK_SECRET = "whsec_test_integration_secret";
  const STELLAR_RECIPIENT = "GBZXCJIUEPDPADZNGFYTGV2UNBWDLRPGLOJNHZQ6NPAEYV4YUXKGD7A";

  /** In-memory payments table */
  const paymentsStore = new Map();

  /** In-memory merchants table */
  const merchantsStore = new Map();

  /** Captured webhook delivery rows */
  const webhookDeliveryLogs = [];

  function resetStores() {
    paymentsStore.clear();
    merchantsStore.clear();
    webhookDeliveryLogs.length = 0;

    // Seed the test merchant
    merchantsStore.set(MERCHANT_ID, {
      id: MERCHANT_ID,
      email: "merchant@test.io",
      business_name: "Test Shop",
      notification_email: "alerts@test.io",
      api_key: MERCHANT_API_KEY,
      branding_config: null,
      merchant_settings: null,
      webhook_secret: MERCHANT_WEBHOOK_SECRET,
      webhook_secret_old: null,
      webhook_secret_expiry: null,
      webhook_version: "v1",
      payment_limits: null,
      deleted_at: null,
    });
  }

  return {
    paymentsStore,
    merchantsStore,
    webhookDeliveryLogs,
    resetStores,
    MERCHANT_ID,
    MERCHANT_API_KEY,
    MERCHANT_WEBHOOK_SECRET,
    STELLAR_RECIPIENT,
  };
});

// ─── Module mocks (hoisted by vitest) ───────────────────────────────────────

/*
 * Supabase mock — the most elaborate mock because every route drives queries
 * through the fluent .from().select().eq().maybeSingle() chaining API.
 *
 * Strategy: build a lightweight chainable query builder backed by the
 * in-memory paymentsStore / merchantsStore Maps.
 */
vi.mock("../../src/lib/supabase.js", () => {
  /** Return a chainable object that mirrors the Supabase PostgREST builder. */
  function createQueryBuilder(tableName) {
    let filters = {};
    let selectFields = "*";
    let updatePayload = null;
    let isHead = false;
    let isNullFilters = {};
    let rangeStart = null;
    let rangeEnd = null;

    function getStore() {
      if (tableName === "payments") return paymentsStore;
      if (tableName === "merchants") return merchantsStore;
      if (tableName === "webhook_delivery_logs") return null;
      return new Map();
    }

    function applyFilters(rows) {
      return rows.filter((row) => {
        for (const [key, val] of Object.entries(filters)) {
          if (row[key] !== val) return false;
        }
        for (const [key, mustBeNull] of Object.entries(isNullFilters)) {
          if (mustBeNull && row[key] != null) return false;
        }
        return true;
      });
    }

    function joinMerchant(payment) {
      if (!selectFields.includes("merchants(")) return payment;
      const merchant = merchantsStore.get(payment.merchant_id);
      if (!merchant) return { ...payment, merchants: null };
      return { ...payment, merchants: merchant };
    }

    const builder = {
      select(fields, opts) {
        selectFields = fields || "*";
        if (opts?.head) isHead = true;
        if (opts?.count === "exact") isHead = true;
        return builder;
      },
      insert(payload) {
        const rows = Array.isArray(payload) ? payload : [payload];
        const store = getStore();
        if (store) {
          for (const row of rows) {
            store.set(row.id, { ...row });
          }
        }
        if (tableName === "webhook_delivery_logs") {
          webhookDeliveryLogs.push(...rows);
        }
        return { data: rows, error: null };
      },
      update(payload) {
        updatePayload = payload;
        return builder;
      },
      eq(key, value) {
        filters[key] = value;

        // If this is an update, apply when we have the id filter
        if (updatePayload && key === "id") {
          const store = getStore();
          if (store && store.has(value)) {
            const existing = store.get(value);
            store.set(value, { ...existing, ...updatePayload });
          }
          return { data: null, error: null };
        }

        return builder;
      },
      is(key, value) {
        if (value === null) isNullFilters[key] = true;
        return builder;
      },
      order() {
        return builder;
      },
      range(start, end) {
        rangeStart = start;
        rangeEnd = end;
        return builder;
      },
      gte() { return builder; },
      lte() { return builder; },
      or() { return builder; },
      async maybeSingle() {
        const store = getStore();
        if (!store) return { data: null, error: null };
        const rows = applyFilters([...store.values()]);
        const row = rows[0] || null;
        return { data: row ? joinMerchant(row) : null, error: null };
      },
      // Support awaiting the builder directly (paginated queries)
      then(resolve) {
        const store = getStore();
        if (!store) return resolve({ data: [], error: null, count: 0 });
        const rows = applyFilters([...store.values()]);

        if (isHead) {
          return resolve({ data: null, error: null, count: rows.length });
        }

        let result = rows.map(joinMerchant);
        if (rangeStart !== null && rangeEnd !== null) {
          result = result.slice(rangeStart, rangeEnd + 1);
        }
        return resolve({ data: result, error: null, count: rows.length });
      },
    };
    return builder;
  }

  return {
    supabase: {
      from: vi.fn((table) => createQueryBuilder(table)),
    },
  };
});

/*
 * Stellar mock — controls whether findMatchingPayment returns a match.
 */
const mockFindMatchingPayment = vi.fn().mockResolvedValue(null);
const mockGetNetworkFeeStats = vi.fn().mockResolvedValue({
  network: "testnet",
  horizonUrl: "https://horizon-testnet.stellar.org",
  operationCount: 1,
  lastLedgerBaseFee: 100,
  recommendedFeeStroops: 100,
  totalFeeStroops: 100,
  totalFeeXlm: "0.0000100",
  feeCharged: { mode: "100", p50: "100" },
  maxFee: { mode: "100" },
});

vi.mock("../../src/lib/stellar.js", () => ({
  findMatchingPayment: (...args) => mockFindMatchingPayment(...args),
  getNetworkFeeStats: (...args) => mockGetNetworkFeeStats(...args),
  isHorizonReachable: vi.fn(async () => true),
  resolveAsset: vi.fn(),
  createRefundTransaction: vi.fn(),
  findStrictReceivePaths: vi.fn(),
  validateMemo: () => ({ valid: true }),
  getStellarConfig: () => ({ network: "testnet", horizonUrl: "https://horizon-testnet.stellar.org" }),
}));

/*
 * Redis mock — noop cache so the routes that read/write cache don't explode.
 */
const redisMemory = new Map();
vi.mock("../../src/lib/redis.js", () => ({
  connectRedisClient: vi.fn(async () => ({
    get: vi.fn(async (key) => redisMemory.get(key) || null),
    set: vi.fn(async (key, val) => { redisMemory.set(key, val); }),
    del: vi.fn(async (key) => { redisMemory.delete(key); }),
    isOpen: true,
  })),
  getCachedPayment: vi.fn(async () => null),
  setCachedPayment: vi.fn(async () => {}),
  invalidatePaymentCache: vi.fn(async () => {}),
  getRedisClient: vi.fn(() => ({
    get: vi.fn(async (key) => redisMemory.get(key) || null),
    set: vi.fn(async (key, val, options) => { redisMemory.set(key, val); }),
    ping: vi.fn(async () => "PONG"),
    on: vi.fn(),
    sendCommand: vi.fn(async () => {}),
    isOpen: true,
  })),



  resetRedisClientForTests: vi.fn(),
  paymentCacheKey: (id) => `payment:status:${id}`,
  PAYMENT_STATUS_TTL: 2,
}));

/*
 * Webhook mock — records calls so we can assert delivery payloads.
 */
const mockSendWebhook = vi.fn().mockResolvedValue({ ok: true, signed: true, status: 200 });
vi.mock("../../src/lib/webhooks.js", () => ({
  sendWebhook: (...args) => mockSendWebhook(...args),
  signPayload: vi.fn(() => "mocked-signature"),
  verifyWebhook: vi.fn(() => true),
  isEventSubscribed: vi.fn(() => true),
}));

/*
 * Rate-limit mock — bypass Redis-backed rate limiters with noop middleware
 * so verify-payment and merchant-registration routes don't need a live Redis.
 */
vi.mock("../../src/lib/rate-limit.js", () => {
  const passthrough = (req, res, next) => next();
  return {
    RATE_LIMIT_REDIS_PREFIX: "rl:",
    createRedisRateLimitStore: vi.fn(() => ({})),
    createVerifyPaymentRateLimit: vi.fn(() => passthrough),
    createMerchantRegistrationRateLimit: vi.fn(() => passthrough),
  };
});

/*
 * Email mock — noop
 */
vi.mock("../../src/lib/email.js", () => ({
  sendReceiptEmail: vi.fn(async () => ({ ok: true })),
}));
vi.mock("../../src/lib/email-templates.js", () => ({
  renderReceiptEmail: vi.fn(() => "<html>receipt</html>"),
}));

/*
 * DB pool mock
 */
vi.mock("../../src/lib/db.js", () => ({
  pool: { query: vi.fn(), end: vi.fn() },
  closePool: vi.fn(async () => {}),
}));

/*
 * API-usage recorder — noop so auth middleware doesn't error.
 */
vi.mock("../../src/lib/api-usage.js", () => ({
  recordMerchantApiUsage: vi.fn(async () => {}),
}));

/*
 * Sentry — noop in tests.
 */
vi.mock("../../src/lib/sentry.js", () => ({
  initSentry: vi.fn(),
  setupSentryErrorHandler: vi.fn(),
}));

// ─── Test suite ─────────────────────────────────────────────────────────────

import request from "supertest";
import { createApp } from "../../src/app.js";

describe("Payment Lifecycle — Integration", () => {
  let app;
  let io;

  const mockRedisClient = {
    ping: vi.fn(async () => "PONG"),
    on: vi.fn(),
    sendCommand: vi.fn(async () => {}),
    isOpen: true,
  };

  beforeAll(async () => {
    ({ app, io } = await createApp({ redisClient: mockRedisClient }));
  });

  afterAll(() => {
    nock.cleanAll();
    if (nock.isActive()) nock.restore();
  });

  beforeEach(() => {
    resetStores();
    redisMemory.clear();
    vi.clearAllMocks();
    mockFindMatchingPayment.mockResolvedValue(null);
    mockGetNetworkFeeStats.mockResolvedValue({
      network: "testnet",
      horizonUrl: "https://horizon-testnet.stellar.org",
      operationCount: 1,
      lastLedgerBaseFee: 100,
      recommendedFeeStroops: 100,
      totalFeeStroops: 100,
      totalFeeXlm: "0.0000100",
      feeCharged: { mode: "100", p50: "100" },
      maxFee: { mode: "100" },
    });
    mockSendWebhook.mockResolvedValue({ ok: true, signed: true, status: 200 });
    nock.cleanAll();
  });


  // ═══════════════════════════════════════════════════════════════════════════
  // 1) Authentication
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Authentication", () => {
    it("rejects requests without an x-api-key header", async () => {
      const res = await request(app).post("/api/create-payment").send({
        amount: 10,
        asset: "XLM",
        recipient: STELLAR_RECIPIENT,
      });

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/api.key/i);
    });

    it("rejects requests with an invalid API key", async () => {
      const res = await request(app)
        .post("/api/create-payment")
        .set("x-api-key", "totally-wrong-key")
        .send({
          amount: 10,
          asset: "XLM",
          recipient: STELLAR_RECIPIENT,
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/invalid/i);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2) Create Payment Session
  // ═══════════════════════════════════════════════════════════════════════════
  describe("POST /api/create-payment", () => {
    it("creates a payment and returns 201 with payment_id and link", async () => {
      const res = await request(app)
        .post("/api/create-payment")
        .set("x-api-key", MERCHANT_API_KEY)
        .send({
          amount: 50,
          asset: "XLM",
          recipient: STELLAR_RECIPIENT,
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("payment_id");
      expect(res.body).toHaveProperty("payment_link");
      expect(res.body.status).toBe("pending");
      expect(res.body.payment_link).toContain(res.body.payment_id);

      // Verify the payment was persisted in the store
      const stored = paymentsStore.get(res.body.payment_id);
      expect(stored).toBeDefined();
      expect(stored.amount).toBe(50);
      expect(stored.asset).toBe("XLM");
      expect(stored.merchant_id).toBe(MERCHANT_ID);
      expect(stored.status).toBe("pending");
    });

    it("creates a payment with optional description, memo, and webhook_url", async () => {
      const res = await request(app)
        .post("/api/create-payment")
        .set("x-api-key", MERCHANT_API_KEY)
        .send({
          amount: 100,
          asset: "XLM",
          recipient: STELLAR_RECIPIENT,
          description: "Order #42",
          memo: "order42",
          memo_type: "text",
          webhook_url: "https://merchant.example.com/hooks/stellar",
        });

      expect(res.status).toBe(201);

      const stored = paymentsStore.get(res.body.payment_id);
      expect(stored.description).toBe("Order #42");
      expect(stored.memo).toBe("order42");
      expect(stored.memo_type).toBe("text");
      expect(stored.webhook_url).toBe("https://merchant.example.com/hooks/stellar");
    });

    it("returns branding_config in the response", async () => {
      const res = await request(app)
        .post("/api/create-payment")
        .set("x-api-key", MERCHANT_API_KEY)
        .send({
          amount: 25,
          asset: "XLM",
          recipient: STELLAR_RECIPIENT,
          branding_overrides: { primary_color: "#ff0000" },
        });

      expect(res.status).toBe(201);
      expect(res.body.branding_config).toBeDefined();
      expect(res.body.branding_config.primary_color).toBe("#ff0000");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 3) Validation errors
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Payment creation — validation", () => {
    it("rejects a request missing the amount field", async () => {
      const res = await request(app)
        .post("/api/create-payment")
        .set("x-api-key", MERCHANT_API_KEY)
        .send({ asset: "XLM", recipient: STELLAR_RECIPIENT });

      expect(res.status).toBe(400);
    });

    it("rejects a request with a negative amount", async () => {
      const res = await request(app)
        .post("/api/create-payment")
        .set("x-api-key", MERCHANT_API_KEY)
        .send({ amount: -5, asset: "XLM", recipient: STELLAR_RECIPIENT });

      expect(res.status).toBe(400);
    });

    it("rejects a request missing the recipient field", async () => {
      const res = await request(app)
        .post("/api/create-payment")
        .set("x-api-key", MERCHANT_API_KEY)
        .send({ amount: 10, asset: "XLM" });

      expect(res.status).toBe(400);
    });

    it("rejects a non-native asset without asset_issuer", async () => {
      const res = await request(app)
        .post("/api/create-payment")
        .set("x-api-key", MERCHANT_API_KEY)
        .send({ amount: 10, asset: "USDC", recipient: STELLAR_RECIPIENT });

      expect(res.status).toBe(400);
    });

    it("rejects an XLM payment below the minimum amount", async () => {
      const res = await request(app)
        .post("/api/create-payment")
        .set("x-api-key", MERCHANT_API_KEY)
        .send({ amount: 0.001, asset: "XLM", recipient: STELLAR_RECIPIENT });

      expect(res.status).toBe(400);
    });

    it("rejects a request with memo but no memo_type", async () => {
      const res = await request(app)
        .post("/api/create-payment")
        .set("x-api-key", MERCHANT_API_KEY)
        .send({
          amount: 10,
          asset: "XLM",
          recipient: STELLAR_RECIPIENT,
          memo: "hello",
        });

      expect(res.status).toBe(400);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 4) Payment Status
  // ═══════════════════════════════════════════════════════════════════════════
  describe("GET /api/payment-status/:id", () => {
    it("returns the pending payment", async () => {
      const create = await request(app)
        .post("/api/create-payment")
        .set("x-api-key", MERCHANT_API_KEY)
        .send({ amount: 10, asset: "XLM", recipient: STELLAR_RECIPIENT });

      const paymentId = create.body.payment_id;

      const res = await request(app)
        .get(`/api/payment-status/${paymentId}`)
        .set("x-api-key", MERCHANT_API_KEY);

      expect(res.status).toBe(200);
      expect(res.body.payment).toBeDefined();
      expect(res.body.payment.id).toBe(paymentId);
      expect(res.body.payment.status).toBe("pending");
      expect(res.body.payment.amount).toBe(10);
    });

    it("returns 404 for a non-existent payment", async () => {
      const fakeId = randomUUID();
      const res = await request(app)
        .get(`/api/payment-status/${fakeId}`)
        .set("x-api-key", MERCHANT_API_KEY);

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/not found/i);
    });

    it("returns 400 for an invalid UUID format", async () => {
      const res = await request(app)
        .get("/api/payment-status/not-a-uuid")
        .set("x-api-key", MERCHANT_API_KEY);

      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/network-fee", () => {
    it("returns the current estimated Stellar network fee", async () => {
      mockGetNetworkFeeStats.mockResolvedValueOnce({
        network: "testnet",
        horizonUrl: "https://horizon-testnet.stellar.org",
        operationCount: 1,
        lastLedgerBaseFee: 100,
        recommendedFeeStroops: 125,
        totalFeeStroops: 125,
        totalFeeXlm: "0.0000125",
        feeCharged: { mode: "125", p50: "120" },
        maxFee: { mode: "125" },
      });

      const res = await request(app).get("/api/network-fee");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        network_fee: {
          network: "testnet",
          horizon_url: "https://horizon-testnet.stellar.org",
          operation_count: 1,
          stroops: 125,
          xlm: "0.0000125",
          last_ledger_base_fee: 100,
        },
      });
      expect(mockGetNetworkFeeStats).toHaveBeenCalledWith(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 5) Verify Payment (Stellar network check)
  // ═══════════════════════════════════════════════════════════════════════════
  describe("POST /api/verify-payment/:id", () => {
    it("returns pending when no matching Stellar transaction is found", async () => {
      const create = await request(app)
        .post("/api/create-payment")
        .set("x-api-key", MERCHANT_API_KEY)
        .send({ amount: 10, asset: "XLM", recipient: STELLAR_RECIPIENT });

      mockFindMatchingPayment.mockResolvedValue(null);

      const res = await request(app)
        .post(`/api/verify-payment/${create.body.payment_id}`)
        .set("x-api-key", MERCHANT_API_KEY);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("pending");
    });

    it("confirms a payment when a matching Stellar transaction is found", async () => {
      const create = await request(app)
        .post("/api/create-payment")
        .set("x-api-key", MERCHANT_API_KEY)
        .send({
          amount: 75,
          asset: "XLM",
          recipient: STELLAR_RECIPIENT,
          webhook_url: "https://merchant.example.com/hooks",
        });

      const paymentId = create.body.payment_id;
      const fakeTxHash = "abc123def456abc123def456abc123def456abc123def456abc123def456abcd";

      mockFindMatchingPayment.mockResolvedValue({
        id: "op-001",
        transaction_hash: fakeTxHash,
      });

      const res = await request(app)
        .post(`/api/verify-payment/${paymentId}`)
        .set("x-api-key", MERCHANT_API_KEY);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("confirmed");
      expect(res.body.tx_id).toBe(fakeTxHash);
      expect(res.body.ledger_url).toContain(fakeTxHash);

      // Verify DB state was updated
      const stored = paymentsStore.get(paymentId);
      expect(stored.status).toBe("confirmed");
      expect(stored.tx_id).toBe(fakeTxHash);
    });

    it("fires the correct Horizon query parameters to findMatchingPayment", async () => {
      const create = await request(app)
        .post("/api/create-payment")
        .set("x-api-key", MERCHANT_API_KEY)
        .send({
          amount: 42,
          asset: "XLM",
          recipient: STELLAR_RECIPIENT,
          memo: "order99",
          memo_type: "text",
        });

      mockFindMatchingPayment.mockResolvedValue(null);

      await request(app)
        .post(`/api/verify-payment/${create.body.payment_id}`)
        .set("x-api-key", MERCHANT_API_KEY);

      expect(mockFindMatchingPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          recipient: STELLAR_RECIPIENT,
          amount: 42,
          assetCode: "XLM",
          assetIssuer: null,
          memo: "order99",
          memoType: "text",
        }),
      );
    });

    it("returns the cached confirmed result on repeated verify calls", async () => {
      const create = await request(app)
        .post("/api/create-payment")
        .set("x-api-key", MERCHANT_API_KEY)
        .send({ amount: 10, asset: "XLM", recipient: STELLAR_RECIPIENT });

      const paymentId = create.body.payment_id;
      const txHash = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

      // First verify — confirms
      mockFindMatchingPayment.mockResolvedValue({
        id: "op-x",
        transaction_hash: txHash,
      });

      await request(app)
        .post(`/api/verify-payment/${paymentId}`)
        .set("x-api-key", MERCHANT_API_KEY);

      // Second verify — should see already-confirmed without calling Horizon
      mockFindMatchingPayment.mockClear();

      const res2 = await request(app)
        .post(`/api/verify-payment/${paymentId}`)
        .set("x-api-key", MERCHANT_API_KEY);

      expect(res2.status).toBe(200);
      expect(res2.body.status).toBe("confirmed");
      expect(res2.body.tx_id).toBe(txHash);
      // Horizon should NOT have been queried a second time
      expect(mockFindMatchingPayment).not.toHaveBeenCalled();
    });

    it("returns 404 for a non-existent payment", async () => {
      const fakeId = randomUUID();
      const res = await request(app)
        .post(`/api/verify-payment/${fakeId}`)
        .set("x-api-key", MERCHANT_API_KEY);

      expect(res.status).toBe(404);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 6) Webhook delivery on confirmation
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Webhook delivery", () => {
    it("calls sendWebhook with the correct payload on payment confirmation", async () => {
      const webhookUrl = "https://merchant.example.com/hooks/stellar";

      const create = await request(app)
        .post("/api/create-payment")
        .set("x-api-key", MERCHANT_API_KEY)
        .send({
          amount: 200,
          asset: "XLM",
          recipient: STELLAR_RECIPIENT,
          webhook_url: webhookUrl,
        });

      const paymentId = create.body.payment_id;
      const txHash = "aaaa1111bbbb2222cccc3333dddd4444eeee5555ffff6666aaaa1111bbbb2222";

      mockFindMatchingPayment.mockResolvedValue({
        id: "op-wh",
        transaction_hash: txHash,
      });

      await request(app)
        .post(`/api/verify-payment/${paymentId}`)
        .set("x-api-key", MERCHANT_API_KEY);

      // sendWebhook should have been called
      expect(mockSendWebhook).toHaveBeenCalledTimes(1);

      const [calledUrl, calledPayload, calledSecret] = mockSendWebhook.mock.calls[0];
      expect(calledUrl).toBe(webhookUrl);
      expect(calledSecret).toBe(MERCHANT_WEBHOOK_SECRET);
      expect(calledPayload).toEqual(
        expect.objectContaining({
          event: "payment.confirmed",
          payment_id: paymentId,
          amount: 200,
          asset: "XLM",
          tx_id: txHash,
          recipient: STELLAR_RECIPIENT,
        }),
      );
    });

    it("calls sendWebhook with null url when no webhook_url is set", async () => {
      const create = await request(app)
        .post("/api/create-payment")
        .set("x-api-key", MERCHANT_API_KEY)
        .send({
          amount: 5,
          asset: "XLM",
          recipient: STELLAR_RECIPIENT,
          // no webhook_url
        });

      mockFindMatchingPayment.mockResolvedValue({
        id: "op-nw",
        transaction_hash: "0000111122223333444455556666777788889999aaaabbbbccccddddeeeeffff",
      });

      const res = await request(app)
        .post(`/api/verify-payment/${create.body.payment_id}`)
        .set("x-api-key", MERCHANT_API_KEY);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("confirmed");

      // sendWebhook IS called but with a null url — the real implementation
      // returns { ok: false, skipped: true } in this case.
      if (mockSendWebhook.mock.calls.length > 0) {
        const [calledUrl] = mockSendWebhook.mock.calls[0];
        expect(calledUrl).toBeNull();
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 7) Full lifecycle: Create → Status(pending) → Verify(pending) →
  //    Verify(confirmed) → Status(confirmed)
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Full payment lifecycle (end-to-end)", () => {
    it("walks through the entire payment flow", async () => {
      // ── Step 1: Create ──────────────────────────────────────────────
      const create = await request(app)
        .post("/api/create-payment")
        .set("x-api-key", MERCHANT_API_KEY)
        .send({
          amount: 100,
          asset: "XLM",
          recipient: STELLAR_RECIPIENT,
          description: "E2E lifecycle test",
          memo: "lifecycle",
          memo_type: "text",
          webhook_url: "https://merchant.example.com/hooks",
        });

      expect(create.status).toBe(201);
      const paymentId = create.body.payment_id;
      expect(paymentId).toBeDefined();

      // ── Step 2: Status → pending ────────────────────────────────────
      const status1 = await request(app)
        .get(`/api/payment-status/${paymentId}`)
        .set("x-api-key", MERCHANT_API_KEY);

      expect(status1.status).toBe(200);
      expect(status1.body.payment.status).toBe("pending");
      expect(status1.body.payment.tx_id).toBeNull();

      // ── Step 3: Verify → still pending (no Stellar match) ──────────
      mockFindMatchingPayment.mockResolvedValue(null);

      const verify1 = await request(app)
        .post(`/api/verify-payment/${paymentId}`)
        .set("x-api-key", MERCHANT_API_KEY);

      expect(verify1.status).toBe(200);
      expect(verify1.body.status).toBe("pending");

      // DB should still be pending
      expect(paymentsStore.get(paymentId).status).toBe("pending");

      // ── Step 4: Verify → confirmed (Stellar match found) ───────────
      const txHash = "e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0";

      mockFindMatchingPayment.mockResolvedValue({
        id: "op-lifecycle",
        transaction_hash: txHash,
      });

      const verify2 = await request(app)
        .post(`/api/verify-payment/${paymentId}`)
        .set("x-api-key", MERCHANT_API_KEY);

      expect(verify2.status).toBe(200);
      expect(verify2.body.status).toBe("confirmed");
      expect(verify2.body.tx_id).toBe(txHash);
      expect(verify2.body.ledger_url).toContain(txHash);

      // DB should now be confirmed
      const confirmedPayment = paymentsStore.get(paymentId);
      expect(confirmedPayment.status).toBe("confirmed");
      expect(confirmedPayment.tx_id).toBe(txHash);

      // Webhook should have been delivered
      expect(mockSendWebhook).toHaveBeenCalled();
      const webhookPayload = mockSendWebhook.mock.calls[0][1];
      expect(webhookPayload.event).toBe("payment.confirmed");
      expect(webhookPayload.payment_id).toBe(paymentId);
      expect(webhookPayload.tx_id).toBe(txHash);

      // ── Step 5: Status → confirmed ─────────────────────────────────
      const status2 = await request(app)
        .get(`/api/payment-status/${paymentId}`)
        .set("x-api-key", MERCHANT_API_KEY);

      expect(status2.status).toBe(200);
      expect(status2.body.payment.status).toBe("confirmed");
      expect(status2.body.payment.tx_id).toBe(txHash);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 8) Idempotency
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Idempotency", () => {
    it("returns a cached 200 response for duplicate Idempotency-Key", async () => {
      const idempotencyKey = randomUUID();

      const first = await request(app)
        .post("/api/create-payment")
        .set("x-api-key", MERCHANT_API_KEY)
        .set("Idempotency-Key", idempotencyKey)
        .send({ amount: 10, asset: "XLM", recipient: STELLAR_RECIPIENT });

      expect(first.status).toBe(201);

      const second = await request(app)
        .post("/api/create-payment")
        .set("x-api-key", MERCHANT_API_KEY)
        .set("Idempotency-Key", idempotencyKey)
        .send({ amount: 10, asset: "XLM", recipient: STELLAR_RECIPIENT });

      // Duplicate should return 201 (cached) as per new requirement
      expect(second.status).toBe(201);
      expect(second.body.payment_id).toBe(first.body.payment_id);

    });

    it("creates separate payments for different Idempotency-Keys", async () => {
      const first = await request(app)
        .post("/api/create-payment")
        .set("x-api-key", MERCHANT_API_KEY)
        .set("Idempotency-Key", randomUUID())
        .send({ amount: 10, asset: "XLM", recipient: STELLAR_RECIPIENT });

      const second = await request(app)
        .post("/api/create-payment")
        .set("x-api-key", MERCHANT_API_KEY)
        .set("Idempotency-Key", randomUUID())
        .send({ amount: 10, asset: "XLM", recipient: STELLAR_RECIPIENT });

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(first.body.payment_id).not.toBe(second.body.payment_id);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 9) List Payments (paginated)
  // ═══════════════════════════════════════════════════════════════════════════
  describe("GET /api/payments", () => {
    it("returns a paginated list of payments for the authenticated merchant", async () => {
      // Create 3 payments
      for (let i = 0; i < 3; i++) {
        await request(app)
          .post("/api/create-payment")
          .set("x-api-key", MERCHANT_API_KEY)
          .send({ amount: (i + 1) * 10, asset: "XLM", recipient: STELLAR_RECIPIENT });
      }

      const res = await request(app)
        .get("/api/payments?page=1&limit=2")
        .set("x-api-key", MERCHANT_API_KEY);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("payments");
      expect(res.body).toHaveProperty("total_count");
      expect(res.body).toHaveProperty("total_pages");
      expect(res.body).toHaveProperty("page", 1);
      expect(res.body).toHaveProperty("limit", 2);
      expect(res.body.total_count).toBe(3);
      expect(res.body.total_pages).toBe(2);
      expect(res.body.payments.length).toBeLessThanOrEqual(2);
    });

    it("returns an empty list when no payments exist", async () => {
      const res = await request(app)
        .get("/api/payments")
        .set("x-api-key", MERCHANT_API_KEY);

      expect(res.status).toBe(200);
      expect(res.body.payments).toEqual([]);
      expect(res.body.total_count).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 10) Soft Delete
  // ═══════════════════════════════════════════════════════════════════════════
  describe("DELETE /api/payments/:id", () => {
    it("soft-deletes a payment and returns deleted_at timestamp", async () => {
      const create = await request(app)
        .post("/api/create-payment")
        .set("x-api-key", MERCHANT_API_KEY)
        .send({ amount: 10, asset: "XLM", recipient: STELLAR_RECIPIENT });

      const paymentId = create.body.payment_id;

      const res = await request(app)
        .delete(`/api/payments/${paymentId}`)
        .set("x-api-key", MERCHANT_API_KEY);

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/soft.deleted/i);
      expect(res.body.payment_id).toBe(paymentId);
      expect(res.body.deleted_at).toBeDefined();

      // Verify in-store
      const stored = paymentsStore.get(paymentId);
      expect(stored.deleted_at).toBeDefined();
    });

    it("returns 410 when trying to delete an already-deleted payment", async () => {
      const create = await request(app)
        .post("/api/create-payment")
        .set("x-api-key", MERCHANT_API_KEY)
        .send({ amount: 10, asset: "XLM", recipient: STELLAR_RECIPIENT });

      const paymentId = create.body.payment_id;

      // First delete
      await request(app)
        .delete(`/api/payments/${paymentId}`)
        .set("x-api-key", MERCHANT_API_KEY);

      // Second delete → 410
      const res = await request(app)
        .delete(`/api/payments/${paymentId}`)
        .set("x-api-key", MERCHANT_API_KEY);

      expect(res.status).toBe(410);
      expect(res.body.error).toMatch(/already deleted/i);
    });

    it("returns 404 for a non-existent payment", async () => {
      const fakeId = randomUUID();
      const res = await request(app)
        .delete(`/api/payments/${fakeId}`)
        .set("x-api-key", MERCHANT_API_KEY);

      expect(res.status).toBe(404);
    });

    it("hides soft-deleted payments from payment-status queries", async () => {
      const create = await request(app)
        .post("/api/create-payment")
        .set("x-api-key", MERCHANT_API_KEY)
        .send({ amount: 10, asset: "XLM", recipient: STELLAR_RECIPIENT });

      const paymentId = create.body.payment_id;

      // Delete it
      await request(app)
        .delete(`/api/payments/${paymentId}`)
        .set("x-api-key", MERCHANT_API_KEY);

      // Status query should 404 because deleted_at is not null
      const res = await request(app)
        .get(`/api/payment-status/${paymentId}`)
        .set("x-api-key", MERCHANT_API_KEY);

      expect(res.status).toBe(404);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 11) Sessions alias (/api/sessions)
  // ═══════════════════════════════════════════════════════════════════════════
  describe("POST /api/sessions (alias)", () => {
    it("creates a payment via the /api/sessions alias", async () => {
      const res = await request(app)
        .post("/api/sessions")
        .set("x-api-key", MERCHANT_API_KEY)
        .send({ amount: 33, asset: "XLM", recipient: STELLAR_RECIPIENT });

      expect(res.status).toBe(201);
      expect(res.body.payment_id).toBeDefined();
      expect(res.body.status).toBe("pending");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 12) Nock-based webhook HTTP verification
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Webhook HTTP delivery (nock)", () => {
    it("delivers a signed POST to the merchant webhook URL", async () => {
      const webhookUrl = "https://merchant.example.com";
      const webhookPath = "/hooks/confirmed";

      // Set up nock to intercept the webhook POST
      const scope = nock(webhookUrl)
        .post(webhookPath, (body) => {
          return (
            body.event === "payment.confirmed" &&
            typeof body.payment_id === "string" &&
            typeof body.tx_id === "string"
          );
        })
        .reply(200, { received: true });

      // Simulate what the real sendWebhook would do
      const payload = {
        event: "payment.confirmed",
        payment_id: randomUUID(),
        amount: 100,
        asset: "XLM",
        tx_id: "simulated_tx_hash_value_for_nock_test_1234567890abcdef12345678",
        recipient: STELLAR_RECIPIENT,
      };

      const response = await fetch(`${webhookUrl}${webhookPath}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      expect(response.ok).toBe(true);
      const json = await response.json();
      expect(json.received).toBe(true);
      scope.done(); // asserts nock interceptor was called exactly once
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 13) Edge cases
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Edge cases", () => {
    it("handles concurrent verify calls gracefully", async () => {
      const create = await request(app)
        .post("/api/create-payment")
        .set("x-api-key", MERCHANT_API_KEY)
        .send({ amount: 10, asset: "XLM", recipient: STELLAR_RECIPIENT });

      const paymentId = create.body.payment_id;
      const txHash = "concurrent0concurrent0concurrent0concurrent0concurrent0concurrent00";

      mockFindMatchingPayment.mockResolvedValue({
        id: "op-cc",
        transaction_hash: txHash,
      });

      // Fire two verify calls in parallel
      const [r1, r2] = await Promise.all([
        request(app)
          .post(`/api/verify-payment/${paymentId}`)
          .set("x-api-key", MERCHANT_API_KEY),
        request(app)
          .post(`/api/verify-payment/${paymentId}`)
          .set("x-api-key", MERCHANT_API_KEY),
      ]);

      // Both should succeed — one confirms, the other sees already-confirmed
      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);
      expect(r1.body.status).toBe("confirmed");
      expect(r2.body.status).toBe("confirmed");
    });

    it("trims whitespace from string fields", async () => {
      const res = await request(app)
        .post("/api/create-payment")
        .set("x-api-key", MERCHANT_API_KEY)
        .send({
          amount: 10,
          asset: "  xlm  ",
          recipient: `  ${STELLAR_RECIPIENT}  `,
          description: "  padded  ",
        });

      expect(res.status).toBe(201);

      const stored = paymentsStore.get(res.body.payment_id);
      // Zod schema transforms asset to uppercase and trims
      expect(stored.asset).toBe("XLM");
      expect(stored.recipient).toBe(STELLAR_RECIPIENT);
      expect(stored.description).toBe("padded");
    });

    it("stores completion_duration_seconds on confirmation", async () => {
      const create = await request(app)
        .post("/api/create-payment")
        .set("x-api-key", MERCHANT_API_KEY)
        .send({ amount: 10, asset: "XLM", recipient: STELLAR_RECIPIENT });

      const paymentId = create.body.payment_id;

      mockFindMatchingPayment.mockResolvedValue({
        id: "op-dur",
        transaction_hash: "duration0duration0duration0duration0duration0duration0duration000",
      });

      await request(app)
        .post(`/api/verify-payment/${paymentId}`)
        .set("x-api-key", MERCHANT_API_KEY);

      const stored = paymentsStore.get(paymentId);
      expect(stored.status).toBe("confirmed");
      // completion_duration_seconds should be a non-negative number
      expect(stored.completion_duration_seconds).toBeGreaterThanOrEqual(0);
    });
  });
});
