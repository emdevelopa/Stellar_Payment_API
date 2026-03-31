import request from "supertest";
import { createApp } from "../../src/app.js";
import { closePool } from "../../src/lib/db.js";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const mockRedisClient = {
  ping: vi.fn().mockResolvedValue("PONG"),
  on: vi.fn(),
  sendCommand: vi.fn().mockResolvedValue("mocked_hash"),
};

describe.skip("Prometheus Metrics API", () => {
  let app;
  let io;

  beforeAll(async () => {
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
