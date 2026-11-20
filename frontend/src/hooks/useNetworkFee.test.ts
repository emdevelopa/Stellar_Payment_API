import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useNetworkFee, type NetworkFeeData } from "./useNetworkFee";

const FEE: NetworkFeeData = {
  network: "testnet",
  horizon_url: "https://horizon-testnet.stellar.org",
  operation_count: 1,
  stroops: 100,
  xlm: "0.0000100",
  last_ledger_base_fee: 100,
};

const SURGE_FEE: NetworkFeeData = {
  ...FEE,
  stroops: 5000,
  xlm: "0.0005000",
  last_ledger_base_fee: 5000,
};

const okResponse = (fee: NetworkFeeData) => ({
  ok: true,
  json: async () => ({ network_fee: fee }),
});

/** The part of the hook result that is data; `refetch` is a function. */
const view = (result: { current: ReturnType<typeof useNetworkFee> }) => ({
  fee: result.current.fee,
  isLoading: result.current.isLoading,
  error: result.current.error,
});

const abortError = () => {
  const err = new Error("aborted");
  err.name = "AbortError";
  return err;
};

describe("useNetworkFee", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("state snapshots", () => {
    it("loading state while the first request is in flight", () => {
      fetchMock.mockReturnValue(new Promise(() => undefined));

      const { result } = renderHook(() => useNetworkFee());

      expect(view(result)).toMatchInlineSnapshot(`
        {
          "error": null,
          "fee": null,
          "isLoading": true,
        }
      `);
    });

    it("loaded state after a successful response", async () => {
      fetchMock.mockResolvedValue(okResponse(FEE));

      const { result } = renderHook(() => useNetworkFee());
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(view(result)).toMatchInlineSnapshot(`
        {
          "error": null,
          "fee": {
            "horizon_url": "https://horizon-testnet.stellar.org",
            "last_ledger_base_fee": 100,
            "network": "testnet",
            "operation_count": 1,
            "stroops": 100,
            "xlm": "0.0000100",
          },
          "isLoading": false,
        }
      `);
    });

    it("error state after a failed response", async () => {
      fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });

      const { result } = renderHook(() => useNetworkFee());
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(view(result)).toMatchInlineSnapshot(`
        {
          "error": "Network fee unavailable right now.",
          "fee": null,
          "isLoading": false,
        }
      `);
    });

    it("idle state when the hook is disabled", () => {
      const { result } = renderHook(() => useNetworkFee(false));

      expect(view(result)).toMatchInlineSnapshot(`
        {
          "error": null,
          "fee": null,
          "isLoading": false,
        }
      `);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("fetching", () => {
    it("requests the network-fee endpoint with an abort signal", async () => {
      fetchMock.mockResolvedValue(okResponse(FEE));

      const { result } = renderHook(() => useNetworkFee());
      await waitFor(() => expect(result.current.fee).toEqual(FEE));

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toMatch(/\/api\/network-fee$/);
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it("clears the previous error when a request starts", async () => {
      fetchMock.mockRejectedValueOnce(new Error("boom"));
      const { result } = renderHook(() => useNetworkFee());
      await waitFor(() => expect(result.current.error).not.toBeNull());

      fetchMock.mockReturnValueOnce(new Promise(() => undefined));
      act(() => {
        result.current.refetch();
      });

      expect(result.current.error).toBeNull();
      expect(result.current.isLoading).toBe(true);
    });
  });

  describe("user interaction: refetch", () => {
    it("shows a surge fee after the user refreshes", async () => {
      fetchMock.mockResolvedValueOnce(okResponse(FEE));
      const { result } = renderHook(() => useNetworkFee());
      await waitFor(() => expect(result.current.fee?.stroops).toBe(100));

      fetchMock.mockResolvedValueOnce(okResponse(SURGE_FEE));
      await act(async () => {
        result.current.refetch();
      });

      await waitFor(() => expect(result.current.fee?.stroops).toBe(5000));
      expect(result.current.fee?.xlm).toBe("0.0005000");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("recovers from an error on refetch", async () => {
      fetchMock.mockRejectedValueOnce(new Error("offline"));
      const { result } = renderHook(() => useNetworkFee());
      await waitFor(() => expect(result.current.error).toBe("Network fee unavailable right now."));

      fetchMock.mockResolvedValueOnce(okResponse(FEE));
      await act(async () => {
        result.current.refetch();
      });

      await waitFor(() => expect(result.current.fee).toEqual(FEE));
      expect(result.current.error).toBeNull();
    });

    it("drops a stale fee when a later refetch fails", async () => {
      fetchMock.mockResolvedValueOnce(okResponse(FEE));
      const { result } = renderHook(() => useNetworkFee());
      await waitFor(() => expect(result.current.fee).toEqual(FEE));

      fetchMock.mockRejectedValueOnce(new Error("timeout"));
      await act(async () => {
        result.current.refetch();
      });

      await waitFor(() => expect(result.current.error).not.toBeNull());
      expect(result.current.fee).toBeNull();
    });
  });

  describe("failure paths", () => {
    it("reports an error for a non-ok HTTP status", async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });

      const { result } = renderHook(() => useNetworkFee());
      await waitFor(() => expect(result.current.error).toBe("Network fee unavailable right now."));

      expect(result.current.fee).toBeNull();
      expect(result.current.isLoading).toBe(false);
    });

    it("reports an error when the request rejects", async () => {
      fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

      const { result } = renderHook(() => useNetworkFee());
      await waitFor(() => expect(result.current.error).toBe("Network fee unavailable right now."));

      expect(result.current.fee).toBeNull();
    });

    it("reports an error when the body is not valid JSON", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => {
          throw new SyntaxError("Unexpected token");
        },
      });

      const { result } = renderHook(() => useNetworkFee());
      await waitFor(() => expect(result.current.error).toBe("Network fee unavailable right now."));

      expect(result.current.fee).toBeNull();
    });

    it("does not report an error for an aborted request", async () => {
      fetchMock.mockRejectedValue(abortError());

      const { result } = renderHook(() => useNetworkFee());
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.error).toBeNull();
      expect(result.current.fee).toBeNull();
    });
  });

  describe("cancellation", () => {
    it("aborts the previous request when a new one starts", () => {
      const signals: AbortSignal[] = [];
      fetchMock.mockImplementation((_url: string, init: { signal: AbortSignal }) => {
        signals.push(init.signal);
        return new Promise(() => undefined);
      });
      const { result } = renderHook(() => useNetworkFee());

      act(() => {
        result.current.refetch();
      });

      expect(signals).toHaveLength(2);
      expect(signals[0].aborted).toBe(true);
      expect(signals[1].aborted).toBe(false);
    });

    it("aborts the in-flight request on unmount", () => {
      const signals: AbortSignal[] = [];
      fetchMock.mockImplementation((_url: string, init: { signal: AbortSignal }) => {
        signals.push(init.signal);
        return new Promise(() => undefined);
      });
      const { unmount } = renderHook(() => useNetworkFee());

      unmount();

      expect(signals[0].aborted).toBe(true);
    });
  });

  describe("enabled flag", () => {
    it("does not fetch while disabled, even on refetch", () => {
      const { result } = renderHook(() => useNetworkFee(false));

      act(() => {
        result.current.refetch();
      });

      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.current.isLoading).toBe(false);
    });

    it("fetches once it becomes enabled", async () => {
      fetchMock.mockResolvedValue(okResponse(FEE));
      const { result, rerender } = renderHook(({ enabled }) => useNetworkFee(enabled), {
        initialProps: { enabled: false },
      });
      expect(fetchMock).not.toHaveBeenCalled();

      rerender({ enabled: true });

      await waitFor(() => expect(result.current.fee).toEqual(FEE));
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
