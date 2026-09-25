import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetCustomer,
  mockPutCustomer,
  mockDeleteCustomer,
  MockKycError,
} = vi.hoisted(() => {
  class KycError extends Error {
    constructor(code, message, httpStatus = 400, { retryable = false } = {}) {
      super(message);
      this.name = "KycError";
      this.code = code;
      this.httpStatus = httpStatus;
      this.retryable = retryable;
    }
  }

  return {
    mockGetCustomer: vi.fn(),
    mockPutCustomer: vi.fn(),
    mockDeleteCustomer: vi.fn(),
    MockKycError: KycError,
  };
});

vi.mock("../lib/sep12-kyc.js", () => ({
  getCustomer: mockGetCustomer,
  putCustomer: mockPutCustomer,
  deleteCustomer: mockDeleteCustomer,
  KycError: MockKycError,
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    error: vi.fn(),
  },
}));

import createSep12Router, {
  buildSep12RateLimitKey,
  createSep12RateLimit,
  createSep12WriteRateLimit,
} from "./sep12.js";

function createApp(router) {
  const app = express();
  app.use(express.json());
  app.use(router);
  return app;
}

describe("SEP-12 routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds rate-limit keys from account and client IP", () => {
    const key = buildSep12RateLimitKey({
      query: { account: "GACCOUNT123" },
      body: {},
      params: {},
      ip: "203.0.113.10",
      socket: {},
    });

    expect(key).toBe("sep12:GACCOUNT123:203.0.113.10");
  });

  it("truncates oversized account values in rate-limit keys", () => {
    const key = buildSep12RateLimitKey({
      query: { account: "G".repeat(10000) },
      body: {},
      params: {},
      ip: "203.0.113.10",
      socket: {},
    });

    expect(key).toBe(`sep12:${"G".repeat(56)}:203.0.113.10`);
  });

  it("returns structured retryable errors from the service layer", async () => {
    mockGetCustomer.mockRejectedValue(
      new MockKycError("SERVICE_UNAVAILABLE", "KYC store temporarily unavailable, please retry", 503, {
        retryable: true,
      }),
    );

    const app = createApp(createSep12Router());
    const response = await request(app)
      .get("/sep12/customer")
      .query({ account: "GDUKMGUGDZQK6YH3CQZ75W3UNQ6JH4GELB2XH4F54K7M3CY5W6O5W4ER" });

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      error: "SERVICE_UNAVAILABLE",
      message: "KYC store temporarily unavailable, please retry",
      retryable: true,
    });
  });

  it("rate-limits repeated requests for the same account while allowing a different account", async () => {
    const limiter = createSep12RateLimit({ max: 1, windowMs: 60_000 });
    const app = createApp(
      (() => {
        const router = express.Router();
        router.use(limiter);
        router.get("/sep12/customer", (_req, res) => {
          res.json({ ok: true });
        });
        return router;
      })(),
    );

    await request(app).get("/sep12/customer").query({ account: "G-ONE" }).expect(200);
    const limited = await request(app).get("/sep12/customer").query({ account: "G-ONE" });
    await request(app).get("/sep12/customer").query({ account: "G-TWO" }).expect(200);

    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({
      error: "TOO_MANY_REQUESTS",
      message: "Too many KYC requests, please try again later",
    });
  });

  it("rate-limits repeated KYC write requests per account", async () => {
    mockPutCustomer.mockResolvedValue({ id: "kyc-1", status: "pending" });
    const limiter = createSep12WriteRateLimit({ max: 1, windowMs: 60_000 });
    const app = createApp(
      (() => {
        const router = express.Router();
        router.use(limiter);
        router.put("/sep12/customer", async (req, res) => {
          const result = await mockPutCustomer(req.body);
          res.status(202).json(result);
        });
        return router;
      })(),
    );

    await request(app)
      .put("/sep12/customer")
      .send({ account: "G-ONE", fields: { first_name: "Ada" } })
      .expect(202);

    const limited = await request(app)
      .put("/sep12/customer")
      .send({ account: "G-ONE", fields: { first_name: "Grace" } });

    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({
      error: "TOO_MANY_REQUESTS",
      message: "Too many KYC write requests, please try again later",
    });
  });
});
