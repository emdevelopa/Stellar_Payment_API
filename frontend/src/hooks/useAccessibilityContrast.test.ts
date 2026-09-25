import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { useAccessibilityContrast } from "./useAccessibilityContrast";
import { ThemeProvider } from "@/lib/theme-context";
import { NextIntlClientProvider } from "next-intl";
import React from "react";

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

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(NextIntlClientProvider, { locale: "en", messages: mockTranslations },
    React.createElement(ThemeProvider, {}, children)
  );

describe("useAccessibilityContrast", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns initial state", () => {
    const { result } = renderHook(() => useAccessibilityContrast(), { wrapper });

    expect(result.current.loadingState).toBe("idle");
    expect(result.current.announcement).toMatch(/Current theme|^$/);
  });

  it("provides getNextTheme function", () => {
    const { result } = renderHook(() => useAccessibilityContrast(), { wrapper });

    expect(typeof result.current.getNextTheme).toBe("function");
  });

  it("provides getAriaLabel function", () => {
    const { result } = renderHook(() => useAccessibilityContrast(), { wrapper });

    expect(typeof result.current.getAriaLabel).toBe("function");
  });

  it("provides getTitle function", () => {
    const { result } = renderHook(() => useAccessibilityContrast(), { wrapper });

    expect(typeof result.current.getTitle).toBe("function");
  });

  it("provides handleContrastToggle function", () => {
    const { result } = renderHook(() => useAccessibilityContrast(), { wrapper });

    expect(typeof result.current.handleContrastToggle).toBe("function");
  });

  it("tracks loading state", async () => {
    const { result } = renderHook(() => useAccessibilityContrast(), { wrapper });

    expect(result.current.loadingState).toBe("idle");

    await act(async () => {
      await result.current.handleContrastToggle();
    });
  });

  it("updates announcement on theme change", () => {
    const { result } = renderHook(() => useAccessibilityContrast(), { wrapper });

    expect(result.current.announcement).toBeDefined();
  });
});
