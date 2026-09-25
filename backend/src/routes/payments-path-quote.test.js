import { beforeEach, describe, expect, it, vi } from "vitest";
import createPaymentsRouter from "./payments.js";

const { findStrictReceivePaths, supabaseFrom } = vi.hoisted(() => ({
  findStrictReceivePaths: vi.fn(),
  supabaseFrom: vi.fn(),
}));

vi.mock("../lib/stellar.js", () => ({
    findStrictReceivePaths,
    findMatchingPayment: vi.fn(),
    findAnyRecentPayment: vi.fn(),
    createRefundTransaction: vi.fn(),
    getNetworkFeeStats: vi.fn(),
    isValidStellarPublicKey: vi.fn(() => true),
    validateMemo: vi.fn(() => ({ valid: true })),
    verifyTransactionSignature: vi.fn(),
}));

vi.mock("../lib/supabase.js", () => ({
  supabase: {
    from: supabaseFrom,
  },
}));

vi.mock("../lib/redis.js", () => ({
  connectRedisClient: vi.fn(() => Promise.resolve({})),
  getCachedPayment: vi.fn(),
  setCachedPayment: vi.fn(),
  invalidatePaymentCache: vi.fn(),
}));

function createSupabaseSelectMock(payment) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    is: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => ({ data: payment, error: null })),
  };

  return chain;
}

function getPathPaymentQuoteHandler() {
  const router = createPaymentsRouter();
  const layer = router.stack.find(
    (entry) => entry.route?.path === "/path-payment-quote/:id",
  );

  return layer.route.stack.at(-1).handle;
}

function createMockResponse() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

describe("GET /api/path-payment-quote/:id", () => {
  const paymentId = "9f927a2c-02d4-4f76-914c-62cf44d9525e";
  const sourceAccount =
    "GBRPYHIL2C7Q7PGLUKSTPIY2KPJ7QMZ4ZWJHQ6GUSIW2LQAHOMK5N7BI";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an XLM quote for a USDC invoice", async () => {
    supabaseFrom.mockReturnValue(
      createSupabaseSelectMock({
        id: paymentId,
        amount: 25,
        asset: "USDC",
        asset_issuer: "GDQOE23W4QK6WQ4R3BVCUO3PRA4VJ7A3M7MRWWX4V67WJYQ7QXKJQ4KJ",
        recipient: "GB6REFUNDTESTRECIPIENTQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ",
        status: "pending",
      }),
    );

    findStrictReceivePaths.mockResolvedValue({
      source_amount: "60.1250000",
      source_asset_code: "XLM",
      source_asset_issuer: null,
      destination_amount: "25",
      path: [],
    });

    const handler = getPathPaymentQuoteHandler();
    const res = createMockResponse();

    await handler(
      {
        params: { id: paymentId },
        query: {
          source_asset: "XLM",
          source_account: sourceAccount,
        },
        merchant: { id: "merchant-1" },
      },
      res,
      vi.fn(),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      source_asset: "XLM",
      source_amount: "60.1250000",
      send_max: "60.7262500",
      destination_asset: "USDC",
      destination_asset_issuer: "GDQOE23W4QK6WQ4R3BVCUO3PRA4VJ7A3M7MRWWX4V67WJYQ7QXKJQ4KJ",
      destination_amount: "25",
      path: [],
      slippage: 0.01,
    });
    expect(findStrictReceivePaths).toHaveBeenCalledWith({
      sourceAccount,
      destAssetCode: "USDC",
      destAssetIssuer: "GDQOE23W4QK6WQ4R3BVCUO3PRA4VJ7A3M7MRWWX4V67WJYQ7QXKJQ4KJ",
      destAmount: "25",
      sourceAssetCode: "XLM",
      sourceAssetIssuer: null,
    });
  });

  it("rejects a quote request when the source asset already matches the invoice asset", async () => {
    supabaseFrom.mockReturnValue(
      createSupabaseSelectMock({
        id: paymentId,
        amount: 10,
        asset: "XLM",
        asset_issuer: null,
        recipient: "GB6REFUNDTESTRECIPIENTQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ",
        status: "pending",
      }),
    );

    const handler = getPathPaymentQuoteHandler();
    const res = createMockResponse();

    await handler(
      {
        params: { id: paymentId },
        query: {
          source_asset: "XLM",
          source_account: sourceAccount,
        },
        merchant: { id: "merchant-1" },
      },
      res,
      vi.fn(),
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain("Use a direct payment");
    expect(findStrictReceivePaths).not.toHaveBeenCalled();
  });

  it("rejects quote requests for payments that are no longer pending", async () => {
    supabaseFrom.mockReturnValue(
      createSupabaseSelectMock({
        id: paymentId,
        amount: 10,
        asset: "USDC",
        asset_issuer: "GDQOE23W4QK6WQ4R3BVCUO3PRA4VJ7A3M7MRWWX4V67WJYQ7QXKJQ4KJ",
        recipient: "GB6REFUNDTESTRECIPIENTQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ",
        status: "confirmed",
      }),
    );

    const handler = getPathPaymentQuoteHandler();
    const res = createMockResponse();

    await handler(
      {
        params: { id: paymentId },
        query: {
          source_asset: "XLM",
          source_account: sourceAccount,
        },
        merchant: { id: "merchant-1" },
      },
      res,
      vi.fn(),
    );

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({
      error: "Path payment quote is only available for pending payments",
      status: "confirmed",
    });
    expect(findStrictReceivePaths).not.toHaveBeenCalled();
  });
});
