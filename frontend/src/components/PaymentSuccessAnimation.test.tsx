import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import React from "react";
import confetti from "canvas-confetti";
import { PaymentSuccessAnimationClient as PaymentSuccessAnimation } from "./PaymentSuccessAnimationClient";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("canvas-confetti", () => ({
  default: vi.fn(),
}));

// ── motion/react mock ────────────────────────────────────────────────────────

const MOTION_PROPS = [
  "initial", "animate", "exit", "transition", "variants", "viewport",
  "whileInView", "whileHover", "whileTap", "whileFocus", "whileDrag",
  "layout", "layoutId", "custom", "drag", "dragConstraints",
  "onAnimationStart", "onAnimationComplete", "onUpdate",
];

function mkMotion(tag: string) {
  return React.forwardRef(function MotionStub({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>, ref: React.Ref<unknown>) {
    const domProps = { ...props };
    MOTION_PROPS.forEach((k) => delete domProps[k]);
    return React.createElement(tag, { ...domProps, ref }, children);
  });
}

vi.mock("motion/react", () => ({
  motion: {
    div: mkMotion("div"),
    button: mkMotion("button"),
    h2: mkMotion("h2"),
    p: mkMotion("p"),
    path: mkMotion("path"),
  },
  // Wrapped in a marker element (rather than a bare fragment) so tests can
  // assert AnimatePresence itself stays mounted across a show->false toggle,
  // which is what lets its real (unmocked) exit transition run (#1390).
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="animate-presence-boundary">{children}</div>
  ),
}));

// The component reads the OS "prefers reduced motion" setting via
// window.matchMedia (not a framer-motion/motion hook), so tests drive it
// through matchMedia directly (#980).
function setPrefersReducedMotion(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: matches && query === "(prefers-reduced-motion: reduce)",
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

// ─────────────────────────────────────────────────────────────────────────────

describe("PaymentSuccessAnimation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    setPrefersReducedMotion(false);
  });

  // ── Render / visibility ────────────────────────────────────────────────────

  it("renders nothing when show is false", () => {
    render(<PaymentSuccessAnimation show={false} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders dialog content when show is true", () => {
    render(<PaymentSuccessAnimation show amount="100" asset="XLM" txId="tx123" />);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("payment.successTitle")).toBeInTheDocument();
    expect(screen.getByText("100 XLM")).toBeInTheDocument();
    expect(screen.getByText("tx123")).toBeInTheDocument();
  });

  it("omits transaction ID block when txId is not provided", () => {
    render(<PaymentSuccessAnimation show amount="5" asset="USDC" />);
    expect(screen.queryByText("payment.transactionId")).not.toBeInTheDocument();
  });

  it("uses default amount and asset when not provided", () => {
    render(<PaymentSuccessAnimation show />);
    expect(screen.getByText("0 XLM")).toBeInTheDocument();
  });

  it("keeps AnimatePresence mounted when show flips to false, so its exit transition can run (#1390)", () => {
    const { rerender } = render(<PaymentSuccessAnimation show />);
    expect(screen.getByTestId("animate-presence-boundary")).toBeInTheDocument();

    rerender(<PaymentSuccessAnimation show={false} />);
    expect(screen.getByTestId("animate-presence-boundary")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // ── Optimistic updates (#981) ──────────────────────────────────────────────

  it("shows optimistic badge when isOptimistic is true", () => {
    render(<PaymentSuccessAnimation show isOptimistic amount="50" asset="XLM" />);
    expect(screen.getByText("payment.optimisticNote")).toBeInTheDocument();
  });

  it("does not show optimistic badge when isOptimistic is false", () => {
    render(<PaymentSuccessAnimation show isOptimistic={false} amount="50" asset="XLM" />);
    expect(screen.queryByText("payment.optimisticNote")).not.toBeInTheDocument();
  });

  it("optimistic badge has role=status with aria-live=polite", () => {
    render(<PaymentSuccessAnimation show isOptimistic />);
    const badge = screen.getByText("payment.optimisticNote").closest("[role='status']");
    expect(badge).toHaveAttribute("aria-live", "polite");
  });

  it("continue button is disabled during optimistic dismiss", async () => {
    let resolveOnComplete!: () => void;
    const onComplete = vi.fn().mockImplementation(
      () => new Promise<void>((resolve) => { resolveOnComplete = resolve; })
    );
    render(<PaymentSuccessAnimation show onComplete={onComplete} />);

    await userEvent.click(screen.getByLabelText("common.continue"));

    expect(screen.getByLabelText("common.continue")).toBeDisabled();
    expect(screen.getByLabelText("common.continue")).toHaveAttribute("aria-busy", "true");

    act(() => resolveOnComplete());
  });

  it("close button is disabled during optimistic dismiss", async () => {
    let resolveOnComplete!: () => void;
    const onComplete = vi.fn().mockImplementation(
      () => new Promise<void>((resolve) => { resolveOnComplete = resolve; })
    );
    render(<PaymentSuccessAnimation show onComplete={onComplete} />);

    await userEvent.click(screen.getByLabelText("common.close"));

    expect(screen.getByLabelText("common.close")).toBeDisabled();
    expect(screen.getByLabelText("common.close")).toHaveAttribute("aria-busy", "true");

    act(() => resolveOnComplete());
  });

  it("shows spinner on continue button during dismiss", async () => {
    let resolveOnComplete!: () => void;
    const onComplete = vi.fn().mockImplementation(
      () => new Promise<void>((resolve) => { resolveOnComplete = resolve; })
    );
    render(<PaymentSuccessAnimation show onComplete={onComplete} />);

    await userEvent.click(screen.getByLabelText("common.continue"));

    expect(screen.getByTestId("dismiss-spinner")).toBeInTheDocument();

    act(() => resolveOnComplete());
  });

  it("rolls back dismiss state and re-enables buttons when onComplete throws", async () => {
    const onComplete = vi.fn().mockRejectedValue(new Error("Network error"));
    render(<PaymentSuccessAnimation show onComplete={onComplete} />);

    await userEvent.click(screen.getByLabelText("common.continue"));

    expect(screen.getByLabelText("common.continue")).not.toBeDisabled();
    expect(screen.getByLabelText("common.continue")).not.toHaveAttribute("aria-busy", "true");
  });

  it("prevents double-dismiss while already dismissing", async () => {
    let resolveOnComplete!: () => void;
    const onComplete = vi.fn().mockImplementation(
      () => new Promise<void>((resolve) => { resolveOnComplete = resolve; })
    );
    render(<PaymentSuccessAnimation show onComplete={onComplete} />);

    await userEvent.click(screen.getByLabelText("common.continue"));

    // onComplete should have been called exactly once; button is now disabled
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("common.continue")).toBeDisabled();

    act(() => resolveOnComplete());
  });

  // ── Confetti ───────────────────────────────────────────────────────────────

  it("triggers confetti once on show", () => {
    vi.useFakeTimers();
    const { rerender } = render(<PaymentSuccessAnimation show amount="1" asset="XLM" />);
    expect(confetti).toHaveBeenCalledTimes(1);
    rerender(<PaymentSuccessAnimation show amount="1" asset="XLM" />);
    expect(confetti).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("fires flanking confetti burst 200ms after initial burst", () => {
    vi.useFakeTimers();
    render(<PaymentSuccessAnimation show />);
    expect(confetti).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(200); });
    expect(confetti).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("resets confetti guard when show toggles off then on", () => {
    vi.useFakeTimers();
    const { rerender } = render(<PaymentSuccessAnimation show />);
    expect(confetti).toHaveBeenCalledTimes(1);
    rerender(<PaymentSuccessAnimation show={false} />);
    rerender(<PaymentSuccessAnimation show />);
    expect(confetti).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("skips confetti when prefersReducedMotion is true (#980)", () => {
    setPrefersReducedMotion(true);
    vi.useFakeTimers();
    render(<PaymentSuccessAnimation show />);
    act(() => { vi.advanceTimersByTime(200); });
    expect(confetti).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  // ── onComplete callbacks ───────────────────────────────────────────────────

  it("calls onComplete when close button is clicked", async () => {
    const onComplete = vi.fn();
    render(<PaymentSuccessAnimation show onComplete={onComplete} />);
    await userEvent.click(screen.getByLabelText("common.close"));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("calls onComplete when continue button is clicked", async () => {
    const onComplete = vi.fn();
    render(<PaymentSuccessAnimation show onComplete={onComplete} />);
    await userEvent.click(screen.getByLabelText("common.continue"));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("calls onComplete after 4-second auto-dismiss timeout", () => {
    const onComplete = vi.fn();
    vi.useFakeTimers();
    render(<PaymentSuccessAnimation show onComplete={onComplete} />);
    expect(onComplete).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(4000); });
    expect(onComplete).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("does not call onComplete before 4 seconds elapse", () => {
    const onComplete = vi.fn();
    vi.useFakeTimers();
    render(<PaymentSuccessAnimation show onComplete={onComplete} />);
    act(() => { vi.advanceTimersByTime(3999); });
    expect(onComplete).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  // ── Keyboard / focus ───────────────────────────────────────────────────────

  it("dismisses via Escape key", async () => {
    const onComplete = vi.fn();
    render(<PaymentSuccessAnimation show onComplete={onComplete} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("does not call onComplete on unrelated key presses", () => {
    const onComplete = vi.fn();
    render(<PaymentSuccessAnimation show onComplete={onComplete} />);
    fireEvent.keyDown(document, { key: "Enter" });
    fireEvent.keyDown(document, { key: " " });
    expect(onComplete).not.toHaveBeenCalled();
  });

  // ── Screen reader / accessibility (#980) ──────────────────────────────────

  it("has expected dialog ARIA semantics", () => {
    render(<PaymentSuccessAnimation show amount="20" asset="USDC" />);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby", "payment-success-title");
    expect(dialog).toHaveAttribute("aria-describedby", "payment-success-description");
  });

  it("renders an assertive live region with the success announcement", () => {
    render(<PaymentSuccessAnimation show amount="20" asset="USDC" />);
    // role="alert" is implicitly assertive, unlike role="status" (implicitly
    // polite) which used to contradict its own explicit aria-live="assertive" (#1388)
    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("aria-atomic", "true");
    expect(alert).toHaveTextContent("payment.successAnnounce");
  });

  it("renders dynamic announcement region with data-testid", () => {
    render(<PaymentSuccessAnimation show />);
    expect(screen.getByTestId("sr-announcement")).toBeInTheDocument();
  });

  it("announces network confirmation when isOptimistic changes from true to false", () => {
    const { rerender } = render(<PaymentSuccessAnimation show isOptimistic />);
    rerender(<PaymentSuccessAnimation show isOptimistic={false} />);
    expect(screen.getByTestId("sr-announcement")).toHaveTextContent("payment.networkConfirmed");
  });

  it("announces error in live region when onComplete throws", async () => {
    const onComplete = vi.fn().mockRejectedValue(new Error("Stellar network error"));
    render(<PaymentSuccessAnimation show onComplete={onComplete} />);

    await userEvent.click(screen.getByLabelText("common.continue"));

    expect(screen.getByTestId("sr-announcement")).toHaveTextContent("Stellar network error");
  });

  it("close button has a descriptive accessible label", () => {
    render(<PaymentSuccessAnimation show />);
    expect(screen.getByLabelText("common.close")).toBeInTheDocument();
  });

  it("continue button has a descriptive accessible label", () => {
    render(<PaymentSuccessAnimation show />);
    expect(screen.getByLabelText("common.continue")).toBeInTheDocument();
  });

  it("renders sr-only keyboard hint", () => {
    render(<PaymentSuccessAnimation show />);
    expect(screen.getByText("payment.successHint")).toBeInTheDocument();
  });

  it("heading has the correct id for aria-labelledby", () => {
    render(<PaymentSuccessAnimation show />);
    expect(document.getElementById("payment-success-title")).toBeInTheDocument();
  });

  it("description paragraph has the correct id for aria-describedby", () => {
    render(<PaymentSuccessAnimation show />);
    expect(document.getElementById("payment-success-description")).toBeInTheDocument();
  });
});
