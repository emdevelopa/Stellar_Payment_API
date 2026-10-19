import { describe, it, expect, vi, beforeEach } from "vitest";
import { withMerchantContext, validateAndSanitizeMerchantId, sanitizeMerchantId } from "./db-rls.js";
import { pool } from "../lib/db.js";

vi.mock("../lib/db.js", () => ({
  pool: {
    connect: vi.fn(),
  },
}));

beforeEach(() => {
  vi.resetAllMocks();
});

function createMockClient() {
  const client = {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    release: vi.fn(),
  };
  return client;
}

describe("db-rls — payload sanitization and strict validation", () => {
  it("validates and sanitizes a valid merchantId", () => {
    const result = validateAndSanitizeMerchantId("merchant-123");
    expect(result.valid).toBe(true);
    expect(result.merchantId).toBe("merchant-123");
  });

  it("trims whitespace from merchantId", () => {
    const result = validateAndSanitizeMerchantId("  merchant-123  ");
    expect(result.valid).toBe(true);
    expect(result.merchantId).toBe("merchant-123");
  });

  it("rejects null merchantId", () => {
    const result = validateAndSanitizeMerchantId(null);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("rejects undefined merchantId", () => {
    const result = validateAndSanitizeMerchantId(undefined);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("rejects empty string merchantId", () => {
    const result = validateAndSanitizeMerchantId("");
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("rejects merchantId with invalid characters", () => {
    const result = validateAndSanitizeMerchantId("merchant!@#");
    expect(result.valid).toBe(false);
  });

  it("rejects merchantId that is too long", () => {
    const longId = "a".repeat(129);
    const result = validateAndSanitizeMerchantId(longId);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("128");
  });

  it("accepts merchantId with allowed special characters", () => {
    const result = validateAndSanitizeMerchantId("merchant_id:sub.domain-123@test");
    expect(result.valid).toBe(true);
    expect(result.merchantId).toBe("merchant_id:sub.domain-123@test");
  });

  it("sanitizes merchantId by stripping dangerous characters", () => {
    const result = sanitizeMerchantId("merchant'; DROP TABLE merchants; --");
    expect(result).toBe("merchantDROPTABLEmerchants--");
  });

  it("sanitizes returns null for non-string input", () => {
    expect(sanitizeMerchantId(null)).toBeNull();
    expect(sanitizeMerchantId(undefined)).toBeNull();
    expect(sanitizeMerchantId(123)).toBeNull();
  });

  it("sanitizes returns null for empty result after cleaning", () => {
    expect(sanitizeMerchantId("!!!!!!!!")).toBeNull();
  });

  it("sanitizes enforces length limit", () => {
    const longId = "a".repeat(200);
    expect(sanitizeMerchantId(longId)).toBeNull();
  });
});

describe("withMerchantContext — transaction handling with validation", () => {
  it("sets merchant context in transaction and commits on success", async () => {
    const client = createMockClient();
    pool.connect.mockResolvedValue(client);

    const callback = vi.fn().mockResolvedValue({ data: "test" });
    const result = await withMerchantContext("merchant-123", callback);

    expect(result).toEqual({ data: "test" });
    expect(pool.connect).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenCalledWith("BEGIN");
    expect(client.query).toHaveBeenCalledWith("SET LOCAL app.current_merchant_id = $1", ["merchant-123"]);
    expect(client.query).toHaveBeenCalledWith("COMMIT");
    expect(callback).toHaveBeenCalledWith(client);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("rolls back on callback error", async () => {
    const client = createMockClient();
    pool.connect.mockResolvedValue(client);

    const error = new Error("callback failed");
    const callback = vi.fn().mockRejectedValue(error);

    await expect(withMerchantContext("merchant-123", callback)).rejects.toThrow("callback failed");
    expect(client.query).toHaveBeenCalledWith("BEGIN");
    expect(client.query).toHaveBeenCalledWith("SET LOCAL app.current_merchant_id = $1", ["merchant-123"]);
    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
    expect(client.query).not.toHaveBeenCalledWith("COMMIT");
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("throws if merchantId is invalid", async () => {
    const callback = vi.fn();
    await expect(withMerchantContext("", callback)).rejects.toThrow("Invalid merchantId");
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it("throws if callback is not a function", async () => {
    await expect(withMerchantContext("merchant-123", null)).rejects.toThrow("callback must be a function");
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it("throws if callback is not a function (string)", async () => {
    await expect(withMerchantContext("merchant-123", "not-a-function")).rejects.toThrow("callback must be a function");
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it("handles rollback failure gracefully", async () => {
    const client = createMockClient();
    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // SET LOCAL
      .mockRejectedValueOnce(new Error("rollback failed")); // ROLLBACK fails

    pool.connect.mockResolvedValue(client);

    const error = new Error("callback failed");
    const callback = vi.fn().mockRejectedValue(error);

    await expect(withMerchantContext("merchant-123", callback)).rejects.toThrow("callback failed");
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("handles connection errors", async () => {
    pool.connect.mockRejectedValue(new Error("connection failed"));
    const callback = vi.fn();
    await expect(withMerchantContext("merchant-123", callback)).rejects.toThrow("connection failed");
  });
});
