import React from "react";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom";
import PaymentSuccessAnimation from "./PaymentSuccessAnimation";
import { vi } from "vitest";

// Mock next-intl
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => {
    const messages: Record<string, string> = {
      receivedTitle: "Payment Received",
      receivedDescription: "Your transaction was successfully confirmed and settled on the Stellar network.",
    };
    return messages[key] || key;
  },
}));

// Mock framer-motion to skip animations
vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    h2: ({ children, ...props }: any) => <h2 {...props}>{children}</h2>,
    p: ({ children, ...props }: any) => <p {...props}>{children}</p>,
    svg: ({ children, ...props }: any) => <svg {...props}>{children}</svg>,
    path: ({ children, ...props }: any) => <path {...props}>{children}</path>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
  LayoutGroup: ({ children }: any) => <>{children}</>,
}));

// Mock canvas-confetti
vi.mock("canvas-confetti", () => ({
  default: vi.fn(),
}));

describe("PaymentSuccessAnimation Component", () => {
  it("renders correctly with amount and asset after entrance transition", async () => {
    const { findByText } = render(<PaymentSuccessAnimation amount={10} asset="XLM" />);
    
    // The component starts in 'enter' phase and transitions to 'celebrate' after 800ms
    expect(await findByText("10")).toBeInTheDocument();
    expect(await findByText("XLM")).toBeInTheDocument();
  });

  it("shows optimistic state when requested", async () => {
    const { findByText } = render(<PaymentSuccessAnimation amount={10} asset="XLM" optimistic={true} />);
    
    // Settling indicator appears after the entrance transition
    expect(await findByText(/Settling on-chain.../i)).toBeInTheDocument();
  });

  it("displays success title after transition", async () => {
    const { findByText } = render(<PaymentSuccessAnimation amount={10} asset="XLM" />);
    // The title appears in the celebrate phase (delay > 800ms)
    expect(await findByText(/Payment Received/i)).toBeInTheDocument();
  });
});
