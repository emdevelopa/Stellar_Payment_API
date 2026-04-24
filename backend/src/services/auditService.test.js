import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockQuery, mockConsumeRateLimit, mockHashPayload, mockSignPayload } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockConsumeRateLimit: vi.fn(),
  mockHashPayload: vi.fn(),
  mockSignPayload: vi.fn(),
}));

vi.mock("../lib/db.js", () => ({
  pool: { query: mockQuery },
}));

vi.mock("../lib/audit-security.js", () => ({
  consumeAuditLogRateLimit: mockConsumeRateLimit,
  createAuditLogRateLimitKey: vi.fn(() => "merchant-1:update:127.0.0.1"),
  hashAuditPayload: mockHashPayload,
  sanitizeAuditKey: vi.fn((v) => v),
  sanitizeAuditValue: vi.fn((v) => v),
  signAuditPayload: mockSignPayload,
}));

import { auditService } from "./auditService.js";

describe("auditService.logEvent", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockConsumeRateLimit.mockReset();
    mockHashPayload.mockReset();
    mockSignPayload.mockReset();

    mockConsumeRateLimit.mockReturnValue({ allowed: true });
    mockHashPayload.mockReturnValue("a".repeat(64));
    mockSignPayload.mockReturnValue("b".repeat(64));
  });

  it("writes signed audit records", async () => {
    mockQuery.mockResolvedValue({ rows: [] });

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
    mockConsumeRateLimit.mockReturnValue({ allowed: false });

    await auditService.logEvent({
      merchantId: "merchant-1",
      action: "update",
      fieldChanged: "email",
    });

    expect(mockQuery).not.toHaveBeenCalled();
  });
});
