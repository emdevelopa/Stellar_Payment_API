import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockQueryWithRetry,
  mockIsRetryablePoolError,
  mockSupabaseFrom,
  mockFindMatchingPayment,
  mockIsValidStellarPublicKey,
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
  mockIsValidStellarPublicKey: vi.fn(),
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
  isValidStellarPublicKey: mockIsValidStellarPublicKey,
  verifyTransactionSignature: mockVerifyTransactionSignature,
  withHorizonRetry: vi.fn().mockResolvedValue(undefined),
  isValidAssetCode: vi.fn().mockReturnValue(true),
  isValidStellarAccountId: vi.fn().mockReturnValue(true),
  isValidTransactionHash: (value) =>
    typeof value === "string" && /^[0-9a-fA-F]{64}$/.test(value),
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

const { mockHorizonTransaction } = vi.hoisted(() => ({
  mockHorizonTransaction: vi.fn(),
}));

vi.mock("stellar-sdk", () => ({
  Horizon: {
    Server: vi.fn(() => ({
      transactions: () => ({
        transaction: (hash) => ({
          call: () => mockHorizonTransaction(hash),
        }),
      }),
    })),
  },
}));

import { paymentService } from "./paymentService.js";

const USDC_TESTNET_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

describe("paymentService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsValidStellarPublicKey.mockReturnValue(true);
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

  it("resolves default asset issuers before allowlist checks and inserts", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    mockSupabaseFrom.mockReturnValue({ insert });

    const result = await paymentService.createPaymentSession(
      {
        id: "merchant-1",
        allowed_issuers: [USDC_TESTNET_ISSUER],
        payment_limits: {},
        branding_config: {},
      },
      {
        amount: 12.5,
        asset: "USDC",
        recipient: "GRECIPIENT",
      },
    );

    expect(result).toMatchObject({
      status: "pending",
      branding_config: { primary_color: "#000000" },
    });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        merchant_id: "merchant-1",
        amount: 12.5,
        asset: "USDC",
        asset_issuer: USDC_TESTNET_ISSUER,
        recipient: "GRECIPIENT",
      }),
    );
  });

  describe("createPaymentSession persistence retry (issue #1449)", () => {
    const merchant = {
      id: "merchant-1",
      allowed_issuers: [],
      payment_limits: {},
      branding_config: {},
    };
    const body = { amount: 5, asset: "XLM", recipient: "GRECIPIENT" };

    beforeEach(() => {
      process.env.PAYMENT_SESSION_RETRY_BASE_DELAY_MS = "0";
    });

    afterEach(() => {
      delete process.env.PAYMENT_SESSION_RETRY_BASE_DELAY_MS;
    });

    it("retries a transient insert failure and creates the session", async () => {
      const insert = vi
        .fn()
        .mockResolvedValueOnce({ error: { message: "TypeError: fetch failed", code: "" } })
        .mockResolvedValue({ error: null });
      mockSupabaseFrom.mockReturnValue({ insert });

      const result = await paymentService.createPaymentSession(merchant, body);

      expect(result.status).toBe("pending");
      expect(insert).toHaveBeenCalledTimes(2);
      // The same server-generated id is reused on retry (idempotent insert).
      expect(insert.mock.calls[0][0].id).toBe(insert.mock.calls[1][0].id);
    });

    it("surfaces a non-retryable insert error as 500 without retrying", async () => {
      const insert = vi
        .fn()
        .mockResolvedValue({ error: { message: "check violation", code: "23514" } });
      mockSupabaseFrom.mockReturnValue({ insert });

      await expect(paymentService.createPaymentSession(merchant, body)).rejects.toMatchObject({
        status: 500,
        code: "23514",
      });
      expect(insert).toHaveBeenCalledTimes(1);
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

  describe("getPaymentStatus cache scoping (issue #1311)", () => {
    beforeEach(() => {
      mockGetCachedPayment.mockResolvedValue(null);
      mockSetCachedPayment.mockResolvedValue(undefined);
      mockConnectRedisClient.mockResolvedValue({});
    });

    it("reads and writes the cache scoped to the merchantId this call was made with", async () => {
      const maybeSingle = vi.fn().mockResolvedValue({
        data: {
          id: "payment-1",
          amount: "10",
          asset: "XLM",
          asset_issuer: null,
          recipient: "GDEST",
          description: null,
          memo: null,
          memo_type: null,
          status: "confirmed",
          tx_id: "tx-1",
          metadata: {},
          created_at: new Date().toISOString(),
          merchants: { branding_config: null },
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

      await paymentService.getPaymentStatus("payment-1", "merchant-1");

      expect(mockGetCachedPayment).toHaveBeenCalledWith(
        expect.anything(),
        "payment-1",
        "merchant-1",
      );
      expect(mockSetCachedPayment).toHaveBeenCalledWith(
        expect.anything(),
        "payment-1",
        expect.objectContaining({ id: "payment-1" }),
        "merchant-1",
      );
    });

    it("passes undefined merchant scope through as null when called without one (public payment_link lookup)", async () => {
      const maybeSingle = vi.fn().mockResolvedValue({
        data: {
          id: "payment-1",
          amount: "10",
          asset: "XLM",
          asset_issuer: null,
          recipient: "GDEST",
          description: null,
          memo: null,
          memo_type: null,
          status: "confirmed",
          tx_id: "tx-1",
          metadata: {},
          created_at: new Date().toISOString(),
          merchants: { branding_config: null },
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

      await paymentService.getPaymentStatus("payment-1");

      expect(mockGetCachedPayment).toHaveBeenCalledWith(expect.anything(), "payment-1", null);
    });
  });

  describe("verifyPayment concurrent confirmation (issue #1310)", () => {
    const basePayment = {
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
    };

    function mockSupabaseForVerify({ updatedRows }) {
      const maybeSingle = vi.fn().mockResolvedValue({ data: basePayment, error: null });
      const updateSelect = vi.fn().mockResolvedValue({ data: updatedRows, error: null });
      const updateEqStatus = vi.fn(() => ({ select: updateSelect }));
      const updateEqId = vi.fn(() => ({ eq: updateEqStatus }));
      const update = vi.fn(() => ({ eq: updateEqId }));

      mockSupabaseFrom.mockReturnValue({
        select: vi.fn(() => ({
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          maybeSingle,
        })),
        update,
      });

      return { update, updateEqId, updateEqStatus, updateSelect };
    }

    beforeEach(() => {
      mockFindMatchingPayment.mockResolvedValue({ transaction_hash: "tx-1" });
      mockVerifyTransactionSignature.mockResolvedValue({ valid: true });
      mockConnectRedisClient.mockResolvedValue({});
      mockInvalidatePaymentCache.mockResolvedValue(undefined);
      mockGetPayloadForVersion.mockReturnValue({ event: "payment.confirmed" });
      mockSendWebhook.mockResolvedValue({ delivered: true });
    });

    it("filters the confirming UPDATE on the status it read, so only one racing call wins", async () => {
      const { updateEqId, updateEqStatus } = mockSupabaseForVerify({
        updatedRows: [{ id: "payment-1" }],
      });

      await paymentService.verifyPayment("payment-1");

      expect(updateEqId).toHaveBeenCalledWith("id", "payment-1");
      expect(updateEqStatus).toHaveBeenCalledWith("status", "pending");
    });

    it("fires webhooks/metrics when this call's UPDATE actually matched a row", async () => {
      mockSupabaseForVerify({ updatedRows: [{ id: "payment-1" }] });

      const result = await paymentService.verifyPayment("payment-1");

      expect(result.status).toBe("confirmed");
      expect(mockSendWebhook).toHaveBeenCalledTimes(1);
      expect(mockInvalidatePaymentCache).toHaveBeenCalledTimes(1);
    });

    it("does not re-fire webhooks/emails when a concurrent call already confirmed the payment", async () => {
      // The UPDATE ... WHERE status = 'pending' matched zero rows: another
      // concurrent verifyPayment() call for the same payment won the race
      // and already flipped the status.
      mockSupabaseForVerify({ updatedRows: [] });

      const result = await paymentService.verifyPayment("payment-1");

      expect(result).toEqual({
        status: "confirmed",
        tx_id: "tx-1",
        ledger_url: "https://stellar.expert/explorer/testnet/tx/tx-1",
      });
      expect(mockSendWebhook).not.toHaveBeenCalled();
      expect(mockInvalidatePaymentCache).not.toHaveBeenCalled();
    });
  });

  describe("confirmRefundTx verification (issue #1309)", () => {
    function mockSupabaseForConfirm(payment) {
      const maybeSingle = vi.fn().mockResolvedValue({ data: payment, error: null });
      const update = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }));

      mockSupabaseFrom.mockReturnValue({
        select: vi.fn(() => ({
          eq: vi.fn().mockReturnThis(),
          maybeSingle,
        })),
        update,
      });

      return { update };
    }

    const validHash =
      "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";

    it("rejects a malformed transaction hash before touching the database write", async () => {
      mockSupabaseForConfirm({
        id: "payment-1",
        metadata: { refund_tx_hash_expected: validHash },
      });

      await expect(
        paymentService.confirmRefundTx("payment-1", "merchant-1", "not-a-hash"),
      ).rejects.toMatchObject({ status: 400, message: "Invalid transaction hash" });
    });

    it("rejects when no refund was ever generated for this payment", async () => {
      mockSupabaseForConfirm({ id: "payment-1", metadata: {} });

      await expect(
        paymentService.confirmRefundTx("payment-1", "merchant-1", validHash),
      ).rejects.toMatchObject({ status: 400 });
      expect(mockHorizonTransaction).not.toHaveBeenCalled();
    });

    it("rejects a tx_hash that does not match the generated refund transaction", async () => {
      mockSupabaseForConfirm({
        id: "payment-1",
        metadata: { refund_tx_hash_expected: validHash },
      });
      const wrongHash = "f".repeat(64);

      await expect(
        paymentService.confirmRefundTx("payment-1", "merchant-1", wrongHash),
      ).rejects.toMatchObject({
        status: 400,
        message: expect.stringContaining("does not match"),
      });
      expect(mockHorizonTransaction).not.toHaveBeenCalled();
    });

    it("rejects when the matching transaction cannot be found on Stellar", async () => {
      mockSupabaseForConfirm({
        id: "payment-1",
        metadata: { refund_tx_hash_expected: validHash },
      });
      mockHorizonTransaction.mockRejectedValue(new Error("404 Not Found"));

      await expect(
        paymentService.confirmRefundTx("payment-1", "merchant-1", validHash),
      ).rejects.toMatchObject({ status: 400 });
    });

    it("rejects when the transaction exists but failed on-chain", async () => {
      mockSupabaseForConfirm({
        id: "payment-1",
        metadata: { refund_tx_hash_expected: validHash },
      });
      mockHorizonTransaction.mockResolvedValue({ successful: false });

      await expect(
        paymentService.confirmRefundTx("payment-1", "merchant-1", validHash),
      ).rejects.toMatchObject({
        status: 400,
        message: "Refund transaction failed on the Stellar network",
      });
    });

    it("confirms the refund once the hash matches and the transaction succeeded on-chain", async () => {
      const { update } = mockSupabaseForConfirm({
        id: "payment-1",
        metadata: { refund_tx_hash_expected: validHash, refund_status: "pending" },
      });
      mockHorizonTransaction.mockResolvedValue({ successful: true });

      const result = await paymentService.confirmRefundTx("payment-1", "merchant-1", validHash);

      expect(result).toEqual({ message: "Refund confirmed successfully" });
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            refund_status: "refunded",
            refund_tx_hash: validHash,
          }),
        }),
      );
    });

    it("accepts the hash comparison case-insensitively", async () => {
      mockSupabaseForConfirm({
        id: "payment-1",
        metadata: { refund_tx_hash_expected: validHash.toUpperCase() },
      });
      mockHorizonTransaction.mockResolvedValue({ successful: true });

      await expect(
        paymentService.confirmRefundTx("payment-1", "merchant-1", validHash),
      ).resolves.toEqual({ message: "Refund confirmed successfully" });
    });
  });
});
