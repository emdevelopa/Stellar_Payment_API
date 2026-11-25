import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import DocsSidebar from "./DocsSidebar";

// Mock next/navigation
let currentPathname = "/docs/api-guide";
vi.mock("next/navigation", () => ({
  usePathname: () => currentPathname,
}));

describe("DocsSidebar", () => {
  beforeEach(() => {
    currentPathname = "/docs/api-guide";
    vi.clearAllMocks();
  });

  describe("Documentation Navigation & Overview", () => {
    it("renders navigation with proper aria-label and links", () => {
      render(<DocsSidebar />);

      const nav = screen.getByRole("navigation", { name: /documentation navigation/i });
      expect(nav).toBeInTheDocument();

      const overviewLink = screen.getByRole("link", { name: /overview/i });
      expect(overviewLink).toBeInTheDocument();
      expect(overviewLink).toHaveAttribute("href", "/docs");
    });

    it("marks active doc with aria-current='page'", () => {
      currentPathname = "/docs/api-guide";
      render(<DocsSidebar />);

      const activeLink = screen.getByRole("link", { name: /subscription api guide/i });
      expect(activeLink).toHaveAttribute("aria-current", "page");

      const inactiveLink = screen.getByRole("link", { name: /how to verify hmac signatures/i });
      expect(inactiveLink).not.toHaveAttribute("aria-current");
    });

    it("includes accessible screen reader text for 'New' badge", () => {
      render(<DocsSidebar />);
      const srNewText = screen.getByText(/new article:/i);
      expect(srNewText).toHaveClass("sr-only");
    });
  });

  describe("Collapsible Documentation Hierarchy (#1814)", () => {
    it("auto-expands sections for current active page by default", () => {
      currentPathname = "/docs/api-guide";
      render(<DocsSidebar />);

      const toggleBtn = screen.getByRole("button", {
        name: /toggle subscription api guide subsections/i,
      });
      expect(toggleBtn).toHaveAttribute("aria-expanded", "true");

      expect(screen.getByRole("link", { name: /integration architecture/i })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /backend environment/i })).toBeInTheDocument();
    });

    it("collapses and expands subsections when toggle button is clicked", async () => {
      const user = userEvent.setup();
      currentPathname = "/docs/api-guide";
      render(<DocsSidebar />);

      const toggleBtn = screen.getByRole("button", {
        name: /toggle subscription api guide subsections/i,
      });

      // Collapse
      await user.click(toggleBtn);
      expect(toggleBtn).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByRole("link", { name: /integration architecture/i })).not.toBeInTheDocument();

      // Expand again
      await user.click(toggleBtn);
      expect(toggleBtn).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByRole("link", { name: /integration architecture/i })).toBeInTheDocument();
    });
  });

  describe("Search Anchor Navigation (#1814)", () => {
    it("filters documentation guides and sections by query", async () => {
      const user = userEvent.setup();
      render(<DocsSidebar />);

      const searchInput = screen.getByRole("searchbox", { name: /search documentation/i });
      await user.type(searchInput, "hmac");

      // Matching guide should be visible and expanded
      expect(screen.getByRole("link", { name: /how to verify hmac signatures/i })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /signing logic/i })).toBeInTheDocument();

      // Non-matching guide should be filtered out
      expect(screen.queryByRole("link", { name: /subscription api guide/i })).not.toBeInTheDocument();
    });

    it("announces search match count to screen readers via live region", async () => {
      const user = userEvent.setup();
      render(<DocsSidebar />);

      const searchInput = screen.getByRole("searchbox", { name: /search documentation/i });
      await user.type(searchInput, "webhook");

      const liveRegion = screen.getByRole("status");
      expect(liveRegion).toHaveTextContent(/found matching "webhook"/i);
    });

    it("clears search query when clear button or Escape is pressed", async () => {
      const user = userEvent.setup();
      render(<DocsSidebar />);

      const searchInput = screen.getByRole("searchbox", { name: /search documentation/i });
      await user.type(searchInput, "agentic");

      const clearBtn = screen.getByRole("button", { name: /clear search query/i });
      await user.click(clearBtn);

      expect(searchInput).toHaveValue("");
      expect(screen.getByRole("link", { name: /subscription api guide/i })).toBeInTheDocument();

      // Test Escape key
      await user.type(searchInput, "something");
      fireEvent.keyDown(searchInput, { key: "Escape" });
      expect(searchInput).toHaveValue("");
    });

    it("moves focus from search box to first navigation item on ArrowDown", () => {
      render(<DocsSidebar />);

      const searchInput = screen.getByRole("searchbox", { name: /search documentation/i });
      searchInput.focus();

      fireEvent.keyDown(searchInput, { key: "ArrowDown" });

      const overviewLink = screen.getByRole("link", { name: /overview/i });
      expect(document.activeElement).toBe(overviewLink);
    });
  });

  describe("Keyboard Navigation in List (WCAG 2.1 AA)", () => {
    it("navigates between navigation links using ArrowDown and ArrowUp", () => {
      render(<DocsSidebar />);

      const overviewLink = screen.getByRole("link", { name: /overview/i });
      overviewLink.focus();

      fireEvent.keyDown(overviewLink, { key: "ArrowDown" });
      const apiGuideLink = screen.getByRole("link", { name: /subscription api guide/i });
      expect(document.activeElement).toBe(apiGuideLink);

      // ArrowUp goes back to overview link
      fireEvent.keyDown(apiGuideLink, { key: "ArrowUp" });
      expect(document.activeElement).toBe(overviewLink);
    });
  });
});
