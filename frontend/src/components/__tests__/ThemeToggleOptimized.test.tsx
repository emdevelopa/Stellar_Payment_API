import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ThemeToggleOptimized from "../ThemeToggleOptimized";
import { ThemeProvider } from "@/lib/theme-engine-optimized";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, string>) => {
    if (params?.theme) return `${key}:${params.theme}`;
    return key;
  },
}));

describe("ThemeToggleOptimized", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("light", "dark", "high-contrast");
    document.documentElement.removeAttribute("data-contrast");
  });

  const renderWithProvider = () =>
    render(
      <ThemeProvider defaultTheme="light">
        <ThemeToggleOptimized />
      </ThemeProvider>,
    );

  it("renders accessible toggle button and cycles themes on click", () => {
    renderWithProvider();

    const toggleBtn = screen.getByRole("button", { name: /ariaLabel/i });
    expect(toggleBtn).toBeInTheDocument();
    expect(toggleBtn).toHaveAttribute("aria-describedby");

    fireEvent.click(toggleBtn);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("opens responsive drawer, manages keyboard arrow navigation and Escape focus restore", () => {
    renderWithProvider();

    const drawerTrigger = screen.getByRole("button", {
      name: /open theme and high-contrast settings/i,
    });
    expect(drawerTrigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(drawerTrigger);
    expect(drawerTrigger).toHaveAttribute("aria-expanded", "true");

    const dialog = screen.getByRole("dialog", { name: /appearance/i });
    expect(dialog).toBeInTheDocument();

    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(3);
    expect(radios[0]).toHaveAttribute("aria-checked", "true");

    // ArrowDown moves focus to next theme option
    radios[0].focus();
    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    expect(document.activeElement).toBe(radios[1]);

    // Selecting dark theme updates DOM
    fireEvent.click(radios[1]);
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    // Escape closes the drawer
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("toggles high-contrast mode and persists preference", () => {
    renderWithProvider();

    fireEvent.click(
      screen.getByRole("button", {
        name: /open theme and high-contrast settings/i,
      }),
    );

    const contrastSwitch = screen.getByRole("switch", {
      name: /high contrast/i,
    });
    expect(contrastSwitch).toHaveAttribute("aria-checked", "false");

    fireEvent.click(contrastSwitch);
    expect(contrastSwitch).toHaveAttribute("aria-checked", "true");
    expect(document.documentElement.classList.contains("high-contrast")).toBe(true);
    expect(document.documentElement.getAttribute("data-contrast")).toBe("high");
    expect(localStorage.getItem("merchant-high-contrast-preference")).toBe("true");
  });

  it("dismisses drawer on downward swipe touch gesture", () => {
    renderWithProvider();

    fireEvent.click(
      screen.getByRole("button", {
        name: /open theme and high-contrast settings/i,
      }),
    );

    const dialog = screen.getByRole("dialog", { name: /appearance/i });

    fireEvent.touchStart(dialog, { touches: [{ clientX: 100, clientY: 100 }] });
    fireEvent.touchMove(dialog, { touches: [{ clientX: 100, clientY: 200 }] });
    fireEvent.touchEnd(dialog, { changedTouches: [{ clientX: 100, clientY: 200 }] });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("cycles theme on horizontal swipe touch gesture on trigger", () => {
    renderWithProvider();

    const toggleBtn = screen.getByRole("button", { name: /ariaLabel/i });
    fireEvent.touchStart(toggleBtn, { touches: [{ clientX: 100, clientY: 20 }] });
    fireEvent.touchEnd(toggleBtn, { changedTouches: [{ clientX: 180, clientY: 20 }] });

    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});
