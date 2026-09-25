import { describe, it, expect, vi, beforeEach } from "vitest";
import { createPaymentRateLimiter } from "./payment-rate-limiter.js";

/**
 * Build a minimal mock Express request.
 *
 * @param {string} [ip="127.0.0.1"]
 * @returns {object}
 */
function makeReq(ip = "127.0.0.1") {
  return { ip };
}

/**
 * Build a minimal mock Express response that captures status, headers, and json.
 *
 * @returns {{ status: Function, setHeader: Function, json: Function, _status: number|null, _headers: object, _body: any }}
 */
function makeRes() {
  const res = {
    _status: null,
    _headers: {},
    _body: null,
  };

  res.status = vi.fn((code) => {
    res._status = code;
    return res;
  });

  res.setHeader = vi.fn((name, value) => {
    res._headers[name] = value;
  });

  res.json = vi.fn((body) => {
    res._body = body;
    return res;
  });

  return res;
}

describe("createPaymentRateLimiter", () => {
  let fakeNow;
  let now;
  let middleware;
  let next;

  beforeEach(() => {
    fakeNow = Date.now();
    now = vi.fn(() => fakeNow);
    next = vi.fn();
    middleware = createPaymentRateLimiter({ windowMs: 60_000, maxRequests: 3, now });
  });

  // ── Basic pass-through ──────────────────────────────────────────────────────

  it("calls next() for requests within the limit", () => {
    middleware(makeReq(), makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("allows exactly maxRequests requests before blocking", () => {
    const ip = "10.0.0.1";
    for (let i = 0; i < 3; i++) {
      middleware(makeReq(ip), makeRes(), next);
    }
    expect(next).toHaveBeenCalledTimes(3);
  });

  // ── 429 on limit exceeded ───────────────────────────────────────────────────

  it("returns 429 on the request that exceeds maxRequests", () => {
    const ip = "10.0.0.2";
    const res = makeRes();
    for (let i = 0; i < 3; i++) {
      middleware(makeReq(ip), makeRes(), next);
    }
    // 4th request should be blocked
    middleware(makeReq(ip), res, next);

    expect(res._status).toBe(429);
    expect(res._body).toMatchObject({ error: "Too many requests" });
    expect(typeof res._body.retryAfter).toBe("number");
    // next should not be called for the blocked request
    expect(next).toHaveBeenCalledTimes(3);
  });

  it("includes retryAfter > 0 in the 429 response body", () => {
    const ip = "10.0.0.3";
    for (let i = 0; i < 3; i++) {
      middleware(makeReq(ip), makeRes(), next);
    }
    const res = makeRes();
    middleware(makeReq(ip), res, next);
    expect(res._body.retryAfter).toBeGreaterThan(0);
  });

  // ── Headers ─────────────────────────────────────────────────────────────────

  it("sets X-RateLimit-Limit header on every response", () => {
    const res = makeRes();
    middleware(makeReq("10.0.0.4"), res, next);
    expect(res._headers["X-RateLimit-Limit"]).toBe("3");
  });

  it("decrements X-RateLimit-Remaining correctly", () => {
    const ip = "10.0.0.5";
    const res1 = makeRes();
    middleware(makeReq(ip), res1, next);
    expect(res1._headers["X-RateLimit-Remaining"]).toBe("2");

    const res2 = makeRes();
    middleware(makeReq(ip), res2, next);
    expect(res2._headers["X-RateLimit-Remaining"]).toBe("1");
  });

  it("sets X-RateLimit-Reset header as a Unix timestamp in seconds", () => {
    const res = makeRes();
    middleware(makeReq("10.0.0.6"), res, next);
    const reset = Number(res._headers["X-RateLimit-Reset"]);
    const expectedReset = Math.ceil((fakeNow + 60_000) / 1000);
    expect(reset).toBe(expectedReset);
  });

  it("sets Retry-After header on 429 responses", () => {
    const ip = "10.0.0.7";
    for (let i = 0; i < 3; i++) {
      middleware(makeReq(ip), makeRes(), next);
    }
    const res = makeRes();
    middleware(makeReq(ip), res, next);
    expect(res._headers["Retry-After"]).toBeDefined();
    expect(Number(res._headers["Retry-After"])).toBeGreaterThanOrEqual(0);
  });

  // ── Window reset ────────────────────────────────────────────────────────────

  it("resets the counter after the window expires", () => {
    const ip = "10.0.0.8";
    for (let i = 0; i < 3; i++) {
      middleware(makeReq(ip), makeRes(), next);
    }

    // Advance the fake clock past the window
    fakeNow += 60_001;
    now.mockReturnValue(fakeNow);

    const res = makeRes();
    middleware(makeReq(ip), res, next);
    // Should be allowed again — counter reset
    expect(res._status).toBeNull();
    expect(next).toHaveBeenCalledTimes(4);
  });

  // ── Independent key tracking ────────────────────────────────────────────────

  it("tracks different IPs independently", () => {
    const ipA = "192.168.1.1";
    const ipB = "192.168.1.2";

    // Exhaust ipA's quota
    for (let i = 0; i < 3; i++) {
      middleware(makeReq(ipA), makeRes(), next);
    }

    // ipB should still be allowed
    const res = makeRes();
    middleware(makeReq(ipB), res, next);
    expect(res._status).toBeNull();
    expect(next).toHaveBeenCalledTimes(4); // 3 for ipA + 1 for ipB
  });

  // ── keyFn returning null skips limiting ─────────────────────────────────────

  it("skips rate limiting when keyFn returns null", () => {
    const noKeyMiddleware = createPaymentRateLimiter({
      windowMs: 60_000,
      maxRequests: 1,
      keyFn: () => null,
      now,
    });

    for (let i = 0; i < 10; i++) {
      noKeyMiddleware(makeReq(), makeRes(), next);
    }
    expect(next).toHaveBeenCalledTimes(10);
  });

  // ── X-RateLimit-Remaining never goes below 0 ───────────────────────────────

  it("X-RateLimit-Remaining is 0 when limit is exceeded, not negative", () => {
    const ip = "10.0.0.9";
    for (let i = 0; i < 3; i++) {
      middleware(makeReq(ip), makeRes(), next);
    }
    const res = makeRes();
    middleware(makeReq(ip), res, next);
    expect(Number(res._headers["X-RateLimit-Remaining"])).toBe(0);
  });
});
