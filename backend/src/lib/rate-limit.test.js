import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("rate-limit-redis", () => ({
  RedisStore: vi.fn(),
}));

vi.mock("redis", () => ({
  createClient: vi.fn(),
}));

import {
  createDashboardMetricsRateLimit,
  createMerchantSecurityActionRateLimit,
  createRedisRateLimitStore,
  createSep10ChallengeRateLimit,
  createSep10ChallengeIpRateLimit,
  createSep10VerifyRateLimit,
  createVerifyPaymentRateLimit,
  DASHBOARD_METRICS_RATE_LIMIT_MAX,
  DASHBOARD_METRICS_RATE_LIMIT_WINDOW_MS,
  getDashboardMetricsRateLimitKey,
  getMerchantSecurityActionRateLimitKey,
  getSep10ChallengeRateLimitKey,
  getSep10ChallengeIpRateLimitKey,
  getSep10VerifyRateLimitKey,
  getVerifyPaymentRateLimitKey,
  MERCHANT_SECURITY_ACTION_RATE_LIMIT_MAX,
  MERCHANT_SECURITY_ACTION_RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_REDIS_PREFIX,
  SEP10_CHALLENGE_RATE_LIMIT_MAX,
  SEP10_CHALLENGE_IP_RATE_LIMIT_MAX,
  SEP10_CHALLENGE_IP_RATE_LIMIT_WINDOW_MS,
  SEP10_VERIFY_RATE_LIMIT_MAX,
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

describe("createMerchantSecurityActionRateLimit", () => {
  it("passes the merchant security action config into express-rate-limit", () => {
    const store = { kind: "redis-store" };
    const middleware = vi.fn();
    const rateLimitFactory = vi.fn(() => middleware);

    const result = createMerchantSecurityActionRateLimit({ store, rateLimitFactory });

    expect(result).toBe(middleware);
    expect(rateLimitFactory).toHaveBeenCalledWith({
      windowMs: MERCHANT_SECURITY_ACTION_RATE_LIMIT_WINDOW_MS,
      max: MERCHANT_SECURITY_ACTION_RATE_LIMIT_MAX,
      message: { error: "Too many sensitive merchant actions, please try again later." },
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

describe("getMerchantSecurityActionRateLimitKey", () => {
  it("uses merchant ids when available", () => {
    expect(
      getMerchantSecurityActionRateLimitKey({
        merchant: { id: "merchant-456" },
        headers: {},
        ip: "203.0.113.10",
      }),
    ).toBe("merchant:merchant-456");
  });

  it("hashes api keys when merchant context is unavailable", () => {
    expect(
      getMerchantSecurityActionRateLimitKey({
        headers: { "x-api-key": "issuer-secret-key" },
        ip: "203.0.113.10",
      }),
    ).toMatch(/^api:[a-f0-9]{64}$/);
  });
});

describe("createDashboardMetricsRateLimit", () => {
  it("passes the dashboard metrics config into express-rate-limit", () => {
    const store = { kind: "redis-store" };
    const middleware = vi.fn();
    const rateLimitFactory = vi.fn(() => middleware);

    const result = createDashboardMetricsRateLimit({ store, rateLimitFactory });

    expect(result).toBe(middleware);
    expect(rateLimitFactory).toHaveBeenCalledWith({
      windowMs: DASHBOARD_METRICS_RATE_LIMIT_WINDOW_MS,
      max: DASHBOARD_METRICS_RATE_LIMIT_MAX,
      message: {
        error: "Too many dashboard requests, please try again later.",
        code: "DASHBOARD_METRICS_RATE_LIMITED",
      },
      standardHeaders: true,
      legacyHeaders: false,
      validate: { ip: false },
      keyGenerator: expect.any(Function),
      handler: expect.any(Function),
      store,
      passOnStoreError: true,
    });
  });
});

describe("getDashboardMetricsRateLimitKey", () => {
  it("uses merchant ids when available", () => {
    expect(
      getDashboardMetricsRateLimitKey({
        merchant: { id: "merchant-789" },
        headers: {},
        ip: "203.0.113.10",
      }),
    ).toBe("merchant:merchant-789");
  });

  it("hashes api keys when merchant context is unavailable", () => {
    expect(
      getDashboardMetricsRateLimitKey({
        headers: { "x-api-key": "dashboard-secret-key" },
        ip: "203.0.113.10",
      }),
    ).toMatch(/^api:[a-f0-9]{64}$/);
  });

  it("falls back to ip-based keys when no merchant or api key is available", () => {
    expect(
      getDashboardMetricsRateLimitKey({
        headers: {},
        ip: "203.0.113.10",
      }),
    ).toBe("ip:203.0.113.10");
  });
});

describe("SEP-10 rate limiters", () => {
  it("builds challenge keys scoped to account and IP", () => {
    const key = getSep10ChallengeRateLimitKey({
      body: { account: "GABC" },
      ip: "198.51.100.2",
    });
    expect(key).toBe("sep10:challenge:GABC:198.51.100.2");
  });

  it("builds challenge IP keys that ignore the account (#584)", () => {
    const a = getSep10ChallengeIpRateLimitKey({ body: { account: "GAAA" }, ip: "198.51.100.2" });
    const b = getSep10ChallengeIpRateLimitKey({ body: { account: "GBBB" }, ip: "198.51.100.2" });
    expect(a).toBe("sep10:challenge-ip:198.51.100.2");
    expect(b).toBe(a);
  });

  it("creates the challenge IP limiter with the configured policy (#584)", () => {
    const rateLimitFactory = vi.fn((options) => options);
    const options = createSep10ChallengeIpRateLimit({ rateLimitFactory });

    expect(options.max).toBe(SEP10_CHALLENGE_IP_RATE_LIMIT_MAX);
    expect(options.max).toBeGreaterThan(SEP10_CHALLENGE_RATE_LIMIT_MAX);
    expect(options.windowMs).toBe(SEP10_CHALLENGE_IP_RATE_LIMIT_WINDOW_MS);
    expect(options.keyGenerator).toBe(getSep10ChallengeIpRateLimitKey);
    expect(options.message.code).toBe("SEP10_RATE_LIMITED");
    expect(options.passOnStoreError).toBe(true);
  });

  it("builds verify keys scoped to client IP", () => {
    const key = getSep10VerifyRateLimitKey({ ip: "198.51.100.2" });
    expect(key).toBe("sep10:verify:198.51.100.2");
  });

  it("creates challenge and verify limiters with configured defaults", () => {
    const challenge = createSep10ChallengeRateLimit();
    const verify = createSep10VerifyRateLimit();

    expect(challenge).toBeDefined();
    expect(verify).toBeDefined();
    expect(SEP10_CHALLENGE_RATE_LIMIT_MAX).toBeGreaterThan(0);
    expect(SEP10_VERIFY_RATE_LIMIT_MAX).toBeGreaterThan(0);
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
