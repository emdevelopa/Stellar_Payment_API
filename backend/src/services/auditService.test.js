import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import * as auditSecurity from "../lib/audit-security.js";

const { mockQuery, mockIsRetryablePoolError, mockReplayFallbackLogs } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockIsRetryablePoolError: vi.fn(),
  mockReplayFallbackLogs: vi.fn().mockResolvedValue(),
}));

vi.mock("../lib/db.js", () => ({
  pool: { query: mockQuery },
  isRetryablePoolError: mockIsRetryablePoolError,
  queryWithRetry: mockQuery,
}));

vi.mock("../lib/audit-replay.js", () => ({
  replayFallbackLogs: mockReplayFallbackLogs,
}));

import { auditService, _resetSvcCircuitForTests } from "./auditService.js";

describe("auditService", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockIsRetryablePoolError.mockReset();
    vi.restoreAllMocks();
    vi.spyOn(auditSecurity, "consumeAuditLogRateLimit").mockReturnValue({ allowed: true });
    vi.spyOn(auditSecurity, "createAuditLogRateLimitKey").mockReturnValue("merchant-1:update:127.0.0.1");
    vi.spyOn(auditSecurity, "validateAuditAction").mockReturnValue(true);
    _resetSvcCircuitForTests();
  });

  it("writes signed audit records", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    mockIsRetryablePoolError.mockReturnValue(false);
    vi.spyOn(auditSecurity, "consumeAuditLogRateLimit").mockReturnValue({ allowed: true });
    vi.spyOn(auditSecurity, "hashAuditPayload").mockReturnValue("a".repeat(64));
    vi.spyOn(auditSecurity, "signAuditPayload").mockReturnValue("b".repeat(64));

    await auditService.logEvent({
      merchantId: "merchant-1",
      action: "update",
      fieldChanged: "notification_email",
      oldValue: "old@example.com",
      newValue: "new@example.com",
      ipAddress: "127.0.0.1",
      userAgent: "vitest",
    });

    expect(mockQuery).toHaveBeenCalledOnce();
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/payload_hash/);
    expect(sql).toMatch(/signature/);
    expect(params[7]).toBe("a".repeat(64));
    expect(params[8]).toBe("b".repeat(64));
  });

  it("drops events when the audit rate limit is exceeded", async () => {
    vi.spyOn(auditSecurity, "consumeAuditLogRateLimit").mockReturnValue({ allowed: false });
    mockIsRetryablePoolError.mockReturnValue(false);

    await auditService.logEvent({
      merchantId: "merchant-1",
      action: "update",
      fieldChanged: "email",
    });

    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("retries on transient errors", async () => {
    const transientError = new Error("connection terminated");
    mockIsRetryablePoolError.mockReturnValue(true);
    vi.spyOn(auditSecurity, "consumeAuditLogRateLimit").mockReturnValue({ allowed: true });
    vi.spyOn(auditSecurity, "hashAuditPayload").mockReturnValue("a".repeat(64));
    vi.spyOn(auditSecurity, "signAuditPayload").mockReturnValue("b".repeat(64));
    mockQuery
      .mockRejectedValueOnce(transientError)
      .mockRejectedValueOnce(transientError)
      .mockResolvedValueOnce({ rows: [] });

    await auditService.logEvent({
      merchantId: "merchant-1",
      action: "update",
      fieldChanged: "notification_email",
      oldValue: "old@example.com",
      newValue: "new@example.com",
      ipAddress: "127.0.0.1",
      userAgent: "vitest",
    });

    expect(mockQuery).toHaveBeenCalledTimes(3);
  });

  it("falls back to file logging when DB fails permanently", async () => {
    const permanentError = new Error("relation does not exist");
    mockQuery.mockRejectedValue(permanentError);
    mockIsRetryablePoolError.mockReturnValue(false);
    vi.spyOn(auditSecurity, "consumeAuditLogRateLimit").mockReturnValue({ allowed: true });
    vi.spyOn(auditSecurity, "hashAuditPayload").mockReturnValue("a".repeat(64));
    vi.spyOn(auditSecurity, "signAuditPayload").mockReturnValue("b".repeat(64));

    const appendFileSyncSpy = vi.spyOn(fs, "appendFileSync").mockImplementation(() => {});

    await auditService.logEvent({
      merchantId: "merchant-1",
      action: "update",
      fieldChanged: "notification_email",
      oldValue: "old@example.com",
      newValue: "new@example.com",
      ipAddress: "127.0.0.1",
      userAgent: "vitest",
    });

    expect(appendFileSyncSpy).toHaveBeenCalled();
    appendFileSyncSpy.mockRestore();
  });

  // ── SQL optimization: getAuditLogs (issue #770) ───────────────────────────

  it("fetches logs and count using optimized queries", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total_count: 3 }] })
      .mockResolvedValueOnce({
        rows: [
          { id: 1, action: "update", field_changed: "email", old_value: "a@b.com", new_value: "c@d.com", ip_address: "1.2.3.4", user_agent: "ua", timestamp: new Date(), payload_hash: "hash-1", signature: "sig-1" },
          { id: 2, action: "login", field_changed: null, old_value: null, new_value: null, ip_address: "1.2.3.4", user_agent: "ua", timestamp: new Date(), payload_hash: "hash-2", signature: null },
        ],
      });

    const result = await auditService.getAuditLogs("merchant-1", 1, 2);

    expect(mockQuery).toHaveBeenCalledTimes(2);
    const [countSql] = mockQuery.mock.calls[0];
    const [logsSql] = mockQuery.mock.calls[1];
    expect(countSql).toMatch(/COUNT\(\*\)/i);
    expect(logsSql).toMatch(/FROM audit_logs/i);
    expect(result.total_count).toBe(3);
    expect(result.logs).toHaveLength(2);
  });

  it("returns zero total_count when no rows match", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total_count: 0 }] })
      .mockResolvedValueOnce({ rows: [] });
    const result = await auditService.getAuditLogs("merchant-nobody", 1, 10);
    expect(result.total_count).toBe(0);
    expect(result.logs).toHaveLength(0);
  });

  it("clamps page and limit to valid ranges", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total_count: 0 }] })
      .mockResolvedValueOnce({ rows: [] });
    const result = await auditService.getAuditLogs("merchant-1", -5, 200);
    const [, params] = mockQuery.mock.calls[1];
    expect(params[1]).toBe(100);
    expect(params[2]).toBe(0);
    expect(result.page).toBe(1);
  });

  it("verifies matching payload hash and signature during retrieval", async () => {
    process.env.AUDIT_LOG_SIGNING_SECRET = "test-secret";
    const payload = {
      merchant_id: "merchant-1",
      action: "update",
      field_changed: "email",
      old_value: "a@b.com",
      new_value: "c@d.com",
      ip_address: "1.2.3.4",
      user_agent: "ua",
    };
    const row = {
      id: "log-1",
      merchant_id: "merchant-1",
      action: "update",
      field_changed: "email",
      old_value: "a@b.com",
      new_value: "c@d.com",
      ip_address: "1.2.3.4",
      user_agent: "ua",
      timestamp: new Date(),
      payload_hash: auditSecurity.hashAuditPayload(payload),
      signature: auditSecurity.signAuditPayload(payload, "test-secret"),
    };

    mockQuery
      .mockResolvedValueOnce({ rows: [{ total_count: 1 }] })
      .mockResolvedValueOnce({ rows: [row] });

    const result = await auditService.getAuditLogs("merchant-1", 1, 10);
    expect(result.logs[0].hash_verified).toBe(true);
    expect(result.logs[0].signature_verified).toBe(true);
  });

  it("detects mismatching/tampered hash and signature during retrieval", async () => {
    process.env.AUDIT_LOG_SIGNING_SECRET = "test-secret";
    const payload = {
      merchant_id: "merchant-1",
      action: "update",
      field_changed: "email",
      old_value: "a@b.com",
      new_value: "c@d.com",
      ip_address: "1.2.3.4",
      user_agent: "ua",
    };
    const tampered = { ...payload, new_value: "different@example.com" };
    const row = {
      id: "log-2",
      merchant_id: "merchant-1",
      action: "update",
      field_changed: "email",
      old_value: "a@b.com",
      new_value: "c@d.com",
      ip_address: "1.2.3.4",
      user_agent: "ua",
      timestamp: new Date(),
      payload_hash: auditSecurity.hashAuditPayload(payload),
      signature: auditSecurity.signAuditPayload(tampered, "test-secret"),
    };

    mockQuery
      .mockResolvedValueOnce({ rows: [{ total_count: 1 }] })
      .mockResolvedValueOnce({ rows: [row] });

    const result = await auditService.getAuditLogs("merchant-1", 1, 10);
    expect(result.logs[0].hash_verified).toBe(false);
    expect(result.logs[0].signature_verified).toBe(false);
  });

  it("handles missing/null signatures or unset signing secret gracefully", async () => {
    delete process.env.AUDIT_LOG_SIGNING_SECRET;
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total_count: 1 }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "log-3",
            merchant_id: "merchant-1",
            action: "update",
            field_changed: "email",
            old_value: "a@b.com",
            new_value: "c@d.com",
            ip_address: "1.2.3.4",
            user_agent: "ua",
            timestamp: new Date(),
            payload_hash: null,
            signature: null,
          },
        ],
      });

    const result = await auditService.getAuditLogs("merchant-1", 1, 10);
    expect(result.logs[0].hash_verified).toBeNull();
    expect(result.logs[0].signature_verified).toBeNull();
  });

  // ── Action validation (issue #772) ────────────────────────────────────────

  it("drops logEvent calls with disallowed action values", async () => {
    vi.spyOn(auditSecurity, "validateAuditAction").mockReturnValue(false);
    vi.spyOn(auditSecurity, "consumeAuditLogRateLimit").mockReturnValue({ allowed: true });

    await auditService.logEvent({ merchantId: "m", action: "DROP TABLE", fieldChanged: "x" });

    expect(mockQuery).not.toHaveBeenCalled();
  });

  // ── Circuit breaker: logEvent (issue #771) ─────────────────────────────────

  it("opens circuit breaker after repeated DB failures, transitions to HALF_OPEN, recovers to CLOSED on success, and triggers replay", async () => {
    const permError = new Error("connection refused");
    mockQuery.mockRejectedValue(permError);
    mockIsRetryablePoolError.mockReturnValue(false);
    vi.spyOn(auditSecurity, "consumeAuditLogRateLimit").mockReturnValue({ allowed: true });
    vi.spyOn(auditSecurity, "hashAuditPayload").mockReturnValue("a".repeat(64));
    vi.spyOn(auditSecurity, "signAuditPayload").mockReturnValue("b".repeat(64));

    const appendFileSyncSpy = vi.spyOn(fs, "appendFileSync").mockImplementation(() => {});

    // 1. Trip the circuit breaker (5 failures required)
    for (let i = 0; i < 5; i += 1) {
      await auditService.logEvent({ merchantId: `m-${i}`, action: "update", fieldChanged: "email" });
    }

    mockQuery.mockClear();

    // 2. Subsequent call while open bypasses the DB
    await auditService.logEvent({ merchantId: "m-open", action: "update", fieldChanged: "email" });
    expect(mockQuery).not.toHaveBeenCalled();

    // 3. Move time forward past reset timeout to enter HALF_OPEN state
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 65000);

    // 4. In HALF_OPEN, first success does not yet close the circuit
    mockQuery.mockResolvedValue({ rows: [] });
    await auditService.logEvent({ merchantId: "m-probe-1", action: "update", fieldChanged: "email" });
    expect(mockQuery).toHaveBeenCalledOnce();
    expect(mockReplayFallbackLogs).not.toHaveBeenCalled();

    mockQuery.mockClear();

    // 5. Second success closes the circuit and triggers replay
    await auditService.logEvent({ merchantId: "m-probe-2", action: "update", fieldChanged: "email" });
    expect(mockQuery).toHaveBeenCalledOnce();
    expect(mockReplayFallbackLogs).toHaveBeenCalledOnce();

    nowSpy.mockRestore();
    appendFileSyncSpy.mockRestore();
  });

  it("computes and includes integrity_status on getAuditLogs", async () => {
    const { hashAuditPayload, signAuditPayload } = await import("../lib/audit-security.js");

    const payload1 = {
      merchant_id: "m-1",
      action: "login",
      status: "success",
      ip_address: "1.2.3.4",
      user_agent: "ua",
      event_type: "login_attempt"
    };

    const hash1 = hashAuditPayload(payload1);
    const sig1 = signAuditPayload(payload1, "test-secret");

    mockQuery
      .mockResolvedValueOnce({ rows: [{ total_count: 3 }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "log-1",
            merchant_id: "m-1",
            action: "login",
            field_changed: null,
            old_value: null,
            new_value: null,
            ip_address: "1.2.3.4",
            user_agent: "ua",
            timestamp: new Date(),
            status: "success",
            payload_hash: hash1,
            signature: sig1,
          },
          {
            id: "log-2",
            merchant_id: "m-1",
            action: "login",
            field_changed: null,
            old_value: null,
            new_value: null,
            ip_address: "1.2.3.4",
            user_agent: "ua",
            timestamp: new Date(),
            status: "success",
            payload_hash: hash1,
            signature: null,
          },
          {
            id: "log-3",
            merchant_id: "m-1",
            action: "login",
            field_changed: null,
            old_value: null,
            new_value: null,
            ip_address: "1.2.3.4",
            user_agent: "ua",
            timestamp: new Date(),
            status: "success",
            payload_hash: "wrong-hash",
            signature: null,
          }
        ]
      });

    const originalSecret = process.env.AUDIT_LOG_SIGNING_SECRET;
    process.env.AUDIT_LOG_SIGNING_SECRET = "test-secret";

    try {
      const result = await auditService.getAuditLogs("m-1", 1, 10);
      expect(result.logs[0].integrity_status).toBe("verified");
      expect(result.logs[1].integrity_status).toBe("unsigned_verified");
      expect(result.logs[2].integrity_status).toBe("failed");
    } finally {
      process.env.AUDIT_LOG_SIGNING_SECRET = originalSecret;
    }
  });
});