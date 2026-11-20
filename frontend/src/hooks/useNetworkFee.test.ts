import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useNetworkFee, NETWORK_FEE_ERROR_TOAST_ID } from "./useNetworkFee";

const mockToastError = vi.fn();
const mockToastDismiss = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...a: unknown[]) => mockToastError(...a), dismiss: (...a: unknown[]) => mockToastDismiss(...a) },
}));

const FEE = { network: "testnet", horizon_url: "h", operation_count: 1, stroops: 100, xlm: "0.00001", last_ledger_base_fee: 100 };
const fetchMock = vi.fn();

describe("useNetworkFee", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("keeps the last good fee and toasts once when a refetch fails", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ network_fee: FEE }) });
    const { result } = renderHook(() => useNetworkFee());
    await waitFor(() => expect(result.current.fee).toEqual(FEE));
    expect(mockToastDismiss).toHaveBeenCalledWith(NETWORK_FEE_ERROR_TOAST_ID);

    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await act(async () => result.current.refetch());

    await waitFor(() => expect(result.current.error).toBe("Network fee unavailable right now."));
    expect(result.current.fee).toEqual(FEE);
    expect(mockToastError).toHaveBeenCalledTimes(1);
    expect(mockToastError).toHaveBeenCalledWith("Network fee unavailable right now.", { id: NETWORK_FEE_ERROR_TOAST_ID });
  });
});
