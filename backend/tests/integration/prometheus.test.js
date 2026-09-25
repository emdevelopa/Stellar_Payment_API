import request from "supertest";
process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
process.env.DATABASE_URL ||= "postgresql://postgres:postgres@127.0.0.1:5432/postgres";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const mockRedisClient = {
  ping: vi.fn().mockResolvedValue("PONG"),
  on: vi.fn(),
  sendCommand: vi.fn().mockResolvedValue("mocked_hash"),
};

describe("Prometheus Metrics", () => {
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
    // io is not attached to a listening server in tests, closing it throws Unhandled Rejection
    await closePool();
  });

  it("GET /metrics responds 200 and includes default metrics", async () => {
    const res = await request(app).get("/metrics");

    expect(res.status).toBe(200);
    expect(res.text).toContain("process_cpu_seconds_total");
    expect(res.text).toContain("nodejs_version_info");
  });

  it("GET /metrics includes custom payment counters", async () => {
    const res = await request(app).get("/metrics");

    expect(res.status).toBe(200);
    expect(res.text).toContain("payment_created_total");
    expect(res.text).toContain("payment_confirmed_total");
    expect(res.text).toContain("payment_failed_total");
    expect(res.text).toContain("payment_confirmation_latency_seconds");
  });
});
