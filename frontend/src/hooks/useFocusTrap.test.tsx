/**
 * Tests for useFocusTrap hook
 *
 * Validates WCAG 2.1 AA compliance for focus management:
 * - 2.4.3 Focus Order (focus moves into the dialog and comes back)
 * - 2.1.2 No Keyboard Trap (Escape closes)
 * - 2.4.7 Focus Visible
 *
 * #1497 - WCAG 2.1 AA accessible focus trap
 * #1839 - focus restored when the trap is disabled, not only on unmount;
 *         Tab/Shift+Tab from the container itself stays inside it
 *
 * The hook is exercised through a real component so the ref is attached the way
 * production code attaches it (before effects run).
 */

import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFocusTrap } from "./useFocusTrap";

interface HarnessProps {
  enabled?: boolean;
  onEscape?: () => void;
  returnFocusOnDeactivate?: boolean;
  focusContainerOnActivate?: boolean;
  empty?: boolean;
}

function Harness({
  enabled = true,
  onEscape,
  returnFocusOnDeactivate,
  focusContainerOnActivate,
  empty = false,
}: HarnessProps) {
  const ref = useFocusTrap<HTMLDivElement>({
    enabled,
    onEscape,
    returnFocusOnDeactivate,
    focusContainerOnActivate,
  });

  return (
    <>
      <button>Outside</button>
      <div ref={ref} tabIndex={-1} data-testid="trap">
        {!empty && (
          <>
            <button>First</button>
            <button>Second</button>
            <button disabled>Skipped</button>
            <button>Last</button>
          </>
        )}
      </div>
    </>
  );
}

/** Let the hook's deferred initial focus run. */
const settle = () => act(() => void vi.advanceTimersByTime(10));
const pressTab = (shift = false) =>
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Tab", shiftKey: shift });

describe("useFocusTrap", () => {
  const originalOffsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetParent");

  beforeEach(() => {
    vi.useFakeTimers();
    // jsdom does no layout, so offsetParent is always null and the hook's "is this
    // visible" check would exclude every element. Every attached element is visible here.
    Object.defineProperty(HTMLElement.prototype, "offsetParent", {
      configurable: true,
      get() {
        return this.parentNode;
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalOffsetParent) {
      Object.defineProperty(HTMLElement.prototype, "offsetParent", originalOffsetParent);
    } else {
      delete (HTMLElement.prototype as { offsetParent?: unknown }).offsetParent;
    }
  });

  describe("activation", () => {
    it("focuses the first focusable element when enabled", () => {
      render(<Harness />);
      settle();

      expect(screen.getByText("First")).toHaveFocus();
    });

    it("focuses the container itself when focusContainerOnActivate is set", () => {
      render(<Harness focusContainerOnActivate />);
      settle();

      expect(screen.getByTestId("trap")).toHaveFocus();
    });

    it("does not move focus while disabled", () => {
      render(<Harness enabled={false} />);
      screen.getByText("Outside").focus();
      settle();

      expect(screen.getByText("Outside")).toHaveFocus();
    });

    it("moves focus in when it becomes enabled later", () => {
      const { rerender } = render(<Harness enabled={false} />);
      settle();

      rerender(<Harness enabled />);
      settle();

      expect(screen.getByText("First")).toHaveFocus();
    });
  });

  describe("Tab trapping", () => {
    it("wraps Tab from the last control to the first, skipping disabled ones", () => {
      render(<Harness />);
      settle();
      screen.getByText("Last").focus();

      const notPrevented = pressTab();

      expect(notPrevented).toBe(false);
      expect(screen.getByText("First")).toHaveFocus();
    });

    it("wraps Shift+Tab from the first control to the last", () => {
      render(<Harness />);
      settle();

      pressTab(true);

      expect(screen.getByText("Last")).toHaveFocus();
    });

    it("lets Tab move normally between controls in the middle", () => {
      render(<Harness />);
      settle();

      const notPrevented = pressTab();

      expect(notPrevented).toBe(true);
    });

    it("sends Tab from the container itself to the first control", () => {
      render(<Harness focusContainerOnActivate />);
      settle();

      pressTab();

      expect(screen.getByText("First")).toHaveFocus();
    });

    it("sends Shift+Tab from the container itself to the last control", () => {
      render(<Harness focusContainerOnActivate />);
      settle();

      pressTab(true);

      expect(screen.getByText("Last")).toHaveFocus();
    });

    it("pulls focus back in when it has escaped to the page behind", () => {
      render(<Harness />);
      settle();
      screen.getByText("Outside").focus();

      pressTab();

      expect(screen.getByText("First")).toHaveFocus();
    });

    it("keeps focus on the container when there is nothing to tab to", () => {
      render(<Harness empty focusContainerOnActivate />);
      settle();

      const notPrevented = pressTab();

      expect(notPrevented).toBe(false);
      expect(screen.getByTestId("trap")).toHaveFocus();
    });

    it("does not trap Tab while disabled", () => {
      render(<Harness enabled={false} />);
      screen.getByText("Outside").focus();

      expect(pressTab()).toBe(true);
    });
  });

  describe("Escape", () => {
    it("calls onEscape when Escape is pressed", () => {
      const onEscape = vi.fn();
      render(<Harness onEscape={onEscape} />);
      settle();

      fireEvent.keyDown(document.activeElement!, { key: "Escape" });

      expect(onEscape).toHaveBeenCalledTimes(1);
    });

    it("ignores other keys", () => {
      const onEscape = vi.fn();
      render(<Harness onEscape={onEscape} />);
      settle();

      fireEvent.keyDown(document.activeElement!, { key: "Enter" });

      expect(onEscape).not.toHaveBeenCalled();
    });

    it("does not call onEscape while disabled", () => {
      const onEscape = vi.fn();
      render(<Harness enabled={false} onEscape={onEscape} />);

      fireEvent.keyDown(document.body, { key: "Escape" });

      expect(onEscape).not.toHaveBeenCalled();
    });
  });

  describe("returning focus", () => {
    const openFromOutside = () => {
      const view = render(<Harness enabled={false} />);
      screen.getByText("Outside").focus();
      view.rerender(<Harness enabled />);
      settle();
      expect(screen.getByText("First")).toHaveFocus();
      return view;
    };

    it("returns focus to the previously focused element when the trap is disabled while still mounted", () => {
      // The case a dialog that stays mounted but renders nothing when closed hits:
      // the component does not unmount, so restoring only on unmount lost focus.
      const view = openFromOutside();

      view.rerender(<Harness enabled={false} />);

      expect(screen.getByText("Outside")).toHaveFocus();
    });

    it("returns focus to the previously focused element on unmount", () => {
      // A trigger that lives outside the React tree, so it survives the unmount.
      const trigger = document.createElement("button");
      document.body.appendChild(trigger);
      trigger.focus();

      const view = render(<Harness />);
      settle();
      expect(screen.getByText("First")).toHaveFocus();

      view.unmount();

      expect(trigger).toHaveFocus();
      trigger.remove();
    });

    it("does not return focus when returnFocusOnDeactivate is false", () => {
      const view = render(<Harness enabled={false} returnFocusOnDeactivate={false} />);
      screen.getByText("Outside").focus();
      view.rerender(<Harness enabled returnFocusOnDeactivate={false} />);
      settle();

      view.rerender(<Harness enabled={false} returnFocusOnDeactivate={false} />);

      expect(screen.getByText("Outside")).not.toHaveFocus();
    });

    it("restores focus again on every open and close", () => {
      const view = render(<Harness enabled={false} />);
      for (let i = 0; i < 2; i++) {
        screen.getByText("Outside").focus();
        view.rerender(<Harness enabled />);
        settle();
        expect(screen.getByText("First")).toHaveFocus();
        view.rerender(<Harness enabled={false} />);
        expect(screen.getByText("Outside")).toHaveFocus();
      }
    });
  });
});
