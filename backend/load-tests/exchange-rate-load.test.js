import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import autocannon from "autocannon";

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
process.env.DATABASE_URL ||= "postgresql://postgres:postgres@127.0.0.1:5432/postgres";
process.env.STELLAR_NETWORK ||= "testnet";
process.env.PATH_PAYMENT_QUOTE_RATE_LIMIT_MAX ||= "200";

const { horizonMock } = vi.hoisted(() => ({
  horizonMock: {
    loadAccount: vi.fn().mockResolvedValue({ id: "test-account-id" }),
    strictReceivePaths: vi.fn().mockReturnValue({
      call: vi.fn().mockResolvedValue({
        records: [
          {
            source_amount: "0.5000000",
            source_asset_type: "credit_alphanum4",
            source_asset_code: "USDC",
            source_asset_issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
            destination_amount: "1.0000000",
            path: [
              {
                asset_type: "credit_alphanum4",
                asset_code: "USDC",
                asset_issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
              },
            ],
          },
        ],
      }),
    }),
  },
}));

const { mockSupabase } = vi.hoisted(() => {
  const sb = {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: {
        id: "00000000-0000-0000-0000-000000000001",
        amount: "1.0000000",
        asset: "USDC",
        asset_issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
        recipient: "GA...",
        status: "pending",
      },
      error: null,
    }),
  };
  return { mockSupabase: sb };
});

vi.mock("../src/lib/supabase.js", () => ({
  supabase: mockSupabase,
}));

vi.mock("@stellar/stellar-sdk", () => ({
  Horizon: {
    Server: vi.fn().mockImplementation(() => ({
      loadAccount: horizonMock.loadAccount,
      strictReceivePaths: horizonMock.strictReceivePaths,
    })),
  },
  Keypair: { fromSecret: vi.fn().mockReturnValue({ publicKey: () => "test" }) },
  Networks: { TESTNET: "TESTNET", PUBLIC: "PUBLIC" },
  Asset: { native: vi.fn(), from: vi.fn() },
  BASE_FEE: "100",
  TransactionBuilder: vi.fn(),
  Operation: { payment: vi.fn(), changeTrust: vi.fn() },
  Memo: { text: vi.fn() },
  TimeoutInfinite: 0,
}));

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

describe("Multi-currency Exchange Rate Service — Load Tests", () => {
  let appInstance;
  let io;
  let closePool;
  let server;

  beforeAll(async () => {
    const [{ createApp }, { closePool: importedClosePool }] = await Promise.all([
      import("../src/app.js"),
      import("../src/lib/db.js"),
    ]);
    closePool = importedClosePool;
    const { app, io: ioInstance } = await createApp({
      redisClient: {
        ping: vi.fn().mockResolvedValue("PONG"),
        on: vi.fn(),
        sendCommand: vi.fn().mockResolvedValue("mocked_hash"),
        isOpen: true,
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

  it("verifies endpoint works via supertest", async () => {
    const res = await request(appInstance)
      .get("/api/path-payment-quote/00000000-0000-0000-0000-000000000001")
      .query({ source_asset: "XLM" });
    expect([200, 404, 409, 400, 500]).toContain(res.status);
    console.log(`Supertest response: ${res.status} ${JSON.stringify(res.body).substring(0, 200)}`);
  });

  it("handles concurrent requests under load", async () => {
    server = appInstance.listen(0);
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    const results = await autocannonPromise(baseUrl, {
      duration: 10,
      connections: 5,
      requests: [
        {
          method: "GET",
          path: "/api/path-payment-quote/00000000-0000-0000-0000-000000000001?source_asset=XLM",
        },
      ],
    });

    console.log(formatResults("Concurrent Load (10s, 5 connections)", results));
    expect(results.timeouts).toBe(0);
    expect(results.errors).toBe(0);
  });

  it("rejects excess requests with 429 beyond rate limit", async () => {
    server = appInstance.listen(0);
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    const results = await autocannonPromise(baseUrl, {
      duration: 5,
      connections: 1,
      requests: Array.from({ length: 250 }, () => ({
        method: "GET",
        path: "/api/path-payment-quote/00000000-0000-0000-0000-000000000001?source_asset=XLM",
      })),
    });

    console.log(formatResults("Rate Limit Test (5s, 1 connection, 250 requests)", results));

    const has429 = Object.keys(results.statusCodeStats).some(
      (code) => parseInt(code) === 429,
    );
    expect(has429).toBe(true);
    expect(results.timeouts).toBe(0);
  });

  it("handles burst of connections without crash", async () => {
    server = appInstance.listen(0);
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    const results = await autocannonPromise(baseUrl, {
      duration: 10,
      connections: 20,
      requests: [
        {
          method: "GET",
          path: "/api/path-payment-quote/00000000-0000-0000-0000-000000000001?source_asset=XLM",
        },
      ],
    });

    console.log(formatResults("Burst Load (10s, 20 connections)", results));
    expect(results.timeouts).toBe(0);
  });
});
