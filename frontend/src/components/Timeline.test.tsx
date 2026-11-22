/** @vitest-environment jsdom */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

import Timeline, {
  type PaymentLifecycleData,
  type AuditLog,
  type LifecycleStep,
  getDefaultLifecycleSteps,
} from "./Timeline";

// ─── framer-motion mock ───────────────────────────────────────────────────────
vi.mock("framer-motion", () => {
  const strip = (props: Record<string, unknown>) => {
    const { initial: _i, animate: _a, exit: _e, transition: _t, ...rest } = props;
    return rest;
  };

  return {
    motion: {
      div: ({ children, ...p }: any) => <div {...strip(p)}>{children}</div>,
      span: ({ children, ...p }: any) => <span {...strip(p)}>{children}</span>,
    },
    AnimatePresence: ({ children }: any) => <>{children}</>,
  };
});

// ─── Test Fixtures ────────────────────────────────────────────────────────────

const MOCK_LIFECYCLE_CONFIRMED: PaymentLifecycleData = {
  id: "pay_test_987654321",
  status: "confirmed",
  amount: "250.00",
  asset: "USDC",
  txHash: "5f4dcc3b5aa765d61d8327deb882cf992b9699aec8a33c8b8714eb6100c5c2d3",
  ledgerSequence: 52190412,
  confirmations: 3,
  requiredConfirmations: 3,
  createdAt: "2026-11-21T10:00:00.000Z",
  updatedAt: "2026-11-21T10:04:00.000Z",
};

const MOCK_LIFECYCLE_PROCESSING: PaymentLifecycleData = {
  id: "pay_test_processing_123",
  status: "processing",
  amount: "50.00",
  asset: "XLM",
  txHash: "a1b2c3d4e5f678901234567890abcdef1234567890abcdef1234567890abcdef",
  ledgerSequence: 52190500,
  confirmations: 1,
  requiredConfirmations: 3,
  createdAt: "2026-11-21T10:10:00.000Z",
};

const MOCK_LIFECYCLE_FAILED: PaymentLifecycleData = {
  id: "pay_test_failed_456",
  status: "failed",
  amount: "100.00",
  asset: "USDC",
  confirmations: 0,
  requiredConfirmations: 3,
  createdAt: "2026-11-21T10:15:00.000Z",
};

const MOCK_AUDIT_LOGS: AuditLog[] = [
  {
    id: "log_1",
    action: "Payment link created",
    field_changed: "status",
    old_value: "draft",
    new_value: "active",
    created_at: "2026-11-21T09:30:00.000Z",
  },
  {
    id: "log_2",
    action: "Threshold updated",
    field_changed: "confirmations",
    old_value: "1",
    new_value: "3",
    created_at: "2026-11-21T09:35:00.000Z",
  },
];

describe("Timeline Component - Stellar Ledger Payment Lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── 1. Snapshot Tests ────────────────────────────────────────────────────────

  describe("1 · Snapshot Tests", () => {
    it("matches snapshot for confirmed Stellar payment lifecycle", () => {
      const { container } = render(<Timeline lifecycle={MOCK_LIFECYCLE_CONFIRMED} />);
      expect(container).toMatchSnapshot();
    });

    it("matches snapshot for in-progress / processing lifecycle state", () => {
      const { container } = render(<Timeline lifecycle={MOCK_LIFECYCLE_PROCESSING} />);
      expect(container).toMatchSnapshot();
    });

    it("matches snapshot for failed lifecycle state", () => {
      const { container } = render(<Timeline lifecycle={MOCK_LIFECYCLE_FAILED} />);
      expect(container).toMatchSnapshot();
    });

    it("matches snapshot for legacy audit logs", () => {
      const { container } = render(<Timeline logs={MOCK_AUDIT_LOGS} />);
      expect(container).toMatchSnapshot();
    });

    it("matches snapshot for empty audit logs", () => {
      const { container } = render(<Timeline logs={[]} />);
      expect(container).toMatchSnapshot();
    });
  });

  // ── 2. Rendering & Lifecycle Progress Stepper ────────────────────────────────

  describe("2 · Rendering & Lifecycle Progress Stepper", () => {
    it("renders default title and status badge", () => {
      render(<Timeline lifecycle={MOCK_LIFECYCLE_CONFIRMED} />);
      expect(screen.getByRole("region", { name: /Stellar Ledger Payment Lifecycle/i })).toBeInTheDocument();
      expect(screen.getByText("confirmed")).toBeInTheDocument();
      expect(screen.getByText(/Payment ID: pay_test_987654321/i)).toBeInTheDocument();
    });

    it("renders custom title if provided", () => {
      render(
        <Timeline
          lifecycle={MOCK_LIFECYCLE_CONFIRMED}
          title="Custom Stellar Payment Stepper"
        />
      );
      expect(screen.getByRole("region", { name: "Custom Stellar Payment Stepper" })).toBeInTheDocument();
      expect(screen.getByText("Custom Stellar Payment Stepper")).toBeInTheDocument();
    });

    it("renders the progress bar with correct accessible progress value", () => {
      render(<Timeline lifecycle={MOCK_LIFECYCLE_CONFIRMED} />);
      const progressbar = screen.getByRole("progressbar", { name: /Payment lifecycle progress/i });
      expect(progressbar).toBeInTheDocument();
      expect(progressbar).toHaveAttribute("aria-valuenow", "100");
      expect(progressbar).toHaveAttribute("aria-valuemin", "0");
      expect(progressbar).toHaveAttribute("aria-valuemax", "100");
    });

    it("renders on-chain confirmation ticks counter status", () => {
      render(<Timeline lifecycle={MOCK_LIFECYCLE_CONFIRMED} />);
      const liveStatus = screen.getByRole("status");
      expect(liveStatus).toHaveAttribute("aria-live", "polite");
      expect(within(liveStatus).getByText(/On-chain ticks:/i)).toBeInTheDocument();
      expect(within(liveStatus).getByText("3 / 3")).toBeInTheDocument();
    });

    it("renders all 5 default lifecycle steps", () => {
      render(<Timeline lifecycle={MOCK_LIFECYCLE_CONFIRMED} />);
      const list = screen.getByRole("list", { name: /Payment lifecycle steps/i });
      const items = within(list).getAllByRole("listitem");
      expect(items).toHaveLength(5);
      expect(within(list).getByText("Payment Initiated")).toBeInTheDocument();
      expect(within(list).getByText("Cryptographically Signed")).toBeInTheDocument();
      expect(within(list).getByText("Submitted to Horizon")).toBeInTheDocument();
      expect(within(list).getByText("SCP Consensus & Ledger Ingestion")).toBeInTheDocument();
      expect(within(list).getByText("On-Chain Confirmed")).toBeInTheDocument();
    });

    it("marks current active step with aria-current='step'", () => {
      render(<Timeline lifecycle={MOCK_LIFECYCLE_PROCESSING} />);
      const list = screen.getByRole("list", { name: /Payment lifecycle steps/i });
      const currentItem = within(list).getByText("Submitted to Horizon").closest("li");
      expect(currentItem).toHaveAttribute("aria-current", "step");
    });
  });

  // ── 3. User Interactions & Step Details ──────────────────────────────────────

  describe("3 · User Interactions & Step Details", () => {
    it("expands and collapses step details when clicking step header", async () => {
      render(<Timeline lifecycle={MOCK_LIFECYCLE_CONFIRMED} />);
      const initiatedButton = screen.getByRole("button", { name: /Payment Initiated/i });

      // Initially initiated is collapsed (aria-expanded="false")
      expect(initiatedButton).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByText(/USDC/i)).not.toBeInTheDocument();

      // Click to expand
      fireEvent.click(initiatedButton);
      expect(initiatedButton).toHaveAttribute("aria-expanded", "true");

      // Click again to collapse
      fireEvent.click(initiatedButton);
      expect(initiatedButton).toHaveAttribute("aria-expanded", "false");
    });

    it("supports keyboard expansion with Enter and Space keys", async () => {
      render(<Timeline lifecycle={MOCK_LIFECYCLE_CONFIRMED} />);
      const signedButton = screen.getByRole("button", { name: /Cryptographically Signed/i });

      expect(signedButton).toHaveAttribute("aria-expanded", "false");

      // Press Enter
      signedButton.focus();
      fireEvent.keyDown(signedButton, { key: "Enter", code: "Enter" });
      fireEvent.click(signedButton);
      expect(signedButton).toHaveAttribute("aria-expanded", "true");
    });

    it("calls onStepClick callback when a step is clicked", () => {
      const handleStepClick = vi.fn();
      render(
        <Timeline
          lifecycle={MOCK_LIFECYCLE_CONFIRMED}
          onStepClick={handleStepClick}
        />
      );

      const initiatedButton = screen.getByRole("button", { name: /Payment Initiated/i });
      fireEvent.click(initiatedButton);

      expect(handleStepClick).toHaveBeenCalledTimes(1);
      expect(handleStepClick).toHaveBeenCalledWith(
        expect.objectContaining({ id: "initiated", label: "Payment Initiated" }),
        0
      );
    });

    it("copies transaction hash to clipboard when copy button is clicked", async () => {
      const writeTextMock = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, {
        clipboard: {
          writeText: writeTextMock,
        },
      });

      render(<Timeline lifecycle={MOCK_LIFECYCLE_CONFIRMED} />);

      const copyButton = screen.getByRole("button", { name: /Copy transaction hash/i });
      expect(copyButton).toBeInTheDocument();

      fireEvent.click(copyButton);

      expect(writeTextMock).toHaveBeenCalledWith(MOCK_LIFECYCLE_CONFIRMED.txHash);
      expect(screen.getByText("Copied!")).toBeInTheDocument();
    });

    it("renders external explorer link with secure rel attributes", () => {
      render(<Timeline lifecycle={MOCK_LIFECYCLE_CONFIRMED} network="public" />);

      const explorerLink = screen.getByRole("link", { name: /View on Stellar Expert explorer/i });
      expect(explorerLink).toBeInTheDocument();
      expect(explorerLink).toHaveAttribute("target", "_blank");
      expect(explorerLink).toHaveAttribute("rel", "noopener noreferrer");
      expect(explorerLink).toHaveAttribute(
        "href",
        `https://stellar.expert/explorer/public/tx/${MOCK_LIFECYCLE_CONFIRMED.txHash}`
      );
    });

    it("renders testnet explorer link when network='testnet'", () => {
      render(<Timeline lifecycle={MOCK_LIFECYCLE_CONFIRMED} network="testnet" />);

      const explorerLink = screen.getByRole("link", { name: /View on Stellar Expert explorer/i });
      expect(explorerLink).toHaveAttribute(
        "href",
        `https://stellar.expert/explorer/testnet/tx/${MOCK_LIFECYCLE_CONFIRMED.txHash}`
      );
    });
  });

  // ── 4. Error & Edge States ──────────────────────────────────────────────────

  describe("4 · Error & Edge States", () => {
    it("renders failed error message in failed state", () => {
      render(<Timeline lifecycle={MOCK_LIFECYCLE_FAILED} />);
      expect(screen.getByText("failed")).toBeInTheDocument();
      expect(screen.getByText(/Transaction rejected: op_underfunded/i)).toBeInTheDocument();
    });

    it("disables interactive expansion when interactive=false", () => {
      render(<Timeline lifecycle={MOCK_LIFECYCLE_CONFIRMED} interactive={false} />);
      const initiatedButton = screen.getByRole("button", { name: /Payment Initiated/i });
      expect(initiatedButton.className).toContain("cursor-default");

      fireEvent.click(initiatedButton);
      // Stays collapsed
      expect(initiatedButton).toHaveAttribute("aria-expanded", "false");
    });

    it("hides copy hash button when showCopyHash=false", () => {
      render(<Timeline lifecycle={MOCK_LIFECYCLE_CONFIRMED} showCopyHash={false} />);
      expect(screen.queryByRole("button", { name: /Copy transaction hash/i })).not.toBeInTheDocument();
    });

    it("supports custom steps passed via steps prop", () => {
      const customSteps: LifecycleStep[] = [
        {
          id: "custom_step_1",
          label: "Custom Verification",
          description: "Custom pre-flight checks",
          status: "completed",
        },
      ];

      render(<Timeline steps={customSteps} />);
      expect(screen.getAllByText("Custom Verification").length).toBeGreaterThan(0);
      expect(screen.getByText("Custom pre-flight checks")).toBeInTheDocument();
    });
  });

  // ── 5. Backward Compatibility (Audit Logs) ──────────────────────────────────

  describe("5 · Backward Compatibility (Audit Logs)", () => {
    it("renders audit logs when logs prop is provided", () => {
      render(<Timeline logs={MOCK_AUDIT_LOGS} />);
      expect(screen.getByRole("region", { name: "Activity timeline" })).toBeInTheDocument();
      expect(screen.getByText("Payment link created")).toBeInTheDocument();
      expect(screen.getByText("Threshold updated")).toBeInTheDocument();
      expect(screen.getByText("status")).toBeInTheDocument();
      expect(screen.getByText("draft")).toBeInTheDocument();
      expect(screen.getByText("active")).toBeInTheDocument();
    });

    it("renders empty activity state when logs is empty array", () => {
      render(<Timeline logs={[]} />);
      expect(screen.getByText("No activity yet")).toBeInTheDocument();
    });
  });

  // ── 6. Accessibility & WCAG 2.1 AA Compliance ───────────────────────────────

  describe("6 · Accessibility & WCAG 2.1 AA Compliance", () => {
    it("has accessible landmark region with label", () => {
      render(<Timeline lifecycle={MOCK_LIFECYCLE_CONFIRMED} />);
      expect(screen.getByRole("region", { name: /Stellar Ledger Payment Lifecycle/i })).toBeInTheDocument();
    });

    it("associates step header buttons with details panels via aria-controls", () => {
      render(<Timeline lifecycle={MOCK_LIFECYCLE_CONFIRMED} />);
      const buttons = screen.getAllByRole("button", { name: /Confirmed|Processing|Failed|Payment/i });
      buttons.forEach((btn) => {
        expect(btn).toHaveAttribute("aria-controls");
      });
    });

    it("interactive buttons have focus-visible styling for keyboard users", () => {
      render(<Timeline lifecycle={MOCK_LIFECYCLE_CONFIRMED} />);
      const initiatedButton = screen.getByRole("button", { name: /Payment Initiated/i });
      expect(initiatedButton.className).toContain("focus-visible:ring-2");
    });
  });
});
