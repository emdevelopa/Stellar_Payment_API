import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// Mock next/dynamic to test the loading skeleton
vi.mock("next/dynamic", () => ({
  default: vi.fn((_loader: any, options?: { loading?: () => React.ReactNode }) => {
    return function DynamicStub() {
      return options?.loading ? options.loading() : null;
    };
  }),
}));

import TransactionFilterSidebarLazy, {
  TransactionFilterSidebarSkeleton,
} from "./TransactionFilterSidebar.lazy";

describe("TransactionFilterSidebar.lazy", () => {
  it("exports a dynamic component", () => {
    expect(TransactionFilterSidebarLazy).toBeDefined();
  });

  it("renders the loading skeleton while component is dynamically imported", () => {
    render(<TransactionFilterSidebarLazy />);
    const skeleton = screen.getByTestId("transaction-filter-sidebar-skeleton");
    expect(skeleton).toBeInTheDocument();
    expect(skeleton).toHaveAttribute("role", "status");
    expect(skeleton).toHaveAttribute("aria-label", "Loading filters…");
  });

  it("renders TransactionFilterSidebarSkeleton standalone", () => {
    render(<TransactionFilterSidebarSkeleton />);
    const skeleton = screen.getByTestId("transaction-filter-sidebar-skeleton");
    expect(skeleton).toBeInTheDocument();
  });
});
