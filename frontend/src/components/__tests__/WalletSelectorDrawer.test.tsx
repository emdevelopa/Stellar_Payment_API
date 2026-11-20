/**
 * Tests for WalletSelectorDrawer (#1850): the wallet picker as a drawer on small screens.
 *
 * Covers opening and closing by every route, focus management, scroll locking, closing on
 * connect, and the touch gestures (drag to dismiss, snap back, scrolled content not
 * hijacked), with the close button and Escape as the non-gesture alternatives.
 */

import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WalletSelectorDrawer from "../WalletSelectorDrawer";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) =>
    ({
      connectWallet: "Connect wallet",
      closeWalletSelector: "Close wallet selector",
      chooseWallet: "Choose a wallet",
    })[key] ?? key,
}));

// The picker has its own tests; here it only needs to be present and able to "connect".
vi.mock("../WalletSelector", () => ({
  default: ({ onConnected }: { onConnected: () => void }) => (
    <div data-testid="picker">
      <button onClick={onConnected}>Pick Freighter</button>
    </div>
  ),
}));

const trigger = () => screen.getByRole("button", { name: "Connect wallet" });
const dialog = () => screen.getByRole("dialog");
const settle = () => act(() => void vi.advanceTimersByTime(10));

function renderDrawer(onConnected = vi.fn()) {
  render(<WalletSelectorDrawer networkPassphrase="Test SDF Network" onConnected={onConnected} />);
  return { onConnected };
}

function openDrawer() {
  const view = renderDrawer();
  trigger().focus();
  fireEvent.click(trigger());
  settle();
  return view;
}

const touch = (y: number) => ({ touches: [{ clientX: 0, clientY: y }], changedTouches: [{ clientX: 0, clientY: y }] });

describe("WalletSelectorDrawer", () => {
  const originalOffsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetParent");

  beforeEach(() => {
    vi.useFakeTimers();
    // jsdom does no layout, so offsetParent is always null and the focus trap's visibility
    // check would exclude every control. Every attached element counts as visible here.
    Object.defineProperty(HTMLElement.prototype, "offsetParent", {
      configurable: true,
      get() {
        return this.parentNode;
      },
    });
    document.body.style.overflow = "";
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalOffsetParent) {
      Object.defineProperty(HTMLElement.prototype, "offsetParent", originalOffsetParent);
    } else {
      delete (HTMLElement.prototype as { offsetParent?: unknown }).offsetParent;
    }
  });

  describe("closed", () => {
    it("shows only a Connect wallet button that announces it opens a dialog", () => {
      renderDrawer();

      expect(trigger()).toHaveAttribute("aria-haspopup", "dialog");
      expect(trigger()).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.queryByTestId("picker")).not.toBeInTheDocument();
    });
  });

  describe("open", () => {
    it("opens a modal dialog named Connect wallet that contains the picker", () => {
      openDrawer();

      expect(dialog()).toHaveAttribute("aria-modal", "true");
      expect(dialog()).toHaveAccessibleName("Connect wallet");
      expect(dialog()).toContainElement(screen.getByTestId("picker"));
      expect(trigger()).toHaveAttribute("aria-expanded", "true");
    });

    it("is a bottom sheet on small screens and a centred dialog from sm up", () => {
      openDrawer();

      expect(dialog()).toHaveClass("rounded-t-[2rem]", "sm:max-w-md", "sm:rounded-[2rem]");
      expect(screen.getByTestId("wallet-drawer-backdrop")).toHaveClass("items-end", "sm:items-center");
    });

    it("shows a drag handle only below sm, hidden from assistive technology", () => {
      openDrawer();

      const handle = screen.getByTestId("wallet-drawer-handle");
      expect(handle).toHaveClass("sm:hidden");
      expect(handle).toHaveAttribute("aria-hidden", "true");
    });

    it("moves focus to the dialog", () => {
      openDrawer();

      expect(dialog()).toHaveFocus();
    });

    it("keeps Tab inside the dialog", () => {
      openDrawer();
      screen.getByRole("button", { name: "Pick Freighter" }).focus();

      const notPrevented = fireEvent.keyDown(document.activeElement!, { key: "Tab" });

      expect(notPrevented).toBe(false);
      expect(screen.getByRole("button", { name: "Close wallet selector" })).toHaveFocus();
    });

    it("locks page scrolling while open and restores it after", () => {
      document.body.style.overflow = "auto";
      openDrawer();
      expect(document.body.style.overflow).toBe("hidden");

      fireEvent.click(screen.getByRole("button", { name: "Close wallet selector" }));

      expect(document.body.style.overflow).toBe("auto");
    });
  });

  describe("closing without a gesture", () => {
    it("closes from the close button and returns focus to the trigger", () => {
      openDrawer();

      fireEvent.click(screen.getByRole("button", { name: "Close wallet selector" }));

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(trigger()).toHaveFocus();
      expect(trigger()).toHaveAttribute("aria-expanded", "false");
    });

    it("closes on Escape and returns focus to the trigger", () => {
      openDrawer();

      fireEvent.keyDown(document.activeElement!, { key: "Escape" });

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(trigger()).toHaveFocus();
    });

    it("closes when the backdrop is clicked", () => {
      openDrawer();

      fireEvent.click(screen.getByTestId("wallet-drawer-backdrop"));

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("stays open when the sheet itself is clicked", () => {
      openDrawer();

      fireEvent.click(dialog());

      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("can be opened again after closing", () => {
      openDrawer();
      fireEvent.click(screen.getByRole("button", { name: "Close wallet selector" }));

      fireEvent.click(trigger());
      settle();

      expect(dialog()).toBeInTheDocument();
    });
  });

  describe("connecting", () => {
    it("closes and reports the connection when a wallet connects", () => {
      const { onConnected } = openDrawer();

      fireEvent.click(screen.getByRole("button", { name: "Pick Freighter" }));

      expect(onConnected).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  describe("touch gestures", () => {
    it("follows the finger while dragging down", () => {
      openDrawer();

      fireEvent.touchStart(dialog(), touch(100));
      fireEvent.touchMove(dialog(), touch(180));

      expect(dialog().style.transform).toBe("translate3d(0, 80px, 0)");
      expect(dialog()).toHaveAttribute("data-dragging", "true");
    });

    it("dismisses after a long drag down", () => {
      openDrawer();

      fireEvent.touchStart(dialog(), touch(0));
      act(() => void vi.advanceTimersByTime(400));
      fireEvent.touchMove(dialog(), touch(160));
      fireEvent.touchEnd(dialog(), touch(160));

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(trigger()).toHaveFocus();
    });

    it("dismisses after a short, fast flick", () => {
      openDrawer();

      fireEvent.touchStart(dialog(), touch(0));
      act(() => void vi.advanceTimersByTime(50));
      fireEvent.touchMove(dialog(), touch(60));
      fireEvent.touchEnd(dialog(), touch(60));

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("snaps back, staying open, after a short slow drag", () => {
      openDrawer();

      fireEvent.touchStart(dialog(), touch(0));
      act(() => void vi.advanceTimersByTime(600));
      fireEvent.touchMove(dialog(), touch(40));
      fireEvent.touchEnd(dialog(), touch(40));

      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(dialog().style.transform).toBe("");
      expect(dialog()).not.toHaveAttribute("data-dragging");
    });

    it("ignores an upward drag", () => {
      openDrawer();

      fireEvent.touchStart(dialog(), touch(200));
      act(() => void vi.advanceTimersByTime(100));
      fireEvent.touchMove(dialog(), touch(100));
      fireEvent.touchEnd(dialog(), touch(100));

      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(dialog().style.transform).toBe("");
    });

    it("does not treat a sideways swipe as a dismiss", () => {
      openDrawer();

      fireEvent.touchStart(dialog(), { touches: [{ clientX: 0, clientY: 0 }] });
      act(() => void vi.advanceTimersByTime(50));
      fireEvent.touchMove(dialog(), { touches: [{ clientX: 200, clientY: 20 }] });
      fireEvent.touchEnd(dialog(), { changedTouches: [{ clientX: 200, clientY: 20 }] });

      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("does not hijack scrolling when the content is scrolled down", () => {
      openDrawer();
      const scroller = screen.getByTestId("picker").parentElement as HTMLElement;
      Object.defineProperty(scroller, "scrollTop", { configurable: true, value: 120 });

      fireEvent.touchStart(screen.getByTestId("picker"), touch(0));
      act(() => void vi.advanceTimersByTime(50));
      fireEvent.touchMove(screen.getByTestId("picker"), touch(200));
      fireEvent.touchEnd(screen.getByTestId("picker"), touch(200));

      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(dialog().style.transform).toBe("");
    });

    it("does dismiss from inside the content once it is scrolled back to the top", () => {
      openDrawer();
      const scroller = screen.getByTestId("picker").parentElement as HTMLElement;
      Object.defineProperty(scroller, "scrollTop", { configurable: true, value: 0 });

      fireEvent.touchStart(screen.getByTestId("picker"), touch(0));
      act(() => void vi.advanceTimersByTime(400));
      fireEvent.touchMove(screen.getByTestId("picker"), touch(200));
      fireEvent.touchEnd(screen.getByTestId("picker"), touch(200));

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("fades the backdrop as the sheet is dragged down", () => {
      openDrawer();

      fireEvent.touchStart(dialog(), touch(0));
      fireEvent.touchMove(dialog(), touch(150));

      expect(screen.getByTestId("wallet-drawer-backdrop").style.backgroundColor).toMatch(/rgba\(0,\s*0,\s*0,\s*0\.35\)/);
    });
  });
});
