/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTransactionFilters } from "./useTransactionFilters";
import { DEFAULT_PAYMENT_HISTORY_FILTERS } from "@/lib/payment-history-filters";

// Mock useTransition so we can control pending state
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useTransition: () => {
      const [isPending, setIsPending] = actual.useState(false);
      const startTransition = (fn: () => void) => {
        setIsPending(true);
        fn();
        setIsPending(false);
      };
      return [isPending, startTransition];
    },
  };
});

describe("useTransactionFilters", () => {
  let pushSearchParams: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    pushSearchParams = vi.fn();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("initialises with default filters when no searchParams provided", () => {
    const { result } = renderHook(() => useTransactionFilters(pushSearchParams));

    expect(result.current.filters).toEqual(DEFAULT_PAYMENT_HISTORY_FILTERS);
    expect(result.current.hasActiveFilters).toBe(false);
    expect(result.current.searchSyncPending).toBe(false);
  });

  it("initialises from provided URLSearchParams", () => {
    const params = new URLSearchParams("search=foo&status=confirmed&asset=USDC");
    const { result } = renderHook(() =>
      useTransactionFilters(pushSearchParams, params),
    );

    expect(result.current.filters.search).toBe("foo");
    expect(result.current.filters.status).toBe("confirmed");
    expect(result.current.filters.asset).toBe("USDC");
  });

  // ── onFilterChange (search) ─────────────────────────────────────────────

  describe("onFilterChange — search (debounced)", () => {
    it("updates draft state immediately", () => {
      const { result } = renderHook(() => useTransactionFilters(pushSearchParams));

      act(() => {
        result.current.onFilterChange("search", "hello");
      });

      expect(result.current.filters.search).toBe("hello");
    });

    it("sets searchSyncPending to true immediately", () => {
      const { result } = renderHook(() => useTransactionFilters(pushSearchParams));

      act(() => {
        result.current.onFilterChange("search", "hello");
      });

      expect(result.current.searchSyncPending).toBe(true);
    });

    it("does NOT call pushSearchParams immediately", () => {
      const { result } = renderHook(() => useTransactionFilters(pushSearchParams));

      act(() => {
        result.current.onFilterChange("search", "hello");
      });

      expect(pushSearchParams).not.toHaveBeenCalled();
    });

    it("calls pushSearchParams after 350 ms debounce", async () => {
      const { result } = renderHook(() => useTransactionFilters(pushSearchParams));

      act(() => {
        result.current.onFilterChange("search", "hello");
      });

      act(() => {
        vi.advanceTimersByTime(350);
      });

      expect(pushSearchParams).toHaveBeenCalledTimes(1);

      const called = pushSearchParams.mock.calls[0][0] as URLSearchParams;
      expect(called.get("search")).toBe("hello");
    });

    it("clears searchSyncPending after debounce resolves", async () => {
      const { result } = renderHook(() => useTransactionFilters(pushSearchParams));

      act(() => {
        result.current.onFilterChange("search", "hello");
      });

      act(() => {
        vi.advanceTimersByTime(350);
      });

      expect(result.current.searchSyncPending).toBe(false);
    });

    it("debounces rapid keystrokes — only one push after silence", async () => {
      const { result } = renderHook(() => useTransactionFilters(pushSearchParams));

      act(() => {
        result.current.onFilterChange("search", "h");
      });
      act(() => {
        vi.advanceTimersByTime(100);
        result.current.onFilterChange("search", "he");
      });
      act(() => {
        vi.advanceTimersByTime(100);
        result.current.onFilterChange("search", "hel");
      });
      act(() => {
        vi.advanceTimersByTime(350);
      });

      expect(pushSearchParams).toHaveBeenCalledTimes(1);

      const called = pushSearchParams.mock.calls[0][0] as URLSearchParams;
      expect(called.get("search")).toBe("hel");
    });
  });

  // ── onFilterChange (non-search) ─────────────────────────────────────────

  describe("onFilterChange — non-search (immediate)", () => {
    it("updates draft state immediately for status", () => {
      const { result } = renderHook(() => useTransactionFilters(pushSearchParams));

      act(() => {
        result.current.onFilterChange("status", "confirmed");
      });

      expect(result.current.filters.status).toBe("confirmed");
    });

    it("calls pushSearchParams synchronously for non-search filters", () => {
      const { result } = renderHook(() => useTransactionFilters(pushSearchParams));

      act(() => {
        result.current.onFilterChange("asset", "USDC");
      });

      expect(pushSearchParams).toHaveBeenCalledTimes(1);
      const params = pushSearchParams.mock.calls[0][0] as URLSearchParams;
      expect(params.get("asset")).toBe("USDC");
    });

    it("does NOT set searchSyncPending for non-search changes", () => {
      const { result } = renderHook(() => useTransactionFilters(pushSearchParams));

      act(() => {
        result.current.onFilterChange("asset", "XLM");
      });

      expect(result.current.searchSyncPending).toBe(false);
    });
  });

  // ── onClearFilter ───────────────────────────────────────────────────────

  describe("onClearFilter", () => {
    it("clears search immediately and cancels pending debounce", async () => {
      const { result } = renderHook(() => useTransactionFilters(pushSearchParams));

      act(() => {
        result.current.onFilterChange("search", "hello");
      });

      // Cancel the pending debounce by clearing before timer fires
      act(() => {
        result.current.onClearFilter("search");
      });

      act(() => {
        vi.advanceTimersByTime(350);
      });

      expect(result.current.filters.search).toBe("");
      expect(result.current.searchSyncPending).toBe(false);
      // pushSearchParams should be called once for the clear, not for the debounce
      expect(pushSearchParams).toHaveBeenCalledTimes(1);
    });

    it("clears non-search filters and pushes immediately", () => {
      const { result } = renderHook(() =>
        useTransactionFilters(
          pushSearchParams,
          new URLSearchParams("status=confirmed"),
        ),
      );

      act(() => {
        result.current.onClearFilter("status");
      });

      expect(result.current.filters.status).toBe("all");
      expect(pushSearchParams).toHaveBeenCalledTimes(1);
    });
  });

  // ── onClearAll ──────────────────────────────────────────────────────────

  describe("onClearAll", () => {
    it("resets all filters to defaults", () => {
      const { result } = renderHook(() =>
        useTransactionFilters(
          pushSearchParams,
          new URLSearchParams("search=foo&status=confirmed&asset=USDC"),
        ),
      );

      act(() => {
        result.current.onClearAll();
      });

      expect(result.current.filters).toEqual(DEFAULT_PAYMENT_HISTORY_FILTERS);
    });

    it("pushes empty URLSearchParams", () => {
      const { result } = renderHook(() =>
        useTransactionFilters(
          pushSearchParams,
          new URLSearchParams("status=confirmed"),
        ),
      );

      act(() => {
        result.current.onClearAll();
      });

      const params = pushSearchParams.mock.calls[0][0] as URLSearchParams;
      expect(params.toString()).toBe("");
    });

    it("cancels any pending search debounce", async () => {
      const { result } = renderHook(() => useTransactionFilters(pushSearchParams));

      act(() => {
        result.current.onFilterChange("search", "hello");
      });

      act(() => {
        result.current.onClearAll();
      });

      act(() => {
        vi.advanceTimersByTime(350);
      });

      // Only one push (the clear), not two
      expect(pushSearchParams).toHaveBeenCalledTimes(1);
      expect(result.current.searchSyncPending).toBe(false);
    });
  });

  // ── hasActiveFilters ────────────────────────────────────────────────────

  describe("hasActiveFilters", () => {
    it("is false with default filters", () => {
      const { result } = renderHook(() => useTransactionFilters(pushSearchParams));
      expect(result.current.hasActiveFilters).toBe(false);
    });

    it("is true immediately after a filter change (optimistic)", () => {
      const { result } = renderHook(() => useTransactionFilters(pushSearchParams));

      act(() => {
        result.current.onFilterChange("search", "q");
      });

      expect(result.current.hasActiveFilters).toBe(true);
    });
  });
});
