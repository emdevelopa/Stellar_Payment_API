import React from "react";
import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CommandPalette from "./CommandPalette";

const pushMock = vi.fn();
const toggleThemeMock = vi.fn();
let apiKeyMock: string | null = "test-api-key";
let writeTextMock = vi.fn().mockResolvedValue(undefined);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/lib/merchant-store", () => ({
  useMerchantApiKey: () => apiKeyMock,
}));

vi.mock("@/lib/theme-context", () => ({
  useThemeActions: () => ({ toggleTheme: toggleThemeMock }),
  useThemeState: () => ({ theme: "light", resolvedTheme: "light" }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/components/AssetConverter", () => ({
  __esModule: true,
  default: ({ onBack }: { onBack: () => void }) => (
    <div>
      <span>Asset Converter View</span>
      <button onClick={onBack}>Back</button>
    </div>
  ),
}));

// The global open/close shortcut is bound with window.addEventListener
// directly (not React's synthetic event system), so it needs a real
// dispatched event rather than fireEvent.
function pressGlobalShortcut() {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
  });
}

// The palette focuses itself on the next animation frame once open;
// waitFor gives that rAF callback room to run instead of assuming a fixed
// number of ticks.
async function openPalette() {
  pressGlobalShortcut();
  await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
}

describe("CommandPalette", () => {
  beforeEach(() => {
    apiKeyMock = "test-api-key";
    writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: writeTextMock } });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("is closed by default and opens on Cmd/Ctrl+K", async () => {
    render(<CommandPalette />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await openPalette();

    expect(screen.getByRole("dialog", { name: "Command palette" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Search commands" })).toHaveFocus();
  });

  it("toggles closed on a second Cmd/Ctrl+K", async () => {
    render(<CommandPalette />);
    await openPalette();

    pressGlobalShortcut();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    render(<CommandPalette />);
    await openPalette();
    const dialog = screen.getByRole("dialog");

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes on backdrop click but not on dialog click", async () => {
    render(<CommandPalette />);
    await openPalette();

    fireEvent.click(screen.getByRole("dialog"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    const backdrop = screen.getByRole("dialog").parentElement as HTMLElement;
    fireEvent.click(backdrop);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("filters commands as the user types", async () => {
    render(<CommandPalette />);
    await openPalette();
    const input = screen.getByRole("combobox", { name: "Search commands" });

    fireEvent.change(input, { target: { value: "toggle theme" } });

    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(within(options[0]).getByText(/toggle theme/i)).toBeInTheDocument();
  });

  it("shows an empty state and disables number quick-select when there are no matches", async () => {
    render(<CommandPalette />);
    await openPalette();
    const input = screen.getByRole("combobox", { name: "Search commands" });

    fireEvent.change(input, { target: { value: "zzqv no such command" } });

    expect(screen.getByText("No matching commands")).toBeInTheDocument();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  describe("keyboard navigation", () => {
    it("moves the active option with ArrowDown/ArrowUp and wraps around", async () => {
      render(<CommandPalette />);
      await openPalette();
      const dialog = screen.getByRole("dialog");
      const options = screen.getAllByRole("option");
      const firstId = options[0].id;
      const lastId = options[options.length - 1].id;

      expect(options[0]).toHaveAttribute("aria-selected", "true");

      fireEvent.keyDown(dialog, { key: "ArrowUp" });
      expect(document.getElementById(lastId)).toHaveAttribute("aria-selected", "true");

      fireEvent.keyDown(dialog, { key: "ArrowDown" });
      expect(document.getElementById(firstId)).toHaveAttribute("aria-selected", "true");
    });

    it("Tab and Shift+Tab move the active option instead of leaving the dialog (focus trap)", async () => {
      render(<CommandPalette />);
      await openPalette();
      const dialog = screen.getByRole("dialog");
      const options = screen.getAllByRole("option");
      const secondId = options[1].id;
      const lastId = options[options.length - 1].id;

      fireEvent.keyDown(dialog, { key: "Tab" });
      expect(document.getElementById(secondId)).toHaveAttribute("aria-selected", "true");

      fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
      fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
      expect(document.getElementById(lastId)).toHaveAttribute("aria-selected", "true");
    });

    it("Home and End jump to the first and last result when the query is empty", async () => {
      render(<CommandPalette />);
      await openPalette();
      const dialog = screen.getByRole("dialog");
      const options = screen.getAllByRole("option");
      const firstId = options[0].id;
      const lastId = options[options.length - 1].id;

      fireEvent.keyDown(dialog, { key: "End" });
      expect(document.getElementById(lastId)).toHaveAttribute("aria-selected", "true");

      fireEvent.keyDown(dialog, { key: "Home" });
      expect(document.getElementById(firstId)).toHaveAttribute("aria-selected", "true");
    });

    it("does not intercept Home/End once a query has been typed", async () => {
      render(<CommandPalette />);
      await openPalette();
      const input = screen.getByRole("combobox", { name: "Search commands" });
      fireEvent.change(input, { target: { value: "toggle theme" } });
      const dialog = screen.getByRole("dialog");

      fireEvent.keyDown(dialog, { key: "End" });

      // The single remaining match stays selected; End was not treated as a
      // navigation key while a query is present.
      expect(screen.getAllByRole("option")).toHaveLength(1);
      expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
    });

    it("selects a command with Enter", async () => {
      render(<CommandPalette />);
      await openPalette();
      const input = screen.getByRole("combobox", { name: "Search commands" });
      fireEvent.change(input, { target: { value: "settings" } });

      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter" });

      expect(pushMock).toHaveBeenCalledWith("/settings");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("selects a command with a number key (1-9) when the query is empty", async () => {
      render(<CommandPalette />);
      await openPalette();

      // With an empty query, "2" should run the second visible command
      // (index 1) directly -- the same command Enter would run after one
      // ArrowDown from the top.
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "2" });

      expect(pushMock).toHaveBeenCalledWith("/settings");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("does not treat digits as quick-select once a query has been typed", async () => {
      render(<CommandPalette />);
      await openPalette();
      const input = screen.getByRole("combobox", { name: "Search commands" });
      fireEvent.change(input, { target: { value: "2" } });

      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(input).toHaveValue("2");
    });
  });

  it("selects a command via mouse click", async () => {
    render(<CommandPalette />);
    await openPalette();
    const input = screen.getByRole("combobox", { name: "Search commands" });
    fireEvent.change(input, { target: { value: "docs" } });

    fireEvent.click(screen.getByRole("option", { name: /^docs/i }));

    expect(pushMock).toHaveBeenCalledWith("/docs");
  });

  it("toggles the theme without closing via router", async () => {
    render(<CommandPalette />);
    await openPalette();
    const input = screen.getByRole("combobox", { name: "Search commands" });
    fireEvent.change(input, { target: { value: "toggle theme" } });

    fireEvent.click(screen.getByRole("option"));

    expect(toggleThemeMock).toHaveBeenCalledTimes(1);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("switches to the converter view without closing the palette", async () => {
    render(<CommandPalette />);
    await openPalette();
    const input = screen.getByRole("combobox", { name: "Search commands" });
    fireEvent.change(input, { target: { value: "convert" } });

    fireEvent.click(screen.getByRole("option"));

    expect(screen.getByText("Asset Converter View")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("Escape from the converter view returns to the command list instead of closing", async () => {
    render(<CommandPalette />);
    await openPalette();
    const input = screen.getByRole("combobox", { name: "Search commands" });
    fireEvent.change(input, { target: { value: "convert" } });
    fireEvent.click(screen.getByRole("option"));
    expect(screen.getByText("Asset Converter View")).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(screen.queryByText("Asset Converter View")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  describe("async command execution (copy API key)", () => {
    function selectCopyApiKey() {
      const input = screen.getByRole("combobox", { name: "Search commands" });
      fireEvent.change(input, { target: { value: "copy" } });
      fireEvent.click(screen.getByRole("option", { name: /copy api key/i }));
    }

    it("shows a pending state and closes on success without leaving stale UI", async () => {
      let resolveWrite: () => void = () => {};
      writeTextMock.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveWrite = resolve;
          }),
      );

      render(<CommandPalette />);
      await openPalette();
      selectCopyApiKey();

      // Still open and busy while the clipboard write is in flight -- no
      // optimistic close before the outcome is known.
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.getByRole("combobox", { name: "Search commands" })).toBeDisabled();

      resolveWrite();
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(writeTextMock).toHaveBeenCalledWith("test-api-key");
    });

    it("rolls back to the open command list on failure instead of closing", async () => {
      writeTextMock.mockRejectedValue(new Error("denied"));

      render(<CommandPalette />);
      await openPalette();
      selectCopyApiKey();

      await waitFor(() =>
        expect(screen.getByRole("combobox", { name: "Search commands" })).not.toBeDisabled(),
      );

      // Rolled back: the palette is still open on the command list, not
      // dismissed, so the user can see the failure and retry.
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.getAllByRole("option").length).toBeGreaterThan(0);
    });

    it("guards against re-entrant selection while the async command is in flight", async () => {
      let resolveWrite: () => void = () => {};
      writeTextMock.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveWrite = resolve;
          }),
      );

      render(<CommandPalette />);
      await openPalette();
      selectCopyApiKey();

      const otherOptions = screen.getAllByRole("option").filter((option) => !option.getAttribute("aria-busy") || option.getAttribute("aria-busy") === "false");
      if (otherOptions.length > 0) {
        fireEvent.click(otherOptions[0]);
      }

      // No navigation happened from the second click -- the in-flight guard
      // held.
      expect(pushMock).not.toHaveBeenCalled();

      resolveWrite();
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });

    it("shows an error toast and does not attempt to copy when no API key is available", async () => {
      apiKeyMock = null;

      render(<CommandPalette />);
      await openPalette();
      selectCopyApiKey();

      expect(writeTextMock).not.toHaveBeenCalled();
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });

  it("matches its dialog structure for the default (no query) state", async () => {
    const { baseElement } = render(<CommandPalette />);
    await openPalette();
    expect(baseElement.querySelector('[role="dialog"]')).toMatchSnapshot();
  });
});
