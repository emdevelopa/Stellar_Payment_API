import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";

// Mock next/dynamic so we can assert on the `loading` fallback it was given
// without pulling in the real framer-motion/canvas-confetti client bundle.
vi.mock("next/dynamic", () => ({
  default: vi.fn((_loader: unknown, options: { loading: () => ReactNode }) => {
    return function DynamicStub() {
      return options.loading();
    };
  }),
}));

import { PaymentSuccessAnimation } from "./PaymentSuccessAnimation";

describe("PaymentSuccessAnimation (Server Component boundary)", () => {
  it("renders nothing when show is false, without mounting the client bundle", () => {
    render(<PaymentSuccessAnimation show={false} />);
    expect(screen.queryByTestId("payment-success-skeleton")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders the loading skeleton while the client bundle loads", () => {
    render(<PaymentSuccessAnimation show amount="10" asset="XLM" />);
    expect(screen.getByTestId("payment-success-skeleton")).toBeInTheDocument();
  });
});
