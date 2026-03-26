import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createRedisRateLimitStore,
  createVerifyPaymentRateLimit,
  RATE_LIMIT_REDIS_PREFIX,
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
      windowMs: 15 * 60 * 1000,
      max: 10,
      message: { error: "Too many verification requests, please try again later." },
      standardHeaders: true,
      legacyHeaders: false,
      store,
    });
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
    expect(clientFactory).toHaveBeenCalledWith({
      url: "redis://localhost:6379",
    });
    expect(on).toHaveBeenCalledWith("error", expect.any(Function));

    await connectRedisClient({
      redisUrl: "redis://localhost:6379",
      clientFactory,
    });
    expect(connect).toHaveBeenCalledTimes(1);
  });
});
