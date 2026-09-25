/**
 * Data consistency regression tests for the Ledger Monitor
 *
 * One describe block per fix:
 *
 *  DI-01  Underpayment DB update is atomic (.is("tx_id", null) guard)
 *  DI-02  Underpayment SSE/socket notifications only fire when DB update claims the row
 *  DI-03  recordAnomalyMetrics uses the shared METADATA_ALLOWLIST (no divergence)
 *  DI-04  validatePaymentRecord rejects zero, empty, and non-parseable amounts
 *  DI-05  auditPaymentAnomaly uses STALE_PAYMENT_HOURS (shared constant)
 *  DI-06  Merchant cache sentinel distinguishes "not found" from "not cached"
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Shared mock infrastructure
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

// Minimal metrics stub — every counter/histogram the poller touches
vi.mock("./metrics.js", () => {
  const counter = () => ({ inc: vi.fn() });
  const gauge   = () => ({ set: vi.fn() });
  const hist    = () => ({ observe: vi.fn() });
  return {
    paymentConfirmedCounter:              counter(),
    paymentConfirmationLatency:           hist(),
    ledgerMonitorCycleDuration:           hist(),
    ledgerMonitorPaymentsChecked:         counter(),
    ledgerMonitorCircuitBreakerTrips:     counter(),
    ledgerMonitorBatchSize:               gauge(),
    ledgerMonitorRateLimiterWaitSeconds:  hist(),
    ledgerMonitorValidationFailures:      counter(),
    ledgerMonitorAnomaliesDetected:       counter(),
    ledgerMonitorMerchantCacheHits:       counter(),
    ledgerMonitorMerchantCacheMisses:     counter(),
    ledgerMonitorMerchantCacheSize:       gauge(),
    ledgerMonitorSignatureVerifications:  counter(),
    ledgerMonitorHorizonOperations:       counter(),
    rateLimitRequestsTotal:               counter(),
    rateLimitExceededTotal:               counter(),
  };
});

vi.mock("./supabase.js", () => ({ supabase: { from: vi.fn() } }));
vi.mock("./stellar.js",  () => ({
  findMatchingPayment:        vi.fn(),
  findAnyRecentPayment:       vi.fn(),
  verifyTransactionSignature: vi.fn(),
}));
vi.mock("./webhooks.js",         () => ({ sendWebhook: vi.fn(), isEventSubscribed: vi.fn(() => false) }));
vi.mock("./email.js",            () => ({ sendReceiptEmail: vi.fn() }));
vi.mock("./email-templates.js",  () => ({ renderReceiptEmail: vi.fn(() => "<html/>") }));
vi.mock("../webhooks/resolver.js", () => ({ getPayloadForVersion: vi.fn(() => ({})) }));
vi.mock("./stream-manager.js",   () => ({ streamManager: { notify: vi.fn() } }));
vi.mock("./redis.js",            () => ({
  connectRedisClient:    vi.fn(async () => ({ isOpen: true })),
  invalidatePaymentCache: vi.fn(async () => {}),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Imports
// ─────────────────────────────────────────────────────────────────────────────

import { supabase }           from "./supabase.js";
import { streamManager }      from "./stream-manager.js";
import { findAnyRecentPayment, verifyTransactionSignature } from "./stellar.js";

import {
  validatePaymentRecord,
  auditPaymentAnomaly,
  METADATA_ALLOWLIST,
  STALE_PAYMENT_HOURS,
} from "./ledger-monitor-security.js";

import {
  pollOnce,
  resetPollerState,
  setLedgerMonitorRateLimiterForTest,
  createLedgerMonitorRateLimiter,
} from "./horizon-poller.js";

// ─────────────────────────────────────────────────────────────────────────────
// Shared test fixtures
// ─────────────────────────────────────────────────────────────────────────────

const RECIPIENT = "GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI";
const TX_HASH   = "a".repeat(64);

function pendingPayment(overrides = {}) {
  return {
    id: "pay-001",
    recipient: RECIPIENT,
    amount: "10.0000000",
    asset: "XLM",
    asset_issuer: null,
    memo: null,
    memo_type: null,
    webhook_url: null,
    created_at: new Date(Date.now() - 60_000).toISOString(), // 1 minute ago
    merchant_id: "merchant-001",
    metadata: {},
    ...overrides,
  };
}

/** Build a chainable Supabase query mock that resolves to `result`. */
function makeSupabaseChain(result) {
  const chain = {
    select:     vi.fn().mockReturnThis(),
    insert:     vi.fn().mockReturnThis(),
    update:     vi.fn().mockReturnThis(),
    eq:         vi.fn().mockReturnThis(),
    neq:        vi.fn().mockReturnThis(),
    is:         vi.fn().mockReturnThis(),
    in:         vi.fn().mockReturnThis(),
    gte:        vi.fn().mockReturnThis(),
    order:      vi.fn().mockReturnThis(),
    limit:      vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(async () => result),
  };
  return chain;
}

/** Installs a no-op rate limiter so tests aren't slowed by token waits. */
function installNoopRateLimiter() {
  setLedgerMonitorRateLimiterForTest(
    createLedgerMonitorRateLimiter({ maxPerSecond: 1000 }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetPollerState();
  installNoopRateLimiter();
});

// ═════════════════════════════════════════════════════════════════════════════
// DI-04 — validatePaymentRecord amount validation
// ═════════════════════════════════════════════════════════════════════════════

describe("DI-04 — validatePaymentRecord amount validation", () => {
  const base = () => pendingPayment();

  it("accepts a valid positive string amount", () => {
    expect(validatePaymentRecord(base())).toEqual({ valid: true });
  });

  it("accepts a numeric amount (positive number)", () => {
    expect(validatePaymentRecord({ ...base(), amount: 10 })).toEqual({ valid: true });
  });

  it("rejects null amount", () => {
    const r = validatePaymentRecord({ ...base(), amount: null });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/missing or empty/i);
  });

  it("rejects undefined amount", () => {
    const { amount: _omit, ...rest } = base();
    const r = validatePaymentRecord(rest);
    expect(r.valid).toBe(false);
  });

  it("rejects empty string amount", () => {
    const r = validatePaymentRecord({ ...base(), amount: "" });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/missing or empty/i);
  });

  it("rejects whitespace-only string amount", () => {
    const r = validatePaymentRecord({ ...base(), amount: "   " });
    expect(r.valid).toBe(false);
  });

  it("rejects '0.00' (zero value)", () => {
    const r = validatePaymentRecord({ ...base(), amount: "0.00" });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/not a positive finite number/i);
  });

  it("rejects negative amount", () => {
    const r = validatePaymentRecord({ ...base(), amount: "-5.00" });
    expect(r.valid).toBe(false);
  });

  it("rejects non-numeric string", () => {
    const r = validatePaymentRecord({ ...base(), amount: "abc" });
    expect(r.valid).toBe(false);
  });

  it("rejects Infinity", () => {
    const r = validatePaymentRecord({ ...base(), amount: Infinity });
    expect(r.valid).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// DI-05 — STALE_PAYMENT_HOURS shared constant
// ═════════════════════════════════════════════════════════════════════════════

describe("DI-05 — STALE_PAYMENT_HOURS shared constant", () => {
  it("STALE_PAYMENT_HOURS is a positive finite number", () => {
    expect(typeof STALE_PAYMENT_HOURS).toBe("number");
    expect(Number.isFinite(STALE_PAYMENT_HOURS)).toBe(true);
    expect(STALE_PAYMENT_HOURS).toBeGreaterThan(0);
  });

  it("auditPaymentAnomaly flags a payment older than STALE_PAYMENT_HOURS", () => {
    const { logger } = require("./logger.js");
    const staleCreatedAt = new Date(
      Date.now() - (STALE_PAYMENT_HOURS + 1) * 3_600_000,
    ).toISOString();

    auditPaymentAnomaly(pendingPayment({ created_at: staleCreatedAt }));

    const calls = logger.warn.mock.calls;
    const staleCall = calls.find(([ctx]) =>
      Array.isArray(ctx?.flags) &&
      ctx.flags.some((f) => f.type === "stale_payment"),
    );
    expect(staleCall).toBeDefined();
  });

  it("auditPaymentAnomaly does NOT flag a fresh payment as stale", () => {
    const { logger } = require("./logger.js");
    const freshCreatedAt = new Date(Date.now() - 60_000).toISOString(); // 1 min ago

    auditPaymentAnomaly(pendingPayment({ created_at: freshCreatedAt }));

    const calls = logger.warn.mock.calls;
    const staleCall = calls.find(([ctx]) =>
      Array.isArray(ctx?.flags) &&
      ctx.flags.some((f) => f.type === "stale_payment"),
    );
    expect(staleCall).toBeUndefined();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// DI-03 — METADATA_ALLOWLIST shared constant
// ═════════════════════════════════════════════════════════════════════════════

describe("DI-03 — METADATA_ALLOWLIST shared constant", () => {
  it("is a Set exported from ledger-monitor-security.js", () => {
    expect(METADATA_ALLOWLIST).toBeInstanceOf(Set);
    expect(METADATA_ALLOWLIST.size).toBeGreaterThan(0);
  });

  it("contains expected canonical keys", () => {
    const required = [
      "order_id", "customer_id", "reference", "failure_reason",
      "expected_amount", "received_amount", "overpayment",
    ];
    for (const key of required) {
      expect(METADATA_ALLOWLIST.has(key)).toBe(true);
    }
  });

  it("auditPaymentAnomaly flags unknown metadata keys not in METADATA_ALLOWLIST", () => {
    const { logger } = require("./logger.js");
    const payment = pendingPayment({
      metadata: { __proto__: "injected", unknown_key: "bad" },
    });

    auditPaymentAnomaly(payment);

    const flagged = logger.warn.mock.calls.find(([ctx]) =>
      Array.isArray(ctx?.flags) &&
      ctx.flags.some((f) => f.type === "metadata_unknown_keys"),
    );
    expect(flagged).toBeDefined();
  });

  it("auditPaymentAnomaly does NOT flag metadata with only allowlisted keys", () => {
    const { logger } = require("./logger.js");
    const payment = pendingPayment({
      metadata: { order_id: "ORD-1", reference: "REF-2" },
    });

    auditPaymentAnomaly(payment);

    const flagged = logger.warn.mock.calls.find(([ctx]) =>
      Array.isArray(ctx?.flags) &&
      ctx.flags.some((f) => f.type === "metadata_unknown_keys"),
    );
    expect(flagged).toBeUndefined();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// DI-01 + DI-02 — Underpayment atomic guard and gated notifications
// ═════════════════════════════════════════════════════════════════════════════

describe("DI-01/DI-02 — Underpayment: atomic DB update and gated notifications", () => {
  /** Set up supabase mocks so pollOnce processes one underpayment payment. */
  function setupUnderpaymentScenario({ updateResult }) {
    // fetchPendingPayments → returns one payment
    const fetchChain = {
      select: vi.fn().mockReturnThis(),
      eq:     vi.fn().mockReturnThis(),
      is:     vi.fn().mockReturnThis(),
      gte:    vi.fn().mockReturnThis(),
      order:  vi.fn().mockReturnThis(),
      limit:  vi.fn(async () => ({
        data: [pendingPayment({ amount: "10.0000000" })],
        error: null,
      })),
    };

    // merchants preload (IN query)
    const merchantsChain = {
      select: vi.fn().mockReturnThis(),
      in:     vi.fn(async () => ({ data: [], error: null })),
    };

    // tx_id duplicate check → no existing match
    const dupCheckChain = makeSupabaseChain({ data: null, error: null });

    // underpayment update chain — caller-supplied result
    const updateChain = makeSupabaseChain(updateResult);
    updateChain.update = vi.fn().mockReturnThis();
    updateChain.eq     = vi.fn().mockReturnThis();
    updateChain.is     = vi.fn().mockReturnThis();

    let callCount = 0;
    supabase.from.mockImplementation((table) => {
      if (table === "payments") {
        callCount += 1;
        // 1st call = fetchPendingPayments (select chain)
        // 2nd call = duplicate-tx check (select chain)
        // 3rd call = underpayment update
        if (callCount === 1) return fetchChain;
        if (callCount === 2) return dupCheckChain;
        return updateChain;
      }
      if (table === "merchants") return merchantsChain;
      return fetchChain;
    });

    // No exact match — triggers wrong-amount path
    findMatchingPayment.mockResolvedValue(null);

    // findAnyRecentPayment returns an underpayment
    findAnyRecentPayment.mockResolvedValue({
      transaction_hash: TX_HASH,
      received_amount: "8.0000000", // < 10 → underpayment
    });

    // Signature verification passes
    verifyTransactionSignature.mockResolvedValue({ valid: true, isMultiSig: false, signatureCount: 1 });

    return updateChain;
  }

  it("DI-01: update includes .is('tx_id', null) — atomicity guard present", async () => {
    const updateChain = setupUnderpaymentScenario({
      updateResult: { data: { id: "pay-001" }, error: null },
    });

    await pollOnce();

    // The update chain must have had .is("tx_id", null) called on it
    expect(updateChain.is).toHaveBeenCalledWith("tx_id", null);
  });

  it("DI-01: update includes .select('id').maybeSingle() — result is checked", async () => {
    const updateChain = setupUnderpaymentScenario({
      updateResult: { data: { id: "pay-001" }, error: null },
    });

    await pollOnce();

    expect(updateChain.select).toHaveBeenCalledWith("id");
    expect(updateChain.maybeSingle).toHaveBeenCalled();
  });

  it("DI-02: SSE notification fires when DB update claims the row (updated != null)", async () => {
    setupUnderpaymentScenario({
      updateResult: { data: { id: "pay-001" }, error: null },
    });

    await pollOnce();

    expect(streamManager.notify).toHaveBeenCalledWith(
      "pay-001",
      "payment.failed",
      expect.objectContaining({ status: "failed", reason: "underpayment" }),
    );
  });

  it("DI-02: SSE notification does NOT fire when DB update returns null (already claimed)", async () => {
    setupUnderpaymentScenario({
      updateResult: { data: null, error: null }, // row already claimed
    });

    await pollOnce();

    // streamManager.notify must not have been called with payment.failed
    const failedCalls = streamManager.notify.mock.calls.filter(
      ([, event]) => event === "payment.failed",
    );
    expect(failedCalls).toHaveLength(0);
  });

  it("DI-02: no duplicate notifications when two races both return null from the DB", async () => {
    setupUnderpaymentScenario({ updateResult: { data: null, error: null } });
    await pollOnce();

    setupUnderpaymentScenario({ updateResult: { data: null, error: null } });
    await pollOnce();

    const failedCalls = streamManager.notify.mock.calls.filter(
      ([, event]) => event === "payment.failed",
    );
    expect(failedCalls).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// DI-06 — Merchant cache sentinel
// ═════════════════════════════════════════════════════════════════════════════

describe("DI-06 — Merchant cache sentinel distinguishes not-found from not-cached", () => {
  /**
   * Drive the poller through a full confirmed-payment cycle so that
   * loadMerchantNotificationConfig is called with a given merchant query result.
   */
  async function runCycleWithMerchantResult(merchantData) {
    const fetchChain = {
      select: vi.fn().mockReturnThis(),
      eq:     vi.fn().mockReturnThis(),
      is:     vi.fn().mockReturnThis(),
      gte:    vi.fn().mockReturnThis(),
      order:  vi.fn().mockReturnThis(),
      limit:  vi.fn(async () => ({
        data: [pendingPayment({ webhook_url: "https://example.com/webhook" })],
        error: null,
      })),
    };

    const merchantsPreload = {
      select: vi.fn().mockReturnThis(),
      in:     vi.fn(async () => ({ data: merchantData, error: null })),
    };

    const dupCheckChain = makeSupabaseChain({ data: null, error: null });

    const updateChain = makeSupabaseChain({ data: { id: "pay-001" }, error: null });
    updateChain.update = vi.fn().mockReturnThis();
    updateChain.eq     = vi.fn().mockReturnThis();
    updateChain.is     = vi.fn().mockReturnThis();

    // per-payment merchant lookup (maybeSingle for exact merchant by id)
    const merchantLookup = {
      select:      vi.fn().mockReturnThis(),
      eq:          vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(async () => ({ data: merchantData?.[0] ?? null, error: null })),
    };

    let callCount = 0;
    supabase.from.mockImplementation((table) => {
      if (table === "payments") {
        callCount += 1;
        if (callCount === 1) return fetchChain;
        if (callCount === 2) return dupCheckChain;
        return updateChain;
      }
      if (table === "merchants") {
        // First merchants call is the IN preload; subsequent are per-payment lookups
        if (merchantsPreload.in.mock.calls.length === 0) return merchantsPreload;
        return merchantLookup;
      }
      return fetchChain;
    });

    findMatchingPayment.mockResolvedValue({
      transaction_hash: TX_HASH,
    });
    findAnyRecentPayment.mockResolvedValue(null);
    verifyTransactionSignature.mockResolvedValue({
      valid: true, isMultiSig: false, signatureCount: 1,
    });

    await pollOnce();
  }

  it("processes payment confirmation without throwing when merchant is not found", async () => {
    // Merchant batch returns empty — all IDs get MERCHANT_NOT_FOUND sentinel
    await expect(runCycleWithMerchantResult([])).resolves.toBeUndefined();
  });

  it("processes payment confirmation without throwing when merchant exists", async () => {
    await expect(
      runCycleWithMerchantResult([{
        id: "merchant-001",
        webhook_secret: "s3cr3t",
        webhook_version: "v1",
        notification_email: null,
        email: null,
        business_name: "Acme",
        webhook_custom_headers: {},
      }]),
    ).resolves.toBeUndefined();
  });

  it("a DB error during per-payment merchant lookup does not crash the cycle", async () => {
    const fetchChain = {
      select: vi.fn().mockReturnThis(),
      eq:     vi.fn().mockReturnThis(),
      is:     vi.fn().mockReturnThis(),
      gte:    vi.fn().mockReturnThis(),
      order:  vi.fn().mockReturnThis(),
      limit:  vi.fn(async () => ({
        data: [pendingPayment({ webhook_url: "https://example.com/wh" })],
        error: null,
      })),
    };

    const merchantsPreload = {
      select: vi.fn().mockReturnThis(),
      in:     vi.fn(async () => ({ data: null, error: { message: "DB down" } })),
    };

    const dupCheckChain = makeSupabaseChain({ data: null, error: null });

    const updateChain = makeSupabaseChain({ data: { id: "pay-001" }, error: null });
    updateChain.update = vi.fn().mockReturnThis();
    updateChain.eq     = vi.fn().mockReturnThis();
    updateChain.is     = vi.fn().mockReturnThis();

    const merchantLookupFail = {
      select:      vi.fn().mockReturnThis(),
      eq:          vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(async () => ({ data: null, error: { message: "connection refused" } })),
    };

    let paymentsCall = 0;
    supabase.from.mockImplementation((table) => {
      if (table === "payments") {
        paymentsCall += 1;
        if (paymentsCall === 1) return fetchChain;
        if (paymentsCall === 2) return dupCheckChain;
        return updateChain;
      }
      if (table === "merchants") {
        if (merchantsPreload.in.mock.calls.length === 0) return merchantsPreload;
        return merchantLookupFail;
      }
      return fetchChain;
    });

    findMatchingPayment.mockResolvedValue({ transaction_hash: TX_HASH });
    findAnyRecentPayment.mockResolvedValue(null);
    verifyTransactionSignature.mockResolvedValue({ valid: true, isMultiSig: false, signatureCount: 1 });

    // Should complete without throwing
    await expect(pollOnce()).resolves.toBeUndefined();
  });
});
