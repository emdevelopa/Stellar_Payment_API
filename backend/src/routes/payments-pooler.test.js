import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockSupabaseFrom,
  mockFindMatchingPayment,
  mockFindAnyRecentPayment,
  mockVerifyTransactionSignature,
  mockConnectRedisClient,
  mockInvalidatePaymentCache,
  mockPaymentServiceGetMerchantPayments,
  mockPaymentServiceGetRollingMetrics,
} = vi.hoisted(() => ({
  mockSupabaseFrom: vi.fn(),
  mockFindMatchingPayment: vi.fn(),
  mockFindAnyRecentPayment: vi.fn(),
  mockVerifyTransactionSignature: vi.fn(),
  mockConnectRedisClient: vi.fn(),
  mockInvalidatePaymentCache: vi.fn(),
  mockPaymentServiceGetMerchantPayments: vi.fn(),
  mockPaymentServiceGetRollingMetrics: vi.fn(),
}));

vi.mock("../lib/supabase.js", () => ({
  supabase: {
    from: mockSupabaseFrom,
  },
}));

vi.mock("../lib/stellar.js", () => ({
  findMatchingPayment: mockFindMatchingPayment,
  findAnyRecentPayment: mockFindAnyRecentPayment,
  findStrictReceivePaths: vi.fn(),
  getNetworkFeeStats: vi.fn(),
  verifyTransactionSignature: mockVerifyTransactionSignature,
}));

vi.mock("../lib/redis.js", () => ({
  connectRedisClient: mockConnectRedisClient,
  getCachedPayment: vi.fn(),
  setCachedPayment: vi.fn(),
  invalidatePaymentCache: mockInvalidatePaymentCache,
}));

vi.mock("../lib/create-payment-rate-limit.js", () => ({
  createCreatePaymentRateLimit: () => (_req, _res, next) => next(),
}));

vi.mock("../lib/rate-limit.js", () => ({
  createVerifyPaymentRateLimit: () => (_req, _res, next) => next(),
}));

vi.mock("../lib/recaptcha.js", () => ({
  recaptchaMiddleware: () => (_req, _res, next) => next(),
}));

vi.mock("../lib/validation.js", () => ({
  validateRequest: () => (_req, _res, next) => next(),
}));

vi.mock("../lib/sanitize-metadata.js", () => ({
  sanitizeMetadataMiddleware: (_req, _res, next) => next(),
}));

vi.mock("../lib/validate-uuid.js", () => ({
  validateUuidParam: () => (_req, _res, next) => next(),
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../lib/webhooks.js", () => ({
  sendWebhook: vi.fn(),
  isEventSubscribed: vi.fn(() => false),
}));

vi.mock("../lib/email.js", () => ({
  sendReceiptEmail: vi.fn(),
}));

vi.mock("../lib/email-templates.js", () => ({
  renderReceiptEmail: vi.fn(() => "<html />"),
}));

vi.mock("../webhooks/resolver.js", () => ({
  getPayloadForVersion: vi.fn(() => ({})),
}));

vi.mock("../lib/stream-manager.js", () => ({
  streamManager: {
    notify: vi.fn(),
    addClient: vi.fn(),
  },
}));

vi.mock("../lib/metrics.js", () => ({
  paymentCreatedCounter: { inc: vi.fn() },
  paymentConfirmedCounter: { inc: vi.fn() },
  paymentConfirmationLatency: { observe: vi.fn() },
  paymentFailedCounter: { inc: vi.fn() },
}));

vi.mock("../services/paymentService.js", () => ({
  paymentService: {
    createPaymentSession: vi.fn(),
    generateRefundTx: vi.fn(),
    confirmRefundTx: vi.fn(),
    getMerchantPayments: mockPaymentServiceGetMerchantPayments,
    getRollingMetrics: mockPaymentServiceGetRollingMetrics,
  },
}));

import createPaymentsRouter from "./payments.js";

describe("payments routes pooler hardening", () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConnectRedisClient.mockResolvedValue({ isOpen: false });

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.merchant = { id: "merchant-1", payment_limits: {} };
      next();
    });
    app.use("/api", createPaymentsRouter());
  });

  it("keeps verify-payment pending when cryptographic signature verification fails", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: "payment-1",
        merchant_id: "merchant-1",
        amount: "10.0",
        asset: "USDC",
        asset_issuer: "issuer-1",
        recipient: "GDEST",
        status: "pending",
        tx_id: null,
        memo: null,
        memo_type: null,
        webhook_url: "https://example.com/webhook",
        metadata: {},
        created_at: "2026-04-24T10:00:00.000Z",
        merchants: {
          webhook_secret: "secret",
          webhook_version: "v1",
          webhook_custom_headers: {},
          notification_email: "merchant@example.com",
          email: "merchant@example.com",
          business_name: "Merchant",
          subscribed_events: ["payment.confirmed"],
        },
      },
      error: null,
    });

    mockSupabaseFrom.mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle,
      })),
    });
    mockFindMatchingPayment.mockResolvedValue({ transaction_hash: "tx-bad" });
    mockVerifyTransactionSignature.mockResolvedValue({
      valid: false,
      reason: "signature mismatch",
    });

    const response = await request(app).post("/api/verify-payment/payment-1");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "pending" });
    expect(mockVerifyTransactionSignature).toHaveBeenCalledWith("tx-bad");
  });

  it("delegates merchant payment listing to the pool-backed payment service", async () => {
    mockPaymentServiceGetMerchantPayments.mockResolvedValue({
      payments: [],
      total_count: 0,
      total_pages: 0,
      page: 1,
      limit: 10,
    });

    const response = await request(app).get("/api/payments?page=1&limit=10");

    expect(response.status).toBe(200);
    expect(mockPaymentServiceGetMerchantPayments).toHaveBeenCalledWith("merchant-1", {
      page: "1",
      limit: "10",
    });
  });

  it("delegates 7-day metrics to the pool-backed payment service", async () => {
    mockPaymentServiceGetRollingMetrics.mockResolvedValue({
      data: [],
      total_volume: 0,
      total_payments: 0,
      confirmed_count: 0,
      success_rate: 0,
    });

    const response = await request(app).get("/api/metrics/7day");

    expect(response.status).toBe(200);
    expect(response.body.total_volume).toBe(0);
    expect(mockPaymentServiceGetRollingMetrics).toHaveBeenCalledWith("merchant-1");
  });
});
