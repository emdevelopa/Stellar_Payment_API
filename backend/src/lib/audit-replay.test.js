import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import { Readable } from "node:stream";
import { replayFallbackLogs, isReplaying } from "./audit-replay.js";
import { pool } from "./db.js";

// Mock dependencies
const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}));

vi.mock("./db.js", () => ({
  pool: { query: mockQuery },
}));

vi.mock("./audit-security.js", () => ({
  hashAuditPayload: vi.fn(() => "mock-hash"),
  signAuditPayload: vi.fn(() => "mock-signature"),
}));

vi.mock("./logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("audit-replay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should do nothing if fallback file does not exist", async () => {
    const existsSpy = vi.spyOn(fs, "existsSync").mockReturnValue(false);
    await replayFallbackLogs("/path/to/nonexistent.log");
    expect(existsSpy).toHaveBeenCalledWith("/path/to/nonexistent.log");
    expect(mockQuery).not.toHaveBeenCalled();
    expect(isReplaying()).toBe(false);
  });

  it("should parse and replay valid lines, then delete the tmp file", async () => {
    const logPath = "/path/to/audit_fallback.log";
    const tmpPath = `${logPath}.tmp`;

    const payload1 = { merchant_id: "m1", action: "login", status: "success" };
    const payload2 = { merchant_id: "m2", action: "update", field_changed: "email" };

    const line1 = `2026-06-26T04:00:00.000Z | ${JSON.stringify(payload1)} | error: DB down\n`;
    const line2 = `2026-06-26T04:05:00.000Z | ${JSON.stringify(payload2)} | error: connection timeout\n`;

    const existsSpy = vi.spyOn(fs, "existsSync").mockReturnValue(true);
    const renameSpy = vi.spyOn(fs, "renameSync").mockImplementation(() => {});
    const unlinkSpy = vi.spyOn(fs, "unlinkSync").mockImplementation(() => {});

    // Create a mock stream from lines
    const mockStream = Readable.from([line1, line2]);
    const readStreamSpy = vi.spyOn(fs, "createReadStream").mockReturnValue(mockStream);

    mockQuery.mockResolvedValue({ rows: [] });

    await replayFallbackLogs(logPath);

    expect(existsSpy).toHaveBeenCalledWith(logPath);
    expect(renameSpy).toHaveBeenCalledWith(logPath, tmpPath);
    expect(readStreamSpy).toHaveBeenCalledWith(tmpPath);
    expect(mockQuery).toHaveBeenCalledTimes(2);

    // Verify parameters of the first insertion
    const [query1, params1] = mockQuery.mock.calls[0];
    expect(query1).toContain("INSERT INTO audit_logs");
    expect(params1[0]).toBe("m1");
    expect(params1[1]).toBe("login");
    expect(params1[9]).toEqual(new Date("2026-06-26T04:00:00.000Z"));
    expect(params1[10]).toBe("success");

    // Verify parameters of the second insertion
    const [query2, params2] = mockQuery.mock.calls[1];
    expect(params2[0]).toBe("m2");
    expect(params2[1]).toBe("update");
    expect(params2[2]).toBe("email");
    expect(params2[9]).toEqual(new Date("2026-06-26T04:05:00.000Z"));

    expect(unlinkSpy).toHaveBeenCalledWith(tmpPath);
    expect(isReplaying()).toBe(false);
  });

  it("should write failed replays back to the fallback log", async () => {
    const logPath = "/path/to/audit_fallback.log";
    const tmpPath = `${logPath}.tmp`;

    const payload = { merchant_id: "m1", action: "login", status: "success" };
    const line = `2026-06-26T04:00:00.000Z | ${JSON.stringify(payload)} | error: DB down\n`;

    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "renameSync").mockImplementation(() => {});
    vi.spyOn(fs, "unlinkSync").mockImplementation(() => {});
    const appendSpy = vi.spyOn(fs, "appendFileSync").mockImplementation(() => {});

    const mockStream = Readable.from([line]);
    vi.spyOn(fs, "createReadStream").mockReturnValue(mockStream);

    // Simulate DB insert failing
    mockQuery.mockRejectedValue(new Error("DB still down"));

    await replayFallbackLogs(logPath);

    expect(mockQuery).toHaveBeenCalledOnce();
    expect(appendSpy).toHaveBeenCalledOnce();
    const [writtenPath, writtenContent] = appendSpy.mock.calls[0];
    expect(writtenPath).toBe(logPath);
    expect(writtenContent).toContain(line.trim());
  });
});
