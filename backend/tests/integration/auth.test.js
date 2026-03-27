import request from "supertest";
import { createApp } from "../../src/app.js";
import { closePool } from "../../src/lib/db.js";

/**
 * Mock for the Redis client required by createApp().
 */
const mockRedisClient = {
  ping: jest.fn().mockResolvedValue("PONG"),
  on: jest.fn(),
};

describe("Unauthorized Access", () => {
  let app;
  let io;

  beforeAll(async () => {
    ({ app, io } = await createApp({ redisClient: mockRedisClient }));
  });

  afterAll(async () => {
    if (io) io.close();
    await closePool();
  });

  it("POST /api/create-payment without x-api-key responds 401", async () => {
    const res = await request(app)
      .post("/api/create-payment")
      .send({ amount: 10, asset: "XLM", recipient: "GABC" });

    expect(res.status).toBe(401);
  });
});
