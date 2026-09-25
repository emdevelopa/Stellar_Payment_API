/**
 * audit-logger-load.test.js
 *
 * Rigorous load testing for the Audit Logger (Issue #1069).
 *
 * The Audit Logger has no HTTP surface of its own for writes — login-attempt
 * and profile-change events are logged via direct in-process calls from other
 * modules — so, mirroring the Transaction Signer load tests, these scenarios
 * drive the write/read pipeline directly with the DB boundary mocked.
 *
 * Scenarios:
 *   1. High-volume concurrent login-attempt writes
 *   2. Sustained multi-batch profile-change event throughput
 *   3. Rate limiter enforcement under rapid-fire calls from the same key
 *   4. Circuit breaker under sustained DB failures
 *   5. Circuit breaker recovery (HALF_OPEN -> CLOSED) under a concurrent probe burst
 *   6. Fallback-log write throughput while the circuit is open
 *   7. Memory stability across a large volume of sanitize/hash/sign cycles
 *   8. Paginated audit-log read throughput under concurrency
 *
 * Run with: npm run test:load -- audit-logger
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockQuery, mockIsRetryablePoolError, mockReplayFallbackLogs } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockIsRetryablePoolError: vi.fn(),
  mockReplayFallbackLogs: vi.fn().mockResolvedValue(),
}));

vi.mock("../src/lib/db.js", () => ({
  pool: { query: mockQuery },
  isRetryablePoolError: mockIsRetryablePoolError,
}));

vi.mock("../src/lib/audit-replay.js", () => ({
  replayFallbackLogs: mockReplayFallbackLogs,
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import { logLoginAttempt, _resetAuditCircuitForTests } from "../src/lib/audit.js";
import { auditService, _resetSvcCircuitForTests } from "../src/services/auditService.js";
import { resetAuditRateLimitStateForTests, getAuditRateLimitStats } from "../src/lib/audit-security.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function runConcurrent(count, fn) {
  return Promise.all(Array.from({ length: count }, (_, i) => fn(i)));
}

describe("Audit Logger Load Tests", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockIsRetryablePoolError.mockReset();
    mockReplayFallbackLogs.mockClear();
    mockIsRetryablePoolError.mockReturnValue(false);
    _resetAuditCircuitForTests();
    _resetSvcCircuitForTests();
    resetAuditRateLimitStateForTests();
  });

  describe("High-volume login-attempt writes", () => {
    it("handles 500 concurrent successful login-attempt writes", async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const start = Date.now();
      await runConcurrent(500, (i) =>
        logLoginAttempt({
          merchantId: `merchant-${i}`,
          ipAddress: `10.0.${Math.floor(i / 255)}.${i % 255}`,
          userAgent: "load-test-agent",
          status: "success",
        }),
      );
      const duration = Date.now() - start;

      expect(mockQuery).toHaveBeenCalledTimes(500);
      expect(duration).toBeLessThan(2000);
    });
  });

  describe("Sustained profile-change event throughput", () => {
    it("processes 10 sequential batches of 100 events with stable per-batch timing", async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const batchDurations = [];
      for (let batch = 0; batch < 10; batch += 1) {
        const start = Date.now();
        await runConcurrent(100, (i) =>
          auditService.logEvent({
            merchantId: `merchant-batch${batch}-${i}`,
            action: "update",
            fieldChanged: "notification_email",
            oldValue: "old@example.com",
            newValue: "new@example.com",
            ipAddress: "127.0.0.1",
            userAgent: "load-test-agent",
          }),
        );
        batchDurations.push(Date.now() - start);
      }

      expect(mockQuery).toHaveBeenCalledTimes(1000);
      const maxBatch = Math.max(...batchDurations);
      expect(maxBatch).toBeLessThan(1000);
    });
  });

  describe("Rate limiter enforcement under load", () => {
    it("suppresses writes beyond the per-key limit under a rapid-fire burst", async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      // Same merchant/action/ip for every call -> single rate-limit bucket.
      await runConcurrent(200, () =>
        logLoginAttempt({
          merchantId: "merchant-hammer",
          ipAddress: "1.2.3.4",
          userAgent: "load-test-agent",
          status: "failure",
        }),
      );

      const { maxRequestsPerWindow } = getAuditRateLimitStats();
      expect(mockQuery.mock.calls.length).toBeLessThanOrEqual(maxRequestsPerWindow);
      expect(mockQuery.mock.calls.length).toBeGreaterThan(0);
    });
  });

  describe("Circuit breaker under sustained DB failures", () => {
    it("stops hitting the DB once the circuit opens and short-circuits quickly", async () => {
      mockQuery.mockRejectedValue(new Error("DB down"));
      const appendFileSyncSpy = vi.spyOn(fs, "appendFileSync").mockImplementation(() => {});

      // Distinct keys so the rate limiter never interferes with this scenario.
      for (let i = 0; i < 5; i += 1) {
        await logLoginAttempt({ merchantId: `m-${i}`, ipAddress: "9.9.9.9", userAgent: "ua", status: "failure" });
      }

      const callsBeforeOpen = mockQuery.mock.calls.length;

      const start = Date.now();
      await runConcurrent(200, (i) =>
        logLoginAttempt({ merchantId: `m-open-${i}`, ipAddress: "9.9.9.9", userAgent: "ua", status: "failure" }),
      );
      const duration = Date.now() - start;

      // Circuit is open: no additional DB calls, and fallback-only writes are fast.
      expect(mockQuery.mock.calls.length).toBe(callsBeforeOpen);
      expect(duration).toBeLessThan(500);
      expect(appendFileSyncSpy).toHaveBeenCalled();

      appendFileSyncSpy.mockRestore();
    });
  });

  describe("Circuit breaker recovery under a concurrent probe burst", () => {
    it("closes the circuit exactly once and triggers a single replay under concurrent successes", async () => {
      mockQuery.mockRejectedValue(new Error("DB down"));
      const appendFileSyncSpy = vi.spyOn(fs, "appendFileSync").mockImplementation(() => {});

      for (let i = 0; i < 5; i += 1) {
        await auditService.logEvent({
          merchantId: `m-${i}`,
          action: "update",
          fieldChanged: "email",
          oldValue: "a",
          newValue: "b",
          ipAddress: "8.8.8.8",
          userAgent: "ua",
        });
      }

      const nowSpy = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 65_000);
      mockQuery.mockResolvedValue({ rows: [] });

      // Concurrent probes while HALF_OPEN — only halfOpenRequired (2) successes
      // should be needed to close, and replay should fire exactly once even
      // though many probes resolve around the same time.
      await runConcurrent(20, (i) =>
        auditService.logEvent({
          merchantId: `m-probe-${i}`,
          action: "update",
          fieldChanged: "email",
          oldValue: "a",
          newValue: "b",
          ipAddress: "8.8.8.8",
          userAgent: "ua",
        }),
      );

      expect(mockReplayFallbackLogs).toHaveBeenCalledTimes(1);

      nowSpy.mockRestore();
      appendFileSyncSpy.mockRestore();
    });
  });

  describe("Fallback-log write throughput", () => {
    it("writes 300 fallback log entries under sustained permanent DB failure without throwing", async () => {
      mockQuery.mockRejectedValue(new Error("relation does not exist"));
      const appendFileSyncSpy = vi.spyOn(fs, "appendFileSync").mockImplementation(() => {});

      const start = Date.now();
      const results = await Promise.allSettled(
        Array.from({ length: 300 }, (_, i) =>
          logLoginAttempt({ merchantId: `fb-${i}`, ipAddress: "5.5.5.5", userAgent: "ua", status: "failure" }),
        ),
      );
      const duration = Date.now() - start;

      expect(results.every((r) => r.status === "fulfilled")).toBe(true);
      expect(appendFileSyncSpy.mock.calls.length).toBeGreaterThan(0);
      expect(duration).toBeLessThan(2000);

      appendFileSyncSpy.mockRestore();
    });
  });

  describe("Memory stability", () => {
    it("shows bounded heap growth across 3 000 sanitize/hash/sign/fallback cycles", async () => {
      mockQuery.mockRejectedValue(new Error("DB down"));
      const appendFileSyncSpy = vi.spyOn(fs, "appendFileSync").mockImplementation(() => {});

      const before = process.memoryUsage().heapUsed;

      for (let i = 0; i < 3_000; i += 1) {
        // Reset periodically so the circuit stays CLOSED and every call
        // exercises the full sanitize/hash/sign/insert-attempt/fallback path.
        if (i % 4 === 0) _resetAuditCircuitForTests();
        await logLoginAttempt({
          merchantId: `mem-${i}`,
          ipAddress: "6.6.6.6",
          userAgent: "load-test-agent",
          status: "failure",
        });
      }

      if (global.gc) global.gc();
      const after = process.memoryUsage().heapUsed;

      expect(after - before).toBeLessThan(20 * 1024 * 1024);

      appendFileSyncSpy.mockRestore();
    });
  });

  describe("Paginated read throughput", () => {
    it("serves 300 concurrent paginated getAuditLogs reads correctly and quickly", async () => {
      const rows = Array.from({ length: 50 }, (_, i) => ({
        id: i,
        merchant_id: "merchant-read",
        action: "update",
        field_changed: "email",
        old_value: "a",
        new_value: "b",
        ip_address: "127.0.0.1",
        user_agent: "ua",
        timestamp: new Date().toISOString(),
        payload_hash: null,
        signature: null,
        total_count: "500",
      }));
      mockQuery.mockResolvedValue({ rows });

      const start = Date.now();
      const results = await runConcurrent(300, (i) =>
        auditService.getAuditLogs("merchant-read", (i % 10) + 1, 50),
      );
      const duration = Date.now() - start;

      expect(results).toHaveLength(300);
      for (const result of results) {
        expect(result.logs).toHaveLength(50);
        expect(result.total_count).toBe(500);
        expect(result.total_pages).toBe(10);
      }
      expect(duration).toBeLessThan(2000);
    });
  });
});
