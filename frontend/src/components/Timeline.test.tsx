/** @vitest-environment jsdom */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const { mockToastError, mockToastSuccess } = vi.hoisted(() => ({
  mockToastError: vi.fn(),
  mockToastSuccess: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: mockToastError,
    success: mockToastSuccess,
  },
}));

import Timeline, { type AuditLog } from "./Timeline";

const SAMPLE_LOGS: AuditLog[] = [
  {
    id: "log-1",
    action: "Payment submitted",
    field_changed: "status",
    old_value: "draft",
    new_value: "pending",
    created_at: "2026-01-15T10:00:00.000Z",
    status: "pending",
    ledger_sequence: 51234001,
  },
  {
    id: "log-2",
    action: "Horizon confirmation",
    created_at: "2026-01-15T10:01:00.000Z",
    status: "failed",
  },
];

describe("Timeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders empty state when logs array is empty", () => {
    render(<Timeline logs={[]} />);
    expect(screen.getByText("No activity yet")).toBeInTheDocument();
  });

  it("renders timeline items with accessible list semantics and metadata", () => {
    render(<Timeline logs={SAMPLE_LOGS} />);
    expect(screen.getByRole("list")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("Payment submitted")).toBeInTheDocument();
    expect(screen.getByText("status: draft → pending")).toBeInTheDocument();
    expect(screen.getByText("Ledger #51234001")).toBeInTheDocument();
  });

  it("optimistically updates status and confirms on successful retry", async () => {
    const onRetryStep = vi.fn().mockResolvedValue(undefined);
    render(<Timeline logs={SAMPLE_LOGS} onRetryStep={onRetryStep} />);

    fireEvent.click(screen.getByRole("button", { name: /Retry Horizon confirmation/i }));

    await waitFor(() => {
      expect(onRetryStep).toHaveBeenCalledWith(SAMPLE_LOGS[1]);
    });

    await waitFor(() => {
      expect(screen.getByText("confirmed")).toBeInTheDocument();
    });
    expect(mockToastSuccess).toHaveBeenCalledWith(
      '"Horizon confirmation" confirmed on Stellar ledger.',
    );
  });

  it("rolls back optimistic retry state and shows error toast on network failure", async () => {
    const networkError = new Error("Horizon RPC timeout");
    const onRetryStep = vi.fn().mockRejectedValue(networkError);
    const onRollback = vi.fn();

    render(
      <Timeline
        logs={SAMPLE_LOGS}
        onRetryStep={onRetryStep}
        onRollback={onRollback}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Retry Horizon confirmation/i }));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(
        "Horizon RPC timeout",
        expect.objectContaining({
          description: expect.stringContaining("Horizon confirmation"),
          action: expect.objectContaining({ label: "Retry" }),
        }),
      );
    });

    expect(onRollback).toHaveBeenCalledWith(networkError, SAMPLE_LOGS);
    expect(screen.getByText("failed")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      /Failed to update Horizon confirmation\. Reverted to previous state\./i,
    );
  });

  it("rolls back optimistic status sync on network failure and allows retry via toast action", async () => {
    const onSyncStatus = vi
      .fn()
      .mockRejectedValueOnce(new Error("Ledger unavailable"))
      .mockResolvedValueOnce(undefined);

    render(<Timeline logs={SAMPLE_LOGS} onSyncStatus={onSyncStatus} />);

    fireEvent.click(screen.getByRole("button", { name: /Confirm Payment submitted/i }));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(
        "Ledger unavailable",
        expect.objectContaining({
          action: expect.objectContaining({ label: "Retry" }),
        }),
      );
    });

    // Reverted back to pending
    expect(screen.getByText("pending")).toBeInTheDocument();

    // Trigger retry from toast action
    const toastOptions = mockToastError.mock.calls[0][1];
    toastOptions.action.onClick();

    await waitFor(() => {
      expect(onSyncStatus).toHaveBeenCalledTimes(2);
    });
  });

  it("optimistically appends an event and rolls back if onAddEvent rejects", async () => {
    const onAddEvent = vi.fn().mockRejectedValue(new Error("Offline"));
    const onRollback = vi.fn();

    render(
      <Timeline
        logs={SAMPLE_LOGS}
        onAddEvent={onAddEvent}
        onRollback={onRollback}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Record sync check/i }));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(
        "Offline",
        expect.objectContaining({
          description: expect.stringContaining("Manual ledger sync"),
        }),
      );
    });

    expect(onRollback).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
});
