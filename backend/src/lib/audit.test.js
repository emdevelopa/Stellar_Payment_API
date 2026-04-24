/**
 * Tests for backend/src/lib/audit.js
 *
 * Verifies that logLoginAttempt:
 *  - Inserts a row with correct action, merchant_id, ip_address, user_agent
 *  - Never throws even when the DB query fails
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.hoisted ensures mockQuery is initialised before vi.mock's factory runs,
// which Vitest requires because vi.mock calls are hoisted to the top of the file.
const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}));

vi.mock("./db.js", () => ({
  pool: { query: mockQuery },
}));

import { logLoginAttempt } from "./audit.js";

describe("logLoginAttempt", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("inserts a login success row with correct parameters", async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await logLoginAttempt({
      merchantId: "merchant-uuid-001",
      ipAddress: "192.168.1.1",
      userAgent: "Mozilla/5.0",
      status: "success",
    });

    expect(mockQuery).toHaveBeenCalledOnce();
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO audit_logs/i);
    expect(params).toEqual([
      "merchant-uuid-001",
      "login",
      "success",
      "192.168.1.1",
      "Mozilla/5.0",
      expect.stringMatching(/^[a-f0-9]{64}$/),
      null,
    ]);
  });

  it("inserts a login failure row with correct parameters", async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await logLoginAttempt({
      merchantId: "merchant-uuid-002",
      ipAddress: "10.0.0.5",
      userAgent: "curl/7.79.1",
      status: "failure",
    });

    expect(mockQuery).toHaveBeenCalledOnce();
    const [, params] = mockQuery.mock.calls[0];
    expect(params[1]).toBe("login");
    expect(params[2]).toBe("failure");
    expect(params[5]).toMatch(/^[a-f0-9]{64}$/);
  });

  it("inserts a row with null merchantId", async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await logLoginAttempt({
      merchantId: null,
      ipAddress: "1.2.3.4",
      userAgent: "test-agent",
      status: "failure",
    });

    expect(mockQuery).toHaveBeenCalledOnce();
    const [, params] = mockQuery.mock.calls[0];
    expect(params[0]).toBeNull();
    expect(params[2]).toBe("failure");
    expect(params[5]).toMatch(/^[a-f0-9]{64}$/);
  });

  it("stores null ip_address and user_agent when not provided", async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await logLoginAttempt({
      merchantId: "merchant-uuid-003",
      ipAddress: undefined,
      userAgent: undefined,
      status: "success",
    });

    const [, params] = mockQuery.mock.calls[0];
    expect(params[3]).toBeNull();
    expect(params[4]).toBeNull();
    expect(params[6]).toBeNull();
  });

  it("applies a cryptographic signature when audit signing secret is configured", async () => {
    const original = process.env.AUDIT_LOG_SIGNING_SECRET;
    process.env.AUDIT_LOG_SIGNING_SECRET = "test-audit-secret";

    mockQuery.mockResolvedValue({ rows: [] });

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

    await expect(
      logLoginAttempt({
        merchantId: "merchant-uuid-004",
        ipAddress: "1.2.3.4",
        userAgent: "test-agent",
        status: "success",
      }),
    ).resolves.toBeUndefined();
  });
});
