import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Timeline, { AuditLog } from "./Timeline";

const sampleLogs: AuditLog[] = [
  {
    id: "log-1",
    action: "Payment Created",
    created_at: "2026-01-15T10:00:00Z",
    status: "completed",
    ledgerSequence: 51234001,
    confirmations: 1,
    txHash: "abcdef1234567890abcdef1234567890",
  },
  {
    id: "log-2",
    action: "Ledger Submitted",
    field_changed: "status",
    old_value: "pending",
    new_value: "submitted",
    created_at: "2026-01-15T10:00:05Z",
    status: "completed",
    ledgerSequence: 51234002,
    confirmations: 3,
  },
  {
    id: "log-3",
    action: "Awaiting Finality",
    created_at: "2026-01-15T10:00:10Z",
    status: "current",
  },
];

describe("Timeline", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.style.overflow = "";
  });

  it("renders empty state when logs array is empty", () => {
    render(<Timeline logs={[]} />);
    expect(screen.getByText("No activity yet")).toBeInTheDocument();
  });

  it("renders lifecycle steps, field changes, and on-chain metadata inline", () => {
    render(<Timeline logs={sampleLogs} />);

    expect(screen.getByText("Payment Created")).toBeInTheDocument();
    expect(screen.getByText("Ledger Submitted")).toBeInTheDocument();
    expect(screen.getByText("Awaiting Finality")).toBeInTheDocument();
    expect(screen.getByText("status: pending → submitted")).toBeInTheDocument();
    expect(screen.getByText("Ledger #51234001")).toBeInTheDocument();
    expect(screen.getByText("1 confirmation")).toBeInTheDocument();
    expect(screen.getByText("3 confirmations")).toBeInTheDocument();
    expect(screen.getByText("abcdef12...567890")).toBeInTheDocument();

    const progressbar = screen.getByRole("progressbar", {
      name: "Payment lifecycle progress",
    });
    expect(progressbar).toHaveAttribute("aria-valuenow", "67");
  });

  it("infers failed status from action text when status is omitted", () => {
    render(
      <Timeline
        logs={[
          {
            id: "err-1",
            action: "Transaction Failed on Horizon",
            created_at: "2026-01-15T10:05:00Z",
          },
        ]}
      />,
    );

    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("navigates steps via Next/Previous buttons and calls onStepSelect", () => {
    const onStepSelect = vi.fn();
    render(<Timeline logs={sampleLogs} onStepSelect={onStepSelect} />);

    const prevBtn = screen.getByRole("button", { name: "Previous lifecycle step" });
    const nextBtn = screen.getByRole("button", { name: "Next lifecycle step" });

    expect(prevBtn).toBeDisabled();
    expect(screen.getByText("Step 1 of 3")).toBeInTheDocument();

    fireEvent.click(nextBtn);
    expect(screen.getByText("Step 2 of 3")).toBeInTheDocument();
    expect(onStepSelect).toHaveBeenCalledWith(sampleLogs[1], 1);

    fireEvent.click(prevBtn);
    expect(screen.getByText("Step 1 of 3")).toBeInTheDocument();
    expect(onStepSelect).toHaveBeenCalledWith(sampleLogs[0], 0);
  });

  it("supports horizontal touch swipe to navigate between steps", () => {
    const onStepSelect = vi.fn();
    render(<Timeline logs={sampleLogs} onStepSelect={onStepSelect} />);

    const list = screen.getByRole("list");

    // Swipe left -> next step
    fireEvent.touchStart(list, { touches: [{ clientX: 200, clientY: 100 }] });
    fireEvent.touchEnd(list, { changedTouches: [{ clientX: 100, clientY: 105 }] });
    expect(screen.getByText("Step 2 of 3")).toBeInTheDocument();
    expect(onStepSelect).toHaveBeenCalledWith(sampleLogs[1], 1);

    // Swipe right -> previous step
    fireEvent.touchStart(list, { touches: [{ clientX: 100, clientY: 100 }] });
    fireEvent.touchEnd(list, { changedTouches: [{ clientX: 200, clientY: 102 }] });
    expect(screen.getByText("Step 1 of 3")).toBeInTheDocument();
  });

  it("ignores vertical swipes for horizontal step navigation", () => {
    render(<Timeline logs={sampleLogs} />);
    const list = screen.getByRole("list");

    fireEvent.touchStart(list, { touches: [{ clientX: 100, clientY: 100 }] });
    fireEvent.touchEnd(list, { changedTouches: [{ clientX: 120, clientY: 250 }] });
    expect(screen.getByText("Step 1 of 3")).toBeInTheDocument();
  });

  it("renders accessible drawer when variant='drawer' and isOpen=true", () => {
    const onClose = vi.fn();
    render(
      <Timeline
        logs={sampleLogs}
        variant="drawer"
        isOpen={true}
        onClose={onClose}
      />,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(document.body.style.overflow).toBe("hidden");

    // Close via close button
    fireEvent.click(
      screen.getByRole("button", { name: "Close payment lifecycle timeline" }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes drawer on backdrop click and Escape key", () => {
    const onClose = vi.fn();
    render(
      <Timeline
        logs={sampleLogs}
        variant="drawer"
        isOpen={true}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByTestId("timeline-drawer-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("dismisses drawer on downward swipe gesture", () => {
    const onClose = vi.fn();
    render(
      <Timeline
        logs={sampleLogs}
        variant="drawer"
        isOpen={true}
        onClose={onClose}
      />,
    );

    const drawer = screen.getByTestId("timeline-drawer");
    fireEvent.touchStart(drawer, { touches: [{ clientX: 150, clientY: 50 }] });
    fireEvent.touchMove(drawer, { touches: [{ clientX: 150, clientY: 200 }] });
    fireEvent.touchEnd(drawer, { changedTouches: [{ clientX: 150, clientY: 200 }] });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("opens responsive mobile drawer when trigger button is clicked", () => {
    render(<Timeline logs={sampleLogs} variant="responsive" />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    const trigger = screen.getByRole("button", {
      name: /Payment Lifecycle Timeline/i,
    });
    fireEvent.click(trigger);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("handles invalid created_at timestamps gracefully", () => {
    render(
      <Timeline
        logs={[
          {
            id: "bad-date",
            action: "Custom Event",
            created_at: "not-a-date",
          },
        ]}
      />,
    );
    expect(screen.getByText("not-a-date")).toBeInTheDocument();
  });
});
