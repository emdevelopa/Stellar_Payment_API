/**
 * Tests for the enhanced Ledger Monitor (horizon-poller.js)
 * Issue #627 — Enhance error recovery for Ledger Monitor
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const {
  mockFindMatchingPayment,
  mockFindAnyRecentPayment,
  mockVerifyTransactionSignature,
  mockSupabaseFrom,
  mockStreamManagerNotify,
  mockInvalidatePaymentCache,
  mockConnectRedisClient,
  mockSendWebhook,
  mockIsEventSubscribed,
  mockSendReceiptEmail,
  mockRenderReceiptEmail,
  mockGetPayloadForVersion,
  mockPaymentConfirmedCounter,
  mockPaymentConfirmationLatency,
} = vi.hoisted(() => ({
  mockFindMatchingPayment: vi.fn(),
  mockFindAnyRecentPayment: vi.fn(),
  mockVerifyTransactionSignature: vi.fn(),
  mockSupabaseFrom: vi.fn(),
  mockStreamManagerNotify: vi.fn(),
  mockInvalidatePaymentCache: vi.fn(),
  mockConnectRedisClient: vi.fn(),
  mockSendWebhook: vi.fn(),
  mockIsEventSubscribed: vi.fn(),
  mockSendReceiptEmail: vi.fn(),
  mockRenderReceiptEmail: vi.fn(),
  mockGetPayloadForVersion: vi.fn(),
  mockPaymentConfirmedCounter: { inc: vi.fn() },
  mockPaymentConfirmationLatency: { observe: vi.fn() },
}));

vi.mock("./stellar.js", () => ({
  findMatchingPayment: mockFindMatchingPayment,
  findAnyRecentPayment: mockFindAnyRecentPayment,
  verifyTransactionSignature: mockVerifyTransactionSignature,
}));

vi.mock("./supabase.js", () => ({
  supabase: {
    from: mockSupabaseFrom,
  },
}));

vi.mock("./stream-manager.js", () => ({
  streamManager: { notify: mockStreamManagerNotify },
}));

vi.mock("./redis.js", () => ({
  connectRedisClient: mockConnectRedisClient,
  invalidatePaymentCache: mockInvalidatePaymentCache,
}));

vi.mock("./webhooks.js", () => ({
  sendWebhook: mockSendWebhook,
  isEventSubscribed: mockIsEventSubscribed,
}));

vi.mock("./email.js", () => ({
  sendReceiptEmail: mockSendReceiptEmail,
}));

vi.mock("./email-templates.js", () => ({
  renderReceiptEmail: mockRenderReceiptEmail,
}));

vi.mock("../webhooks/resolver.js", () => ({
  getPayloadForVersion: mockGetPayloadForVersion,
}));

vi.mock("./metrics.js", () => ({
  paymentConfirmedCounter: mockPaymentConfirmedCounter,
  paymentConfirmationLatency: mockPaymentConfirmationLatency,
}));

vi.mock("./logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import {
  startHorizonPoller,
  stopHorizonPoller,
  getPollerHealth,
  resetPollerState,
  pollOnce,
} from "./horizon-poller.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a minimal pending payment fixture. */
function makePayment(overrides = {}) {
  return {
    id: "pay-001",
    amount: "10.0000000",
    asset: "XLM",
    asset_issuer: null,
    recipient: "GABC",
    memo: null,
    memo_type: null,
    webhook_url: "https://example.com/webhook",
    created_at: new Date(Date.now() - 5_000).toISOString(),
    merchant_id: "merchant-001",
    metadata: {},
    ...overrides,
  };
}

function makeMerchant(overrides = {}) {
  return {
    webhook_secret: "secret",
    webhook_version: "v1",
    notification_email: "merchant@example.com",
    email: "merchant@example.com",
    business_name: "Test Merchant",
    webhook_custom_headers: {},
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Ledger Monitor — error recovery (Issue #627)", () => {
  beforeEach(() => {
    resetPollerState();

    // Default: redis no-op
    mockConnectRedisClient.mockResolvedValue({ isOpen: false });
    mockInvalidatePaymentCache.mockResolvedValue(undefined);

    // Default: webhook helpers
    mockSendWebhook.mockResolvedValue(undefined);
    mockIsEventSubscribed.mockReturnValue(true);
    mockSendReceiptEmail.mockResolvedValue(undefined);
    mockRenderReceiptEmail.mockReturnValue("<html>receipt</html>");
    mockGetPayloadForVersion.mockReturnValue({ event: "payment.confirmed" });
  });

  afterEach(() => {
    stopHorizonPoller();
    vi.clearAllMocks();
  });

  // ── getPollerHealth ─────────────────────────────────────────────────────────

  describe("getPollerHealth()", () => {
    it("returns healthy state on startup", () => {
      const health = getPollerHealth();
      expect(health.consecutiveFailures).toBe(0);
      expect(health.circuitBreakerOpen).toBe(false);
      expect(health.backoffIndex).toBe(0);
    });
  });

  // ── resetPollerState ────────────────────────────────────────────────────────

  describe("resetPollerState()", () => {
    it("resets all error-recovery counters", () => {
      resetPollerState();
      const health = getPollerHealth();
      expect(health.consecutiveFailures).toBe(0);
      expect(health.circuitBreakerOpen).toBe(false);
    });
  });

  // ── Successful payment confirmation ─────────────────────────────────────────

  describe("successful payment confirmation", () => {
    it("confirms a matching payment and emits events", async () => {
      const payment = makePayment();

      // The poller makes 3 calls to supabase.from("payments"):
      //   1. Fetch pending payments (select + order + limit)
      //   2. Duplicate-tx guard (select + neq + maybeSingle → null)
      //   3. Atomic update (update + maybeSingle → { id })
      //   4. Merchant notification config lookup
      let fromCallCount = 0;
      mockSupabaseFrom.mockImplementation(() => {
        fromCallCount += 1;
        if (fromCallCount === 1) {
          // Fetch pending payments
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [payment], error: null }),
          };
        }
        if (fromCallCount === 2) {
          // Duplicate-tx guard — no conflict
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            neq: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        }
        if (fromCallCount === 3) {
          // Atomic update — success
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnThis(),
              is: vi.fn().mockReturnThis(),
              select: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({ data: { id: payment.id }, error: null }),
            }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: makeMerchant(), error: null }),
        };
      });

      mockFindMatchingPayment.mockResolvedValue({
        id: "op-1",
        transaction_hash: "tx-abc",
        received_amount: "10.0000000",
      });
      mockVerifyTransactionSignature.mockResolvedValue({
        valid: true,
        reason: "ok",
        isMultiSig: false,
        signatureCount: 1,
        thresholdMet: true,
      });

      await pollOnce();

      expect(mockFindMatchingPayment).toHaveBeenCalledWith(
        expect.objectContaining({ recipient: "GABC", amount: "10.0000000" })
      );
      expect(mockVerifyTransactionSignature).toHaveBeenCalledWith("tx-abc");
      expect(mockStreamManagerNotify).toHaveBeenCalledWith(
        payment.id,
        "payment.confirmed",
        expect.objectContaining({ status: "confirmed", tx_id: "tx-abc" })
      );
    });
  });

  // ── Signature verification failure ──────────────────────────────────────────

  describe("signature verification failure", () => {
    it("skips payment when signature verification fails", async () => {
      const payment = makePayment();

      mockSupabaseFrom.mockImplementation(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [payment], error: null }),
      }));

      mockFindMatchingPayment.mockResolvedValue({
        id: "op-1",
        transaction_hash: "tx-bad",
        received_amount: "10.0000000",
      });
      mockVerifyTransactionSignature.mockResolvedValue({
        valid: false,
        reason: "Insufficient signing weight: accumulated 0, required 1",
        isMultiSig: false,
        signatureCount: 0,
        thresholdMet: false,
      });

      await pollOnce();

      // Payment should NOT be confirmed
      expect(mockStreamManagerNotify).not.toHaveBeenCalled();
      expect(mockPaymentConfirmedCounter.inc).not.toHaveBeenCalled();
    });

    it("skips payment when verifyTransactionSignature throws unexpectedly", async () => {
      const payment = makePayment();

      mockSupabaseFrom.mockImplementation(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [payment], error: null }),
      }));

      mockFindMatchingPayment.mockResolvedValue({
        id: "op-1",
        transaction_hash: "tx-err",
        received_amount: "10.0000000",
      });
      mockVerifyTransactionSignature.mockRejectedValue(new Error("unexpected verifier crash"));

      await pollOnce();

      expect(mockStreamManagerNotify).not.toHaveBeenCalled();
    });
  });

  // ── Horizon lookup errors ────────────────────────────────────────────────────

  describe("Horizon lookup errors", () => {
    it("skips payment gracefully when findMatchingPayment throws", async () => {
      const payment = makePayment();

      mockSupabaseFrom.mockImplementation(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [payment], error: null }),
      }));

      mockFindMatchingPayment.mockRejectedValue(new Error("Horizon rate limit exceeded"));

      await pollOnce();

      // Should not crash — other payments in the cycle continue
      expect(mockStreamManagerNotify).not.toHaveBeenCalled();
    });

    it("skips wrong-amount check gracefully when findAnyRecentPayment throws", async () => {
      const payment = makePayment();

      mockSupabaseFrom.mockImplementation(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [payment], error: null }),
      }));

      mockFindMatchingPayment.mockResolvedValue(null); // no exact match
      mockFindAnyRecentPayment.mockRejectedValue(new Error("Horizon 503"));

      await pollOnce();

      expect(mockStreamManagerNotify).not.toHaveBeenCalled();
    });
  });

  // ── DB fetch failure & back-off ──────────────────────────────────────────────

  describe("DB fetch failure and back-off", () => {
    it("increments consecutiveFailures on DB error", async () => {
      vi.useFakeTimers();

      mockSupabaseFrom.mockImplementation(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: null, error: { message: "DB down" } }),
      }));

      // pollOnce will call sleep() internally — advance timers to unblock it
      const pollPromise = pollOnce();
      await vi.runAllTimersAsync();
      await pollPromise;

      vi.useRealTimers();

      const health = getPollerHealth();
      expect(health.consecutiveFailures).toBeGreaterThan(0);
    });

    it("resets consecutiveFailures after a successful DB fetch", async () => {
      vi.useFakeTimers();

      let callCount = 0;
      mockSupabaseFrom.mockImplementation(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockImplementation(() => {
          callCount += 1;
          if (callCount === 1) {
            return Promise.resolve({ data: null, error: { message: "transient" } });
          }
          return Promise.resolve({ data: [], error: null });
        }),
      }));

      // First cycle — fails
      const poll1 = pollOnce();
      await vi.runAllTimersAsync();
      await poll1;

      expect(getPollerHealth().consecutiveFailures).toBe(1);

      vi.useRealTimers();

      // Second cycle — succeeds, resets counter
      await pollOnce();

      expect(getPollerHealth().consecutiveFailures).toBe(0);
    });
  });

  // ── Underpayment handling ────────────────────────────────────────────────────

  describe("underpayment handling", () => {
    it("marks payment as failed on underpayment", async () => {
      const payment = makePayment({ amount: "10.0000000" });

      const updateMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      });

      mockSupabaseFrom.mockImplementation(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [payment], error: null }),
        update: updateMock,
      }));

      mockFindMatchingPayment.mockResolvedValue(null);
      mockFindAnyRecentPayment.mockResolvedValue({
        transaction_hash: "tx-under",
        received_amount: "5.0000000", // underpayment
      });

      await pollOnce();

      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "failed",
          tx_id: "tx-under",
        })
      );
      expect(mockStreamManagerNotify).toHaveBeenCalledWith(
        payment.id,
        "payment.failed",
        expect.objectContaining({ reason: "underpayment" })
      );
    });
  });

  // ── Overpayment handling ─────────────────────────────────────────────────────

  describe("overpayment handling", () => {
    it("confirms payment with overpayment flag", async () => {
      const payment = makePayment({ amount: "10.0000000" });

      const updateMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: payment.id }, error: null }),
      });

      mockSupabaseFrom.mockImplementation(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [payment], error: null }),
        update: updateMock,
      }));

      mockFindMatchingPayment.mockResolvedValue(null);
      mockFindAnyRecentPayment.mockResolvedValue({
        transaction_hash: "tx-over",
        received_amount: "15.0000000", // overpayment
      });

      await pollOnce();

      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "confirmed",
          tx_id: "tx-over",
        })
      );
      expect(mockStreamManagerNotify).toHaveBeenCalledWith(
        payment.id,
        "payment.confirmed",
        expect.objectContaining({ overpayment: true })
      );
    });
  });

  // ── Missing fields guard ─────────────────────────────────────────────────────

  describe("missing fields guard", () => {
    it("skips payment with missing asset", async () => {
      const payment = makePayment({ asset: null });

      mockSupabaseFrom.mockImplementation(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [payment], error: null }),
      }));

      await pollOnce();

      expect(mockFindMatchingPayment).not.toHaveBeenCalled();
    });

    it("skips payment with missing recipient", async () => {
      const payment = makePayment({ recipient: null });

      mockSupabaseFrom.mockImplementation(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [payment], error: null }),
      }));

      await pollOnce();

      expect(mockFindMatchingPayment).not.toHaveBeenCalled();
    });
  });

  // ── Duplicate tx_id guard ────────────────────────────────────────────────────

  describe("duplicate tx_id guard", () => {
    it("skips payment when tx_hash is already used by another payment", async () => {
      const payment = makePayment();

      mockSupabaseFrom.mockImplementation(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        neq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [payment], error: null }),
        // Duplicate check returns an existing payment
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: "other-pay" }, error: null }),
        update: vi.fn().mockReturnThis(),
      }));

      mockFindMatchingPayment.mockResolvedValue({
        id: "op-1",
        transaction_hash: "tx-dup",
        received_amount: "10.0000000",
      });
      mockVerifyTransactionSignature.mockResolvedValue({
        valid: true,
        reason: "ok",
        isMultiSig: false,
        signatureCount: 1,
        thresholdMet: true,
      });

      await pollOnce();

      expect(mockPaymentConfirmedCounter.inc).not.toHaveBeenCalled();
    });
  });

  // ── Empty pending list ───────────────────────────────────────────────────────

  describe("empty pending list", () => {
    it("does nothing when there are no pending payments", async () => {
      mockSupabaseFrom.mockImplementation(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      }));

  describe("merchant notification lookup", () => {
    it("continues confirmation when merchant notification config lookup fails", async () => {
      const payment = makePayment();

      let fromCallCount = 0;
      mockSupabaseFrom.mockImplementation(() => {
        fromCallCount += 1;
        if (fromCallCount === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [payment], error: null }),
          };
        }
        if (fromCallCount === 2) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            neq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        }
        if (fromCallCount === 3) {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnThis(),
              is: vi.fn().mockReturnThis(),
              select: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({ data: { id: payment.id }, error: null }),
            }),
          };
        }

        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: "merchant lookup failed" } }),
        };
      });

      mockFindMatchingPayment.mockResolvedValue({
        id: "op-1",
        transaction_hash: "tx-abc",
        received_amount: "10.0000000",
      });
      mockVerifyTransactionSignature.mockResolvedValue({
        valid: true,
        reason: "ok",
        isMultiSig: false,
        signatureCount: 1,
        thresholdMet: true,
      });

      await pollOnce();

      expect(mockPaymentConfirmedCounter.inc).toHaveBeenCalledWith({ asset: payment.asset });
      expect(mockSendWebhook).not.toHaveBeenCalled();
    });
  });

      await pollOnce();

      expect(mockFindMatchingPayment).not.toHaveBeenCalled();
    });
  });
});
