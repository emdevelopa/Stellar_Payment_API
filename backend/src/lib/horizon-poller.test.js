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
  mockLedgerMonitorCycleDuration,
  mockLedgerMonitorPaymentsChecked,
  mockLedgerMonitorCircuitBreakerTrips,
  mockLedgerMonitorBatchSize,
  mockLedgerMonitorRateLimiterWaitSeconds,
  mockRateLimitRequestsTotal,
  mockRateLimitExceededTotal,
  mockLogger,
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
  mockLedgerMonitorCycleDuration: { observe: vi.fn() },
  mockLedgerMonitorPaymentsChecked: { inc: vi.fn() },
  mockLedgerMonitorCircuitBreakerTrips: { inc: vi.fn() },
  mockLedgerMonitorBatchSize: { set: vi.fn() },
  mockLedgerMonitorRateLimiterWaitSeconds: { observe: vi.fn() },
  mockRateLimitRequestsTotal: { inc: vi.fn() },
  mockRateLimitExceededTotal: { inc: vi.fn() },
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
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
  ledgerMonitorCycleDuration: mockLedgerMonitorCycleDuration,
  ledgerMonitorPaymentsChecked: mockLedgerMonitorPaymentsChecked,
  ledgerMonitorCircuitBreakerTrips: mockLedgerMonitorCircuitBreakerTrips,
  ledgerMonitorBatchSize: mockLedgerMonitorBatchSize,
  ledgerMonitorRateLimiterWaitSeconds: mockLedgerMonitorRateLimiterWaitSeconds,
  rateLimitRequestsTotal: mockRateLimitRequestsTotal,
  rateLimitExceededTotal: mockRateLimitExceededTotal,
}));

vi.mock("./logger.js", () => ({
  logger: mockLogger,
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import {
  startHorizonPoller,
  stopHorizonPoller,
  getPollerHealth,
  resetPollerState,
  pollOnce,
  createLedgerMonitorRateLimiter,
  setLedgerMonitorRateLimiterForTest,
} from "./horizon-poller.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

// Valid Stellar public keys (pass ledger-monitor-security validatePaymentRecord).
const VALID_RECIPIENT_A = "GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI";
const VALID_RECIPIENT_B = "GCEZWKCA5VLDNRLN3RPRJMR3PXJHUWB2TVXVDZQEQ3GTKEX2OQ2BYE4Z";

// Valid 64-char hex transaction hashes (pass isValidTransactionHash).
const VALID_TX_HASH = "a".repeat(64);
const VALID_TX_HASH_B = "b".repeat(64);

/** Build a minimal pending payment fixture. */
function makePayment(overrides = {}) {
  return {
    id: "pay-001",
    amount: "10.0000000",
    asset: "XLM",
    asset_issuer: null,
    recipient: "GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI",
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
    mockVerifyTransactionSignature.mockResolvedValue({
      valid: true,
      reason: "ok",
      isMultiSig: false,
      signatureCount: 1,
      thresholdMet: true,
    });
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

    it("exposes Horizon rate-limit observability (Issue #907)", () => {
      const health = getPollerHealth();
      expect(health.horizonRequestsPerSecond).toBeGreaterThan(0);
      expect(health.rateLimitedRequests).toBe(0);
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

      // Table-aware mock. The poller now batch-loads merchant configs via one
      // merchants `.in(...)` query, then per payment: dup-tx guard + atomic update.
      let paymentsCallCount = 0;
      mockSupabaseFrom.mockImplementation((table) => {
        if (table === "merchants") {
          // Batch merchant preload (single IN query).
          return {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({
              data: [{ id: payment.merchant_id, ...makeMerchant() }],
              error: null,
            }),
          };
        }
        paymentsCallCount += 1;
        if (paymentsCallCount === 1) {
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
        if (paymentsCallCount === 2) {
          // Duplicate-tx guard — no conflict
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            neq: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        }
        // Atomic update — success
        return {
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: payment.id }, error: null }),
          }),
        };
      });

      mockFindMatchingPayment.mockResolvedValue({
        id: "op-1",
        transaction_hash: VALID_TX_HASH,
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
        expect.objectContaining({ recipient: payment.recipient, amount: "10.0000000" })
      );
      expect(mockVerifyTransactionSignature).toHaveBeenCalledWith(VALID_TX_HASH);
      expect(mockStreamManagerNotify).toHaveBeenCalledWith(
        payment.id,
        "payment.confirmed",
        expect.objectContaining({ status: "confirmed", tx_id: VALID_TX_HASH })
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

      await pollOnce();

      expect(mockFindMatchingPayment).not.toHaveBeenCalled();
    });
  });

  describe("merchant notification lookup", () => {
    it("continues confirmation when merchant notification config lookup fails", async () => {
      const payment = makePayment();

      // Merchant lookups fail both in the batch preload (.in) and the
      // per-payment fallback (.eq + maybeSingle); confirmation must still proceed.
      let paymentsCallCount = 0;
      mockSupabaseFrom.mockImplementation((table) => {
        if (table === "merchants") {
          return {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({ data: null, error: { message: "merchant lookup failed" } }),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: "merchant lookup failed" } }),
          };
        }
        paymentsCallCount += 1;
        if (paymentsCallCount === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [payment], error: null }),
          };
        }
        if (paymentsCallCount === 2) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            neq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        }
        return {
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: payment.id }, error: null }),
          }),
        };
      });

      mockFindMatchingPayment.mockResolvedValue({
        id: "op-1",
        transaction_hash: VALID_TX_HASH,
        received_amount: "10.0000000",
      });

      await pollOnce();

      expect(mockPaymentConfirmedCounter.inc).toHaveBeenCalledWith({ asset: payment.asset });
      expect(mockSendWebhook).not.toHaveBeenCalled();
    });

    it("caches merchant notification config within one poll cycle", async () => {
      // Same recipient+asset → one group → processed sequentially, so the
      // shared merchant-config cache is exercised deterministically.
      const payments = [
        makePayment({ id: "pay-001", recipient: VALID_RECIPIENT_A, merchant_id: "merchant-001" }),
        makePayment({ id: "pay-002", recipient: VALID_RECIPIENT_A, merchant_id: "merchant-001" }),
      ];
      let paymentsCallCount = 0;
      mockSupabaseFrom.mockImplementation((table) => {
        if (table === "merchants") {
          // Single batched preload via .in(...) for the whole pending batch.
          return {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({
              data: [{ id: "merchant-001", ...makeMerchant() }],
              error: null,
            }),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: makeMerchant(), error: null }),
          };
        }

        paymentsCallCount += 1;
        if (paymentsCallCount === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: payments, error: null }),
          };
        }
        const isDuplicateCheck = paymentsCallCount === 2 || paymentsCallCount === 4;
        if (isDuplicateCheck) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            neq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        }
        return {
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: "updated" }, error: null }),
          }),
        };
      });

      mockFindMatchingPayment.mockImplementation(({ recipient }) =>
        Promise.resolve({
          id: `op-${recipient}`,
          transaction_hash: VALID_TX_HASH,
          received_amount: "10.0000000",
        })
      );

      await pollOnce();

      const merchantLookups = mockSupabaseFrom.mock.calls.filter(([table]) => table === "merchants");
      expect(merchantLookups).toHaveLength(1);
    });
  });

  describe("Ledger Monitor rate limiter", () => {
    it("delays Horizon calls after the burst is exhausted", async () => {
      let now = 0;
      const sleepFn = vi.fn(async (ms) => {
        now += ms;
      });
      const limiter = createLedgerMonitorRateLimiter({
        maxPerSecond: 2,
        burst: 1,
        now: () => now,
        sleepFn,
      });

      await limiter.waitForSlot();
      await limiter.waitForSlot();

      expect(sleepFn).toHaveBeenCalledWith(500);
    });

    it("emits rate-limit metrics and tracks throttled requests (Issue #907)", async () => {
      let now = 0;
      const sleepFn = vi.fn(async (ms) => {
        now += ms;
      });
      const limiter = createLedgerMonitorRateLimiter({
        maxPerSecond: 2,
        burst: 1,
        now: () => now,
        sleepFn,
      });

      await limiter.waitForSlot(); // uses the single burst token (allowed)
      await limiter.waitForSlot(); // no token → throttled

      // Every request is counted; only the throttled one trips "exceeded".
      expect(mockRateLimitRequestsTotal.inc).toHaveBeenCalledTimes(2);
      expect(mockRateLimitRequestsTotal.inc).toHaveBeenCalledWith({
        endpoint: "ledger_monitor",
        type: "horizon",
      });
      expect(mockRateLimitExceededTotal.inc).toHaveBeenCalledTimes(1);
      expect(mockRateLimitExceededTotal.inc).toHaveBeenCalledWith({
        endpoint: "ledger_monitor",
        type: "horizon",
      });
      expect(limiter.stats().rateLimitedRequests).toBe(1);

      limiter.reset();
      expect(limiter.stats().rateLimitedRequests).toBe(0);
    });

    it("does not count un-throttled requests as exceeded", async () => {
      const limiter = createLedgerMonitorRateLimiter({ maxPerSecond: 5, burst: 5 });
      await limiter.waitForSlot();
      await limiter.waitForSlot();

      expect(mockRateLimitExceededTotal.inc).not.toHaveBeenCalled();
      expect(limiter.stats().rateLimitedRequests).toBe(0);
    });
  });

  describe("wrong-amount signature verification", () => {
    it("does not mark an underpayment failed when transaction signature verification fails", async () => {
      const payment = makePayment({ amount: "10.0000000" });
      const updateMock = vi.fn();

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
        transaction_hash: "tx-under-bad-signature",
        received_amount: "5.0000000",
      });
      mockVerifyTransactionSignature.mockResolvedValue({
        valid: false,
        reason: "bad signature",
        isMultiSig: false,
        signatureCount: 0,
        thresholdMet: false,
      });

      await pollOnce();

      expect(updateMock).not.toHaveBeenCalled();
      expect(mockStreamManagerNotify).not.toHaveBeenCalled();
    });
  });

  describe("cycle result aggregation (Issue #910)", () => {
    it("logs a rejected payment group without aborting the cycle", async () => {
      const payment = makePayment();

      mockSupabaseFrom.mockImplementation(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [payment], error: null }),
      }));

      // Drive checkPayment into its own catch, then make the metric call in that
      // catch throw too — so the group promise rejects and the cycle's
      // Promise.allSettled accounting loop must handle it (this is the path the
      // old `results` ReferenceError silently broke).
      mockFindMatchingPayment.mockRejectedValue(new Error("horizon down"));
      // The horizon-error branch calls inc({result:"skipped"}) once; when that
      // throws, checkPayment's own outer catch runs and calls inc() a second
      // time (also throwing) — that second throw escapes checkPayment entirely,
      // rejecting the group promise. Two `mockImplementationOnce` calls (one per
      // inc() invocation in this path) instead of a persistent `mockImplementation`,
      // which would otherwise leak into every later test in this file —
      // vi.clearAllMocks() in afterEach clears call history but not implementations.
      mockLedgerMonitorPaymentsChecked.inc.mockImplementationOnce(() => {
        throw new Error("metrics backend unavailable");
      });
      mockLedgerMonitorPaymentsChecked.inc.mockImplementationOnce(() => {
        throw new Error("metrics backend unavailable");
      });

      // Must resolve (not reject): allSettled isolates the rejected group.
      await expect(pollOnce()).resolves.toBeUndefined();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        "Horizon poller: payment group processing failed",
      );
      // The old ReferenceError surfaced via the outer catch with this message;
      // it must NOT happen anymore.
      expect(mockLogger.warn).not.toHaveBeenCalledWith(
        expect.anything(),
        "Horizon poller: unexpected error in poll cycle",
      );
    });
  });

  describe("SQL query optimization — batch merchant preload", () => {
    it("loads all merchant configs in a single IN query (no N+1 per-payment lookups)", async () => {
      // Two distinct merchants across the batch.
      const payments = [
        makePayment({ id: "pay-1", recipient: VALID_RECIPIENT_A, merchant_id: "merchant-001" }),
        makePayment({ id: "pay-2", recipient: VALID_RECIPIENT_B, merchant_id: "merchant-002" }),
      ];

      const inMock = vi.fn().mockResolvedValue({
        data: [
          { id: "merchant-001", ...makeMerchant() },
          { id: "merchant-002", ...makeMerchant() },
        ],
        error: null,
      });
      const merchantEqMock = vi.fn().mockReturnThis();

      mockSupabaseFrom.mockImplementation((table) => {
        if (table === "merchants") {
          return {
            select: vi.fn().mockReturnThis(),
            in: inMock,
            // Per-payment fallback path — must NOT be used when preload succeeds.
            eq: merchantEqMock,
            maybeSingle: vi.fn().mockResolvedValue({ data: makeMerchant(), error: null }),
          };
        }
        // payments: fetch, then per-payment dup guard + update (table-agnostic shape).
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          neq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data: payments, error: null }),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: "updated" }, error: null }),
          }),
        };
      });

      mockFindMatchingPayment.mockResolvedValue({
        id: "op-x",
        transaction_hash: VALID_TX_HASH,
        received_amount: "10.0000000",
      });

      await pollOnce();

      // Exactly one batched merchants query for the whole batch...
      const merchantTableCalls = mockSupabaseFrom.mock.calls.filter(
        ([table]) => table === "merchants",
      );
      expect(merchantTableCalls).toHaveLength(1);
      // ...containing both distinct merchant ids...
      expect(inMock).toHaveBeenCalledTimes(1);
      expect(inMock).toHaveBeenCalledWith(
        "id",
        expect.arrayContaining(["merchant-001", "merchant-002"]),
      );
      // ...and no per-payment merchant fallback lookups.
      expect(merchantEqMock).not.toHaveBeenCalled();
    });
  });

  // ── Granular metrics (Issue #1128) ──────────────────────────────────────────

  describe("granular metrics", () => {
    it("records the fetched batch size as a gauge each cycle", async () => {
      const payments = [
        makePayment({ id: "pay-1", recipient: VALID_RECIPIENT_A }),
        makePayment({ id: "pay-2", recipient: VALID_RECIPIENT_B }),
      ];

      mockSupabaseFrom.mockImplementation((table) => {
        if (table === "merchants") {
          return { select: vi.fn().mockReturnThis(), in: vi.fn().mockResolvedValue({ data: [], error: null }) };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          neq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data: payments, error: null }),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: "updated" }, error: null }),
          }),
        };
      });
      mockFindMatchingPayment.mockResolvedValue(null);
      mockFindAnyRecentPayment.mockResolvedValue(null);

      await pollOnce();

      expect(mockLedgerMonitorBatchSize.set).toHaveBeenCalledWith(2);
    });

    it("records rate-limiter wait time when Horizon calls are throttled", async () => {
      const limiter = createLedgerMonitorRateLimiter({ maxPerSecond: 1, burst: 1 });
      await limiter.waitForSlot(); // consumes the only token
      await limiter.waitForSlot(); // must throttle and wait

      expect(mockLedgerMonitorRateLimiterWaitSeconds.observe).toHaveBeenCalledWith(
        expect.any(Number),
      );
    });
  });

  // ── End-to-end mixed-batch poll cycle (Issue #1126) ─────────────────────────

  describe("end-to-end: mixed-outcome batch in a single poll cycle", () => {
    it("confirms one payment and fails another in the same cycle, isolated per group", async () => {
      const confirmedPayment = makePayment({
        id: "pay-confirmed",
        recipient: VALID_RECIPIENT_A,
        merchant_id: "merchant-001",
        amount: "10.0000000",
      });
      const underpaidPayment = makePayment({
        id: "pay-underpaid",
        recipient: VALID_RECIPIENT_B,
        merchant_id: "merchant-002",
        amount: "10.0000000",
      });
      const payments = [confirmedPayment, underpaidPayment];

      mockSupabaseFrom.mockImplementation((table) => {
        if (table === "merchants") {
          return {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({
              data: [
                { id: "merchant-001", ...makeMerchant() },
                { id: "merchant-002", ...makeMerchant() },
              ],
              error: null,
            }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          neq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data: payments, error: null }),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: "updated" }, error: null }),
          }),
        };
      });

      mockFindMatchingPayment.mockImplementation(({ recipient }) =>
        recipient === VALID_RECIPIENT_A
          ? Promise.resolve({
              id: "op-1",
              transaction_hash: VALID_TX_HASH,
              received_amount: "10.0000000",
            })
          : Promise.resolve(null),
      );
      mockFindAnyRecentPayment.mockImplementation(({ recipient }) =>
        recipient === VALID_RECIPIENT_B
          ? Promise.resolve({ transaction_hash: "tx-under", received_amount: "5.0000000" })
          : Promise.resolve(null),
      );

      await pollOnce();

      // Confirmed group: SSE + merchant socket + counters all fire correctly.
      expect(mockStreamManagerNotify).toHaveBeenCalledWith(
        confirmedPayment.id,
        "payment.confirmed",
        expect.objectContaining({ status: "confirmed", tx_id: VALID_TX_HASH }),
      );
      // Failed group: isolated from the confirmed group, notified independently.
      expect(mockStreamManagerNotify).toHaveBeenCalledWith(
        underpaidPayment.id,
        "payment.failed",
        expect.objectContaining({ reason: "underpayment" }),
      );
      expect(mockLedgerMonitorPaymentsChecked.inc).toHaveBeenCalledWith({ result: "confirmed" });
      expect(mockLedgerMonitorPaymentsChecked.inc).toHaveBeenCalledWith({ result: "failed" });
      expect(mockLedgerMonitorBatchSize.set).toHaveBeenCalledWith(2);
      expect(mockLedgerMonitorCycleDuration.observe).toHaveBeenCalled();
    });
  });

  // ── Load test (Issue #1129) ─────────────────────────────────────────────────

  describe("load: high-volume poll cycle", () => {
    it("processes a large batch of independent payments within one cycle without cross-group interference", async () => {
      const BATCH = 50; // matches production BATCH_SIZE
      const payments = Array.from({ length: BATCH }, (_, i) =>
        makePayment({
          id: `pay-${i}`,
          recipient: i % 2 === 0 ? VALID_RECIPIENT_A : VALID_RECIPIENT_B,
          merchant_id: `merchant-${i % 2}`,
        }),
      );

      mockSupabaseFrom.mockImplementation((table) => {
        if (table === "merchants") {
          return {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({
              data: [
                { id: "merchant-0", ...makeMerchant() },
                { id: "merchant-1", ...makeMerchant() },
              ],
              error: null,
            }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          neq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data: payments, error: null }),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: "updated" }, error: null }),
          }),
        };
      });

      mockFindMatchingPayment.mockResolvedValue({
        id: "op-load",
        transaction_hash: VALID_TX_HASH,
        received_amount: "10.0000000",
      });

      // Load-test throughput of the group-processing pipeline itself, not the
      // intentional Horizon rate limit (that's covered separately above).
      setLedgerMonitorRateLimiterForTest(
        createLedgerMonitorRateLimiter({ maxPerSecond: 10_000, burst: 10_000 }),
      );

      const startedAt = Date.now();
      await pollOnce();
      const elapsedMs = Date.now() - startedAt;

      // All 50 payments across the two recipient groups were checked and every
      // notification fired — nothing was dropped under load.
      expect(mockStreamManagerNotify).toHaveBeenCalledTimes(BATCH);
      expect(mockLedgerMonitorBatchSize.set).toHaveBeenCalledWith(BATCH);
      // Sanity ceiling — a full mocked cycle (no real network/DB latency) should
      // stay well under a second; a large regression here would signal an
      // accidental serial bottleneck (e.g. losing the per-group concurrency).
      expect(elapsedMs).toBeLessThan(5_000);
    });
  });
});
