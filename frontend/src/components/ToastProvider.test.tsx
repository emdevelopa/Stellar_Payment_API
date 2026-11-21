import React, { useState } from "react";
import { render, fireEvent, waitFor, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import ToastProvider, {
  useToast,
  executeOptimisticRollback,
  useOptimisticRollback,
  toast,
} from "./ToastProvider";
import { toast as sonnerToast } from "sonner";

vi.mock("sonner", () => ({
  Toaster: vi.fn(({ position }: { position?: string }) => (
    <div data-testid="sonner-toaster" data-position={position} />
  )),
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
  },
}));

const TestComponent = () => {
  const [count, setCount] = useState(0);
  const runOptimistic = useOptimisticRollback();

  const handleSuccess = () => {
    runOptimistic({
      applyOptimistic: () => setCount((c) => c + 1),
      rollback: () => setCount((c) => c - 1),
      action: async () => "ok",
      successMessage: "Count updated successfully",
    });
  };

  const handleFailure = () => {
    runOptimistic({
      applyOptimistic: () => setCount((c) => c + 1),
      rollback: () => setCount((c) => c - 1),
      action: async () => {
        throw new Error("Network timeout");
      },
      errorMessage: "Network request failed. Changes rolled back.",
      onRetry: () => {},
    });
  };

  return (
    <div>
      <div data-testid="count">{count}</div>
      <button onClick={handleSuccess}>Success</button>
      <button onClick={handleFailure}>Failure</button>
    </div>
  );
};

describe("ToastProvider and Optimistic State Rollback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders ToastProvider with live region and Toaster without crashing", () => {
    render(<ToastProvider />);
    expect(screen.getByTestId("sonner-toaster")).toBeInTheDocument();
    const liveRegion = screen.getByTestId("live-region");
    expect(liveRegion).toBeInTheDocument();
    expect(liveRegion).toHaveAttribute("role", "status");
  });

  it("applies optimistic update, succeeds, no rollback, shows success toast", async () => {
    render(
      <ToastProvider>
        <TestComponent />
      </ToastProvider>
    );

    const button = screen.getByText("Success");
    fireEvent.click(button);

    await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("1"));
    expect(sonnerToast.success).toHaveBeenCalledWith("Count updated successfully");
    const liveRegion = screen.getByTestId("live-region");
    expect(liveRegion).toHaveTextContent("Count updated successfully");
  });

  it("applies optimistic update, catches network failure, immediately rolls back, and shows error toast with retry action", async () => {
    render(
      <ToastProvider>
        <TestComponent />
      </ToastProvider>
    );

    const button = screen.getByText("Failure");
    fireEvent.click(button);

    await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("0"));

    expect(sonnerToast.error).toHaveBeenCalledWith(
      "Network request failed. Changes rolled back.",
      expect.objectContaining({
        description: "State was restored to its previous value.",
        action: expect.objectContaining({ label: "Retry" }),
      })
    );

    const liveRegion = screen.getByTestId("live-region");
    expect(liveRegion).toHaveTextContent("Network request failed. Changes rolled back.");
    expect(liveRegion).toHaveAttribute("aria-live", "assertive");
  });

  it("executes retry action successfully when invoked", async () => {
    const applyOptimistic = vi.fn();
    const rollback = vi.fn();
    const action = vi.fn().mockRejectedValueOnce(new Error("Fail")).mockResolvedValueOnce("Retry ok");
    const onRetry = vi.fn();

    await executeOptimisticRollback({
      applyOptimistic,
      rollback,
      action,
      onRetry,
    });

    expect(applyOptimistic).toHaveBeenCalledTimes(1);
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(sonnerToast.error).toHaveBeenCalledWith(
      "Network failure. Changes were rolled back.",
      expect.objectContaining({
        action: expect.objectContaining({ label: "Retry" }),
      })
    );

    const errorOptions = vi.mocked(sonnerToast.error).mock.calls[0][1] as any;
    expect(errorOptions.action).toBeDefined();
    await errorOptions.action.onClick();

    expect(applyOptimistic).toHaveBeenCalledTimes(2);
    expect(sonnerToast.success).toHaveBeenCalledWith("Operation completed successfully");
  });
});
