import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  CREATE_PAYMENT_RATE_LIMIT_ERROR,
  createCreatePaymentRateLimit,
  getCreatePaymentRateLimitConfig,
  getCreatePaymentRateLimitKey,
  getRetryAfterSeconds,
} from "./create-payment-rate-limit.js";

function createRequest({
  apiKey,
  merchantId,
  ip = "127.0.0.1",
  resetTime,
} = {}) {
  return {
    ip,
    merchant: merchantId ? { id: merchantId } : undefined,
    rateLimit: resetTime ? { resetTime } : undefined,
    get(name) {
      if (name.toLowerCase() === "x-api-key") {
        return apiKey;
      }

      return undefined;
    },
  };
}

function createResponse() {
  return {
    json: vi.fn(),
    set: vi.fn(),
    status: vi.fn(),
  };
}

describe("create-payment rate limit config", () => {
  it("uses the default rate-limit settings", () => {
    expect(getCreatePaymentRateLimitConfig({})).toEqual({
      max: 50,
      windowMs: 60 * 1000,
    });
  });

  it("uses environment overrides when present", () => {
    expect(
      getCreatePaymentRateLimitConfig({
        CREATE_PAYMENT_RATE_LIMIT_MAX: "75",
        CREATE_PAYMENT_RATE_LIMIT_WINDOW_MS: "120000",
      })
    ).toEqual({
      max: 75,
      windowMs: 120000,
    });
  });

  it("falls back to defaults for invalid environment overrides", () => {
    expect(
      getCreatePaymentRateLimitConfig({
        CREATE_PAYMENT_RATE_LIMIT_MAX: "0",
        CREATE_PAYMENT_RATE_LIMIT_WINDOW_MS: "nope",
      })
    ).toEqual({
      max: 50,
      windowMs: 60 * 1000,
    });
  });
});

describe("getCreatePaymentRateLimitKey", () => {
  it("uses a hashed API key when the header is present", () => {
    const apiKey = "  live_test_key  ";

    expect(getCreatePaymentRateLimitKey(createRequest({ apiKey }))).toBe(
      createHash("sha256").update("live_test_key").digest("hex")
    );
  });

  it("falls back to the merchant id when the API key header is unavailable", () => {
    expect(
      getCreatePaymentRateLimitKey(createRequest({ merchantId: "merchant-123" }))
    ).toBe("merchant:merchant-123");
  });

  it("falls back to the request ip when merchant data is unavailable", () => {
    expect(
      getCreatePaymentRateLimitKey(createRequest({ ip: "10.0.0.4" }))
    ).toBe("10.0.0.4");
  });
});

describe("getRetryAfterSeconds", () => {
  it("rounds up the remaining wait time in seconds", () => {
    const now = new Date("2026-03-26T12:00:00.000Z");
    const resetTime = new Date("2026-03-26T12:00:02.100Z");

    expect(getRetryAfterSeconds(resetTime, now, 60 * 1000)).toBe(3);
  });

  it("falls back to the window duration when reset time is unavailable", () => {
    const now = new Date("2026-03-26T12:00:00.000Z");

    expect(getRetryAfterSeconds(undefined, now, 90 * 1000)).toBe(90);
  });
});

describe("createCreatePaymentRateLimit", () => {
  it("passes the expected config to the limiter factory", () => {
    const limiter = vi.fn();
    const limiterFactory = vi.fn(() => limiter);

    const result = createCreatePaymentRateLimit({
      env: {
        CREATE_PAYMENT_RATE_LIMIT_MAX: "55",
        CREATE_PAYMENT_RATE_LIMIT_WINDOW_MS: "90000",
      },
      limiterFactory,
    });

    expect(result).toBe(limiter);
    expect(limiterFactory).toHaveBeenCalledTimes(1);

    const [config] = limiterFactory.mock.calls[0];
    expect(config.max).toBe(55);
    expect(config.windowMs).toBe(90000);
    expect(config.standardHeaders).toBe(true);
    expect(config.legacyHeaders).toBe(false);
    expect(typeof config.keyGenerator).toBe("function");
    expect(typeof config.handler).toBe("function");
  });

  it("returns a 429 response with Retry-After when the limiter blocks a request", () => {
    const limiterFactory = vi.fn((config) => config);
    const limiterConfig = createCreatePaymentRateLimit({ limiterFactory });
    const req = createRequest({
      apiKey: "limited-key",
      resetTime: new Date("2026-03-26T12:00:03.000Z"),
    });
    const res = createResponse();
    res.status.mockReturnValue(res);

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));

    limiterConfig.handler(req, res);

    expect(res.set).toHaveBeenCalledWith("Retry-After", "3");
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith({
      error: CREATE_PAYMENT_RATE_LIMIT_ERROR,
    });

    vi.useRealTimers();
  });
});
