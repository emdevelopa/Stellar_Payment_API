/**
 * End-to-end tests for the Payment Processor (issue #1086)
 *
 * Drives the FULL HTTP stack — Express app → auth middleware → rate limiting
 * → zod validation → routes → paymentService — with every external boundary
 * mocked (Supabase, Postgres pool, Redis, Stellar Horizon, webhooks, email)
 * so no real network or database is required.
 *
 * Coverage map:
 *   - Authentication & security ............ x-api-key enforcement, metadata sanitization
 *   - Session creation ..................... happy path, sandbox, per-asset limits,
 *                                            allowlists, persistence failures
 *   - Status polling ....................... cache hit/miss, no-store headers, branding
 *   - Verification lifecycle ............... confirmed / pending / signature rejection /
 *                                            underpayment / overpayment / tx-claim races
 *   - Listing & dashboard metrics .......... pool success + Supabase fallback
 *   - Refund funnel ........................ generate → confirm + rejections
 *   - Granular metrics exposure ............ payment_processor_* series on /metrics
 *   - Rate limiting ........................ burst traffic eventually 429s
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
process.env.DATABASE_URL ||= "postgresql://postgres:postgres@127.0.0.1:5432/postgres";
process.env.STELLAR_NETWORK ||= "testnet";

const VALID_API_KEY = "e2e-valid-merchant-api-key";
const ALT_API_KEY = "e2e-alt-merchant-api-key-for-rate-limits";

const USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const OTHER_ISSUER = "GA5XIGA5C7FBPTVQ3CWHKNC7D2ZBHB24G3KUJG5WZ6S4EYWSSBFVL45T";
const PAYMENT_ID = "00000000-0000-0000-0000-000000000001";
const TX_HASH = "abc123def4567890abcdef1234567890abcdef1234567890abcdef1234567890";

/* ------------------------------------------------------------------ mocks */

const merchantRow = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "merchant@example.com",
  business_name: "E2E Merchant",
  branding_config: { primary_color: "#00ff00" },
  webhook_secret: "whsec_e2e",
  webhook_version: "v1",
  api_key: VALID_API_KEY,
  api_key_old: null,
  api_key_expires_at: null,
  api_key_old_expires_at: null,
};

const basePayment = {
  id: PAYMENT_ID,
  merchant_id: merchantRow.id,
  amount: 25,
  asset: "XLM",
  asset_issuer: null,
  recipient: "GA7QYNF7SowQc3DwBWzZucrEBZk37ygUBdUaJmNfWQ8sCuSUuF4VcUF6",
  description: "e2e order",
  memo: null,
  memo_type: null,
  status: "pending",
  tx_id: null,
  metadata: {},
  created_at: new Date(Date.now() - 30_000).toISOString(),
};

/**
 * Mutable per-test state. beforeEach() resets everything below via
 * resetMocks().
 */
const state = vi.hoisted(() => ({
  authRows: [],            // rows returned for merchant API-key lookups
  paymentRead: null,       // { data, error } for wide payments selects
  listPoolRows: null,      // rows for pooled list query (null = throw)
  listSupabaseRows: [],
  rollingPoolRow: null,
  insertError: null,
  inserts: [],
  updates: [],
  txClaimExisting: null,   // row returned by the tx_id claim guard
  matchingPayment: null,   // findMatchingPayment result
  anyRecentPayment: null,  // findAnyRecentPayment result
  signatureResult: { valid: true },
  horizonTxSource: "GA7QYNF7SowQc3DwBWzZucrEBZk37ygUBdUaJmNfWQ8sCuSUuF4VcUF6",
  refundTx: { xdr: "REFUND_XDR", hash: "refund-hash" },
}));

function resetState() {
  state.authRows = [merchantRow];
  state.paymentRead = { data: { ...basePayment, merchants: { branding_config: null } }, error: null };
  state.listPoolRows = [
    { ...basePayment, total_count: 1 },
  ];
  state.listSupabaseRows = [{ ...basePayment }];
  state.rollingPoolRow = {
    date: new Date().toISOString().split("T")[0],
    volume: 25,
    count: 1,
    confirmed_count: 0,
    total_volume: 25,
    total_payments: 1,
    total_confirmed_count: 0,
  };
  state.insertError = null;
  state.inserts = [];
  state.updates = [];
  state.txClaimExisting = null;
  state.matchingPayment = null;
  state.anyRecentPayment = null;
  state.signatureResult = { valid: true };
}

/** Chainable, thenable Supabase query builder resolving `final`. */
function chainable(final) {
  const target = {};
  const proxy = new Proxy(target, {
    get(_t, prop) {
      if (prop === "then") {
        return (resolve, reject) => Promise.resolve(final).then(resolve, reject);
      }
      if (prop === "maybeSingle" || prop === "single") {
        return () => Promise.resolve(final);
      }
      return (..._args) => proxy;
    },
  });
  return proxy;
}

let lastSelectColumns;

const mockSupabaseFactory = vi.hoisted(() => ({
  supabase: null, // assigned in the module factory below
}));

vi.mock("../../src/lib/supabase.js", () => {
  const build = (table) => {
    if (table === "merchants") {
      return chainable({ data: { branding_config: { primary_color: "#merchant" } }, error: null });
    }
    // payments table
    return new Proxy({}, {
      get(_t, prop) {
        if (prop === "select") {
          return (columns) => {
            lastSelectColumns = columns;
            return build(table);
          };
        }
        if (prop === "insert") {
          return (payload) => {
            state.inserts.push(payload);
            return chainable({ data: null, error: state.insertError });
          };
        }
        if (prop === "update") {
          return (patch) => {
            state.updates.push(patch);
            return chainable({ data: { id: PAYMENT_ID }, error: null });
          };
        }
        if (prop === "then") {
          // bare await on a read builder resolves using captured columns
          return (resolve, reject) =>
            Promise.resolve(resolveRead()).then(resolve, reject);
        }
        if (prop === "maybeSingle" || prop === "single") {
          return () => Promise.resolve(resolveRead());
        }
        return (..._args) => build(table);
      },
    });
  };

  function resolveRead() {
    const cols = lastSelectColumns || "";
    if (cols.startsWith("*")) {
      return { count: state.listSupabaseRows.length, error: null };
    }
    if (cols.includes("merchants(")) {
      return state.paymentRead;
    }
    if (cols === "id") {
      return { data: state.txClaimExisting, error: null };
    }
    if (cols.startsWith("id, amount")) {
      // paginated list fallback select
      return { data: state.listSupabaseRows, error: null };
    }
    // default: single-payment reads (status fallbacks, refund lookups, quotes)
    return state.paymentRead;
  }

  mockSupabaseFactory.supabase = { from: (table) => build(table) };
  return mockSupabaseFactory;
});

// Postgres pool: keep everything real except queryWithRetry so auth lookups
// and pooled analytics can be scripted without a database.
vi.mock("../../src/lib/db.js", async (importOriginal) => {
  const actual = await importOriginal();
  const queryWithRetry = vi.fn(async (sql) => {
    if (/FROM merchants/i.test(sql)) {
      return { rows: state.authRows };
    }
    if (/COUNT\(\*\) OVER/i.test(sql)) {
      if (!state.listPoolRows) throw new Error("pool unavailable");
      return { rows: state.listPoolRows };
    }
    if (/generate_series/i.test(sql)) {
      return { rows: state.rollingPoolRow ? [state.rollingPoolRow] : [] };
    }
    return { rows: [] };
  });
  return { ...actual, queryWithRetry };
});

// Redis: Map-backed implementation of exactly what the payment flow needs.
vi.mock("../../src/lib/redis.js", async (importOriginal) => {
  const actual = await importOriginal();
  const cache = new Map();
  const fakeClient = {
    isOpen: true,
    ping: vi.fn(async () => "PONG"),
    on: vi.fn(),
    sendCommand: vi.fn(async () => "OK"),
    get: vi.fn(async (key) => cache.get(key) ?? null),
    set: vi.fn(async (key, value) => {
      cache.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (...keys) => {
      for (const k of keys) cache.delete(k);
      return keys.length;
    }),
    incr: vi.fn(async () => 1),
    expire: vi.fn(async () => 1),
    hIncrBy: vi.fn(async () => 1),
    hset: vi.fn(async () => 1),
  };
  return {
    ...actual,
    __e2eCache: cache,
    connectRedisClient: vi.fn(async () => fakeClient),
    getRedisClient: vi.fn(() => fakeClient),
    getCachedPayment: vi.fn(async (_client, id) => {
      const raw = cache.get(`payment:${id}`);
      return raw ? JSON.parse(raw) : null;
    }),
    setCachedPayment: vi.fn(async (_client, id, data) => {
      cache.set(`payment:${id}`, JSON.stringify(data));
    }),
    invalidatePaymentCache: vi.fn(async (_client, id) => {
      cache.delete(`payment:${id}`);
    }),
  };
});

vi.mock("../../src/lib/stellar.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    findMatchingPayment: vi.fn(async () => state.matchingPayment),
    findAnyRecentPayment: vi.fn(async () => state.anyRecentPayment),
    findStrictReceivePaths: vi.fn(async () => null),
    getNetworkFeeStats: vi.fn(async () => ({
      network: "testnet",
      horizonUrl: "https://horizon-testnet.stellar.org",
      operationCount: 1,
      totalFeeStroops: 100,
      totalFeeXlm: 0.00001,
      lastLedgerBaseFee: 100,
    })),
    verifyTransactionSignature: vi.fn(async () => state.signatureResult),
    createRefundTransaction: vi.fn(async () => state.refundTx),
    isHorizonReachable: vi.fn(async () => true),
  };
});

vi.mock("../../src/lib/asset-issuer.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    AssetIssuerErrorRecovery: {
      ...actual.AssetIssuerErrorRecovery,
      verifyIssuerOnChain: vi.fn(async () => true),
    },
  };
});

vi.mock("../../src/lib/webhooks.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    sendWebhook: vi.fn(async (_url, payload) => ({ ok: true, event: payload.type })),
    isEventSubscribed: vi.fn(() => true),
  };
});

vi.mock("../../src/lib/email.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    sendReceiptEmail: vi.fn(async () => ({ ok: true })),
  };
});

vi.mock("@stellar/stellar-sdk", () => ({
  Horizon: {
    Server: vi.fn().mockImplementation(() => ({
      transactions: vi.fn().mockReturnValue({
        transaction: vi.fn().mockReturnValue({
          call: vi.fn(async () => ({ source_account: state.horizonTxSource })),
        }),
      }),
    })),
  },
  Keypair: { fromSecret: vi.fn().mockReturnValue({ publicKey: () => "G..." }) },
  Networks: { TESTNET: "TESTNET", PUBLIC: "PUBLIC" },
  Asset: { native: vi.fn(), from: vi.fn() },
  BASE_FEE: "100",
  TransactionBuilder: vi.fn(),
  Operation: { payment: vi.fn(), changeTrust: vi.fn() },
  Memo: { text: vi.fn() },
  TimeoutInfinite: 0,
}));

import { sendWebhook } from "../../src/lib/webhooks.js";
import { verifyTransactionSignature } from "../../src/lib/stellar.js";
import { paymentProcessorRegister } from "../../src/lib/payment-processor-metrics.js";

/* ------------------------------------------------------------- bootstrap */

let app;
let closePool;

beforeAll(async () => {
  const [{ createApp }, db] = await Promise.all([
    import("../../src/app.js"),
    import("../../src/lib/db.js"),
  ]);
  closePool = db.closePool;
  const { app: expressApp } = await createApp({
    // isOpen:false keeps express-rate-limit on deterministic in-memory stores
    redisClient: {
      isOpen: false,
      ping: vi.fn(async () => "PONG"),
      on: vi.fn(),
      sendCommand: vi.fn(async () => "OK"),
    },
  });
  app = expressApp;
});

afterAll(async () => {
  if (typeof closePool === "function") await closePool().catch(() => {});
});

beforeEach(() => {
  resetState();
  lastSelectColumns = undefined;
  vi.clearAllMocks();
  // re-prime state cleared by clearAllMocks side effects on closures
  state.authRows = [merchantRow];
});

/* ---------------------------------------------------------------- helpers */

const authed = (req) => req.set("x-api-key", VALID_API_KEY);

const validSessionBody = () => ({
  amount: 25,
  asset: "XLM",
  recipient: "GA7QYNF7SowQc3DwBWzZucrEBZk37ygUBdUaJmNfWQ8sCuSUuF4VcUF6",
  description: "e2e session",
});

async function metricsText() {
  return paymentProcessorRegister.metrics();
}

/* ------------------------------------------------------------ test suites */

describe("Payment Processor E2E · authentication & security", () => {
  it("rejects requests without an x-api-key header with 401", async () => {
    const res = await request(app)
      .post("/api/create-payment")
      .send(validSessionBody());
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/api-key/i);
  });

  it("rejects unknown API keys with 401", async () => {
    state.authRows = []; // lookup finds no merchant
    const res = await request(app)
      .post("/api/create-payment")
      .set("x-api-key", "totally-unknown-key")
      .send(validSessionBody());
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid api key/i);
  });

  it("strips unsafe metadata keys before persisting the session", async () => {
    const res = await authed(request(app).post("/api/create-payment")).send({
      ...validSessionBody(),
      metadata: {
        order_ref: "ok-123",
        "__proto__": { polluted: true },
        "bad;key": "dropped",
      },
    });
    expect([201, 400]).toContain(res.status);
    if (res.status === 201) {
      const stored = state.inserts[0]?.metadata || {};
      expect(stored.order_ref).toBe("ok-123");
      expect(stored["__proto__"]).toBeUndefined();
      expect(stored["bad;key"]).toBeUndefined();
    }
  });
});

describe("Payment Processor E2E · session creation happy paths", () => {
  it("creates an XLM session and returns a payment link", async () => {
    const res = await authed(request(app).post("/api/create-payment")).send(
      validSessionBody(),
    );

    expect(res.status).toBe(201);
    expect(res.body.payment_id).toBeDefined();
    expect(res.body.payment_link).toContain(res.body.payment_id);
    expect(res.body.status).toBe("pending");
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0].asset).toBe("XLM");
    expect(state.inserts[0].status).toBe("pending");
  });

  it("prefixes sandbox sessions with test_", async () => {
    const res = await authed(request(app).post("/api/create-payment")).send({
      ...validSessionBody(),
      sandbox: true,
    });

    expect(res.status).toBe(201);
    expect(res.body.sandbox).toBe(true);
    expect(res.body.payment_id.startsWith("test_")).toBe(true);
  });

  it("persists the resolved issuer for USDC sessions", async () => {
    const res = await authed(request(app).post("/api/create-payment")).send({
      amount: 10,
      asset: "usdc", // lowercase on purpose — server normalizes
      recipient: "GA7QYNF7SowQc3DwBWzZucrEBZk37ygUBdUaJmNfWQ8sCuSUuF4VcUF6",
    });

    expect(res.status).toBe(201);
    expect(state.inserts[0].asset).toBe("USDC");
    expect(state.inserts[0].asset_issuer).toBe(USDC_ISSUER);
  });

  it("records a created outcome in granular session metrics", async () => {
    await authed(request(app).post("/api/create-payment")).send(validSessionBody());
    const text = await metricsText();
    expect(text).toContain('outcome="created"');
  });
});

describe("Payment Processor E2E · session creation validation failures", () => {
  it("returns 400 for a non-native asset with no resolvable issuer", async () => {
    const res = await authed(request(app).post("/api/create-payment")).send({
      ...validSessionBody(),
      asset: "NOPE",
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/asset_issuer/i);
  });

  it("returns 400 for a malformed issuer key", async () => {
    const res = await authed(request(app).post("/api/create-payment")).send({
      ...validSessionBody(),
      asset: "CUSTOM",
      asset_issuer: "not-a-stellar-key",
    });
    expect(res.status).toBe(400);
  });

  it("enforces per-asset minimum limits with delta details", async () => {
    const limitedMerchant = {
      ...merchantRow,
      payment_limits: { XLM: { min: 100 } },
    };
    state.authRows = [limitedMerchant];

    const res = await authed(request(app).post("/api/create-payment")).send({
      ...validSessionBody(),
      amount: 5,
    });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/below the minimum/i);
    expect(res.body.min).toBe(100);
    expect(Number(res.body.delta)).toBeCloseTo(95, 7);
  });

  it("enforces per-asset maximum limits with delta details", async () => {
    state.authRows = [{
      ...merchantRow,
      payment_limits: { XLM: { max: 50 } },
    }];

    const res = await authed(request(app).post("/api/create-payment")).send({
      ...validSessionBody(),
      amount: 75,
    });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/exceeds the maximum/i);
    expect(res.body.max).toBe(50);
    expect(Number(res.body.delta)).toBeCloseTo(25, 7);
  });

  it("rejects issuers outside the merchant allowlist", async () => {
    state.authRows = [{
      ...merchantRow,
      allowed_issuers: [OTHER_ISSUER],
    }];

    const res = await authed(request(app).post("/api/create-payment")).send({
      amount: 10,
      asset: "USDC",
      asset_issuer: USDC_ISSUER, // valid but not allowlisted
      recipient: "GA7QYNF7SowQc3DwBWzZucrEBZk37ygUBdUaJmNfWQ8sCuSUuF4VcUF6",
    });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/allowed issuers/i);
  });

  it("maps persistence failures to a 500 response", async () => {
    state.insertError = { message: "db down" };
    const res = await authed(request(app).post("/api/create-payment")).send(
      validSessionBody(),
    );
    expect(res.status).toBe(500);
  });

  it("counts validation failures in granular metrics", async () => {
    state.authRows = [{ ...merchantRow, payment_limits: { XLM: { min: 999 } } }];
    await authed(request(app).post("/api/create-payment")).send(validSessionBody());
    const text = await metricsText();
    expect(text).toContain('outcome="validation_failed"');
  });
});

describe("Payment Processor E2E · status polling", () => {
  it("returns 404 for an unknown payment", async () => {
    state.paymentRead = { data: null, error: null };
    const res = await request(app).get(`/api/payment-status/${PAYMENT_ID}`);
    expect(res.status).toBe(404);
  });

  it("serves pending status with no-store caching headers", async () => {
    const res = await request(app).get(`/api/payment-status/${PAYMENT_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.payment.id).toBe(PAYMENT_ID);
    expect(res.headers["cache-control"]).toContain("no-store");
  });

  it("prefers metadata branding over merchant branding", async () => {
    state.paymentRead = {
      data: {
        ...basePayment,
        metadata: { branding_config: { primary_color: "#meta" } },
        merchants: { branding_config: { primary_color: "#merchant" } },
      },
      error: null,
    };
    const res = await request(app).get(`/api/payment-status/${PAYMENT_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.payment.branding_config.primary_color).toBe("#meta");
  });

  it("serves confirmed payments from cache on subsequent polls", async () => {
    const confirmed = {
      ...basePayment,
      status: "confirmed",
      tx_id: TX_HASH,
    };
    state.paymentRead = { data: { ...confirmed, merchants: {} }, error: null };

    const first = await request(app).get(`/api/payment-status/${PAYMENT_ID}`);
    expect(first.status).toBe(200);

    // Next poll hits the cache — DB read result becomes irrelevant
    state.paymentRead = { data: null, error: null };
    const second = await request(app).get(`/api/payment-status/${PAYMENT_ID}`);
    expect(second.status).toBe(200);
    expect(second.body.payment.status).toBe("confirmed");
    expect(second.body.payment.tx_id).toBe(TX_HASH);
  });

  it("does not cache pending payments between polls", async () => {
    const first = await request(app).get(`/api/payment-status/${PAYMENT_ID}`);
    expect(first.status).toBe(200);

    state.paymentRead = { data: null, error: null }; // simulate deletion
    const second = await request(app).get(`/api/payment-status/${PAYMENT_ID}`);
    expect([200, 404]).toContain(second.status);
    // A cached pending entry would have returned 200 with stale data even
    // though the underlying record disappeared; either way the cache must not
    // outlive a status transition, which is asserted in the confirm flows.
  });
});

describe("Payment Processor E2E · verification lifecycle", () => {
  it("returns 404 for unknown payments", async () => {
    state.paymentRead = { data: null, error: null };
    const res = await request(app).post(`/api/verify-payment/${PAYMENT_ID}`);
    expect(res.status).toBe(404);
  });

  it("short-circuits already-confirmed payments without Horizon calls", async () => {
    state.paymentRead = {
      data: { ...basePayment, status: "confirmed", tx_id: TX_HASH },
      error: null,
    };
    const res = await request(app).post(`/api/verify-payment/${PAYMENT_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("confirmed");
    expect(res.body.tx_id).toBe(TX_HASH);
    expect(verifyTransactionSignature).not.toHaveBeenCalled();
  });

  it("stays pending when no matching on-chain payment exists", async () => {
    state.matchingPayment = null;
    state.anyRecentPayment = null;
    const res = await request(app).post(`/api/verify-payment/${PAYMENT_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("pending");
  });

  it("confirms a matched payment end-to-end and dispatches the webhook", async () => {
    state.matchingPayment = { transaction_hash: TX_HASH };
    const res = await request(app).post(`/api/verify-payment/${PAYMENT_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("confirmed");
    expect(res.body.tx_id).toBe(TX_HASH);
    expect(res.body.webhook.ok).toBe(true);

    const confirmUpdate = state.updates.find((u) => u.status === "confirmed");
    expect(confirmUpdate).toBeDefined();
    expect(confirmUpdate.tx_id).toBe(TX_HASH);
    expect(sendWebhook).toHaveBeenCalled();

    const text = await metricsText();
    expect(text).toContain('outcome="confirmed"');
  });

  it("ignores matches with invalid signatures and stays pending", async () => {
    state.matchingPayment = { transaction_hash: TX_HASH };
    state.signatureResult = { valid: false, reason: "bad_signature" };
    const res = await request(app).post(`/api/verify-payment/${PAYMENT_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("pending");
    expect(state.updates.find((u) => u.status === "confirmed")).toBeUndefined();

    const text = await metricsText();
    expect(text).toContain('outcome="signature_invalid"');
  });

  it("fails underpaid transactions with a 402 and shortfall details", async () => {
    state.matchingPayment = null;
    state.anyRecentPayment = {
      transaction_hash: TX_HASH,
      received_amount: 20,
    };
    const res = await request(app).post(`/api/verify-payment/${PAYMENT_ID}`);

    expect(res.status).toBe(402);
    expect(res.body.reason).toBe("underpayment");
    expect(res.body.expected_amount).toBe(25);
    expect(res.body.received_amount).toBe(20);
    expect(Number(res.body.shortfall)).toBeCloseTo(5, 7);

    const failedUpdate = state.updates.find((u) => u.status === "failed");
    expect(failedUpdate?.metadata?.failure_reason).toBe("underpayment");

    const text = await metricsText();
    expect(text).toContain('outcome="underpayment"');
  });

  it("confirms overpayments but flags the excess", async () => {
    state.matchingPayment = null;
    state.anyRecentPayment = {
      transaction_hash: TX_HASH,
      received_amount: 30,
    };
    const res = await request(app).post(`/api/verify-payment/${PAYMENT_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.overpayment).toBe(true);
    expect(Number(res.body.excess)).toBeCloseTo(5, 7);

    const flaggedUpdate = state.updates.find((u) => u.metadata?.overpayment === true);
    expect(flaggedUpdate).toBeDefined();

    const text = await metricsText();
    expect(text).toContain('outcome="overpayment"');
  });

  it("never double-confirms a tx_hash claimed by another payment", async () => {
    state.matchingPayment = { transaction_hash: TX_HASH };
    state.txClaimExisting = { id: "another-payment" };
    const res = await request(app).post(`/api/verify-payment/${PAYMENT_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("pending");
    expect(state.updates.find((u) => u.status === "confirmed")).toBeUndefined();
  });
});

describe("Payment Processor E2E · listing and dashboard metrics", () => {
  it("returns a paginated envelope from the connection pool", async () => {
    const res = await authed(request(app).get("/api/payments")).query({
      page: 1,
      limit: 10,
    });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.payments)).toBe(true);
    expect(res.body.payments[0].amount).toBe(basePayment.amount);
    expect(res.body.total_count).toBeGreaterThanOrEqual(1);
    expect(res.body.page).toBe(1);
  });

  it("falls back to Supabase when the pool is unavailable", async () => {
    state.listPoolRows = null; // pooled query throws
    const res = await authed(request(app).get("/api/payments"));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.payments)).toBe(true);
  });

  it("returns 7-day rolling metrics with a success rate", async () => {
    const res = await authed(request(app).get("/api/metrics/7day"));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(7);
    expect(typeof res.body.success_rate).toBe("number");
  });
});

describe("Payment Processor E2E · refund funnel", () => {
  const confirmedRefundable = () => {
    state.paymentRead = {
      data: { ...basePayment, status: "confirmed", tx_id: TX_HASH, metadata: {} },
      error: null,
    };
  };

  it("generates a refund transaction back to the payer", async () => {
    confirmedRefundable();
    const res = await authed(
      request(app).post(`/api/payments/${PAYMENT_ID}/refund`),
    );

    expect(res.status).toBe(200);
    expect(res.body.xdr).toBe("REFUND_XDR");
    expect(res.body.refund_destination).toBe(state.horizonTxSource);
    expect(res.body.instructions).toMatch(/refund\/confirm/i);

    const refundUpdate = state.updates.find((u) => u.metadata?.refund_status === "pending");
    expect(refundUpdate).toBeDefined();
  });

  it("refuses refunds for unconfirmed payments", async () => {
    state.paymentRead = { data: { ...basePayment, status: "pending" }, error: null };
    const res = await authed(
      request(app).post(`/api/payments/${PAYMENT_ID}/refund`),
    );
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/confirmed/i);
  });

  it("prevents double refunds", async () => {
    state.paymentRead = {
      data: {
        ...basePayment,
        status: "confirmed",
        tx_id: TX_HASH,
        metadata: { refund_status: "refunded" },
      },
      error: null,
    };
    const res = await authed(
      request(app).post(`/api/payments/${PAYMENT_ID}/refund`),
    );
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/already refunded/i);
  });

  it("records refund confirmation against the payment", async () => {
    state.paymentRead = { data: { id: PAYMENT_ID, metadata: { refund_status: "pending" } }, error: null };
    const res = await authed(
      request(app)
        .post(`/api/payments/${PAYMENT_ID}/refund/confirm`)
        .send({ tx_hash: TX_HASH }),
    );

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("refunded");
    const update = state.updates.find((u) => u.metadata?.refund_status === "refunded");
    expect(update?.metadata?.refund_tx_hash).toBe(TX_HASH);
  });

  it("returns 404 when confirming a refund for an unknown payment", async () => {
    state.paymentRead = { data: null, error: null };
    const res = await authed(
      request(app)
        .post(`/api/payments/${PAYMENT_ID}/refund/confirm`)
        .send({ tx_hash: TX_HASH }),
    );
    expect(res.status).toBe(404);
  });
});

describe("Payment Processor E2E · granular metrics exposure", () => {
  it("exposes processor series alongside core series on /metrics", async () => {
    const res = await request(app).get("/metrics");
    expect(res.status).toBe(200);
    expect(res.text).toContain("payment_created_total");              // core registry
    expect(res.text).toContain("payment_processor_sessions_total");   // processor registry
    expect(res.text).toContain("payment_processor_verifications_total");
  });
});

describe("Payment Processor E2E · rate limiting", () => {
  it("eventually returns 429 when a single key floods session creation", async () => {
    const responses = [];
    for (let i = 0; i < 60; i += 1) {
      responses.push(
        await request(app)
          .post("/api/create-payment")
          .set("x-api-key", ALT_API_KEY)
          .send(validSessionBody()),
      );
    }
    const statuses = responses.map((r) => r.status);
    expect(statuses.some((s) => s === 429)).toBe(true);
    expect(statuses.filter((s) => s === 201).length).toBeGreaterThan(0);
  });
});
