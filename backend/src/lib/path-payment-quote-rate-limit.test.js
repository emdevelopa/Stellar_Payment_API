import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  PATH_PAYMENT_QUOTE_RATE_LIMIT_ERROR,
  createPathPaymentQuoteRateLimit,
  getPathPaymentQuoteRateLimitConfig,
  getPathPaymentQuoteRateLimitKey,
  getRetryAfterSeconds,
} from "./path-payment-quote-rate-limit.js";

function createRequest({
  apiKey,
  merchantId,
  ip = "127.0.0.1",
  paymentId = "payment-1",
  resetTime,
} = {}) {
  return {
    ip,
    params: paymentId ? { id: paymentId } : {},
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

describe("path-payment-quote rate limit config", () => {
  it("uses the default rate-limit settings", () => {
    expect(getPathPaymentQuoteRateLimitConfig({})).toEqual({
      max: 20,
      windowMs: 60 * 1000,
    });
  });

  it("uses environment overrides when present", () => {
    expect(
      getPathPaymentQuoteRateLimitConfig({
        PATH_PAYMENT_QUOTE_RATE_LIMIT_MAX: "40",
        PATH_PAYMENT_QUOTE_RATE_LIMIT_WINDOW_MS: "120000",
      })
    ).toEqual({
      max: 40,
      windowMs: 120000,
    });
  });

  it("falls back to defaults for invalid environment overrides", () => {
    expect(
      getPathPaymentQuoteRateLimitConfig({
        PATH_PAYMENT_QUOTE_RATE_LIMIT_MAX: "0",
        PATH_PAYMENT_QUOTE_RATE_LIMIT_WINDOW_MS: "nope",
      })
    ).toEqual({
      max: 20,
      windowMs: 60 * 1000,
    });
  });
});

describe("getPathPaymentQuoteRateLimitKey", () => {
  it("scopes the key by payment id and hashed API key when the header is present", () => {
    const apiKey = "  live_test_key  ";
    const hashedKey = createHash("sha256").update("live_test_key").digest("hex");

    expect(
      getPathPaymentQuoteRateLimitKey(
        createRequest({ apiKey, paymentId: "pay-1" })
      )
    ).toBe(`pay-1:api:${hashedKey}`);
  });

  it("scopes by merchant id when no API key header is present", () => {
    expect(
      getPathPaymentQuoteRateLimitKey(
        createRequest({ merchantId: "merchant-9", paymentId: "pay-2" })
      )
    ).toBe("pay-2:merchant:merchant-9");
  });

  it("scopes by ip address when neither API key nor merchant id is available", () => {
    expect(
      getPathPaymentQuoteRateLimitKey(
        createRequest({ ip: "10.0.0.4", paymentId: "pay-3" })
      )
    ).toBe("pay-3:ip:10.0.0.4");
  });

  it("uses an unknown-payment marker when params.id is missing", () => {
    const req = createRequest({ ip: "10.0.0.4" });
    req.params = {};

    expect(getPathPaymentQuoteRateLimitKey(req)).toBe(
      "unknown-payment:ip:10.0.0.4"
    );
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

describe("createPathPaymentQuoteRateLimit", () => {
  it("passes the expected config to the limiter factory", () => {
    const limiter = vi.fn();
    const limiterFactory = vi.fn(() => limiter);

    const result = createPathPaymentQuoteRateLimit({
      env: {
        PATH_PAYMENT_QUOTE_RATE_LIMIT_MAX: "25",
        PATH_PAYMENT_QUOTE_RATE_LIMIT_WINDOW_MS: "90000",
      },
      limiterFactory,
    });

    expect(result).toBe(limiter);
    expect(limiterFactory).toHaveBeenCalledTimes(1);

    const [config] = limiterFactory.mock.calls[0];
    expect(config.max).toBe(25);
    expect(config.windowMs).toBe(90000);
    expect(config.standardHeaders).toBe(true);
    expect(config.legacyHeaders).toBe(false);
    expect(typeof config.keyGenerator).toBe("function");
    expect(typeof config.handler).toBe("function");
  });

  it("returns a 429 response with Retry-After when the limiter blocks a request", () => {
    const limiterFactory = vi.fn((config) => config);
    const limiterConfig = createPathPaymentQuoteRateLimit({ limiterFactory });
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
      error: PATH_PAYMENT_QUOTE_RATE_LIMIT_ERROR,
    });

    vi.useRealTimers();
  });
});
