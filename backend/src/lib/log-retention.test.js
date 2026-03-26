import { describe, expect, it, vi } from "vitest";
import { purgeWebhookLogs } from "./log-retention.js";

describe("purgeWebhookLogs", () => {
  it("deletes old rows in batches until empty and returns totals", async () => {
    const query = vi
      .fn()
      // validate index
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] })
      // validate no FK references
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      // delete loops
      .mockResolvedValueOnce({ rowCount: 2, rows: [{ id: "1" }, { id: "2" }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: "3" }] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const pool = { query };

    const result = await purgeWebhookLogs({
      pool,
      retentionDays: 30,
      batchSize: 2,
      maxDurationMs: 10_000,
    });

    expect(result.totalDeleted).toBe(3);
    expect(result.retentionDays).toBe(30);
    expect(result.batchSize).toBe(2);
    expect(query).toHaveBeenCalledTimes(5);
  });

  it("throws when timestamp index is missing", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const pool = { query };

    await expect(
      purgeWebhookLogs({
        pool,
        retentionDays: 30,
        batchSize: 1000,
      }),
    ).rejects.toThrow("Missing index");
  });
});
