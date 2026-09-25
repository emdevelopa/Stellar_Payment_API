import { useCallback, useEffect, useState } from "react";
import { useThemeState, useThemeActions } from "@/lib/theme-context";
import { useThemeI18n } from "@/hooks/useThemeI18n";

export type LoadingState = "idle" | "loading" | "success" | "error";

export function useAccessibilityContrast() {
  const { theme, resolvedTheme, isMounted, isLoading, error } = useThemeState();
  const { toggleTheme, clearError } = useThemeActions();
  const i18n = useThemeI18n();

  const [announcement, setAnnouncement] = useState<string>("");
  const [loadingState, setLoadingState] = useState<LoadingState>("idle");

  const getNextTheme = useCallback((): string => {
    const themes = ["light", "dark", "system"] as const;
    const currentIndex = theme ? themes.indexOf(theme as (typeof themes)[number]) : 0;
    const next = themes[(currentIndex + 1) % themes.length];
    return i18n.currentThemeLabel(next, resolvedTheme);
  }, [theme, resolvedTheme, i18n]);

  const handleContrastToggle = useCallback(async () => {
    if (error) {
      clearError();
      setLoadingState("idle");
      setAnnouncement(i18n.errorCleared);
      return;
    }

    setLoadingState("loading");
    const nextTheme = getNextTheme();
    setAnnouncement(i18n.switchingToLabel(nextTheme));

    try {
      await toggleTheme();
      setLoadingState("success");

      setTimeout(() => {
        setLoadingState("idle");
        setAnnouncement(i18n.themeChangedLabel(nextTheme));
      }, 500);
    } catch {
      setLoadingState("error");
      setAnnouncement(i18n.themeError);
      setTimeout(() => setLoadingState("idle"), 2000);
    }
  }, [toggleTheme, error, clearError, i18n, getNextTheme]);

  useEffect(() => {
    if (isMounted && !isLoading && !error) {
      const desc = i18n.currentThemeLabel(theme, resolvedTheme);
      setAnnouncement(desc);
    }
  }, [theme, resolvedTheme, isMounted, isLoading, error, i18n]);

  const getAriaLabel = useCallback(() => {
    return i18n.getAriaLabel(theme, resolvedTheme, !!error);
  }, [error, theme, resolvedTheme, i18n]);

  const getTitle = useCallback(() => {
    return i18n.getTitle(theme, resolvedTheme, error ? String(error) : null);
  }, [error, theme, resolvedTheme, i18n]);

  return {
    theme,
    resolvedTheme,
    isMounted,
    isLoading,
    error,
    announcement,
    loadingState,
    getNextTheme,
    handleContrastToggle,
    getAriaLabel,
    getTitle,
  };
}
