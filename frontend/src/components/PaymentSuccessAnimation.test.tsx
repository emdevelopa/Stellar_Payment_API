/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { PaymentSuccessAnimation } from "./PaymentSuccessAnimation";

const { mockConfetti } = vi.hoisted(() => ({
  mockConfetti: vi.fn(),
}));

vi.mock("framer-motion", async () => {
  const ReactModule = await import("react");

  const motion = new Proxy(
    {},
    {
      get: (_, tag: string) =>
        ReactModule.forwardRef(function MockMotion(
          { children, ...props }: any,
          ref,
        ) {
          return ReactModule.createElement(tag, { ...props, ref }, children);
        }),
    },
  );

  return {
    motion,
  };
});

vi.mock("canvas-confetti", () => ({
  default: mockConfetti,
}));

describe("PaymentSuccessAnimation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("renders the success copy with the Pluto-themed card styling hook", () => {
    const { container } = render(<PaymentSuccessAnimation className="custom-card" />);

    expect(screen.getByText("Payment Secured")).toBeInTheDocument();
    expect(screen.getByText("Transaction verified on Stellar")).toBeInTheDocument();
    expect(container.firstChild).toHaveClass("custom-card");
  });

  it("fires the initial confetti burst and follow-up celebration bursts", () => {
    render(<PaymentSuccessAnimation />);

    expect(mockConfetti).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(260);
    expect(mockConfetti).toHaveBeenCalledTimes(3);

    vi.advanceTimersByTime(260);
    expect(mockConfetti).toHaveBeenCalledTimes(5);
  });

  it("calls onComplete after the animation window ends", () => {
    const onComplete = vi.fn();

    render(<PaymentSuccessAnimation onComplete={onComplete} />);

    vi.advanceTimersByTime(1999);
    expect(onComplete).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("cleans up timers when unmounted before completion", () => {
    const onComplete = vi.fn();
    const { unmount } = render(<PaymentSuccessAnimation onComplete={onComplete} />);

    vi.advanceTimersByTime(260);
    expect(mockConfetti).toHaveBeenCalledTimes(3);

    unmount();
    vi.advanceTimersByTime(4000);

    expect(onComplete).not.toHaveBeenCalled();
    expect(mockConfetti).toHaveBeenCalledTimes(3);
  });
});
