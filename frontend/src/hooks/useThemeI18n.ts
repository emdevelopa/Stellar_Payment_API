/**
 * useThemeI18n
 *
 * Centralises all translated strings used by the Dark Mode Theme Engine
 * components (ThemeToggle, ThemeToggleOptimized, AccessibilityContrastToggle).
 *
 * Consuming components call this hook once and receive a stable object of
 * typed helper functions — no duplicated `useTranslations("darkModeTheme")`
 * calls scattered across the codebase.
 */

"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import type { ThemeMode, ResolvedTheme } from "@/lib/theme-context";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ThemeI18n {
  /** e.g. "Loading theme settings" */
  loading: string;
  /** e.g. "Use this button to cycle through light, dark, and system themes…" */
  description: string;
  /** Label for the preference selector */
  preferenceLabel: string;
  /** Announce theme saved to localStorage */
  preferenceSaved: string;
  /** Announce theme restored from localStorage */
  preferenceRestored: string;

  /**
   * Returns a translated, human-readable label for the current theme.
   * e.g. theme="system", resolved="dark"  →  "System (dark)"
   */
  currentThemeLabel: (theme: ThemeMode | undefined, resolved: ResolvedTheme | undefined) => string;

  /**
   * Returns the announcement string for a pending theme switch.
   * e.g.  "Switching to dark theme."
   */
  switchingToLabel: (nextTheme: string) => string;

  /**
   * Returns the confirmation announcement after the switch completes.
   */
  themeChangedLabel: (nextTheme: string) => string;

  /** "Error cleared. Attempting to toggle theme." */
  errorCleared: string;
  /** "Failed to toggle theme. Please try again." */
  themeError: string;

  /**
   * Returns the aria-label for the toggle button.
   * e.g.  "Theme toggle, current theme: dark. Press to switch to next theme."
   */
  getAriaLabel: (theme: ThemeMode | undefined, resolved: ResolvedTheme | undefined, hasError: boolean) => string;

  /**
   * Returns the tooltip / title string for the toggle button.
   */
  getTitle: (theme: ThemeMode | undefined, resolved: ResolvedTheme | undefined, error: string | null) => string;

  /** aria-label while loading */
  ariaLoading: string;
  /** aria-label when the button is in an error state */
  ariaError: string;

  /** Translated theme names (display form), e.g. "Light", "Dark", "System" */
  themeNames: Record<"light" | "dark" | "system", string>;

  /** SVG icon accessible titles */
  sr: {
    sunIcon: string;
    moonIcon: string;
    systemIcon: string;
    errorIcon: string;
  };
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useThemeI18n(): ThemeI18n {
  const t = useTranslations("darkModeTheme");

  /** Resolved, human-readable label for a theme + resolvedTheme pair. */
  const currentThemeLabel = useCallback(
    (theme: ThemeMode | undefined, resolved: ResolvedTheme | undefined): string => {
      if (!theme) return t("themes.system");
      if (theme === "system") {
        return t("systemTheme", { theme: t(`themes.${resolved ?? "light"}`) });
      }
      return t(`themes.${theme}`);
    },
    [t],
  );

  const switchingToLabel = useCallback(
    (next: string) => t("switchingTo", { theme: next }),
    [t],
  );

  const themeChangedLabel = useCallback(
    (next: string) => t("themeChanged", { theme: next }),
    [t],
  );

  const getAriaLabel = useCallback(
    (
      theme: ThemeMode | undefined,
      resolved: ResolvedTheme | undefined,
      hasError: boolean,
    ): string => {
      if (hasError) return t("ariaError");
      const desc = currentThemeLabel(theme, resolved);
      return t("ariaLabel", { theme: desc });
    },
    [t, currentThemeLabel],
  );

  const getTitle = useCallback(
    (
      theme: ThemeMode | undefined,
      resolved: ResolvedTheme | undefined,
      error: string | null,
    ): string => {
      if (error) return t("errorTitle", { error });
      if (theme === "system") {
        return t("titleSystem", {
          theme: t(`themeNames.${resolved ?? "light"}`),
        });
      }
      if (theme === "light") return t("titleLight");
      if (theme === "dark") return t("titleDark");
      return t("titleSystem", { theme: t(`themeNames.${resolved ?? "light"}`) });
    },
    [t],
  );

  return {
    loading: t("loading"),
    description: t("description"),
    preferenceLabel: t("preferenceLabel"),
    preferenceSaved: t("preferenceSaved"),
    preferenceRestored: t("preferenceRestored"),
    errorCleared: t("errorCleared"),
    themeError: t("themeError"),
    ariaLoading: t("ariaLoading"),
    ariaError: t("ariaError"),
    currentThemeLabel,
    switchingToLabel,
    themeChangedLabel,
    getAriaLabel,
    getTitle,
    themeNames: {
      light: t("themeNames.light"),
      dark: t("themeNames.dark"),
      system: t("themeNames.system"),
    },
    sr: {
      sunIcon: t("sr.sunIcon"),
      moonIcon: t("sr.moonIcon"),
      systemIcon: t("sr.systemIcon"),
      errorIcon: t("sr.errorIcon"),
    },
  };
}
