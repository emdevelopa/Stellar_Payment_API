import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Timeline, { type AuditLog, type PaymentLifecycleStep } from "../Timeline";

const SAMPLE_LOGS: AuditLog[] = [
  {
    id: "evt-1",
    action: "Payment Intent Created",
    field_changed: "status",
    old_value: "draft",
    new_value: "pending",
    created_at: "2026-11-21T10:00:00.000Z",
    status: "pending",
  },
  {
    id: "evt-2",
    action: "Stellar Ledger Confirmed",
    field_changed: "status",
    old_value: "pending",
    new_value: "confirmed",
    created_at: "2026-11-21T10:00:05.000Z",
    tx_hash: "abc123stellarhash",
    ledger: 52100442,
    status: "confirmed",
  },
];

const SAMPLE_STEPS: PaymentLifecycleStep[] = [
  { id: "s1", label: "Created", status: "completed" },
  { id: "s2", label: "Submitted", status: "completed" },
  { id: "s3", label: "Confirmed", status: "current" },
  { id: "s4", label: "Settled", status: "upcoming" },
];

describe("Timeline", () => {
  it("renders empty state when logs array is empty", () => {
    render(<Timeline logs={[]} />);
    expect(screen.getByRole("status")).toHaveTextContent("No activity yet");
  });

  it("renders timeline items without eagerly mounting detail panels", () => {
    render(<Timeline logs={SAMPLE_LOGS} />);

    expect(screen.getByText("Payment Intent Created")).toBeInTheDocument();
    expect(screen.getByText("Stellar Ledger Confirmed")).toBeInTheDocument();
    expect(screen.queryByText("Ledger Event Details")).not.toBeInTheDocument();
  });

  it("dynamically loads and toggles the detail panel on inspect click", async () => {
    const onSelectLog = vi.fn();
    render(<Timeline logs={SAMPLE_LOGS} onSelectLog={onSelectLog} />);

    const inspectButtons = screen.getAllByRole("button", { name: /inspect/i });
    fireEvent.click(inspectButtons[1]);

    expect(onSelectLog).toHaveBeenCalledWith(SAMPLE_LOGS[1]);

    await waitFor(() => {
      expect(screen.getByText("Ledger Event Details")).toBeInTheDocument();
      expect(screen.getByText("abc123stellarhash")).toBeInTheDocument();
      expect(screen.getByText("#52100442")).toBeInTheDocument();
    });

    const closeBtn = screen.getByRole("button", { name: /close event details/i });
    fireEvent.click(closeBtn);

    expect(screen.queryByText("Ledger Event Details")).not.toBeInTheDocument();
  });

  it("dynamically loads the progress stepper when showProgressStepper is enabled", async () => {
    render(
      <Timeline
        logs={SAMPLE_LOGS}
        steps={SAMPLE_STEPS}
        showProgressStepper
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("navigation", { name: /payment lifecycle progress/i }),
      ).toBeInTheDocument();
      expect(screen.getByText("Created")).toBeInTheDocument();
      expect(screen.getByText("Settled")).toBeInTheDocument();
    });
  });
});
