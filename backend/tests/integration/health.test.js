import request from "supertest";
import { createApp } from "../../src/app.js";
import { closePool } from "../../src/lib/db.js";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

/**
 * Mock for the Redis client required by createApp().
 * We don't want a live Redis connection in tests, so we stub the
 * methods that app.js calls during initialisation.
 */
const mockRedisClient = {
  ping: vi.fn().mockResolvedValue("PONG"),
  on: vi.fn(),
  sendCommand: vi.fn().mockResolvedValue("mocked_hash"),
};

vi.mock("../../src/lib/stellar.js", () => ({
  findMatchingPayment: vi.fn(),
  findAnyRecentPayment: vi.fn(),
  findStrictReceivePaths: vi.fn(),
  getNetworkFeeStats: vi.fn(),
  isHorizonReachable: vi.fn(async () => true),
  isValidAssetCode: vi.fn(() => true),
  isValidStellarAccountId: vi.fn(() => true),
  isValidStellarPublicKey: vi.fn(() => true),
  validateMemo: vi.fn(() => ({ valid: true })),
  verifyTransactionSignature: vi.fn(),
  withHorizonRetry: vi.fn(),
}));

vi.mock("../../src/lib/supabase.js", () => {
  return {
    supabase: {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
        })),
      })),
    },
  };
});

describe("Health Check", () => {
  let app;
  let io;

  beforeAll(async () => {
    ({ app, io } = await createApp({ redisClient: mockRedisClient }));
  });

  afterAll(async () => {
    // io is not attached to a listening server in tests, closing it throws Unhandled Rejection
    await closePool();
  });

  it("GET /health responds 200 with ok: true", async () => {
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("ok", true);
  });
});
