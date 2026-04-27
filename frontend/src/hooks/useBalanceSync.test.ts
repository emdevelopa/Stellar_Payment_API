import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useBalanceSync } from "./useBalanceSync";

describe("useBalanceSync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should fetch balances on mount", async () => {
    const mockBalances = [{ code: "XLM", balance: "100" }];
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ balances: mockBalances }),
    });

    const { result } = renderHook(() => 
      useBalanceSync("m1", "k1", { pollingInterval: 1000 })
    );

    await act(async () => {
      // Fetch on mount
    });

    expect(global.fetch).toHaveBeenCalled();
  });

  it("should poll for balances", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ balances: [] }),
    });

    renderHook(() => 
      useBalanceSync("m1", "k1", { pollingInterval: 1000 })
    );

    expect(global.fetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
