import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockQueryWithRetry,
  mockIsRetryablePoolError,
  mockSupabaseFrom,
  mockFindMatchingPayment,
  mockVerifyTransactionSignature,
  mockConnectRedisClient,
  mockGetCachedPayment,
  mockSetCachedPayment,
  mockInvalidatePaymentCache,
  mockSendWebhook,
  mockGetPayloadForVersion,
  mockSendReceiptEmail,
  mockRenderReceiptEmail,
  mockResolveBrandingConfig,
} = vi.hoisted(() => ({
  mockQueryWithRetry: vi.fn(),
  mockIsRetryablePoolError: vi.fn(),
  mockSupabaseFrom: vi.fn(),
  mockFindMatchingPayment: vi.fn(),
  mockVerifyTransactionSignature: vi.fn(),
  mockConnectRedisClient: vi.fn(),
  mockGetCachedPayment: vi.fn(),
  mockSetCachedPayment: vi.fn(),
  mockInvalidatePaymentCache: vi.fn(),
  mockSendWebhook: vi.fn(),
  mockGetPayloadForVersion: vi.fn(),
  mockSendReceiptEmail: vi.fn(),
  mockRenderReceiptEmail: vi.fn(),
  mockResolveBrandingConfig: vi.fn(),
}));

vi.mock("../lib/db.js", () => ({
  queryWithRetry: mockQueryWithRetry,
  isRetryablePoolError: mockIsRetryablePoolError,
}));

vi.mock("../lib/supabase.js", () => ({
  supabase: {
    from: mockSupabaseFrom,
  },
}));

vi.mock("../lib/stellar.js", () => ({
  findMatchingPayment: mockFindMatchingPayment,
  createRefundTransaction: vi.fn(),
  findStrictReceivePaths: vi.fn(),
  verifyTransactionSignature: mockVerifyTransactionSignature,
}));

vi.mock("../lib/branding.js", () => ({
  resolveBrandingConfig: mockResolveBrandingConfig,
}));

vi.mock("../lib/webhooks.js", () => ({
  sendWebhook: mockSendWebhook,
}));

vi.mock("../webhooks/resolver.js", () => ({
  getPayloadForVersion: mockGetPayloadForVersion,
}));

vi.mock("../lib/email.js", () => ({
  sendReceiptEmail: mockSendReceiptEmail,
}));

vi.mock("../lib/email-templates.js", () => ({
  renderReceiptEmail: mockRenderReceiptEmail,
}));

vi.mock("../lib/redis.js", () => ({
  connectRedisClient: mockConnectRedisClient,
  getCachedPayment: mockGetCachedPayment,
  setCachedPayment: mockSetCachedPayment,
  invalidatePaymentCache: mockInvalidatePaymentCache,
}));

vi.mock("../lib/metrics.js", () => ({
  paymentCreatedCounter: { inc: vi.fn() },
  paymentConfirmedCounter: { inc: vi.fn() },
  paymentConfirmationLatency: { observe: vi.fn() },
  paymentFailedCounter: { inc: vi.fn() },
}));

import { paymentService } from "./paymentService.js";

describe("paymentService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveBrandingConfig.mockReturnValue({ primary_color: "#000000" });
    mockConnectRedisClient.mockResolvedValue({ isOpen: false });
    mockGetCachedPayment.mockResolvedValue(null);
    mockSetCachedPayment.mockResolvedValue(undefined);
    mockInvalidatePaymentCache.mockResolvedValue(undefined);
    mockSendWebhook.mockResolvedValue({ ok: true });
    mockGetPayloadForVersion.mockReturnValue({ event: "payment.confirmed" });
    mockSendReceiptEmail.mockResolvedValue(undefined);
    mockRenderReceiptEmail.mockReturnValue("<html />");
  });

  it("uses the pooler for merchant payment listing with parameterized filters", async () => {
    mockQueryWithRetry.mockResolvedValue({
      rows: [
        {
          id: "pay_1",
          amount: "10.50",
          asset: "USDC",
          asset_issuer: "issuer-1",
          recipient: "GRECIPIENT",
          description: "Invoice 1",
          client_id: "client-1",
          status: "pending",
          tx_id: null,
          created_at: "2026-04-24T10:00:00.000Z",
          total_count: 1,
        },
      ],
    });

    const result = await paymentService.getMerchantPayments("merchant-1", {
      page: "1",
      limit: "20",
      status: "pending",
      search: "invoice",
      client_id: "client-1",
      metadata: { store: "lagos" },
    });

    expect(mockQueryWithRetry).toHaveBeenCalledTimes(1);
    const [sql, values, options] = mockQueryWithRetry.mock.calls[0];
    expect(sql).toContain("COUNT(*) OVER()");
    expect(sql).toContain("metadata @>");
    expect(values).toEqual([
      "merchant-1",
      "client-1",
      "pending",
      "%invoice%",
      "{\"store\":\"lagos\"}",
      20,
      0,
    ]);
    expect(options).toEqual({ label: "merchant-payments-list" });
    expect(result).toEqual({
      payments: [
        {
          id: "pay_1",
          amount: 10.5,
          asset: "USDC",
          asset_issuer: "issuer-1",
          recipient: "GRECIPIENT",
          description: "Invoice 1",
          client_id: "client-1",
          status: "pending",
          tx_id: null,
          created_at: "2026-04-24T10:00:00.000Z",
        },
      ],
      total_count: 1,
      total_pages: 1,
      page: 1,
      limit: 20,
    });
  });

  it("falls back to Supabase when the pooler exhausts retryable errors", async () => {
    const poolError = new Error("connection terminated");
    poolError.code = "57P01";
    mockQueryWithRetry.mockRejectedValue(poolError);
    mockIsRetryablePoolError.mockReturnValue(true);

    let callCount = 0;
    mockSupabaseFrom.mockImplementation(() => {
      callCount += 1;

      if (callCount === 1) {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            range: vi.fn(),
            filter: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            lte: vi.fn().mockReturnThis(),
            or: vi.fn().mockReturnThis(),
            count: 2,
            error: null,
          })),
        };
      }

      return {
        select: vi.fn(() => ({
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          range: vi.fn().mockResolvedValue({
            data: [
              {
                id: "pay_2",
                amount: 5,
                asset: "XLM",
                asset_issuer: null,
                recipient: "G2",
                description: null,
                client_id: null,
                status: "confirmed",
                tx_id: "tx-2",
                created_at: "2026-04-24T11:00:00.000Z",
              },
            ],
            error: null,
          }),
          filter: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          lte: vi.fn().mockReturnThis(),
          or: vi.fn().mockReturnThis(),
        })),
      };
    });

    const result = await paymentService.getMerchantPayments("merchant-1", {
      page: "1",
      limit: "10",
    });

    expect(mockQueryWithRetry).toHaveBeenCalledTimes(1);
    expect(result.total_count).toBe(2);
    expect(result.payments).toHaveLength(1);
    expect(result.total_pages).toBe(1);
  });

  it("returns pool-backed rolling metrics with confirmed counts", async () => {
    mockQueryWithRetry.mockResolvedValue({
      rows: [
        {
          date: "2026-04-18",
          volume: 0,
          count: 0,
          confirmed_count: 0,
          total_volume: 15.75,
          total_payments: 2,
          total_confirmed_count: 1,
        },
        {
          date: "2026-04-19",
          volume: 15.75,
          count: 2,
          confirmed_count: 1,
          total_volume: 15.75,
          total_payments: 2,
          total_confirmed_count: 1,
        },
      ],
    });

    const result = await paymentService.getRollingMetrics("merchant-1");

    expect(mockQueryWithRetry).toHaveBeenCalledWith(
      expect.stringContaining("generate_series"),
      ["merchant-1"],
      { label: "rolling-payment-metrics" },
    );
    expect(result.total_volume).toBe(15.75);
    expect(result.total_payments).toBe(2);
    expect(result.confirmed_count).toBe(1);
    expect(result.success_rate).toBe(50);
    expect(result.data[1]).toEqual({
      date: "2026-04-19",
      volume: 15.75,
      count: 2,
      confirmed_count: 1,
    });
  });

  it("keeps verifyPayment pending when transaction signature verification fails", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: "payment-1",
        merchant_id: "merchant-1",
        amount: "12.5",
        asset: "USDC",
        asset_issuer: "issuer-1",
        recipient: "GDEST",
        status: "pending",
        tx_id: null,
        memo: null,
        memo_type: null,
        webhook_url: "https://example.com/webhook",
        created_at: "2026-04-24T10:00:00.000Z",
        merchants: {
          webhook_secret: "secret",
          webhook_version: "v1",
          notification_email: "merchant@example.com",
          email: "merchant@example.com",
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
      update: vi.fn(),
    });
    mockFindMatchingPayment.mockResolvedValue({
      transaction_hash: "tx-invalid",
    });
    mockVerifyTransactionSignature.mockResolvedValue({
      valid: false,
      reason: "signature mismatch",
    });

    const result = await paymentService.verifyPayment("payment-1");

    expect(result).toEqual({ status: "pending" });
    expect(mockVerifyTransactionSignature).toHaveBeenCalledWith("tx-invalid");
  });
});
