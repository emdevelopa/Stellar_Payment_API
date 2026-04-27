import request from "supertest";
process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
process.env.DATABASE_URL ||= "postgresql://postgres:postgres@127.0.0.1:5432/postgres";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

/**
 * Mock for the Redis client required by createApp().
 */
const mockRedisClient = {
  ping: vi.fn().mockResolvedValue("PONG"),
  on: vi.fn(),
  sendCommand: vi.fn().mockResolvedValue("mocked_hash"),
};

describe("Unauthorized Access", () => {
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

  it("POST /api/create-payment without x-api-key responds 401", async () => {
    const res = await request(app)
      .post("/api/create-payment")
      .send({ amount: 10, asset: "XLM", recipient: "GABC" });

    expect(res.status).toBe(401);
  });
});
