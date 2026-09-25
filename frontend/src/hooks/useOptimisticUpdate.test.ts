import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useOptimisticUpdate } from "./useOptimisticUpdate";

describe("useOptimisticUpdate", () => {
  it("should update state optimistically and stay updated on success", async () => {
    const { result } = renderHook(() => useOptimisticUpdate("idle"));

    const apiFn = vi.fn().mockResolvedValue(undefined);

    await act(async () => {
      await result.current.executeUpdate(() => "loading", apiFn);
    });

    expect(result.current.state).toBe("loading");
    expect(apiFn).toHaveBeenCalled();
  });

  it("should rollback state on failure", async () => {
    const { result } = renderHook(() => useOptimisticUpdate("idle"));

    const apiFn = vi.fn().mockRejectedValue(new Error("API Error"));

    await act(async () => {
      await result.current.executeUpdate(() => "loading", apiFn);
    });

    expect(result.current.state).toBe("idle"); // Rolled back
    expect(apiFn).toHaveBeenCalled();
  });
});
