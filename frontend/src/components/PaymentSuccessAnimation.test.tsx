import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import PaymentSuccessAnimation from "./PaymentSuccessAnimation";
import { vi, describe, it, expect } from "vitest";

// Mock framer-motion to avoid animation-related issues in tests
vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
    svg: ({ children, ...props }: React.SVGAttributes<SVGSVGElement>) => <svg {...props}>{children}</svg>,
    path: ({ ...props }: React.SVGAttributes<SVGPathElement>) => <path {...props} />,
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock Heroicons
vi.mock("@heroicons/react/24/outline/CheckIcon", () => ({
  default: ({ className }: { className: string }) => (
    <span data-testid="check-icon" className={className} />
  ),
}));

describe("PaymentSuccessAnimation Component", () => {
  it("renders correctly with provided title and description", () => {
    const title = "Payment Received";
    const description = "Your transaction has been confirmed on the Stellar network.";

    render(<PaymentSuccessAnimation title={title} description={description} />);

    expect(screen.getByText(title)).toBeInTheDocument();
    expect(screen.getByText(description)).toBeInTheDocument();
    expect(screen.getByTestId("check-icon")).toBeInTheDocument();
  });

  it("applies correct styles to the container", () => {
    render(<PaymentSuccessAnimation title="Title" description="Desc" />);
    
    // Check if the main container exists and has expected flex classes
    const titleElement = screen.getByText("Title");
    // Find the outer-most div within the component
    const container = titleElement.closest(".flex-col.items-center");
    expect(container).toHaveClass("justify-center", "text-center");
  });

  it("renders with appropriate heading level for SEO and accessibility", () => {
    render(<PaymentSuccessAnimation title="Success" description="Done" />);
    
    const heading = screen.getByRole("heading", { level: 3 });
    expect(heading).toHaveTextContent("Success");
  });
});
