/** @vitest-environment jsdom */
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, vi } from "vitest";
import WebhookDetailModal, {
  DISMISS_DISTANCE_PX,
  NAVIGATE_DISTANCE_PX,
  resolveSwipe,
  WebhookLog,
} from "./WebhookDetailModal";

vi.mock("./CopyButton", () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock("@/components/ui/Button", () => ({
  __esModule: true,
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

const LOG: WebhookLog = {
  id: "log-1",
  payment_id: "p1",
  status_code: 500,
  event: "payment.failed",
  url: "https://example.com/wh",
  request_payload: { amount: "10" },
  request_headers: null,
  response_body: "error",
  timestamp: "2026-04-25T10:00:00.000Z",
};

function swipe(el: Element, from: { x: number; y: number }, to: { x: number; y: number }) {
  fireEvent.touchStart(el, { touches: [{ clientX: from.x, clientY: from.y }] });
  fireEvent.touchMove(el, { touches: [{ clientX: to.x, clientY: to.y }] });
  fireEvent.touchEnd(el, { changedTouches: [{ clientX: to.x, clientY: to.y }] });
}

describe("resolveSwipe", () => {
  it("dismisses on a long downward drag", () => {
    expect(resolveSwipe(0, DISMISS_DISTANCE_PX, 1000, "y")).toBe("dismiss");
  });

  it("dismisses on a short but fast downward flick", () => {
    expect(resolveSwipe(0, 40, 50, "y")).toBe("dismiss");
  });

  it("does nothing on a short, slow downward drag", () => {
    expect(resolveSwipe(0, 40, 1000, "y")).toBe("none");
  });

  it("never dismisses on an upward drag", () => {
    expect(resolveSwipe(0, -300, 50, "y")).toBe("none");
  });

  it("maps horizontal swipes to next / previous", () => {
    expect(resolveSwipe(-NAVIGATE_DISTANCE_PX, 0, 200, "x")).toBe("next");
    expect(resolveSwipe(NAVIGATE_DISTANCE_PX, 0, 200, "x")).toBe("previous");
    expect(resolveSwipe(-20, 0, 200, "x")).toBe("none");
  });
});

describe("WebhookDetailModal drawer", () => {
  const onClose = vi.fn();
  const onNext = vi.fn();
  const onPrevious = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    document.body.style.overflow = "";
  });

  function renderDrawer(props: Partial<React.ComponentProps<typeof WebhookDetailModal>> = {}) {
    return render(
      <WebhookDetailModal
        isOpen
        log={LOG}
        onClose={onClose}
        onNext={onNext}
        onPrevious={onPrevious}
        positionLabel="2 of 3"
        {...props}
      />,
    );
  }

  it("renders an accessible dialog with a mobile drag handle", () => {
    renderDrawer();
    const dialog = screen.getByRole("dialog", { name: /webhook delivery detail/i });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveFocus();
    expect(screen.getByTestId("webhook-drawer-handle")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("Delivery 2 of 3")).toBeInTheDocument();
  });

  it("locks body scroll while open and restores it on close", () => {
    const { rerender } = renderDrawer();
    expect(document.body.style.overflow).toBe("hidden");
    rerender(<WebhookDetailModal isOpen={false} log={LOG} onClose={onClose} />);
    expect(document.body.style.overflow).toBe("");
  });

  it("swiping down past the threshold dismisses the drawer", () => {
    renderDrawer();
    swipe(screen.getByTestId("webhook-drawer-handle"), { x: 100, y: 100 }, { x: 100, y: 100 + DISMISS_DISTANCE_PX + 10 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("follows the finger while dragging and snaps back on a short drag", () => {
    renderDrawer();
    const dialog = screen.getByTestId("webhook-detail-drawer");
    const handle = screen.getByTestId("webhook-drawer-handle");

    fireEvent.touchStart(handle, { touches: [{ clientX: 100, clientY: 100 }] });
    fireEvent.touchMove(handle, { touches: [{ clientX: 100, clientY: 140 }] });
    expect(dialog.style.transform).toContain("40px");
    expect(dialog).toHaveAttribute("data-dragging", "true");

    // Slow release well below the threshold
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 2000);
    fireEvent.touchEnd(handle, { changedTouches: [{ clientX: 100, clientY: 140 }] });
    nowSpy.mockRestore();

    expect(onClose).not.toHaveBeenCalled();
    expect(dialog.style.transform).toBe("");
    expect(dialog).not.toHaveAttribute("data-dragging");
  });

  it("does not dismiss when dragging down inside scrolled content", () => {
    renderDrawer();
    const body = screen.getByTestId("webhook-drawer-body");
    body.scrollTop = 200;
    swipe(body, { x: 100, y: 100 }, { x: 100, y: 400 });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("swiping left / right navigates between deliveries", () => {
    renderDrawer();
    const handle = screen.getByTestId("webhook-drawer-handle");
    swipe(handle, { x: 200, y: 100 }, { x: 200 - NAVIGATE_DISTANCE_PX - 10, y: 105 });
    expect(onNext).toHaveBeenCalledTimes(1);
    swipe(handle, { x: 100, y: 100 }, { x: 100 + NAVIGATE_DISTANCE_PX + 10, y: 105 });
    expect(onPrevious).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("sideways swipes inside the payload scroll the code instead of navigating", () => {
    renderDrawer();
    const pre = document.querySelector("pre")!;
    swipe(pre, { x: 200, y: 100 }, { x: 50, y: 100 });
    expect(onNext).not.toHaveBeenCalled();
  });

  it("offers button and keyboard alternatives to every gesture", () => {
    renderDrawer();
    fireEvent.click(screen.getByRole("button", { name: "Next delivery" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous delivery" }));
    fireEvent.keyDown(document, { key: "ArrowRight" });
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    fireEvent.keyDown(document, { key: "Escape" });

    expect(onNext).toHaveBeenCalledTimes(2);
    expect(onPrevious).toHaveBeenCalledTimes(2);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("disables navigation buttons at the ends of the list", () => {
    renderDrawer({ onPrevious: undefined });
    expect(screen.getByRole("button", { name: "Previous delivery" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next delivery" })).toBeEnabled();
  });

  it("closes when the backdrop is tapped", () => {
    renderDrawer();
    fireEvent.click(screen.getByTestId("modal-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
