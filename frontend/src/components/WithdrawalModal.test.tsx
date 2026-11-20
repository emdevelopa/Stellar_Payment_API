import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import WithdrawalModal, { SUPPORTED_ASSETS } from "./WithdrawalModal";

// ─── Framer Motion Mock ──────────────────────────────────────────────────────
vi.mock("framer-motion", () => {
  const strip = (props: Record<string, unknown>) => {
    const { initial: _i, animate: _a, exit: _e, transition: _t, ...rest } = props;
    return rest;
  };
  return {
    motion: {
      div: React.forwardRef(({ children, ...p }: any, ref: any) => (
        <div ref={ref} {...strip(p)}>
          {children}
        </div>
      )),
    },
    AnimatePresence: ({ children }: any) => <>{children}</>,
  };
});

// ─── Sonner Mock ─────────────────────────────────────────────────────────────
const mockToastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

// ─── useSep24AnchorFlow Mock ─────────────────────────────────────────────────
const mockStart = vi.fn();
const mockResetFlow = vi.fn();
let mockFlowState = {
  step: "IDLE" as "IDLE" | "CONNECTING" | "AUTH" | "SUBMITTING" | "READY",
  isBusy: false,
  interactiveUrl: null as string | null,
  start: mockStart,
  reset: mockResetFlow,
};

vi.mock("@/hooks/useSep24AnchorFlow", () => ({
  useSep24AnchorFlow: () => mockFlowState,
  SEP24_ERROR_TOAST_ID: "sep24-flow-error",
}));

describe("WithdrawalModal", () => {
  const defaultOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.style.overflow = "";
    mockFlowState = {
      step: "IDLE",
      isBusy: false,
      interactiveUrl: null,
      start: mockStart,
      reset: mockResetFlow,
    };
  });

  afterEach(() => {
    document.body.style.overflow = "";
  });

  const renderModal = (props: { isOpen?: boolean; onClose?: () => void } = {}) => {
    return render(
      <WithdrawalModal
        isOpen={props.isOpen ?? true}
        onClose={props.onClose ?? defaultOnClose}
      />
    );
  };

  // ── 1. Rendering and Visibility ─────────────────────────────────────────────
  describe("Rendering & Visibility", () => {
    it("renders nothing when isOpen is false", () => {
      renderModal({ isOpen: false });
      expect(screen.queryByTestId("withdrawal-modal")).not.toBeInTheDocument();
      expect(screen.queryByTestId("withdrawal-backdrop")).not.toBeInTheDocument();
    });

    it("renders modal dialog and elements when isOpen is true", () => {
      renderModal({ isOpen: true });
      expect(screen.getByTestId("withdrawal-modal")).toBeInTheDocument();
      expect(screen.getByTestId("withdrawal-backdrop")).toBeInTheDocument();
      expect(screen.getByText("Withdraw Funds")).toBeInTheDocument();
      expect(screen.getByText("Via Stellar SEP-0024 Anchor")).toBeInTheDocument();
      expect(screen.getByTestId("withdrawal-drawer-handle")).toBeInTheDocument();
      expect(screen.getByText("Secured by Stellar Network • SEP-0024 Standard")).toBeInTheDocument();
    });

    it("renders supported assets and default anchor domain input", () => {
      renderModal();
      SUPPORTED_ASSETS.forEach((asset) => {
        expect(screen.getByTestId(`asset-select-${asset.code}`)).toBeInTheDocument();
        expect(screen.getByText(asset.code)).toBeInTheDocument();
      });

      const anchorInput = screen.getByTestId("withdrawal-anchor-input") as HTMLInputElement;
      expect(anchorInput).toBeInTheDocument();
      expect(anchorInput.value).toBe("testanchor.stellar.org");
    });
  });

  // ── 2. User Interactions ───────────────────────────────────────────────────
  describe("User Interactions", () => {
    it("calls onClose and reset when close button is clicked", () => {
      renderModal();
      const closeBtn = screen.getByTestId("withdrawal-close-btn");
      fireEvent.click(closeBtn);

      expect(defaultOnClose).toHaveBeenCalledTimes(1);
      expect(mockResetFlow).toHaveBeenCalledTimes(1);
    });

    it("calls onClose and reset when backdrop is clicked", () => {
      renderModal();
      const backdrop = screen.getByTestId("withdrawal-backdrop");
      fireEvent.click(backdrop);

      expect(defaultOnClose).toHaveBeenCalledTimes(1);
      expect(mockResetFlow).toHaveBeenCalledTimes(1);
    });

    it("does not call onClose when clicking inside the modal content", () => {
      renderModal();
      const modal = screen.getByTestId("withdrawal-modal");
      fireEvent.click(modal);

      expect(defaultOnClose).not.toHaveBeenCalled();
    });

    it("allows selecting a different asset", () => {
      renderModal();
      const usdcBtn = screen.getByTestId("asset-select-USDC");
      const srtBtn = screen.getByTestId("asset-select-SRT");

      expect(usdcBtn).toHaveAttribute("aria-checked", "true");
      expect(srtBtn).toHaveAttribute("aria-checked", "false");

      fireEvent.click(srtBtn);

      expect(srtBtn).toHaveAttribute("aria-checked", "true");
      expect(usdcBtn).toHaveAttribute("aria-checked", "false");
    });

    it("allows updating the anchor domain input", () => {
      renderModal();
      const anchorInput = screen.getByTestId("withdrawal-anchor-input") as HTMLInputElement;

      fireEvent.change(anchorInput, { target: { value: "myanchor.io" } });
      expect(anchorInput.value).toBe("myanchor.io");
    });

    it("starts withdrawal flow when submit button is clicked", async () => {
      mockStart.mockResolvedValueOnce(undefined);
      renderModal();

      const submitBtn = screen.getByTestId("withdrawal-submit-btn");
      fireEvent.click(submitBtn);

      expect(mockStart).toHaveBeenCalledWith({
        anchorDomain: "testanchor.stellar.org",
        assetCode: "USDC",
        direction: "withdraw",
      });
    });

    it("handles error when start withdrawal fails", async () => {
      mockStart.mockRejectedValueOnce(new Error("Network connection error"));
      renderModal();

      const submitBtn = screen.getByTestId("withdrawal-submit-btn");
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith("Network connection error", expect.objectContaining({ id: "sep24-flow-error" }));
      });
    });

    it("handles non-Error rejection message gracefully", async () => {
      mockStart.mockRejectedValueOnce("Unknown failure");
      renderModal();

      const submitBtn = screen.getByTestId("withdrawal-submit-btn");
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith("Withdrawal failed", expect.objectContaining({ id: "sep24-flow-error" }));
      });
    });
  });

  // ── 3. Responsive Drawer View and Touch Gestures ────────────────────────────
  describe("Responsive Drawer View and Touch Gestures", () => {
    it("has mobile drawer styling and desktop modal styling classes", () => {
      renderModal();
      const modal = screen.getByTestId("withdrawal-modal");
      expect(modal).toHaveClass("rounded-t-3xl", "sm:rounded-3xl", "max-h-[90vh]", "sm:max-h-[85vh]");

      const handle = screen.getByTestId("withdrawal-drawer-handle");
      expect(handle).toHaveClass("sm:hidden");
    });

    it("closes modal on swipe down gesture (>50px delta)", () => {
      renderModal();
      const modal = screen.getByTestId("withdrawal-modal");

      fireEvent.touchStart(modal, {
        touches: [{ clientY: 100 }],
      });

      fireEvent.touchEnd(modal, {
        changedTouches: [{ clientY: 165 }],
      });

      expect(defaultOnClose).toHaveBeenCalledTimes(1);
      expect(mockResetFlow).toHaveBeenCalledTimes(1);
    });

    it("does not close on small swipe movement (<=50px delta)", () => {
      renderModal();
      const modal = screen.getByTestId("withdrawal-modal");

      fireEvent.touchStart(modal, {
        touches: [{ clientY: 100 }],
      });

      fireEvent.touchEnd(modal, {
        changedTouches: [{ clientY: 130 }],
      });

      expect(defaultOnClose).not.toHaveBeenCalled();
    });

    it("does not close on swipe up gesture (negative delta)", () => {
      renderModal();
      const modal = screen.getByTestId("withdrawal-modal");

      fireEvent.touchStart(modal, {
        touches: [{ clientY: 200 }],
      });

      fireEvent.touchEnd(modal, {
        changedTouches: [{ clientY: 120 }],
      });

      expect(defaultOnClose).not.toHaveBeenCalled();
    });

    it("ignores touchEnd if touchStart was never fired", () => {
      renderModal();
      const modal = screen.getByTestId("withdrawal-modal");

      fireEvent.touchEnd(modal, {
        changedTouches: [{ clientY: 200 }],
      });

      expect(defaultOnClose).not.toHaveBeenCalled();
    });
  });

  // ── 4. Accessibility (WCAG 2.1 AA) and Keyboard Navigation ─────────────────
  describe("Accessibility (WCAG 2.1 AA) and Keyboard Navigation", () => {
    it("has proper dialog ARIA roles and labels", () => {
      renderModal();
      const modal = screen.getByTestId("withdrawal-modal");
      expect(modal).toHaveAttribute("role", "dialog");
      expect(modal).toHaveAttribute("aria-modal", "true");
      expect(modal).toHaveAttribute("aria-labelledby", "withdrawal-modal-title");
      expect(modal).toHaveAttribute("aria-describedby", "withdrawal-modal-subtitle");

      const closeBtn = screen.getByTestId("withdrawal-close-btn");
      expect(closeBtn).toHaveAttribute("aria-label", "Close withdrawal modal");

      const backdrop = screen.getByTestId("withdrawal-backdrop");
      expect(backdrop).toHaveAttribute("aria-hidden", "true");
    });

    it("closes when Escape key is pressed", () => {
      renderModal();
      fireEvent.keyDown(document, { key: "Escape" });

      expect(defaultOnClose).toHaveBeenCalledTimes(1);
      expect(mockResetFlow).toHaveBeenCalledTimes(1);
    });

    it("does not close on other key presses", () => {
      renderModal();
      fireEvent.keyDown(document, { key: "Enter" });
      fireEvent.keyDown(document, { key: " " });

      expect(defaultOnClose).not.toHaveBeenCalled();
    });

    it("locks body scroll when open and restores it when unmounted", () => {
      const { unmount } = renderModal({ isOpen: true });
      expect(document.body.style.overflow).toBe("hidden");

      unmount();
      expect(document.body.style.overflow).toBe("");
    });

    it("traps focus between first and last focusable elements", () => {
      renderModal();
      const closeBtn = screen.getByTestId("withdrawal-close-btn");
      const submitBtn = screen.getByTestId("withdrawal-submit-btn");

      // Focus close button (first element) and press Shift+Tab
      closeBtn.focus();
      expect(document.activeElement).toBe(closeBtn);

      fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
      expect(document.activeElement).toBe(submitBtn);

      // Focus submit button (last element) and press Tab
      fireEvent.keyDown(document, { key: "Tab", shiftKey: false });
      expect(document.activeElement).toBe(closeBtn);
    });
  });

  // ── 5. State Transitions ───────────────────────────────────────────────────
  describe("Flow States", () => {
    it("renders authenticating spinner and text when in AUTH state", () => {
      mockFlowState = {
        step: "AUTH",
        isBusy: true,
        interactiveUrl: null,
        start: mockStart,
        reset: mockResetFlow,
      };

      renderModal();
      expect(screen.getByTestId("withdrawal-authenticating-status")).toBeInTheDocument();
      expect(screen.getByText("Authenticating")).toBeInTheDocument();
      expect(
        screen.getByText(/Please sign the challenge transaction in your wallet/)
      ).toBeInTheDocument();
    });

    it("renders interactive iframe when step is READY", () => {
      mockFlowState = {
        step: "READY",
        isBusy: false,
        interactiveUrl: "https://testanchor.stellar.org/sep24/interactive?jwt=xyz",
        start: mockStart,
        reset: mockResetFlow,
      };

      renderModal();
      const frameContainer = screen.getByTestId("withdrawal-interactive-frame");
      expect(frameContainer).toBeInTheDocument();

      const iframe = frameContainer.querySelector("iframe");
      expect(iframe).toHaveAttribute(
        "src",
        "https://testanchor.stellar.org/sep24/interactive?jwt=xyz"
      );
      expect(iframe).toHaveAttribute("title", "Stellar Anchor Withdrawal");
    });
  });

  // ── 6. Snapshot Tests ──────────────────────────────────────────────────────
  describe("Snapshot Tests", () => {
    it("matches snapshot when modal is closed", () => {
      const { container } = renderModal({ isOpen: false });
      expect(container).toMatchSnapshot();
    });

    it("matches snapshot when modal is open in IDLE state", () => {
      const { container } = renderModal({ isOpen: true });
      expect(container).toMatchSnapshot();
    });

    it("matches snapshot in AUTH authenticating state", () => {
      mockFlowState = {
        step: "AUTH",
        isBusy: true,
        interactiveUrl: null,
        start: mockStart,
        reset: mockResetFlow,
      };
      const { container } = renderModal({ isOpen: true });
      expect(container).toMatchSnapshot();
    });

    it("matches snapshot in READY state with interactiveUrl", () => {
      mockFlowState = {
        step: "READY",
        isBusy: false,
        interactiveUrl: "https://testanchor.stellar.org/sep24/interactive?jwt=test1234",
        start: mockStart,
        reset: mockResetFlow,
      };
      const { container } = renderModal({ isOpen: true });
      expect(container).toMatchSnapshot();
    });
  });
});
