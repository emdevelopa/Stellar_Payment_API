import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPoolQuery, mockClientQuery, mockIsRetryablePoolError, mockCircuitExecute } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockClientQuery: vi.fn(),
  mockIsRetryablePoolError: vi.fn(() => false),
  mockCircuitExecute: vi.fn((fn) => fn()),
}));

vi.mock("../lib/db.js", () => ({
  pool: { query: mockPoolQuery },
  isRetryablePoolError: mockIsRetryablePoolError,
  circuitBreaker: { execute: mockCircuitExecute },
  queryWithRetry: async (text, values) => {
    return mockPoolQuery(text, values);
  },
}));

vi.mock("../lib/db-rls.js", () => ({
  withMerchantContext: async (_merchantId, callback) => {
    return callback({ query: mockClientQuery });
  },
}));

import { metricService } from "./metricService.js";

describe("metricService.getMonthlySummary", () => {
  beforeEach(() => {
    mockClientQuery.mockReset();
    mockCircuitExecute.mockReset();
    mockCircuitExecute.mockImplementation((fn) => fn());
  });

  it("issues a single combined query instead of two sequential queries", async () => {
    mockClientQuery.mockResolvedValue({
      rows: [
        {
          asset: "USDC",
          asset_issuer: "GISSUER",
          last_month_total: "100.0000000",
          last_month_count: 2,
          current_month_total: "50.0000000",
          current_month_count: 1,
        },
      ],
    });

    const result = await metricService.getMonthlySummary("merchant-1");

    expect(mockClientQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockClientQuery.mock.calls[0];
    expect(sql).toMatch(/FILTER \(WHERE/);
    expect(params[0]).toBe("merchant-1");

    expect(result.last_month.by_asset).toEqual([
      { asset: "USDC", asset_issuer: "GISSUER", total: "100.0000000", count: 2 },
    ]);
    expect(result.current_month.by_asset).toEqual([
      { asset: "USDC", asset_issuer: "GISSUER", total: "50.0000000", count: 1 },
    ]);
    expect(result.last_month.total).toBe(100);
    expect(result.current_month.total).toBe(50);
  });

  it("omits assets with zero activity in a given period", async () => {
    mockClientQuery.mockResolvedValue({
      rows: [
        {
          asset: "XLM",
          asset_issuer: null,
          last_month_total: null,
          last_month_count: 0,
          current_month_total: "10.0000000",
          current_month_count: 1,
        },
      ],
    });

    const result = await metricService.getMonthlySummary("merchant-1");

    expect(result.last_month.by_asset).toEqual([]);
    expect(result.current_month.by_asset).toEqual([
      { asset: "XLM", asset_issuer: null, total: "10.0000000", count: 1 },
    ]);
  });

  it("retries on a retryable connection error and succeeds on the next attempt", async () => {
    mockIsRetryablePoolError.mockReturnValueOnce(true);
    mockClientQuery
      .mockRejectedValueOnce(Object.assign(new Error("connection terminated"), { code: "08006" }))
      .mockResolvedValueOnce({ rows: [] });

    const result = await metricService.getMonthlySummary("merchant-1");

    expect(mockClientQuery).toHaveBeenCalledTimes(2);
    expect(mockCircuitExecute).toHaveBeenCalledTimes(1);
    expect(result.last_month.by_asset).toEqual([]);
  });

  it("does not retry non-retryable errors", async () => {
    mockIsRetryablePoolError.mockReturnValueOnce(false);
    mockClientQuery.mockRejectedValueOnce(new Error("syntax error"));

    await expect(metricService.getMonthlySummary("merchant-1")).rejects.toThrow(
      "syntax error",
    );
    expect(mockClientQuery).toHaveBeenCalledTimes(1);
  });
});

describe("metricService.getRevenueByAsset", () => {
  beforeEach(() => {
    mockPoolQuery.mockReset();
  });

  it("returns revenue grouped by asset", async () => {
    mockPoolQuery.mockResolvedValue({
      rows: [{ asset: "USDC", asset_issuer: "GISSUER", total: "10", count: "3" }],
    });

    const result = await metricService.getRevenueByAsset("merchant-1");

    expect(result.revenue).toEqual([
      { asset: "USDC", asset_issuer: "GISSUER", total: "10", count: 3 },
    ]);
  });
});

describe("metricService.getVolumeOverTime", () => {
  beforeEach(() => {
    mockPoolQuery.mockReset();
  });

  it("rejects an invalid range before querying", async () => {
    await expect(
      metricService.getVolumeOverTime("merchant-1", "BOGUS"),
    ).rejects.toThrow("Invalid range");
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });

  it("fills date gaps for every asset across the requested range", async () => {
    mockPoolQuery.mockResolvedValue({
      rows: [
        { date: new Date(), asset: "USDC", volume: "5", count: "1" },
      ],
    });

    const result = await metricService.getVolumeOverTime("merchant-1", "7D");

    expect(result.range).toBe("7D");
    expect(result.assets).toEqual(["USDC"]);
    expect(result.data).toHaveLength(7);
    expect(result.data.every((entry) => "USDC" in entry)).toBe(true);
  });
});
