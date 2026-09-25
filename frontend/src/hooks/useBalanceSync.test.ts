import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useBalanceSync,
  balanceSyncReducer,
  initialBalanceSyncState,
} from "./useBalanceSync";

// ─── Pure reducer tests (no hook setup needed) ────────────────────────────────

describe("balanceSyncReducer", () => {
  it("FETCH_START sets isLoading and clears error", () => {
    const s = balanceSyncReducer(
      { ...initialBalanceSyncState, error: "prev error" },
      { type: "FETCH_START" },
    );
    expect(s.isLoading).toBe(true);
    expect(s.error).toBeNull();
  });

  it("FETCH_SUCCESS stores balances and clears optimisticBalances", () => {
    const withOptimistic = balanceSyncReducer(
      initialBalanceSyncState,
      { type: "OPTIMISTIC_UPDATE", code: "XLM", balance: "5" },
    );
    const at = new Date();
    const s = balanceSyncReducer(withOptimistic, {
      type: "FETCH_SUCCESS",
      balances: [{ code: "XLM", balance: "10" }],
      at,
    });
    expect(s.balances).toEqual([{ code: "XLM", balance: "10" }]);
    expect(s.optimisticBalances).toEqual({});
    expect(s.lastUpdated).toBe(at);
  });

  it("OPTIMISTIC_UPDATE stores the override without touching balances", () => {
    const s = balanceSyncReducer(
      initialBalanceSyncState,
      { type: "OPTIMISTIC_UPDATE", code: "USDC", balance: "50" },
    );
    expect(s.optimisticBalances).toEqual({ USDC: "50" });
    expect(s.balances).toHaveLength(0);
  });

  it("FETCH_ERROR stores the message and clears loading", () => {
    const loading = balanceSyncReducer(initialBalanceSyncState, { type: "FETCH_START" });
    const s = balanceSyncReducer(loading, { type: "FETCH_ERROR", error: "oops" });
    expect(s.isLoading).toBe(false);
    expect(s.error).toBe("oops");
  });
});

// ─── Hook integration tests ───────────────────────────────────────────────────

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

  it("fetches from Horizon and normalises balances when an address is given", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        balances: [
          { asset_type: "native", balance: "42.5" },
          { asset_type: "credit_alphanum4", asset_code: "USDC", balance: "10" },
        ],
      }),
    });

    const { result } = renderHook(() =>
      useBalanceSync(null, null, { address: "GABC", pollingInterval: 0 })
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/accounts/GABC"),
      expect.any(Object)
    );
    expect(result.current.balances).toEqual([
      { code: "XLM", balance: "42.5" },
      { code: "USDC", balance: "10" },
    ]);
    expect(result.current.lastUpdated).not.toBeNull();
  });

  it("does not fetch when disabled", () => {
    global.fetch = vi.fn();
    renderHook(() => useBalanceSync("m1", "k1", { enabled: false }));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("applies an optimistic balance immediately without a network call", () => {
    global.fetch = vi.fn();
    const { result } = renderHook(() =>
      useBalanceSync(null, null, { enabled: false })
    );

    act(() => {
      result.current.applyOptimistic("XLM", "7.5");
    });
    expect(result.current.balances).toEqual([{ code: "XLM", balance: "7.5" }]);

    act(() => {
      result.current.applyOptimistic("XLM", "9");
    });
    expect(result.current.balances).toEqual([{ code: "XLM", balance: "9" }]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("reports the balance as stale until the first successful sync", () => {
    global.fetch = vi.fn();
    const { result } = renderHook(() =>
      useBalanceSync("m1", "k1", { enabled: false, pollingInterval: 1000 })
    );
    expect(result.current.isStale).toBe(true);
  });
});
