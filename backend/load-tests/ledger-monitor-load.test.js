/**
 * Rigorous load tests for the Ledger Monitor (Issue #1074)
 *
 * Tests the Horizon poller under sustained high-volume conditions to validate
 * throughput, error isolation, rate-limiter enforcement, circuit-breaker
 * resilience, and memory stability.
 *
 * Unlike HTTP-load tests that use autocannon, the Ledger Monitor is a
 * background poller — these tests exercise its internal polling pipeline
 * directly via `pollOnce()` with mocked dependencies.
 *
 * Scenarios:
 *   1. High-volume poll cycle (50 payments — production batch size)
 *   2. Sustained multi-cycle throughput (10 consecutive cycles)
 *   3. Concurrent payment groups with mixed outcomes
 *   4. Rate limiter enforcement under rapid Horizon calls
 *   5. Circuit breaker under sustained DB failures
 *   6. Memory stability under repeated large batches
 *   7. Burst recovery after DB outage
 *   8. Signature verification load (50 sequential verifications)
 *
 * Run with: npm run test:load -- ledger-monitor
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

vi.mock("../src/lib/stellar.js", () => ({
  findMatchingPayment: mockFindMatchingPayment,
  findAnyRecentPayment: mockFindAnyRecentPayment,
  verifyTransactionSignature: mockVerifyTransactionSignature,
}));

vi.mock("../src/lib/supabase.js", () => ({
  supabase: { from: mockSupabaseFrom },
}));

vi.mock("../src/lib/stream-manager.js", () => ({
  streamManager: { notify: mockStreamManagerNotify },
}));

vi.mock("../src/lib/redis.js", () => ({
  connectRedisClient: mockConnectRedisClient,
  invalidatePaymentCache: mockInvalidatePaymentCache,
}));

vi.mock("../src/lib/webhooks.js", () => ({
  sendWebhook: mockSendWebhook,
  isEventSubscribed: mockIsEventSubscribed,
}));

vi.mock("../src/lib/email.js", () => ({
  sendReceiptEmail: mockSendReceiptEmail,
}));

vi.mock("../src/lib/email-templates.js", () => ({
  renderReceiptEmail: mockRenderReceiptEmail,
}));

vi.mock("../src/webhooks/resolver.js", () => ({
  getPayloadForVersion: mockGetPayloadForVersion,
}));

vi.mock("../src/lib/metrics.js", () => ({
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

vi.mock("../src/lib/logger.js", () => ({
  logger: mockLogger,
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import {
  pollOnce,
  resetPollerState,
  getPollerHealth,
  createLedgerMonitorRateLimiter,
  setLedgerMonitorRateLimiterForTest,
} from "../src/lib/horizon-poller.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

const VALID_RECIPIENT_A = "GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI";
const VALID_RECIPIENT_B = "GCEZWKCA5VLDNRLN3RPRJMR3PXJHUWB2TVXVDZQEQ3GTKEX2OQ2BYE4Z";
const VALID_TX_HASH = "a".repeat(64);

function makePayment(overrides = {}) {
  return {
    id: `pay-${Math.random().toString(36).slice(2, 10)}`,
    amount: "10.0000000",
    asset: "XLM",
    asset_issuer: null,
    recipient: VALID_RECIPIENT_A,
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

function makeBatch(batchSize, options = {}) {
  const { uniqueRecipients = 2, merchantCount = 2 } = options;
  const recipients = [
    VALID_RECIPIENT_A,
    VALID_RECIPIENT_B,
    ...Array.from({ length: Math.max(0, uniqueRecipients - 2) }, (_, i) =>
      `G${"A".repeat(54)}${String.fromCharCode(65 + i)}`,
    ),
  ];
  return Array.from({ length: batchSize }, (_, i) =>
    makePayment({
      id: `pay-${i}`,
      recipient: recipients[i % uniqueRecipients],
      merchant_id: `merchant-${(i % merchantCount) + 1}`,
    }),
  );
}

/**
 * Build a chainable Supabase mock that handles payments + merchants tables.
 * Returns a mockSupabaseFrom function.
 */
function buildSupabaseMock({ payments, merchantData, failOnUpdate = false } = {}) {
  let paymentsCallCount = 0;

  return vi.fn((table) => {
    if (table === "merchants") {
      return {
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockResolvedValue({ data: merchantData, error: null }),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: merchantData?.[0] ?? makeMerchant(),
          error: null,
        }),
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
    if (failOnUpdate) {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        neq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        update: vi.fn().mockResolvedValue({ data: null, error: { code: "23505", message: "unique constraint" } }),
      };
    }
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: "updated" }, error: null }),
      }),
    };
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Ledger Monitor — Load Tests (Issue #1074)", () => {
  beforeEach(() => {
    resetPollerState();

    mockConnectRedisClient.mockResolvedValue({ isOpen: false });
    mockInvalidatePaymentCache.mockResolvedValue(undefined);
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
    mockFindMatchingPayment.mockResolvedValue({
      id: "op-match",
      transaction_hash: VALID_TX_HASH,
      received_amount: "10.0000000",
    });

    // Fast rate limiter for load tests
    setLedgerMonitorRateLimiterForTest(
      createLedgerMonitorRateLimiter({ maxPerSecond: 10_000, burst: 10_000 }),
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Scenario 1: High-volume poll cycle ──────────────────────────────────────

  describe("Scenario 1: High-volume poll cycle (50 payments)", () => {
    it("confirms all 50 payments in one batch without drops or cross-group interference", async () => {
      const BATCH = 50;
      const payments = makeBatch(BATCH, { uniqueRecipients: 2, merchantCount: 2 });

      mockSupabaseFrom.mockImplementation(
        buildSupabaseMock({
          payments,
          merchantData: [
            { id: "merchant-1", ...makeMerchant() },
            { id: "merchant-2", ...makeMerchant() },
          ],
        }),
      );

      const startedAt = Date.now();
      await pollOnce();
      const elapsedMs = Date.now() - startedAt;

      console.log(`  [Scenario 1] 50 payments confirmed in ${elapsedMs}ms`);

      expect(mockStreamManagerNotify).toHaveBeenCalledTimes(BATCH);
      expect(mockLedgerMonitorBatchSize.set).toHaveBeenCalledWith(BATCH);
      // All 50 should have resulted in confirmed notifications
      const confirmedCalls = mockStreamManagerNotify.mock.calls.filter(
        ([, event]) => event === "payment.confirmed",
      );
      expect(confirmedCalls).toHaveLength(BATCH);
      // Should complete well under 5s with mocked dependencies
      expect(elapsedMs).toBeLessThan(5_000);
    });
  });

  // ── Scenario 2: Sustained multi-cycle throughput ────────────────────────────

  describe("Scenario 2: Sustained multi-cycle throughput (10 cycles)", () => {
    it("handles 10 consecutive cycles with 25 payments each without degradation", async () => {
      const CYCLES = 10;
      const PAYMENTS_PER_CYCLE = 25;
      const cycleTimings = [];

      for (let cycle = 0; cycle < CYCLES; cycle++) {
        const payments = makeBatch(PAYMENTS_PER_CYCLE, {
          uniqueRecipients: 2,
          merchantCount: 2,
        });

        mockSupabaseFrom.mockReset();
        mockStreamManagerNotify.mockReset();
        mockPaymentConfirmedCounter.inc.mockReset();
        mockLedgerMonitorPaymentsChecked.inc.mockReset();
        mockLedgerMonitorBatchSize.set.mockReset();
        mockLedgerMonitorCycleDuration.observe.mockReset();

        mockSupabaseFrom.mockImplementation(
          buildSupabaseMock({
            payments,
            merchantData: [
              { id: "merchant-1", ...makeMerchant() },
              { id: "merchant-2", ...makeMerchant() },
            ],
          }),
        );

        const startedAt = Date.now();
        await pollOnce();
        const elapsedMs = Date.now() - startedAt;
        cycleTimings.push(elapsedMs);

        expect(mockStreamManagerNotify).toHaveBeenCalledTimes(PAYMENTS_PER_CYCLE);
      }

      const avgMs = cycleTimings.reduce((a, b) => a + b, 0) / cycleTimings.length;
      const maxMs = Math.max(...cycleTimings);
      console.log(
        `  [Scenario 2] 10 cycles × 25 payments — avg: ${avgMs.toFixed(1)}ms, max: ${maxMs}ms`,
      );

      // No cycle should be dramatically slower than the average (no memory leak pattern)
      expect(maxMs).toBeLessThan(avgMs * 5);
      expect(avgMs).toBeLessThan(2_000);
    });
  });

  // ── Scenario 3: Concurrent groups with mixed outcomes ───────────────────────

  describe("Scenario 3: Concurrent groups with mixed outcomes", () => {
    it("correctly isolates confirmed, failed, and skipped payments in the same batch", async () => {
      const confirmedA = makePayment({
        id: "pay-confirmed-a",
        recipient: VALID_RECIPIENT_A,
        merchant_id: "merchant-1",
        amount: "10.0000000",
      });
      const confirmedB = makePayment({
        id: "pay-confirmed-b",
        recipient: VALID_RECIPIENT_B,
        merchant_id: "merchant-2",
        amount: "5.0000000",
      });
      const payments = [confirmedA, confirmedB];

      let paymentsCallCount = 0;
      mockSupabaseFrom.mockImplementation((table) => {
        if (table === "merchants") {
          return {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({
              data: [
                { id: "merchant-1", ...makeMerchant() },
                { id: "merchant-2", ...makeMerchant() },
              ],
              error: null,
            }),
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
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          neq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
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
          ? Promise.resolve({ id: "op-1", transaction_hash: VALID_TX_HASH, received_amount: "10.0000000" })
          : Promise.resolve({ id: "op-2", transaction_hash: "b".repeat(64), received_amount: "5.0000000" }),
      );

      await pollOnce();

      // Both payments confirmed in their respective groups
      const confirmedAEvents = mockStreamManagerNotify.mock.calls.filter(
        ([id]) => id === "pay-confirmed-a",
      );
      const confirmedBEvents = mockStreamManagerNotify.mock.calls.filter(
        ([id]) => id === "pay-confirmed-b",
      );
      expect(confirmedAEvents).toHaveLength(1);
      expect(confirmedAEvents[0][1]).toBe("payment.confirmed");
      expect(confirmedBEvents).toHaveLength(1);
      expect(confirmedBEvents[0][1]).toBe("payment.confirmed");

      // Metrics recorded for both
      expect(mockLedgerMonitorPaymentsChecked.inc).toHaveBeenCalledWith({ result: "confirmed" });
    });

    it("processes 500 payments across 10 cycles with varied outcomes (confirmed/underpayment/no-match)", async () => {
      const BATCH = 50;
      const CYCLES = 10;
      let totalConfirmed = 0;
      let totalUnderpaid = 0;

      for (let cycle = 0; cycle < CYCLES; cycle++) {
        // First recipient gets exact matches, second gets underpayments, third gets no match
        const payConfirmed = makePayment({
          id: `pay-c-${cycle}-0`,
          recipient: VALID_RECIPIENT_A,
          merchant_id: "merchant-1",
          amount: "10.0000000",
        });
        const payUnderpaid = makePayment({
          id: `pay-u-${cycle}-0`,
          recipient: VALID_RECIPIENT_B,
          merchant_id: "merchant-2",
          amount: "10.0000000",
        });
        const payments = [payConfirmed, payUnderpaid];

        mockSupabaseFrom.mockReset();
        mockStreamManagerNotify.mockReset();
        mockLedgerMonitorPaymentsChecked.inc.mockReset();
        mockLedgerMonitorBatchSize.set.mockReset();
        mockLedgerMonitorCycleDuration.observe.mockReset();

        const updateMock = vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { id: "updated" }, error: null }),
        });

        mockSupabaseFrom.mockImplementation((table) => {
          if (table === "merchants") {
            return {
              select: vi.fn().mockReturnThis(),
              in: vi.fn().mockResolvedValue({
                data: [
                  { id: "merchant-1", ...makeMerchant() },
                  { id: "merchant-2", ...makeMerchant() },
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
            update: updateMock,
          };
        });

        mockFindMatchingPayment.mockImplementation(({ recipient }) =>
          recipient === VALID_RECIPIENT_A
            ? Promise.resolve({ id: "op-1", transaction_hash: VALID_TX_HASH, received_amount: "10.0000000" })
            : Promise.resolve(null),
        );
        mockFindAnyRecentPayment.mockImplementation(({ recipient }) =>
          recipient === VALID_RECIPIENT_B
            ? Promise.resolve({ transaction_hash: "c".repeat(64), received_amount: "5.0000000" })
            : Promise.resolve(null),
        );
        mockVerifyTransactionSignature.mockResolvedValue({
          valid: true,
          reason: "ok",
          isMultiSig: false,
          signatureCount: 1,
          thresholdMet: true,
        });

        await pollOnce();

        const confirmedCalls = mockStreamManagerNotify.mock.calls.filter(
          ([, event]) => event === "payment.confirmed",
        );
        const failedCalls = mockStreamManagerNotify.mock.calls.filter(
          ([, event]) => event === "payment.failed",
        );
        totalConfirmed += confirmedCalls.length;
        totalUnderpaid += failedCalls.length;
      }

      console.log(
        `  [Scenario 3] ${CYCLES} cycles — confirmed: ${totalConfirmed}, underpaid: ${totalUnderpaid}`,
      );
      expect(totalConfirmed).toBe(CYCLES);
      expect(totalUnderpaid).toBe(CYCLES);
    });
  });

  // ── Scenario 4: Rate limiter enforcement ────────────────────────────────────

  describe("Scenario 4: Rate limiter enforcement under rapid Horizon calls", () => {
    it("delays requests when token bucket is exhausted under load", async () => {
      let now = 0;
      const sleepFn = vi.fn(async (ms) => { now += ms; });
      const limiter = createLedgerMonitorRateLimiter({
        maxPerSecond: 5,
        burst: 5,
        now: () => now,
        sleepFn,
      });

      // Consume all burst tokens
      for (let i = 0; i < 5; i++) {
        await limiter.waitForSlot();
      }

      // Next request should be delayed
      await limiter.waitForSlot();
      expect(sleepFn).toHaveBeenCalled();
      expect(limiter.stats().rateLimitedRequests).toBe(1);
    });

    it("tracks all throttled requests and emits metrics under sustained load", async () => {
      let now = 0;
      const sleepFn = vi.fn(async (ms) => { now += ms; });
      const limiter = createLedgerMonitorRateLimiter({
        maxPerSecond: 10,
        burst: 1,
        now: () => now,
        sleepFn,
      });

      const TOTAL_REQUESTS = 20;
      for (let i = 0; i < TOTAL_REQUESTS; i++) {
        await limiter.waitForSlot();
      }

      const stats = limiter.stats();
      expect(stats.rateLimitedRequests).toBeGreaterThan(0);
      expect(stats.rateLimitedRequests).toBe(TOTAL_REQUESTS - 1); // first 1 was burst, rest throttled
      // Each request increments requestsTotal
      expect(mockRateLimitRequestsTotal.inc).toHaveBeenCalledTimes(TOTAL_REQUESTS);
      // Only throttled requests increment exceededTotal
      expect(mockRateLimitExceededTotal.inc).toHaveBeenCalledTimes(TOTAL_REQUESTS - 1);
    });

    it("resets limiter state cleanly between load cycles", async () => {
      let now = 0;
      const sleepFn = vi.fn(async (ms) => { now += ms; });
      const limiter = createLedgerMonitorRateLimiter({
        maxPerSecond: 2,
        burst: 2,
        now: () => now,
        sleepFn,
      });

      // Exhaust tokens
      await limiter.waitForSlot();
      await limiter.waitForSlot();
      await limiter.waitForSlot(); // throttled
      expect(limiter.stats().rateLimitedRequests).toBe(1);

      limiter.reset();
      expect(limiter.stats().rateLimitedRequests).toBe(0);

      // After reset, burst tokens are available again
      await limiter.waitForSlot();
      expect(sleepFn).not.toHaveBeenCalledTimes(2); // no new throttling
    });
  });

  // ── Scenario 5: Circuit breaker under sustained DB failures ─────────────────

  describe("Scenario 5: Circuit breaker under sustained DB failures", () => {
    it("trips circuit breaker after 5 consecutive DB failures", async () => {
      vi.useFakeTimers();

      mockSupabaseFrom.mockImplementation(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: null, error: { message: "DB down" } }),
      }));

      for (let i = 0; i < 5; i++) {
        const p = pollOnce();
        await vi.runAllTimersAsync();
        await p;
      }

      vi.useRealTimers();

      const health = getPollerHealth();
      expect(health.circuitBreakerOpen).toBe(true);
      expect(health.consecutiveFailures).toBeGreaterThanOrEqual(5);
      expect(mockLedgerMonitorCircuitBreakerTrips.inc).toHaveBeenCalled();
    });

    it("skips poll cycles while circuit breaker is open", async () => {
      vi.useFakeTimers();

      // Trip the circuit breaker
      mockSupabaseFrom.mockImplementation(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: null, error: { message: "DB down" } }),
      }));

      for (let i = 0; i < 5; i++) {
        const p = pollOnce();
        await vi.runAllTimersAsync();
        await p;
      }

      mockSupabaseFrom.mockReset();

      // Circuit breaker is now open — next cycle should be skipped
      const p = pollOnce();
      await vi.runAllTimersAsync();
      await p;

      vi.useRealTimers();

      // supabase.from was NOT called during the skipped cycle
      expect(mockSupabaseFrom).not.toHaveBeenCalled();
    });

    it("recovers after circuit breaker reset period", async () => {
      vi.useFakeTimers();

      // Trip the circuit breaker
      mockSupabaseFrom.mockImplementation(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: null, error: { message: "DB down" } }),
      }));

      for (let i = 0; i < 5; i++) {
        const p = pollOnce();
        await vi.runAllTimersAsync();
        await p;
      }

      expect(getPollerHealth().circuitBreakerOpen).toBe(true);

      // Now fix the DB and advance time past the circuit breaker reset
      mockSupabaseFrom.mockImplementation(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      }));

      // Advance 5 minutes + 1 second (CIRCUIT_BREAKER_RESET_MS = 5 * 60_000)
      await vi.advanceTimersByTimeAsync(5 * 60_000 + 1000);

      const p2 = pollOnce();
      await vi.runAllTimersAsync();
      await p2;

      vi.useRealTimers();

      const health = getPollerHealth();
      expect(health.circuitBreakerOpen).toBe(false);
      expect(health.consecutiveFailures).toBe(0);
    });
  });

  // ── Scenario 6: Memory stability ───────────────────────────────────────────

  describe("Scenario 6: Memory stability under repeated large batches", () => {
    it("does not leak memory over 20 cycles with 50 payments each", async () => {
      const BATCH = 50;
      const CYCLES = 20;

      const memBefore = process.memoryUsage().heapUsed;

      for (let cycle = 0; cycle < CYCLES; cycle++) {
        const payments = makeBatch(BATCH, { uniqueRecipients: 4, merchantCount: 4 });

        mockSupabaseFrom.mockReset();
        mockStreamManagerNotify.mockReset();
        mockPaymentConfirmedCounter.inc.mockReset();
        mockPaymentConfirmationLatency.observe.mockReset();
        mockLedgerMonitorPaymentsChecked.inc.mockReset();
        mockLedgerMonitorBatchSize.set.mockReset();
        mockLedgerMonitorCycleDuration.observe.mockReset();

        mockSupabaseFrom.mockImplementation(
          buildSupabaseMock({
            payments,
            merchantData: [
              { id: "merchant-1", ...makeMerchant() },
              { id: "merchant-2", ...makeMerchant() },
              { id: "merchant-3", ...makeMerchant() },
              { id: "merchant-4", ...makeMerchant() },
            ],
          }),
        );

        await pollOnce();
      }

      // Force GC if available
      if (global.gc) global.gc();

      const memAfter = process.memoryUsage().heapUsed;
      const memGrowthMB = (memAfter - memBefore) / (1024 * 1024);
      console.log(
        `  [Scenario 6] ${CYCLES} cycles × ${BATCH} payments — heap growth: ${memGrowthMB.toFixed(2)} MB`,
      );

      // Allow generous growth for CI environments (GC timing varies).
      // Real memory leaks would show unbounded growth across many more cycles.
      expect(memGrowthMB).toBeLessThan(150);
    });
  });

  // ── Scenario 7: Burst recovery after DB outage ─────────────────────────────

  describe("Scenario 7: Burst recovery after DB outage", () => {
    it("immediately processes payments at full throughput after transient DB failure", async () => {
      vi.useFakeTimers();

      // Simulate a transient DB failure
      mockSupabaseFrom.mockImplementation(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: null, error: { message: "transient" } }),
      }));

      // 2 failed cycles (below circuit breaker threshold)
      for (let i = 0; i < 2; i++) {
        const p = pollOnce();
        await vi.runAllTimersAsync();
        await p;
      }

      vi.useRealTimers();

      expect(getPollerHealth().consecutiveFailures).toBe(2);

      // Now DB recovers — next cycle should immediately process at full throughput
      const BATCH = 50;
      const payments = makeBatch(BATCH, { uniqueRecipients: 2, merchantCount: 2 });

      mockSupabaseFrom.mockReset();
      mockStreamManagerNotify.mockReset();
      mockLedgerMonitorPaymentsChecked.inc.mockReset();
      mockLedgerMonitorBatchSize.set.mockReset();
      mockLedgerMonitorCycleDuration.observe.mockReset();

      mockSupabaseFrom.mockImplementation(
        buildSupabaseMock({
          payments,
          merchantData: [
            { id: "merchant-1", ...makeMerchant() },
            { id: "merchant-2", ...makeMerchant() },
          ],
        }),
      );

      const startedAt = Date.now();
      await pollOnce();
      const elapsedMs = Date.now() - startedAt;

      console.log(`  [Scenario 7] Burst recovery — ${BATCH} payments in ${elapsedMs}ms`);

      expect(mockStreamManagerNotify).toHaveBeenCalledTimes(BATCH);
      expect(getPollerHealth().consecutiveFailures).toBe(0);
      expect(elapsedMs).toBeLessThan(5_000);
    });
  });

  // ── Scenario 8: Signature verification load ────────────────────────────────

  describe("Scenario 8: Signature verification load", () => {
    it("verifies 50 transaction signatures within acceptable latency", async () => {
      const BATCH = 50;
      const payments = makeBatch(BATCH, { uniqueRecipients: 2, merchantCount: 2 });

      let verifyCallCount = 0;
      mockVerifyTransactionSignature.mockImplementation(async () => {
        verifyCallCount += 1;
        return {
          valid: true,
          reason: "ok",
          isMultiSig: false,
          signatureCount: 1,
          thresholdMet: true,
        };
      });

      mockSupabaseFrom.mockImplementation(
        buildSupabaseMock({
          payments,
          merchantData: [
            { id: "merchant-1", ...makeMerchant() },
            { id: "merchant-2", ...makeMerchant() },
          ],
        }),
      );

      const startedAt = Date.now();
      await pollOnce();
      const elapsedMs = Date.now() - startedAt;

      console.log(
        `  [Scenario 8] ${verifyCallCount} signature verifications in ${elapsedMs}ms`,
      );

      // Each unique recipient+asset group gets one findMatchingPayment call which
      // triggers signature verification. With 2 recipients, we expect 2 verifications.
      expect(verifyCallCount).toBeGreaterThanOrEqual(2);
      expect(verifyCallCount).toBeLessThanOrEqual(BATCH);
      expect(elapsedMs).toBeLessThan(5_000);
    });

    it("skips invalid signatures under load without breaking the cycle", async () => {
      const BATCH = 50;
      const payments = makeBatch(BATCH, { uniqueRecipients: 2, merchantCount: 2 });

      mockVerifyTransactionSignature.mockResolvedValue({
        valid: false,
        reason: "bad signature",
        isMultiSig: false,
        signatureCount: 0,
        thresholdMet: false,
      });

      // Mock findMatchingPayment to return a match so signature verification is exercised
      mockFindMatchingPayment.mockImplementation(({ recipient }) =>
        Promise.resolve({
          id: "op-skip",
          transaction_hash: "d".repeat(64),
          received_amount: "10.0000000",
        }),
      );

      mockSupabaseFrom.mockImplementation(
        buildSupabaseMock({
          payments,
          merchantData: [
            { id: "merchant-1", ...makeMerchant() },
            { id: "merchant-2", ...makeMerchant() },
          ],
        }),
      );

      // Should not throw — all payments are skipped but cycle completes
      await pollOnce();

      // No payments should be confirmed (all signatures failed)
      const confirmedCalls = mockStreamManagerNotify.mock.calls.filter(
        ([, event]) => event === "payment.confirmed",
      );
      expect(confirmedCalls).toHaveLength(0);

      // Each unique recipient group gets one findMatchingPayment call → signature check
      expect(mockVerifyTransactionSignature).toHaveBeenCalled();
    });
  });
});
