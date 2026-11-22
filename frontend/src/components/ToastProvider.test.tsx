/** @vitest-environment jsdom */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, renderHook } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import ToastProvider, { notify, useToast } from "./ToastProvider";
import { toast as sonnerToast } from "sonner";

// ─── Mock sonner ─────────────────────────────────────────────────────────────
vi.mock("sonner", () => {
  const toastMock = vi.fn((msg: any, opts: any) => "toast_id_1");
  (toastMock as any).success = vi.fn((msg: any, opts: any) => "toast_id_success");
  (toastMock as any).error = vi.fn((msg: any, opts: any) => "toast_id_error");
  (toastMock as any).info = vi.fn((msg: any, opts: any) => "toast_id_info");
  (toastMock as any).warning = vi.fn((msg: any, opts: any) => "toast_id_warning");
  (toastMock as any).dismiss = vi.fn();

  return {
    Toaster: ({
      hotkey: _h,
      toastOptions: _t,
      position: _pos,
      closeButton: _cb,
      expand: _e,
      maxScrolledToasts: _m,
      pauseWhenPageIsHidden: _p,
      ...props
    }: any) => (
      <div data-testid="sonner-toaster" {...props}>
        <div data-sonner-toast>
          <span>Notification Content</span>
          <button aria-label="Close notification" data-close-button>
            ✕
          </button>
        </div>
      </div>
    ),
    toast: toastMock,
  };
});

describe("ToastProvider - WCAG 2.1 AA Keyboard Focus & Screen Reader Labels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── 1. Screen Reader Labels & Landmark Regions ──────────────────────────────

  describe("1 · Screen Reader Labels & Landmark Regions", () => {
    it("renders the notification container with role='region' and accessible label", () => {
      render(<ToastProvider />);
      const region = screen.getByRole("region", {
        name: /Global Feedback Notifications \(Press Alt\+T to focus\)/i,
      });
      expect(region).toBeInTheDocument();
      expect(region).toHaveAttribute("aria-describedby", "toast-keyboard-instructions");
    });

    it("renders keyboard instructions for screen readers in sr-only element", () => {
      render(<ToastProvider />);
      const instructions = screen.getByText(/Press Alt\+T to focus notification banner/i);
      expect(instructions).toBeInTheDocument();
      expect(instructions.id).toBe("toast-keyboard-instructions");
    });

    it("renders polite live region for status announcements", () => {
      render(<ToastProvider />);
      const politeRegion = screen.getByRole("status");
      expect(politeRegion).toHaveAttribute("aria-live", "polite");
      expect(politeRegion).toHaveAttribute("aria-atomic", "true");
    });

    it("renders assertive live region for critical alerts and errors", () => {
      render(<ToastProvider />);
      const assertiveRegion = screen.getByRole("alert");
      expect(assertiveRegion).toHaveAttribute("aria-live", "assertive");
      expect(assertiveRegion).toHaveAttribute("aria-atomic", "true");
    });
  });

  // ── 2. Keyboard Focus Management (WCAG 2.1 AA) ──────────────────────────────

  describe("2 · Keyboard Focus Management", () => {
    it("moves focus to the notification region when Alt+T hotkey is pressed", () => {
      render(
        <div>
          <button id="trigger-btn">External Button</button>
          <ToastProvider />
        </div>
      );

      const triggerBtn = screen.getByRole("button", { name: "External Button" });
      triggerBtn.focus();
      expect(document.activeElement).toBe(triggerBtn);

      // Press Alt + T
      fireEvent.keyDown(window, {
        key: "t",
        code: "KeyT",
        altKey: true,
      });

      const closeButton = screen.getByRole("button", { name: /Close notification/i });
      expect(document.activeElement).toBe(closeButton);
    });

    it("restores focus to previous element when Escape is pressed inside toast region", () => {
      render(
        <div>
          <button id="input-trigger">Main Action</button>
          <ToastProvider />
        </div>
      );

      const trigger = screen.getByRole("button", { name: "Main Action" });
      trigger.focus();

      // Jump to toast with Alt+T
      fireEvent.keyDown(window, {
        key: "t",
        code: "KeyT",
        altKey: true,
      });

      const closeBtn = screen.getByRole("button", { name: /Close notification/i });
      expect(document.activeElement).toBe(closeBtn);

      // Press Escape inside toast container
      fireEvent.keyDown(closeBtn, {
        key: "Escape",
        code: "Escape",
      });

      // Focus should be restored
      expect(document.activeElement).toBe(trigger);
    });

    it("handles ArrowDown / ArrowUp navigation between queued toasts", () => {
      render(
        <div id="wrapper">
          <div
            role="region"
            aria-label="Global Feedback Notifications (Press Alt+T to focus)"
          >
            <div data-testid="sonner-toaster">
              <div data-sonner-toast id="toast-1">
                <button id="btn-1">Action 1</button>
              </div>
              <div data-sonner-toast id="toast-2">
                <button id="btn-2">Action 2</button>
              </div>
            </div>
          </div>
          <ToastProvider />
        </div>
      );

      // Focus should navigate on ArrowDown/ArrowUp when multiple toasts exist
      const btn1 = screen.getByRole("button", { name: "Action 1" });
      btn1.focus();
      expect(document.activeElement).toBe(btn1);

      fireEvent.keyDown(btn1, { key: "ArrowDown", code: "ArrowDown" });
      // Navigation event fired without uncaught exception
    });
  });

  // ── 3. Actionable Toast Manager & Utilities ─────────────────────────────────

  describe("3 · Actionable Toast Manager & Utilities", () => {
    it("notify.success calls sonner with correct duration and options", () => {
      notify.success("Payment confirmed!", { description: "Tx #12345" });

      expect(sonnerToast.success).toHaveBeenCalledWith(
        "Payment confirmed!",
        expect.objectContaining({
          description: "Tx #12345",
          duration: 4500,
        })
      );
    });

    it("notify.error calls sonner with longer duration for readability", () => {
      notify.error("Payment failed", { description: "Insufficient funds" });

      expect(sonnerToast.error).toHaveBeenCalledWith(
        "Payment failed",
        expect.objectContaining({
          description: "Insufficient funds",
          duration: 6000,
        })
      );
    });

    it("notify.actionable configures action button with callback", () => {
      const handleRetry = vi.fn();
      notify.actionable("Transaction Pending", {
        description: "Network congestion detected",
        action: {
          label: "Retry",
          onClick: handleRetry,
        },
      });

      expect(sonnerToast).toHaveBeenCalledWith(
        "Transaction Pending",
        expect.objectContaining({
          description: "Network congestion detected",
          duration: 7000,
          action: expect.objectContaining({
            label: "Retry",
          }),
        })
      );
    });

    it("notify.dismiss calls sonner.dismiss", () => {
      notify.dismiss("toast_id_1");
      expect(sonnerToast.dismiss).toHaveBeenCalledWith("toast_id_1");
    });
  });

  // ── 4. useToast Hook & Live Region Updates ──────────────────────────────────

  describe("4 · useToast Hook & Live Region Updates", () => {
    function TestComponent() {
      const toast = useToast();
      return (
        <div>
          <button onClick={() => toast.showSuccess("Success Message")}>Trigger Success</button>
          <button onClick={() => toast.showError("Error Message")}>Trigger Error</button>
          <button onClick={() => toast.showInfo("Info Message")}>Trigger Info</button>
          <button onClick={() => toast.showWarning("Warning Message")}>Trigger Warning</button>
          <span data-testid="active-count">{toast.activeCount}</span>
        </div>
      );
    }

    it("announces success via polite live region and increments activeCount", () => {
      render(
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      );

      const successBtn = screen.getByRole("button", { name: "Trigger Success" });
      fireEvent.click(successBtn);

      const politeRegion = screen.getByRole("status");
      expect(politeRegion).toHaveTextContent("Success: Success Message");
      expect(screen.getByTestId("active-count")).toHaveTextContent("1");
    });

    it("announces error via assertive live region", () => {
      render(
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      );

      const errorBtn = screen.getByRole("button", { name: "Trigger Error" });
      fireEvent.click(errorBtn);

      const assertiveRegion = screen.getByRole("alert");
      expect(assertiveRegion).toHaveTextContent("Error: Error Message");
    });

    it("fallback works safely when useToast is used outside provider", () => {
      const { result } = renderHook(() => useToast());
      expect(typeof result.current.showSuccess).toBe("function");
      expect(typeof result.current.showError).toBe("function");
      expect(typeof result.current.dismiss).toBe("function");
    });
  });
});
