import request from "supertest";
import { createApp } from "../../src/app.js";
import { closePool } from "../../src/lib/db.js";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

/**
 * Mock for the Redis client required by createApp().
 */
const mockRedisClient = {
  ping: vi.fn().mockResolvedValue("PONG"),
  on: vi.fn(),
  sendCommand: vi.fn().mockResolvedValue("mocked_hash"),
};

describe.skip("Auth Middleware — API Key Validation", () => {
  let app;
  let io;

  beforeAll(async () => {
    ({ app, io } = await createApp({ redisClient: mockRedisClient }));
  });

  afterAll(async () => {
    // io is not attached to a listening server in tests, closing it throws Unhandled Rejection
    await closePool();
  });

  it("POST /api/create-payment without x-api-key responds 401", async () => {
    const res = await request(app)
      .post("/api/create-payment")
      .send({ amount: 10, asset: "XLM", recipient: "GABC" });

    expect(res.status).toBe(401);
  });
});
