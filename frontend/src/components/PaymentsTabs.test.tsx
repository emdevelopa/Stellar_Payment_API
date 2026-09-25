/** @vitest-environment jsdom */
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, it, vi } from "vitest";
import PaymentsTabs from "./PaymentsTabs";

vi.mock("@/components/RecentPayments", () => ({
  __esModule: true,
  default: () => <div>Recent Payments Mock</div>,
}));

vi.mock("@/components/WebhookLogs", () => ({
  __esModule: true,
  default: () => <div>Webhook Logs Mock</div>,
}));

describe("PaymentsTabs", () => {
  it("renders Development Logs tab beside Payments and toggles panel", () => {
    render(<PaymentsTabs />);

    expect(screen.getByRole("tab", { name: "Payments" })).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Development Logs" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Recent Payments Mock")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Development Logs" }));

    expect(screen.getByText("Webhook Logs Mock")).toBeInTheDocument();
    expect(screen.queryByText("Recent Payments Mock")).not.toBeInTheDocument();
  });
});
