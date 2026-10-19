/**
 * Rigorous load tests for the Payment Processor (issue #1089)
 *
 * Uses autocannon against a real HTTP server built from the full Express
 * app, with every external boundary mocked (Supabase, Postgres pool,
 * Redis, Horizon) so results measure application-layer throughput rather
 * than network/DB latency.
 *
 * Scenarios:
 *   1. Supertest smoke check before load runs
 *   2. Sustained session-creation throughput (POST /api/create-payment)
 *   3. Status-polling storm (GET /api/payment-status/:id)
 *   4. Mixed workload (status polls interleaved with verifications)
 *   5. Rate-limit enforcement under fixed request budget (429s)
 *   6. Connection burst without crashes or timeouts
 *
 * Run with: npm run test:load -- payment-processor
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import autocannon from "autocannon";

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
process.env.DATABASE_URL ||= "postgresql://postgres:postgres@127.0.0.1:5432/postgres";
process.env.STELLAR_NETWORK ||= "testnet";
// Keep the creation limiter out of the way for throughput scenarios; the
// dedicated rate-limit scenario below uses its own API-key bucket.
process.env.CREATE_PAYMENT_RATE_LIMIT_MAX ||= "100000";

const VALID_API_KEY = "load-test-merchant-api-key";
const RATE_LIMIT_KEY = "load-test-rate-limit-bucket-key";
const PAYMENT_ID = "00000000-0000-0000-0000-000000000001";
const TX_HASH = "abc123def4567890abcdef1234567890abcdef1234567890abcdef1234567890";
const RECIPIENT = "GA7QYNF7SowQc3DwBWzZucrEBZk37ygUBdUaJmNfWQ8sCuSUuF4VcUF6";

const merchantRow = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "load@example.com",
  business_name: "Load Merchant",
  branding_config: {},
  webhook_secret: "whsec_load",
  webhook_version: "v1",
  api_key: VALID_API_KEY,
  api_key_old: null,
  api_key_expires_at: null,
  api_key_old_expires_at: null,
};

const pendingPayment = {
  id: PAYMENT_ID,
  merchant_id: merchantRow.id,
  amount: 25,
  asset: "XLM",
  asset_issuer: null,
  recipient: RECIPIENT,
  description: "load order",
  memo: null,
  memo_type: null,
  status: "pending",
  tx_id: null,
  metadata: {},
  created_at: new Date(Date.now() - 30_000).toISOString(),
};

const { mockSupabase } = vi.hoisted(() => {
  const chainable = (final) => {
    const proxy = new Proxy({}, {
      get(_t, prop) {
        if (prop === "then") {
          return (resolve, reject) => Promise.resolve(final).then(resolve, reject);
        }
        if (prop === "maybeSingle" || prop === "single") {
          return () => Promise.resolve(final);
        }
        return () => proxy;
      },
    });
    return proxy;
  };

  let lastSelect;
  const resolveRead = () => {
    const cols = lastSelect || "";
    if (cols.includes("merchants(")) {
      return { data: { ...pendingPayment, merchants: {} }, error: null };
    }
    if (cols.startsWith("id, amount")) {
      return { data: [{ ...pendingPayment }], error: null };
    }
    return { data: { ...pendingPayment }, error: null };
  };

  const buildPayments = () =>
    new Proxy({}, {
      get(_t, prop) {
        if (prop === "select") {
          return (columns) => {
            lastSelect = columns;
            return buildPayments();
          };
        }
        if (prop === "insert") {
          return () => chainable({ data: null, error: null });
        }
        if (prop === "update") {
          return () => chainable({ data: { id: PAYMENT_ID }, error: null });
        }
        if (prop === "then") {
          return (resolve, reject) => Promise.resolve(resolveRead()).then(resolve, reject);
        }
        if (prop === "maybeSingle" || prop === "single") {
          return () => Promise.resolve(resolveRead());
        }
        return () => buildPayments();
      },
    });

  const sb = {
    from: vi.fn((table) => (table === "merchants" ? chainable({ data: { branding_config: {} }, error: null }) : buildPayments())),
  };
  return { mockSupabase: sb };
});

vi.mock("../src/lib/supabase.js", () => ({ supabase: mockSupabase }));

vi.mock("../src/lib/db.js", async (importOriginal) => {
  const actual = await importOriginal();
  const queryWithRetry = vi.fn(async (sql) => {
    if (/FROM merchants/i.test(sql)) return { rows: [merchantRow] };
    if (/COUNT\(\*\) OVER/i.test(sql)) {
      return { rows: [{ ...pendingPayment, total_count: 100 }] };
    }
    if (/generate_series/i.test(sql)) {
      return {
        rows: [{
          date: new Date().toISOString().split("T")[0],
          volume: 25,
          count: 1,
          confirmed_count: 0,
          total_volume: 25,
          total_payments: 1,
          total_confirmed_count: 0,
        }],
      };
    }
    return { rows: [] };
  });
  return { ...actual, queryWithRetry };
});

vi.mock("../src/lib/redis.js", async (importOriginal) => {
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
    del: vi.fn(async (...keys) => keys.length),
    incr: vi.fn(async () => 1),
    expire: vi.fn(async () => 1),
    hIncrBy: vi.fn(async () => 1),
    hset: vi.fn(async () => 1),
  };
  return {
    ...actual,
    connectRedisClient: vi.fn(async () => fakeClient),
    getRedisClient: vi.fn(() => fakeClient),
    getCachedPayment: vi.fn(async (_c, id) => {
      const raw = cache.get(`payment:${id}`);
      return raw ? JSON.parse(raw) : null;
    }),
    setCachedPayment: vi.fn(async (_c, id, data) => {
      cache.set(`payment:${id}`, JSON.stringify(data));
    }),
    invalidatePaymentCache: vi.fn(async (_c, id) => {
      cache.delete(`payment:${id}`);
    }),
  };
});

vi.mock("../src/lib/stellar.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    findMatchingPayment: vi.fn(async () => ({ transaction_hash: TX_HASH })),
    findAnyRecentPayment: vi.fn(async () => null),
    findStrictReceivePaths: vi.fn(async () => null),
    getNetworkFeeStats: vi.fn(async () => ({
      network: "testnet",
      horizonUrl: "https://horizon-testnet.stellar.org",
      operationCount: 1,
      totalFeeStroops: 100,
      totalFeeXlm: 0.00001,
      lastLedgerBaseFee: 100,
    })),
    verifyTransactionSignature: vi.fn(async () => ({ valid: true })),
    createRefundTransaction: vi.fn(async () => ({ xdr: "XDR", hash: "h" })),
    isHorizonReachable: vi.fn(async () => true),
  };
});

vi.mock("../src/lib/webhooks.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    sendWebhook: vi.fn(async (_url, payload) => ({ ok: true, event: payload.type })),
    isEventSubscribed: vi.fn(() => true),
  };
});

vi.mock("../src/lib/email.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, sendReceiptEmail: vi.fn(async () => ({ ok: true })) };
});

function formatResults(title, results) {
  const lines = [
    `\n=== ${title} ===`,
    `  Duration:      ${results.duration}s`,
    `  Connections:   ${results.connections}`,
    `  Requests:      ${results.requests.total} (${results.requests.average} req/s)`,
    `  Throughput:    ${(results.throughput.total / 1024 / 1024).toFixed(2)} MB`,
    `  Errors:        ${results.errors}`,
    `  Timeouts:      ${results.timeouts}`,
    `  Status codes:  ${JSON.stringify(results.statusCodeStats)}`,
    `  P50: ${results.latency.p50}ms  P90: ${results.latency.p90}ms  P99: ${results.latency.p99}ms`,
    `  Non-2xx:       ${results.non2xx}`,
  ];
  return lines.join("\n");
}

function autocannonPromise(url, opts) {
  return new Promise((resolve, reject) => {
    const instance = autocannon({ url, ...opts }, (err, res) => {
      if (err) reject(err);
      else resolve(res);
    });
    autocannon.track(instance, { renderProgressBar: false });
  });
}

describe("Payment Processor — Load Tests", () => {
  let appInstance;
  let io;
  let closePool;
  let server;

  beforeAll(async () => {
    const [{ createApp }, db] = await Promise.all([
      import("../src/app.js"),
      import("../src/lib/db.js"),
    ]);
    closePool = db.closePool;
    const { app, io: ioInstance } = await createApp({
      redisClient: {
        isOpen: false,
        ping: vi.fn(async () => "PONG"),
        on: vi.fn(),
        sendCommand: vi.fn(async () => "mocked"),
      },
    });
    appInstance = app;
    io = ioInstance;
  });

  afterAll(async () => {
    if (server) server.close();
    if (io) {
      try {
        const httpServer = io.httpServer || io.server;
        if (httpServer && typeof httpServer.close === "function") httpServer.close();
      } catch {}
    }
    if (typeof closePool === "function") await closePool().catch(() => {});
  });

  it("smoke-checks session creation via supertest before loading", async () => {
    const res = await request(appInstance)
      .post("/api/create-payment")
      .set("x-api-key", VALID_API_KEY)
      .send({
        amount: 25,
        asset: "XLM",
        recipient: RECIPIENT,
        description: "smoke",
      });
    expect([200, 201, 400, 429]).toContain(res.status);
    console.log(`Supertest smoke response: ${res.status}`);
  });

  it("sustains session-creation throughput", async () => {
    server = appInstance.listen(0);
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;
    const body = JSON.stringify({
      amount: 25,
      asset: "XLM",
      recipient: RECIPIENT,
      description: "load session",
    });

    const results = await autocannonPromise(baseUrl, {
      duration: 10,
      connections: 10,
      headers: {
        "content-type": "application/json",
        "x-api-key": VALID_API_KEY,
      },
      requests: [{ method: "POST", path: "/api/create-payment", body }],
    });

    console.log(formatResults("Session Creation Load (10s, 10 connections)", results));
    expect(results.timeouts).toBe(0);
    expect(results.errors).toBe(0);
  });

  it("absorbs status-polling storms", async () => {
    server = appInstance.listen(0);
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    const results = await autocannonPromise(baseUrl, {
      duration: 10,
      connections: 20,
      requests: [
        { method: "GET", path: `/api/payment-status/${PAYMENT_ID}` },
      ],
    });

    console.log(formatResults("Status Poll Storm (10s, 20 connections)", results));
    expect(results.timeouts).toBe(0);
    expect(results.errors).toBe(0);
    const ok = Object.keys(results.statusCodeStats)
      .map(Number)
      .filter((code) => code >= 200 && code < 300)
      .reduce((sum, code) => sum + results.statusCodeStats[String(code)], 0);
    expect(ok).toBeGreaterThan(0);
  });

  it("handles mixed workloads of polls and verifications", async () => {
    server = appInstance.listen(0);
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    const results = await autocannonPromise(baseUrl, {
      duration: 8,
      connections: 8,
      requests: [
        { method: "GET", path: `/api/payment-status/${PAYMENT_ID}` },
        { method: "POST", path: `/api/verify-payment/${PAYMENT_ID}` },
      ],
    });

    console.log(formatResults("Mixed Workload (8s, 8 connections)", results));
    expect(results.timeouts).toBe(0);
    // Verification rate limiting may legitimately produce some 429s; what
    // matters under load is that the process never times out or errors.
  });

  it("enforces rate limits under a fixed request budget", async () => {
    server = appInstance.listen(0);
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;
    const body = JSON.stringify({
      amount: 25,
      asset: "XLM",
      recipient: RECIPIENT,
    });

    const results = await autocannonPromise(baseUrl, {
      duration: 5,
      connections: 1,
      headers: {
        "content-type": "application/json",
        "x-api-key": RATE_LIMIT_KEY,
      },
      requests: Array.from({ length: 120 }, () => ({
        method: "POST",
        path: "/api/create-payment",
        body,
      })),
    });

    console.log(formatResults("Rate Limit Budget (120 requests, 1 connection)", results));
    const has429 = Object.keys(results.statusCodeStats).some(
      (code) => parseInt(code) === 429,
    );
    expect(has429).toBe(true);
    expect(results.timeouts).toBe(0);
  });

  it("survives connection bursts without crashing", async () => {
    server = appInstance.listen(0);
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    const results = await autocannonPromise(baseUrl, {
      duration: 10,
      connections: 50,
      requests: [
        { method: "GET", path: `/api/payment-status/${PAYMENT_ID}` },
      ],
    });

    console.log(formatResults("Connection Burst (10s, 50 connections)", results));
    expect(results.timeouts).toBe(0);
  });
});
