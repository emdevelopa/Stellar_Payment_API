import request from "supertest";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
process.env.DATABASE_URL ||= "postgresql://postgres:postgres@127.0.0.1:5432/postgres";
process.env.STELLAR_NETWORK ||= "testnet";

const mockRedisClient = {
  ping: vi.fn().mockResolvedValue("PONG"),
  on: vi.fn(),
  sendCommand: vi.fn().mockResolvedValue("mocked_hash"),
  isOpen: true,
};

describe("Oracle Integrator E2E — HTTP Integration", () => {
  let app;
  let io;
  let closePool;

  beforeAll(async () => {
    const [{ createApp }, { closePool: importedClosePool }] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/lib/db.js"),
    ]);
    closePool = importedClosePool;
    ({ app, io } = await createApp({ redisClient: mockRedisClient }));
  });

  afterAll(async () => {
    await closePool().catch(() => {});
  });

  it("GET /api/oracle/stats returns cache stats", async () => {
    const res = await request(app).get("/api/oracle/stats");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("caches");
    expect(res.body).toHaveProperty("circuitBreakers");
  });

  it("POST /api/oracle/clear returns ok", async () => {
    const res = await request(app).post("/api/oracle/clear");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.clearedEntries).toBe("number");
  });

  it("GET /api/oracle/:provider/:feed returns 400 for unknown provider", async () => {
    const res = await request(app).get("/api/oracle/unknown/price");
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Unknown oracle provider");
  });

  it("GET /metrics includes oracle Prometheus metrics", async () => {
    const res = await request(app).get("/metrics");
    expect(res.status).toBe(200);
    expect(res.text).toContain("oracle_cache_hit_total");
    expect(res.text).toContain("oracle_cache_miss_total");
    expect(res.text).toContain("oracle_cache_size");
    expect(res.text).toContain("oracle_fetch_duration_seconds");
    expect(res.text).toContain("oracle_fetch_errors_total");
    expect(res.text).toContain("oracle_stale_data_served_total");
    expect(res.text).toContain("oracle_circuit_breaker_trips_total");
  });

  it("POST /api/oracle/invalidate returns 400 without provider and feed", async () => {
    const res = await request(app).post("/api/oracle/invalidate").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("provider and feed are required");
  });

  it("POST /api/oracle/invalidate succeeds with valid body", async () => {
    const res = await request(app)
      .post("/api/oracle/invalidate")
      .send({ provider: "stellar", feed: "price" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe("Oracle Integrator E2E — Custom Provider via app.locals", () => {
  let app;
  let io;
  let closePool;

  beforeAll(async () => {
    const [{ createApp }, { closePool: importedClosePool }, { resetCircuitBreaker }] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/lib/db.js"),
      import("../../src/lib/oracle-cache.js"),
    ]);
    closePool = importedClosePool;
    resetCircuitBreaker();

    const mockFn = vi.fn()
      .mockResolvedValueOnce({ price: 1.5 })
      .mockResolvedValueOnce({ price: 1.5 });

    const customIntegrator = new (await import("../../src/lib/oracle-cache.js")).SmartContractOracleIntegrator({
      providers: [{ name: "test-provider", fetch: mockFn }],
    });

    ({ app, io } = await createApp({ redisClient: mockRedisClient }));
    app.locals.oracleIntegrator = customIntegrator;
  });

  afterAll(async () => {
    await closePool().catch(() => {});
  });

  it("fetches data from provider on first call", async () => {
    const res = await request(app).get("/api/oracle/test-provider/price");
    expect(res.status).toBe(200);
    expect(res.body.source).toBe("provider");
    expect(res.body.data).toEqual({ price: 1.5 });
    expect(res.body.provider).toBe("test-provider");
  });

  it("returns cached data on second call", async () => {
    const res = await request(app).get("/api/oracle/test-provider/price");
    expect(res.status).toBe(200);
    expect(res.body.source).toBe("cache");
    expect(res.body.stale).toBe(false);
  });

  it("returns 502 when provider fails with no cache", async () => {
    const { SmartContractOracleIntegrator, resetCircuitBreaker } = await import("../../src/lib/oracle-cache.js");
    resetCircuitBreaker();

    const failingFn = vi.fn().mockImplementation(() => Promise.reject(new Error("provider down")));
    const failingIntegrator = new SmartContractOracleIntegrator({
      providers: [{ name: "fail-provider", fetch: failingFn }],
    });

    const { createApp } = await import("../../src/app.js");
    const { app: failApp } = await createApp({ redisClient: mockRedisClient });
    failApp.locals.oracleIntegrator = failingIntegrator;

    const res = await request(failApp).get("/api/oracle/fail-provider/price");
    expect(res.status).toBe(502);
    expect(res.body.error).toContain("Oracle provider fetch failed");
  });
});
