import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("rate-limit-redis", () => ({
  RedisStore: vi.fn(),
}));

vi.mock("redis", () => ({
  createClient: vi.fn(),
}));

import {
  createRedisRateLimitStore,
  createVerifyPaymentRateLimit,
  getVerifyPaymentRateLimitKey,
  RATE_LIMIT_REDIS_PREFIX,
  VERIFY_PAYMENT_RATE_LIMIT_MAX,
  VERIFY_PAYMENT_RATE_LIMIT_WINDOW_MS,
} from "./rate-limit.js";
import {
  connectRedisClient,
  getRedisClient,
  resetRedisClientForTests,
} from "./redis.js";

describe("createRedisRateLimitStore", () => {
  it("configures the redis store with sendCommand and prefix", async () => {
    const sendCommand = vi.fn().mockResolvedValue(1);
    const client = { sendCommand };
    const StoreClass = vi.fn(function MockStore(options) {
      this.options = options;
    });

    const store = createRedisRateLimitStore({ client, StoreClass });

    expect(StoreClass).toHaveBeenCalledTimes(1);
    expect(StoreClass).toHaveBeenCalledWith({
      sendCommand: expect.any(Function),
      prefix: RATE_LIMIT_REDIS_PREFIX,
    });

    await store.options.sendCommand("INCR", "rl:key");
    expect(sendCommand).toHaveBeenCalledWith(["INCR", "rl:key"]);
  });
});

describe("createVerifyPaymentRateLimit", () => {
  it("passes the redis store into express-rate-limit", () => {
    const store = { kind: "redis-store" };
    const middleware = vi.fn();
    const rateLimitFactory = vi.fn(() => middleware);

    const result = createVerifyPaymentRateLimit({ store, rateLimitFactory });

    expect(result).toBe(middleware);
    expect(rateLimitFactory).toHaveBeenCalledWith({
      windowMs: VERIFY_PAYMENT_RATE_LIMIT_WINDOW_MS,
      max: VERIFY_PAYMENT_RATE_LIMIT_MAX,
      message: { error: "Too many verification requests, please try again later." },
      standardHeaders: true,
      legacyHeaders: false,
      validate: { ip: false },
      keyGenerator: expect.any(Function),
      requestWasSuccessful: expect.any(Function),
      store,
      passOnStoreError: true,
    });
  });
});

describe("getVerifyPaymentRateLimitKey", () => {
  it("keys by payment id and merchant when merchant auth is present", () => {
    expect(
      getVerifyPaymentRateLimitKey({
        params: { id: "payment-123" },
        merchant: { id: "merchant-789" },
        headers: {},
        ip: "127.0.0.1",
      }),
    ).toBe("payment-123:merchant:merchant-789");
  });

  it("hashes api keys instead of storing them in limiter keys", () => {
    const key = getVerifyPaymentRateLimitKey({
      params: { id: "payment-123" },
      headers: { "x-api-key": "secret-api-key" },
      ip: "127.0.0.1",
    });

    expect(key).toMatch(/^payment-123:api:[a-f0-9]{64}$/);
    expect(key).not.toContain("secret-api-key");
  });

  it("falls back to ip-based keys when no merchant or api key is available", () => {
    expect(
      getVerifyPaymentRateLimitKey({
        params: { id: "payment-123" },
        headers: {},
        ip: "203.0.113.10",
      }),
    ).toBe("payment-123:ip:203.0.113.10");
  });
});

describe("redis client helpers", () => {
  beforeEach(() => {
    resetRedisClientForTests();
  });

  it("creates a singleton redis client and connects it once", async () => {
    const connect = vi.fn().mockResolvedValue(undefined);
    const on = vi.fn();
    const client = {
      isOpen: false,
      connect,
      on,
      close: vi.fn(),
    };
    const clientFactory = vi.fn(() => client);

    const first = getRedisClient({
      redisUrl: "redis://localhost:6379",
      clientFactory,
    });
    const second = getRedisClient({
      redisUrl: "redis://localhost:6379",
      clientFactory,
    });

    expect(first).toBe(second);
    expect(clientFactory).toHaveBeenCalledTimes(1);
    expect(clientFactory).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "redis://localhost:6379",
        socket: expect.objectContaining({
          connectTimeout: 4000,
          reconnectStrategy: expect.any(Function),
        }),
      }),
    );
    expect(on).toHaveBeenCalledWith("error", expect.any(Function));

    await connectRedisClient({
      redisUrl: "redis://localhost:6379",
      clientFactory,
    });
    expect(connect).toHaveBeenCalledTimes(1);
  });
});
