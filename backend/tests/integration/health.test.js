import request from "supertest";
import { createApp } from "../../src/app.js";
import { closePool } from "../../src/lib/db.js";

/**
 * Mock for the Redis client required by createApp().
 * We don't want a live Redis connection in tests, so we stub the
 * methods that app.js calls during initialisation.
 */
const mockRedisClient = {
  ping: jest.fn().mockResolvedValue("PONG"),
  on: jest.fn(),
};

describe("Health Check", () => {
  let app;
  let io;

  beforeAll(async () => {
    ({ app, io } = await createApp({ redisClient: mockRedisClient }));
  });

  afterAll(async () => {
    if (io) io.close();
    await closePool();
  });

  it("GET /health responds 200 with ok: true", async () => {
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("ok", true);
  });
});
