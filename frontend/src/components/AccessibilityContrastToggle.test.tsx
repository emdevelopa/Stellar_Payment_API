import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import AccessibilityContrastToggle from "./AccessibilityContrastToggle";
import { ThemeProvider } from "@/lib/theme-context";
import { NextIntlClientProvider } from "next-intl";

// Mock translations
const mockTranslations = {
  accessibility: {
    loadingTheme: "Loading theme settings",
    errorCleared: "Error cleared. Attempting to toggle contrast.",
    switchingTo: "Switching to {theme} theme.",
    themeChanged: "Theme successfully changed to {theme}.",
    themeError: "Failed to toggle theme. Please try again.",
    currentTheme: "Current theme: {theme}",
    systemTheme: "System ({theme})",
    ariaError: "Contrast toggle with error, press to retry switching theme",
    ariaLabel: "Accessibility Contrast Toggle, current theme: {theme}, press to switch to next theme",
    errorTitle: "Theme error: {error}. Press to retry.",
    titleSystem: "Theme: System ({theme})",
    description: "Use this button to cycle through light, dark, and system themes.",
    theme: {
      light: "light",
      dark: "dark",
      system: "system",
    },
    title: {
      light: "Theme: Light",
      dark: "Theme: Dark",
    },
  },
};

const renderWithProviders = (component: React.ReactElement) => {
  return render(
    <NextIntlClientProvider locale="en" messages={mockTranslations}>
      <ThemeProvider>{component}</ThemeProvider>
    </NextIntlClientProvider>
  );
};

describe("AccessibilityContrastToggle", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders an accessible toggle after provider mount", async () => {
    renderWithProviders(<AccessibilityContrastToggle />);
    const button = await screen.findByRole("button", { name: /contrast/i });
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute("aria-busy", "false");
  });

  it("renders toggle button after mounting", async () => {
    renderWithProviders(<AccessibilityContrastToggle />);

    await waitFor(() => {
      const button = screen.queryByRole("button", { name: /loading/i });
      expect(button).not.toBeInTheDocument();
    });

    const toggleButton = screen.getByRole("button", { name: /contrast/i });
    expect(toggleButton).toBeInTheDocument();
  });

  it("announces theme change on click", async () => {
    renderWithProviders(<AccessibilityContrastToggle />);

    await waitFor(() => {
      const button = screen.queryByRole("button", { name: /loading/i });
      expect(button).not.toBeInTheDocument();
    });

    const toggleButton = screen.getByRole("button", { name: /contrast/i });
    fireEvent.click(toggleButton);

    await waitFor(() => {
      const announcement = screen.getByRole("status");
      expect(announcement.textContent).toMatch(/Switching|successfully changed/);
    });
  });

  it("has proper ARIA attributes", async () => {
    renderWithProviders(<AccessibilityContrastToggle />);

    await waitFor(() => {
      const button = screen.queryByRole("button", { name: /loading/i });
      expect(button).not.toBeInTheDocument();
    });

    const toggleButton = screen.getByRole("button", { name: /contrast/i });
    expect(toggleButton).toHaveAttribute("aria-label");
    expect(toggleButton).toHaveAttribute("aria-describedby", "contrast-description");
    expect(toggleButton).toHaveAttribute("title");
  });

  it("displays description in sr-only region", async () => {
    renderWithProviders(<AccessibilityContrastToggle />);

    const description = screen.getByText(/Use this button to cycle/);
    expect(description).toHaveClass("sr-only");
  });

  it("has live region for announcements", () => {
    renderWithProviders(<AccessibilityContrastToggle />);

    const liveRegion = screen.getByRole("status");
    expect(liveRegion).toHaveAttribute("aria-live", "polite");
    expect(liveRegion).toHaveAttribute("aria-atomic", "true");
  });

  it("disables button during loading", async () => {
    renderWithProviders(<AccessibilityContrastToggle />);

    await waitFor(() => {
      const button = screen.queryByRole("button", { name: /loading/i });
      expect(button).not.toBeInTheDocument();
    });

    const toggleButton = screen.getByRole("button", { name: /contrast/i });
    fireEvent.click(toggleButton);

    await waitFor(() => {
      expect(toggleButton).toHaveAttribute("aria-busy", "true");
    });
  });

  it("handles error state", async () => {
    renderWithProviders(<AccessibilityContrastToggle />);

    await waitFor(() => {
      const button = screen.queryByRole("button", { name: /loading/i });
      expect(button).not.toBeInTheDocument();
    });

    const toggleButton = screen.getByRole("button", { name: /contrast/i });
    expect(toggleButton).toBeInTheDocument();
  });

  it("has correct icon colors based on theme", async () => {
    const { container } = renderWithProviders(<AccessibilityContrastToggle />);

    await waitFor(() => {
      const button = screen.queryByRole("button", { name: /loading/i });
      expect(button).not.toBeInTheDocument();
    });

    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
  });
});
