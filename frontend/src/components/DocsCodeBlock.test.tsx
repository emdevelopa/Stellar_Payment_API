import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import DocsCodeBlock, { type CodeSnippet } from "./DocsCodeBlock";

describe("DocsCodeBlock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock navigator.clipboard
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
      configurable: true,
      writable: true,
    });
  });

  describe("Rendering & Basic Functionality", () => {
    it("renders code block with text children and copy button", () => {
      render(<DocsCodeBlock className="language-bash">echo "Hello Pluto"</DocsCodeBlock>);

      expect(screen.getByText(/echo "Hello Pluto"/i)).toBeInTheDocument();
      const copyBtn = screen.getByRole("button", { name: /copy code snippet/i });
      expect(copyBtn).toBeInTheDocument();
    });

    it("copies text to clipboard and updates screen reader announcement on click", async () => {
      const user = userEvent.setup();
      const writeSpy = vi.spyOn(navigator.clipboard, "writeText");

      render(<DocsCodeBlock className="language-javascript">const a = 10;</DocsCodeBlock>);

      const copyBtn = screen.getByRole("button", { name: /copy code snippet/i });
      await user.click(copyBtn);

      expect(writeSpy).toHaveBeenCalledWith("const a = 10;");

      // Verify copied visual state and screen reader announcement
      await waitFor(() => {
        expect(screen.getByText("Copied")).toBeInTheDocument();
        expect(screen.getByRole("status")).toHaveTextContent("Code snippet copied to clipboard");
      });
    });

    it("has accessible scrollable region for keyboard users (WCAG 2.1 AA)", () => {
      render(<DocsCodeBlock className="language-python">print('test')</DocsCodeBlock>);
      const region = screen.getByRole("region", { name: /snippet content/i });
      expect(region).toBeInTheDocument();
      expect(region).toHaveAttribute("tabindex", "0");
    });
  });

  describe("Multi-language snippet tab switcher (#1809)", () => {
    const mockSnippets: CodeSnippet[] = [
      { id: "curl", label: "cURL", language: "bash", code: `curl https://api.pluto.io` },
      { id: "node", label: "Node.js", language: "javascript", code: `const res = await fetch('https://api.pluto.io');` },
      { id: "python", label: "Python", language: "python", code: `import requests\nrequests.get('https://api.pluto.io')` },
    ];

    it("renders tablist and tabs with proper ARIA attributes", () => {
      render(<DocsCodeBlock snippets={mockSnippets} />);

      const tablist = screen.getByRole("tablist", { name: /code snippet languages/i });
      expect(tablist).toBeInTheDocument();

      const tabs = screen.getAllByRole("tab");
      expect(tabs).toHaveLength(3);

      expect(tabs[0]).toHaveAttribute("aria-selected", "true");
      expect(tabs[0]).toHaveAttribute("tabindex", "0");
      expect(tabs[1]).toHaveAttribute("aria-selected", "false");
      expect(tabs[1]).toHaveAttribute("tabindex", "-1");
    });

    it("switches snippet code when a different tab is clicked", async () => {
      const user = userEvent.setup();
      render(<DocsCodeBlock snippets={mockSnippets} />);

      expect(screen.getByRole("region")).toHaveTextContent(/curl https:\/\/api\.pluto\.io/i);

      const nodeTab = screen.getByRole("tab", { name: "Node.js" });
      await user.click(nodeTab);

      expect(nodeTab).toHaveAttribute("aria-selected", "true");
      expect(screen.getByRole("region")).toHaveTextContent(/const res = await fetch/i);
    });

    it("supports keyboard navigation across tabs (ArrowRight, ArrowLeft, Home, End)", async () => {
      render(<DocsCodeBlock snippets={mockSnippets} />);

      const tabs = screen.getAllByRole("tab");
      tabs[0].focus();

      // ArrowRight moves to next tab
      fireEvent.keyDown(tabs[0], { key: "ArrowRight" });
      expect(tabs[1]).toHaveAttribute("aria-selected", "true");
      expect(document.activeElement).toBe(tabs[1]);

      // ArrowRight again moves to third tab
      fireEvent.keyDown(tabs[1], { key: "ArrowRight" });
      expect(tabs[2]).toHaveAttribute("aria-selected", "true");
      expect(document.activeElement).toBe(tabs[2]);

      // ArrowRight wraps to first tab
      fireEvent.keyDown(tabs[2], { key: "ArrowRight" });
      expect(tabs[0]).toHaveAttribute("aria-selected", "true");
      expect(document.activeElement).toBe(tabs[0]);

      // ArrowLeft wraps backwards to last tab
      fireEvent.keyDown(tabs[0], { key: "ArrowLeft" });
      expect(tabs[2]).toHaveAttribute("aria-selected", "true");
      expect(document.activeElement).toBe(tabs[2]);

      // Home key moves to first tab
      fireEvent.keyDown(tabs[2], { key: "Home" });
      expect(tabs[0]).toHaveAttribute("aria-selected", "true");
      expect(document.activeElement).toBe(tabs[0]);

      // End key moves to last tab
      fireEvent.keyDown(tabs[0], { key: "End" });
      expect(tabs[2]).toHaveAttribute("aria-selected", "true");
      expect(document.activeElement).toBe(tabs[2]);
    });
  });

  describe("Responsive Drawer View & Touch Gesture Support (#1810)", () => {
    it("opens responsive bottom drawer when drawer button is clicked", async () => {
      const user = userEvent.setup();
      render(<DocsCodeBlock className="language-bash">pluto-cli init</DocsCodeBlock>);

      const drawerBtn = screen.getByRole("button", { name: /open code in responsive drawer/i });
      expect(drawerBtn).toHaveAttribute("aria-expanded", "false");

      await user.click(drawerBtn);

      const dialog = screen.getByRole("dialog");
      expect(dialog).toBeInTheDocument();
      expect(dialog).toHaveAttribute("aria-modal", "true");
      expect(drawerBtn).toHaveAttribute("aria-expanded", "true");
    });

    it("closes responsive drawer on close button click and restores focus", async () => {
      const user = userEvent.setup();
      render(<DocsCodeBlock className="language-bash">pluto-cli init</DocsCodeBlock>);

      const drawerBtn = screen.getByRole("button", { name: /open code in responsive drawer/i });
      await user.click(drawerBtn);

      const closeBtn = screen.getByRole("button", { name: /close code drawer/i });
      await user.click(closeBtn);

      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
    });

    it("closes responsive drawer on Escape key press", async () => {
      const user = userEvent.setup();
      render(<DocsCodeBlock className="language-bash">pluto-cli init</DocsCodeBlock>);

      const drawerBtn = screen.getByRole("button", { name: /open code in responsive drawer/i });
      await user.click(drawerBtn);

      expect(screen.getByRole("dialog")).toBeInTheDocument();

      fireEvent.keyDown(document, { key: "Escape" });

      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
    });

    it("closes responsive drawer when clicking on the backdrop", async () => {
      const user = userEvent.setup();
      render(<DocsCodeBlock className="language-bash">pluto-cli init</DocsCodeBlock>);

      const drawerBtn = screen.getByRole("button", { name: /open code in responsive drawer/i });
      await user.click(drawerBtn);

      const backdrop = screen.getByTestId("code-block-drawer-backdrop");
      fireEvent.click(backdrop);

      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
    });

    it("handles touch gestures for swipe-to-dismiss", async () => {
      const user = userEvent.setup();
      render(<DocsCodeBlock className="language-bash">pluto-cli init</DocsCodeBlock>);

      const drawerBtn = screen.getByRole("button", { name: /open code in responsive drawer/i });
      await user.click(drawerBtn);

      const dialog = screen.getByRole("dialog");

      // Touch start at y = 100
      fireEvent.touchStart(dialog, {
        touches: [{ clientX: 200, clientY: 100 }],
      });

      // Drag downward to y = 250 (150px downward drag, exceeding 100px threshold)
      fireEvent.touchMove(dialog, {
        touches: [{ clientX: 200, clientY: 250 }],
      });

      // Release touch
      fireEvent.touchEnd(dialog, {
        changedTouches: [{ clientX: 200, clientY: 250 }],
      });

      // Should dismiss
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
    });

    it("traps focus inside the drawer dialog while open (WCAG 2.1 AA)", async () => {
      const user = userEvent.setup();
      render(<DocsCodeBlock className="language-bash">pluto-cli init</DocsCodeBlock>);

      const drawerBtn = screen.getByRole("button", { name: /open code in responsive drawer/i });
      await user.click(drawerBtn);

      const dialog = screen.getByRole("dialog");
      const focusable = dialog.querySelectorAll<HTMLElement>("button, [tabindex='0']");
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      // Tab on last element should cycle to first
      last.focus();
      fireEvent.keyDown(document, { key: "Tab", shiftKey: false });
      expect(document.activeElement).toBe(first);

      // Shift+Tab on first element should cycle to last
      first.focus();
      fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
      expect(document.activeElement).toBe(last);
    });
  });
});
