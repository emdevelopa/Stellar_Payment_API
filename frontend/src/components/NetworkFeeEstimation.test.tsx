/** @vitest-environment jsdom */
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NetworkFeeData } from "@/hooks/useNetworkFee";
import NetworkFeeEstimation from "./NetworkFeeEstimation";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) =>
    key === "networkFeeUnavailable" ? "Network fee unavailable right now." : key,
}));

// Render motion elements as plain ones so the tests do not depend on animation.
vi.mock("framer-motion", () => {
  const motion = new Proxy(
    {},
    {
      get: (_target, tag: string) =>
        function MotionElement({
          children,
          initial: _initial,
          animate: _animate,
          exit: _exit,
          transition: _transition,
          ...props
        }: Record<string, unknown> & { children?: React.ReactNode }) {
          return React.createElement(tag, props, children);
        },
    },
  );
  return { motion, AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</> };
});

const refetch = vi.fn();
let hookState: {
  fee: NetworkFeeData | null;
  isLoading: boolean;
  error: string | null;
};

vi.mock("@/hooks/useNetworkFee", () => ({
  useNetworkFee: () => ({ ...hookState, refetch }),
}));

const FEE: NetworkFeeData = {
  network: "testnet",
  horizon_url: "https://horizon-testnet.stellar.org",
  operation_count: 1,
  stroops: 100,
  xlm: "0.00001",
  last_ledger_base_fee: 100,
};

beforeEach(() => {
  refetch.mockReset();
  hookState = { fee: null, isLoading: false, error: null };
});

describe("NetworkFeeEstimation accessibility", () => {
  it("announces the loading state and marks the region busy", () => {
    hookState = { fee: null, isLoading: true, error: null };
    render(<NetworkFeeEstimation />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading network fee estimate");
    expect(screen.getByTestId("network-fee-region")).toHaveAttribute("aria-busy", "true");
  });

  it("announces the full fee phrase instead of the terse visible text", () => {
    hookState = { fee: FEE, isLoading: false, error: null };
    render(<NetworkFeeEstimation />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "Estimated network fee: about 0.00001 XLM, 100 stroops for 1 operation."
    );
    expect(screen.getByTestId("network-fee-region")).toHaveAttribute("aria-busy", "false");
    // The visible "~0.00001 XLM" is hidden from assistive technology.
    expect(screen.getByText("~0.00001 XLM").closest("[aria-hidden='true']")).not.toBeNull();
  });

  it("uses a polite, atomic live region so updates are announced whole", () => {
    hookState = { fee: FEE, isLoading: false, error: null };
    render(<NetworkFeeEstimation />);

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveAttribute("aria-atomic", "true");
  });

  it("surfaces an error as an alert with a labelled retry button", () => {
    hookState = { fee: null, isLoading: false, error: "boom" };
    render(<NetworkFeeEstimation />);

    expect(screen.getByRole("alert")).toHaveTextContent("Network fee unavailable right now.");
    expect(screen.getByRole("button", { name: /retry fetching network fee/i })).toBeInTheDocument();
    // The error is announced by the alert, not duplicated in the status region.
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("keeps keyboard focus on the region when Retry is activated", () => {
    hookState = { fee: null, isLoading: false, error: "boom" };
    render(<NetworkFeeEstimation />);

    const retry = screen.getByRole("button", { name: /retry fetching network fee/i });
    retry.focus();
    fireEvent.click(retry);

    expect(refetch).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("network-fee-region")).toHaveFocus();
  });

  it("makes the region programmatically focusable but not a tab stop", () => {
    render(<NetworkFeeEstimation />);
    expect(screen.getByTestId("network-fee-region")).toHaveAttribute("tabindex", "-1");
  });

  it("keeps the last good estimate when a refresh fails", () => {
    hookState = { fee: FEE, isLoading: false, error: "boom" };
    render(<NetworkFeeEstimation />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("about 0.00001 XLM");
  });

  it("announces the unavailable fallback when there is no fee and no error", () => {
    render(<NetworkFeeEstimation />);
    expect(screen.getByRole("status")).toHaveTextContent("Network fee unavailable right now.");
  });

  it("hides decorative icons from assistive technology", () => {
    hookState = { fee: FEE, isLoading: false, error: null };
    const { container, rerender } = render(<NetworkFeeEstimation />);
    container.querySelectorAll("svg").forEach((icon) => {
      expect(icon).toHaveAttribute("aria-hidden", "true");
    });

    hookState = { fee: null, isLoading: false, error: "boom" };
    rerender(<NetworkFeeEstimation />);
    container.querySelectorAll("svg").forEach((icon) => {
      expect(icon).toHaveAttribute("aria-hidden", "true");
    });
  });
});
