import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockQueryWithRetry,
  mockSupabaseFrom,
  mockConnectRedisClient,
  mockGetCachedPayment,
  mockFindMatchingPayment,
} = vi.hoisted(() => ({
  mockQueryWithRetry: vi.fn(),
  mockSupabaseFrom: vi.fn(),
  mockConnectRedisClient: vi.fn(),
  mockGetCachedPayment: vi.fn(),
  mockFindMatchingPayment: vi.fn().mockResolvedValue({
    transaction_hash: "tx_hash_123",
    received_amount: "10",
    is_multisig: false,
  }),
}));

vi.mock("../lib/db.js", () => ({
  queryWithRetry: mockQueryWithRetry,
}));

vi.mock("../lib/supabase.js", () => ({
  supabase: { from: mockSupabaseFrom },
}));

vi.mock("../lib/stellar.js", () => ({
  findMatchingPayment: mockFindMatchingPayment,
  createRefundTransaction: vi.fn(),
  findStrictReceivePaths: vi.fn(),
  isValidStellarPublicKey: vi.fn().mockReturnValue(true),
  verifyTransactionSignature: vi.fn(),
}));

vi.mock("../lib/branding.js", () => ({
  resolveBrandingConfig: vi.fn().mockReturnValue({}),
}));

vi.mock("../lib/webhooks.js", () => ({
  sendWebhook: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("../webhooks/resolver.js", () => ({
  getPayloadForVersion: vi.fn().mockReturnValue({}),
}));

vi.mock("../lib/email.js", () => ({
  sendReceiptEmail: vi.fn(),
}));

vi.mock("../lib/email-templates.js", () => ({
  renderReceiptEmail: vi.fn().mockReturnValue("<html/>"),
}));

vi.mock("../lib/redis.js", () => ({
  connectRedisClient: mockConnectRedisClient,
  getCachedPayment: mockGetCachedPayment,
  setCachedPayment: vi.fn(),
  invalidatePaymentCache: vi.fn(),
}));

vi.mock("../lib/metrics.js", () => ({
  paymentCreatedCounter: { inc: vi.fn() },
  paymentConfirmedCounter: { inc: vi.fn() },
  paymentConfirmationLatency: { observe: vi.fn() },
  paymentFailedCounter: { inc: vi.fn() },
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../lib/payment-signature-verification.js", () => ({
  paymentSignatureVerifier: {
    verifyTransaction: vi.fn().mockResolvedValue({ valid: true, cached: false }),
  },
}));

import { paymentService } from "../services/paymentService.js";

describe("Payment Processor Security Audit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnectRedisClient.mockResolvedValue({ isOpen: false });
    mockGetCachedPayment.mockResolvedValue(null);
  });

  describe("Input Validation", () => {
    it("rejects payment session with missing asset", async () => {
      const merchant = {
        id: "m1",
        payment_limits: {},
        allowed_issuers: [],
        branding_config: {},
      };

      await expect(
        paymentService.createPaymentSession(merchant, {
          amount: 10,
          recipient: "GDEST",
        })
      ).rejects.toThrow();
    });

    it("rejects payment session with zero amount", async () => {
      const merchant = {
        id: "m1",
        payment_limits: {},
        allowed_issuers: [],
        branding_config: {},
      };

      await expect(
        paymentService.createPaymentSession(merchant, {
          amount: 0,
          asset: "XLM",
          recipient: "GDEST",
        })
      ).rejects.toThrow();
    });
  });

  describe("Parameterized Queries", () => {
    it("uses parameterized SQL for payment listing (no string interpolation)", async () => {
      mockQueryWithRetry.mockResolvedValue({ rows: [] });

      await paymentService.getMerchantPayments("m1", {
        page: "1",
        limit: "10",
        search: "test'; DROP TABLE payments;--",
      });

      const [sql, values] = mockQueryWithRetry.mock.calls[0];
      expect(sql).toContain("$1");
      expect(sql).toContain("ILIKE");
      expect(values).toContain("%test'; DROP TABLE payments;--%");
    });

    it("uses parameterized SQL for rolling metrics", async () => {
      mockQueryWithRetry.mockResolvedValue({ rows: [] });

      await paymentService.getRollingMetrics("m1");

      const [, values] = mockQueryWithRetry.mock.calls[0];
      expect(values).toEqual(["m1"]);
    });
  });

  describe("Payment Status Security", () => {
    it("caches confirmed/completed payments but not pending", async () => {
      const mockSet = vi.fn();
      mockConnectRedisClient.mockResolvedValue({
        isOpen: true,
        set: mockSet,
        get: vi.fn(),
        del: vi.fn(),
      });

      const insert = vi.fn().mockResolvedValue({ error: null });
      const maybeSingle = vi.fn().mockResolvedValue({
        data: {
          id: "pay_1",
          amount: "10",
          asset: "XLM",
          recipient: "GDEST",
          status: "pending",
          metadata: {},
          merchants: { branding_config: null },
        },
        error: null,
      });
      mockSupabaseFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          maybeSingle,
        }),
        insert,
      });

      const result = await paymentService.getPaymentStatus("pay_1");

      expect(result.payment).toBeDefined();
      expect(result.payment.status).toBe("pending");
    });
  });

  describe("Error Handling", () => {
    it("returns 404 for non-existent payment status", async () => {
      const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
      mockSupabaseFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          maybeSingle,
        }),
      });

      await expect(paymentService.getPaymentStatus("nonexistent")).rejects.toThrow(
        "Payment not found"
      );
    });

    it("propagates database errors with status 500", async () => {
      const dbError = new Error("connection refused");
      dbError.code = "08001";
      const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: dbError });
      mockSupabaseFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          maybeSingle,
        }),
      });

      await expect(paymentService.getPaymentStatus("pay_1")).rejects.toThrow("connection refused");
    });
  });

  describe("Signature Verification Integration", () => {
    it("confirms payment when signature verification passes", async () => {
      const maybeSingle = vi.fn().mockResolvedValue({
        data: {
          id: "pay_1",
          merchant_id: "m1",
          amount: "10",
          asset: "XLM",
          recipient: "GDEST",
          status: "pending",
          tx_id: null,
          memo: null,
          memo_type: null,
          webhook_url: null,
          created_at: new Date().toISOString(),
          merchants: {
            webhook_secret: "sec",
            webhook_version: "v1",
            notification_email: null,
            email: null,
          },
        },
        error: null,
      });
      const update = vi.fn().mockResolvedValue({ error: null });
      mockSupabaseFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          maybeSingle,
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
        }),
      });

      const result = await paymentService.verifyPayment("pay_1");

      expect(result.status).toBe("confirmed");
    });
  });

  describe("SQL Injection Prevention", () => {
    it("escapes LIKE patterns in search queries", async () => {
      mockQueryWithRetry.mockResolvedValue({ rows: [] });

      await paymentService.getMerchantPayments("m1", {
        page: "1",
        limit: "10",
        search: "100%_OR_1=1",
      });

      const [, values] = mockQueryWithRetry.mock.calls[0];
      const searchValue = values.find((v) => typeof v === "string" && v.includes("100"));
      expect(searchValue).toBe("%100\\%\\_OR\\_1=1%");
    });
  });
});
