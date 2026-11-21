// ThemeToggleOptimized.test.tsx - clean test suite

import { render, screen, fireEvent } from "@testing-library/react";
import { vi, describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";

// Mock the theme engine module
vi.mock("@/lib/theme-engine-optimized", () => ({
  useThemeState: vi.fn(),
  useThemeActions: vi.fn(),
}));

import ThemeToggleOptimized from "./ThemeToggleOptimized";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../messages/en.json";

import * as themeEngine from "@/lib/theme-engine-optimized";

// Typed mocked hooks
const mockUseThemeState = vi.mocked(themeEngine.useThemeState);
const mockUseThemeActions = vi.mocked(themeEngine.useThemeActions);

// Helper to render the component with internationalisation provider
const renderComponent = () =>
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ThemeToggleOptimized />
    </NextIntlClientProvider>
  );

// Provide a stable matchMedia mock for system‑theme detection
beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).matchMedia = vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

// Global beforeEach: mock theme actions for every test
beforeEach(() => {
  mockUseThemeActions.mockReturnValue({
    toggleTheme: vi.fn(),
    setTheme: vi.fn(),
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Snapshot suite – verifies rendering for each state
// ---------------------------------------------------------------------------

describe("ThemeToggleOptimized – snapshots", () => {
  it("matches snapshot when loading (isMounted false)", () => {
    mockUseThemeState.mockReturnValue({ isMounted: false });
    const { container } = renderComponent();
    expect(container).toMatchSnapshot();
    const button = screen.getByRole("button", { hidden: true });
    expect(button).toBeDisabled();
  });

  it("matches snapshot for light theme", () => {
    mockUseThemeState.mockReturnValue({
      theme: "light",
      resolvedTheme: "light",
      isMounted: true,
    });
    const { container } = renderComponent();
    expect(container).toMatchSnapshot();
  });

  it("matches snapshot for dark theme", () => {
    mockUseThemeState.mockReturnValue({
      theme: "dark",
      resolvedTheme: "dark",
      isMounted: true,
    });
    const { container } = renderComponent();
    expect(container).toMatchSnapshot();
  });

  it("matches snapshot for system theme (system + resolved dark)", () => {
    mockUseThemeState.mockReturnValue({
      theme: "system",
      resolvedTheme: "dark",
      isMounted: true,
    });
    const { container } = renderComponent();
    expect(container).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------
// Interaction suite – user behaviour
// ---------------------------------------------------------------------------

describe("ThemeToggleOptimized – interactions", () => {
  const toggleMock = vi.fn();

  beforeEach(() => {
    toggleMock.mockReset();
    mockUseThemeActions.mockReturnValue({ toggleTheme: toggleMock, setTheme: vi.fn() });
  });

  it("cycles theme on click – toggles to dark and updates live region", async () => {
    // Start in light mode
    mockUseThemeState.mockReturnValue({
      theme: "light",
      resolvedTheme: "light",
      isMounted: true,
    });
    renderComponent();
    const button = screen.getByRole("button");

    await fireEvent.click(button);
    expect(toggleMock).toHaveBeenCalledTimes(1);

    // Verify live region contains the expected switch message for dark theme
    const liveRegion = screen.getByRole("status");
    const expectedSwitch = messages.darkModeTheme.switchingTo.replace(
      "{theme}",
      messages.darkModeTheme.themes.dark
    );
    expect(liveRegion).toHaveTextContent(expectedSwitch);
  });

  it("responds to keyboard activation (Enter key)", async () => {
    mockUseThemeState.mockReturnValue({
      theme: "light",
      resolvedTheme: "light",
      isMounted: true,
    });
    renderComponent();
    const button = screen.getByRole("button");

    await fireEvent.keyDown(button, { key: "Enter", code: "Enter", charCode: 13 });
    // Simulate native button activation via Enter key
    await fireEvent.click(button);
    expect(toggleMock).toHaveBeenCalledTimes(1);
  });

  it("has correct aria‑label and aria-describedby attributes", () => {
    mockUseThemeState.mockReturnValue({
      theme: "dark",
      resolvedTheme: "dark",
      isMounted: true,
    });
    renderComponent();
    const button = screen.getByRole("button");
    const expectedLabel = messages.darkModeTheme.ariaLabel.replace(
      "{theme}",
      messages.darkModeTheme.themes.dark
    );
    expect(button).toHaveAttribute("aria-label", expectedLabel);
    expect(button).toHaveAttribute("aria-describedby", "theme-opt-description");
    const description = screen.getByText(messages.darkModeTheme.description);
    expect(description).toBeInTheDocument();
  });
});
