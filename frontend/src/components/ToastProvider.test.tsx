import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import ToastProvider from "./ToastProvider";

const toasterSpy = vi.fn();

vi.mock("sonner", () => ({
  Toaster: (props: Record<string, unknown>) => {
    toasterSpy(props);
    return <div data-testid="sonner-toaster" data-position={String(props.position)} />;
  },
  toast: {
    dismiss: vi.fn(),
  },
}));

function mockViewport(isMobile: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: isMobile && query === "(max-width: 767px)",
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

describe("ToastProvider", () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    toasterSpy.mockClear();
    vi.mocked(toast.dismiss).mockClear();
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it("renders Toaster at top-right on desktop viewports", () => {
    mockViewport(false);
    render(<ToastProvider showDrawerTrigger />);

    const toaster = screen.getByTestId("sonner-toaster");
    expect(toaster).toHaveAttribute("data-position", "top-right");
    expect(toasterSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        position: "top-right",
        swipeDirections: ["right"],
        visibleToasts: 5,
      }),
    );
    expect(screen.queryByRole("button", { name: "Open notifications drawer" })).not.toBeInTheDocument();
  });

  it("switches to bottom-center drawer mode with multi-direction swipe on mobile", () => {
    mockViewport(true);
    render(<ToastProvider showDrawerTrigger />);

    const toaster = screen.getByTestId("sonner-toaster");
    expect(toaster).toHaveAttribute("data-position", "bottom-center");
    expect(toasterSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        position: "bottom-center",
        swipeDirections: ["down", "left", "right"],
        expand: true,
        visibleToasts: 3,
      }),
    );

    const trigger = screen.getByRole("button", { name: "Open notifications drawer" });
    expect(trigger).toBeInTheDocument();

    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Notification center drawer" })).toBeInTheDocument();
  });

  it("dismisses the mobile drawer on swipe-down gesture past threshold", () => {
    mockViewport(true);
    render(<ToastProvider showDrawerTrigger />);

    fireEvent.click(screen.getByRole("button", { name: "Open notifications drawer" }));
    const drawer = screen.getByRole("dialog", { name: "Notification center drawer" });

    fireEvent.touchStart(drawer, { touches: [{ clientY: 100 }] });
    fireEvent.touchMove(drawer, { touches: [{ clientY: 180 }] });
    fireEvent.touchEnd(drawer);

    expect(screen.queryByRole("dialog", { name: "Notification center drawer" })).not.toBeInTheDocument();
  });

  it("closes the drawer on Escape key and clears all toasts when Clear all is clicked", () => {
    mockViewport(true);
    render(<ToastProvider showDrawerTrigger />);

    fireEvent.click(screen.getByRole("button", { name: "Open notifications drawer" }));
    expect(screen.getByRole("dialog", { name: "Notification center drawer" })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Notification center drawer" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open notifications drawer" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));

    expect(toast.dismiss).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: "Notification center drawer" })).not.toBeInTheDocument();
  });
});
