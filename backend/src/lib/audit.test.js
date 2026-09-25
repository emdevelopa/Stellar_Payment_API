/**
 * Tests for backend/src/lib/audit.js
 *
 * Verifies that logLoginAttempt:
 *  - Inserts a row with correct action, merchant_id, ip_address, user_agent
 *  - Never throws even when the DB query fails
 *  - Retries on transient errors
 *  - Falls back to file logging when DB fails permanently
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";

const { mockQuery, mockIsRetryablePoolError, mockConsumeRateLimit, mockHashPayload, mockSignPayload, mockSanitizeAuditValue, mockValidateAuditAction, mockReplayFallbackLogs } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockIsRetryablePoolError: vi.fn(),
  mockConsumeRateLimit: vi.fn(),
  mockHashPayload: vi.fn(),
  mockSignPayload: vi.fn(),
  mockSanitizeAuditValue: vi.fn((v) => v),
  mockValidateAuditAction: vi.fn(() => true),
  mockReplayFallbackLogs: vi.fn().mockResolvedValue(),
}));

vi.mock("./db.js", () => ({
  pool: { query: mockQuery },
  isRetryablePoolError: mockIsRetryablePoolError,
  queryWithRetry: mockQuery,
}));

vi.mock("./audit-replay.js", () => ({
  replayFallbackLogs: mockReplayFallbackLogs,
}));

vi.mock("./audit-security.js", () => ({
  consumeAuditLogRateLimit: mockConsumeRateLimit,
  createAuditLogRateLimitKey: vi.fn(() => "key"),
  hashAuditPayload: mockHashPayload,
  sanitizeAuditValue: mockSanitizeAuditValue,
  signAuditPayload: mockSignPayload,
  validateAuditAction: mockValidateAuditAction,
}));

import { logLoginAttempt, _resetAuditCircuitForTests } from "./audit.js";

describe("logLoginAttempt", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockIsRetryablePoolError.mockReset();
    mockConsumeRateLimit.mockReset();
    mockHashPayload.mockReset();
    mockSignPayload.mockReset();
    mockSanitizeAuditValue.mockReset();
    mockValidateAuditAction.mockReset();
    mockValidateAuditAction.mockReturnValue(true);
    _resetAuditCircuitForTests();
  });

  it("inserts a login success row with correct parameters", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    mockIsRetryablePoolError.mockReturnValue(false);
    mockConsumeRateLimit.mockReturnValue({ allowed: true });
    mockHashPayload.mockReturnValue("a".repeat(64));
    mockSignPayload.mockReturnValue("b".repeat(64));

    await logLoginAttempt({
      merchantId: "merchant-uuid-001",
      ipAddress: "192.168.1.1",
      userAgent: "Mozilla/5.0",
      status: "success",
    });

    expect(mockQuery).toHaveBeenCalledOnce();
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO audit_logs/i);
    expect(params[0]).toBe("merchant-uuid-001");
    expect(params[1]).toBe("login");
  });

  it("inserts a login failure row with correct parameters", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    mockIsRetryablePoolError.mockReturnValue(false);
    mockConsumeRateLimit.mockReturnValue({ allowed: true });
    mockHashPayload.mockReturnValue("a".repeat(64));
    mockSignPayload.mockReturnValue("b".repeat(64));

    await logLoginAttempt({
      merchantId: "merchant-uuid-002",
      ipAddress: "10.0.0.5",
      userAgent: "curl/7.79.1",
      status: "failure",
    });

    expect(mockQuery).toHaveBeenCalledOnce();
    const [, params] = mockQuery.mock.calls[0];
    expect(params[1]).toBe("login");
  });

  it("inserts a row with null merchantId", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    mockIsRetryablePoolError.mockReturnValue(false);
    mockConsumeRateLimit.mockReturnValue({ allowed: true });
    mockHashPayload.mockReturnValue("a".repeat(64));
    mockSignPayload.mockReturnValue("b".repeat(64));

    await logLoginAttempt({
      merchantId: null,
      ipAddress: "1.2.3.4",
      userAgent: "test-agent",
      status: "failure",
    });

    expect(mockQuery).toHaveBeenCalledOnce();
    const [, params] = mockQuery.mock.calls[0];
    expect(params[0]).toBeNull();
  });

  it("stores null ip_address and user_agent when not provided", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    mockIsRetryablePoolError.mockReturnValue(false);
    mockConsumeRateLimit.mockReturnValue({ allowed: true });
    mockHashPayload.mockReturnValue("a".repeat(64));
    mockSignPayload.mockReturnValue(null);
    mockSanitizeAuditValue.mockImplementation((v) => (v === null || v === undefined ? null : v));

    await logLoginAttempt({
      merchantId: "merchant-uuid-003",
      ipAddress: undefined,
      userAgent: undefined,
      status: "success",
    });

    const [, params] = mockQuery.mock.calls[0];
    expect(params[3]).toBeNull();
    expect(params[4]).toBeNull();
  });

  it("applies a cryptographic signature when audit signing secret is configured", async () => {
    const original = process.env.AUDIT_LOG_SIGNING_SECRET;
    process.env.AUDIT_LOG_SIGNING_SECRET = "test-audit-secret";

    mockQuery.mockResolvedValue({ rows: [] });
    mockIsRetryablePoolError.mockReturnValue(false);
    mockConsumeRateLimit.mockReturnValue({ allowed: true });
    mockHashPayload.mockReturnValue("a".repeat(64));
    mockSignPayload.mockReturnValue("b".repeat(64));

    await logLoginAttempt({
      merchantId: "merchant-uuid-005",
      ipAddress: "127.0.0.1",
      userAgent: "vitest",
      status: "success",
    });

    const [, params] = mockQuery.mock.calls[0];
    expect(params[6]).toMatch(/^[a-f0-9]{64}$/);

    process.env.AUDIT_LOG_SIGNING_SECRET = original;
  });

  it("does not throw when the DB query fails", async () => {
    mockQuery.mockRejectedValue(new Error("DB connection lost"));
    mockIsRetryablePoolError.mockReturnValue(false);
    mockConsumeRateLimit.mockReturnValue({ allowed: true });
    mockHashPayload.mockReturnValue("a".repeat(64));
    mockSignPayload.mockReturnValue("b".repeat(64));

    await expect(
      logLoginAttempt({
        merchantId: "merchant-uuid-004",
        ipAddress: "1.2.3.4",
        userAgent: "test-agent",
        status: "success",
      }),
    ).resolves.toBeUndefined();
  });

  it("retries on transient errors", async () => {
    const transientError = new Error("connection terminated");
    mockIsRetryablePoolError.mockReturnValue(true);
    mockConsumeRateLimit.mockReturnValue({ allowed: true });
    mockHashPayload.mockReturnValue("a".repeat(64));
    mockSignPayload.mockReturnValue("b".repeat(64));
    mockQuery
      .mockRejectedValueOnce(transientError)
      .mockRejectedValueOnce(transientError)
      .mockResolvedValueOnce({ rows: [] });

    await logLoginAttempt({
      merchantId: "merchant-uuid-006",
      ipAddress: "1.2.3.4",
      userAgent: "test-agent",
      status: "success",
    });

    expect(mockQuery).toHaveBeenCalledTimes(3);
  });

  it("falls back to file logging when DB fails permanently", async () => {
    const permanentError = new Error("relation does not exist");
    mockQuery.mockRejectedValue(permanentError);
    mockIsRetryablePoolError.mockReturnValue(false);
    mockConsumeRateLimit.mockReturnValue({ allowed: true });
    mockHashPayload.mockReturnValue("a".repeat(64));
    mockSignPayload.mockReturnValue("b".repeat(64));

    const appendFileSyncSpy = vi.spyOn(fs, "appendFileSync").mockImplementation(() => {});

    await logLoginAttempt({
      merchantId: "merchant-uuid-007",
      ipAddress: "1.2.3.4",
      userAgent: "test-agent",
      status: "failure",
    });

    expect(appendFileSyncSpy).toHaveBeenCalled();
    appendFileSyncSpy.mockRestore();
  });

  // ── Circuit breaker (issue #771) ──────────────────────────────────────────

  it("routes to fallback after circuit breaker opens from repeated DB failures", async () => {
    const permError = new Error("DB down");
    mockQuery.mockRejectedValue(permError);
    mockIsRetryablePoolError.mockReturnValue(false);
    mockConsumeRateLimit.mockReturnValue({ allowed: true });
    mockHashPayload.mockReturnValue("a".repeat(64));
    mockSignPayload.mockReturnValue("b".repeat(64));

    const appendFileSyncSpy = vi.spyOn(fs, "appendFileSync").mockImplementation(() => {});

    // Exceed the default threshold (5) to open the circuit
    for (let i = 0; i < 6; i += 1) {
      await logLoginAttempt({ merchantId: `m-${i}`, ipAddress: "1.2.3.4", userAgent: "ua", status: "failure" });
    }

    // After circuit opens, subsequent calls bypass the DB entirely
    const callCountBeforeCircuitOpen = mockQuery.mock.calls.length;
    await logLoginAttempt({ merchantId: "m-circuit", ipAddress: "1.2.3.4", userAgent: "ua", status: "failure" });
    expect(mockQuery.mock.calls.length).toBe(callCountBeforeCircuitOpen);
    expect(appendFileSyncSpy).toHaveBeenCalled();

    appendFileSyncSpy.mockRestore();
  });

  it("transitions to HALF_OPEN after timeout, recovers to CLOSED on successes, and triggers replay", async () => {
    mockQuery.mockRejectedValue(new Error("DB down"));
    mockIsRetryablePoolError.mockReturnValue(false);
    mockConsumeRateLimit.mockReturnValue({ allowed: true });
    mockHashPayload.mockReturnValue("a".repeat(64));
    mockSignPayload.mockReturnValue("b".repeat(64));

    const appendFileSyncSpy = vi.spyOn(fs, "appendFileSync").mockImplementation(() => {});

    // 1. Trip the circuit breaker (5 failures required)
    for (let i = 0; i < 5; i += 1) {
      await logLoginAttempt({ merchantId: `m-${i}`, ipAddress: "1.2.3.4", userAgent: "ua", status: "failure" });
    }

    mockQuery.mockClear();

    // 2. Subsequent call while open bypasses the DB
    await logLoginAttempt({ merchantId: "m-open", ipAddress: "1.2.3.4", userAgent: "ua", status: "failure" });
    expect(mockQuery).not.toHaveBeenCalled();

    // 3. Move time forward past reset timeout to enter HALF_OPEN state
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 65000);

    // 4. In HALF_OPEN, first success does not yet close the circuit
    mockQuery.mockResolvedValue({ rows: [] });
    await logLoginAttempt({ merchantId: "m-probe-1", ipAddress: "1.2.3.4", userAgent: "ua", status: "success" });
    expect(mockQuery).toHaveBeenCalledOnce();
    expect(mockReplayFallbackLogs).not.toHaveBeenCalled();

    mockQuery.mockClear();

    // 5. Second success closes the circuit and triggers replay
    await logLoginAttempt({ merchantId: "m-probe-2", ipAddress: "1.2.3.4", userAgent: "ua", status: "success" });
    expect(mockQuery).toHaveBeenCalledOnce();
    expect(mockReplayFallbackLogs).toHaveBeenCalledOnce();

    nowSpy.mockRestore();
    appendFileSyncSpy.mockRestore();
  });
});