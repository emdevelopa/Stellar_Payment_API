"use client";

import { useThemeState, useThemeActions } from "@/lib/theme-context";
import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

export default function ThemeToggle() {
  const { theme, resolvedTheme, isMounted, isLoading, error } = useThemeState();
  const { toggleTheme, clearError } = useThemeActions();
  const [announcement, setAnnouncement] = useState<string>("");

  const handleThemeToggle = useCallback(() => {
    if (error) {
      clearError();
      setAnnouncement("Error cleared. Attempting to toggle theme.");
      return;
    }

    // Announce the theme change before toggling
    const nextTheme = getNextTheme();
    setAnnouncement(`Switching to ${nextTheme} theme.`);

    toggleTheme();
  }, [toggleTheme, error, clearError, theme]);

  /**
   * Get the next theme that will be activated
   */
  const getNextTheme = useCallback((): string => {
    const themes = ["light", "dark", "system"];
    const currentIndex = theme ? themes.indexOf(theme) : 0;
    const nextIndex = (currentIndex + 1) % themes.length;
    const nextTheme = themes[nextIndex];
    return nextTheme === "system" ? `system (${resolvedTheme})` : nextTheme;
  }, [theme, resolvedTheme]);

  /**
   * Announce theme changes to screen readers
   */
  useEffect(() => {
    if (isMounted && !isLoading && !error) {
      const currentThemeDesc = theme === "system" ? `system (${resolvedTheme})` : theme || "system";
      setAnnouncement(`Current theme: ${currentThemeDesc}`);
    }
  }, [theme, resolvedTheme, isMounted, isLoading, error]);

  if (!isMounted || isLoading) {
    return (
      <button 
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 transition-all hover:bg-white/10 active:scale-95"
        aria-label="Loading theme settings"
        disabled
      >
        <div className="h-5 w-5 animate-pulse rounded bg-white/20" />
      </button>
    );
  }

  const getAriaLabel = () => {
    if (error) return "Theme toggle with error, press to retry switching theme";
    const currentThemeDesc = theme === "system" ? `system (${resolvedTheme})` : theme || "system";
    return `Theme toggle, current theme: ${currentThemeDesc}, press to switch to next theme`;
  };

  const getTitle = () => {
    if (error) return `Theme error: ${error}. Press to retry.`;
    if (theme === 'system') return `Theme: System (${resolvedTheme})`;
    return `Theme: ${theme}`;
  };

  return (
    <>
      {/* Screen reader announcement */}
      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {announcement}
      </div>

      <button
        onClick={handleThemeToggle}
        className={`flex h-9 w-9 items-center justify-center rounded-lg border transition-all active:scale-95 ${
          error
            ? "border-red-500/50 bg-red-500/10 hover:bg-red-500/20"
            : "border-white/10 bg-white/5 hover:bg-white/10"
        }`}
        aria-label={getAriaLabel()}
        aria-describedby="theme-description"
        title={getTitle()}
        disabled={isLoading}
        role="button"
      >
      <AnimatePresence mode="wait" initial={false}>
        {error ? (
          <motion.svg
            key="error"
            initial={{ scale: 0.5, opacity: 0, rotate: -45 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            exit={{ scale: 0.5, opacity: 0, rotate: 45 }}
            transition={{ duration: 0.2 }}
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="h-5 w-5 text-red-500"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
            />
          </motion.svg>
        ) : theme === "light" ? (
          <motion.svg
            key="light"
            initial={{ scale: 0.5, opacity: 0, rotate: -45 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            exit={{ scale: 0.5, opacity: 0, rotate: 45 }}
            transition={{ duration: 0.2 }}
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="h-5 w-5 text-amber-500 transition-colors"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z"
            />
          </motion.svg>
        ) : theme === "dark" ? (
          <motion.svg
            key="dark"
            initial={{ scale: 0.5, opacity: 0, rotate: -45 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            exit={{ scale: 0.5, opacity: 0, rotate: 45 }}
            transition={{ duration: 0.2 }}
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="h-5 w-5 text-accent transition-colors"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z"
            />
          </motion.svg>
        ) : (
          <motion.div
            key="system"
            initial={{ scale: 0.5, opacity: 0, rotate: -45 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            exit={{ scale: 0.5, opacity: 0, rotate: 45 }}
            transition={{ duration: 0.2 }}
            className="relative flex items-center justify-center"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="h-5 w-5 text-slate-400 transition-colors"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25"
              />
            </svg>
            <div className="absolute -bottom-0.5 -right-0.5 flex h-2 w-2 items-center justify-center">
              <div className={`h-1.5 w-1.5 rounded-full transition-colors ${
                resolvedTheme === 'dark' ? 'bg-accent' : 'bg-amber-500'
              }`} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hidden description for screen readers */}
      <div id="theme-description" className="sr-only">
        Use this button to cycle through light, dark, and system themes. The system theme follows your device preference.
      </div>
    </>
  );
}
