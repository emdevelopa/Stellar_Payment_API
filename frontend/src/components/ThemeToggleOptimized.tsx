

"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  memo,
  type KeyboardEvent,
  type TouchEvent,
} from "react";
import {
  useThemeState,
  useThemeActions,
  type ThemeMode,
} from "@/lib/theme-engine-optimized";
import { useTranslations } from "next-intl";

const HIGH_CONTRAST_STORAGE_KEY = "merchant-high-contrast-preference";
const SWIPE_DISMISS_THRESHOLD_PX = 72;
const SWIPE_THEME_THRESHOLD_PX = 50;
const THEME_OPTIONS: readonly ThemeMode[] = ["light", "dark", "system"];

// ── Icon sub-components (no external library deps) ───────────────────────────

const SunIcon = memo(({ title }: { title: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    className="h-5 w-5 text-amber-500"
    aria-hidden="true"
  >
    <title>{title}</title>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z"
    />
  </svg>
));
SunIcon.displayName = "SunIcon";

const MoonIcon = memo(({ title }: { title: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    className="h-5 w-5 text-accent"
    aria-hidden="true"
  >
    <title>{title}</title>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z"
    />
  </svg>
));
MoonIcon.displayName = "MoonIcon";

const SystemIcon = memo(
  ({ resolved, title }: { resolved?: "light" | "dark"; title: string }) => (
    <div className="relative flex items-center justify-center" aria-hidden="true">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
        className="h-5 w-5 text-slate-400"
      >
        <title>{title}</title>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25"
        />
      </svg>
      <div className="absolute -bottom-0.5 -right-0.5 h-2 w-2">
        <div
          className={`h-1.5 w-1.5 rounded-full ${
            resolved === "dark" ? "bg-accent" : "bg-amber-500"
          }`}
        />
      </div>
    </div>
  ),
);
SystemIcon.displayName = "SystemIcon";

// Loading skeleton
const LoadingSkeleton = memo(({ label }: { label: string }) => (
  <button
    type="button"
    className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/5"
    aria-label={label}
    aria-busy="true"
    disabled
  >
    <div className="h-5 w-5 animate-pulse rounded bg-white/20" />
  </button>
));
LoadingSkeleton.displayName = "LoadingSkeleton";

const applyHighContrastToDOM = (enabled: boolean): void => {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("high-contrast", enabled);
  if (enabled) {
    document.documentElement.setAttribute("data-contrast", "high");
  } else {
    document.documentElement.removeAttribute("data-contrast");
  }
};

// ── Main component ────────────────────────────────────────────────────────────

function ThemeToggleOptimized() {
  const { theme, resolvedTheme, isMounted } = useThemeState();
  const { setTheme, toggleTheme } = useThemeActions();
  const t = useTranslations("darkModeTheme");

  const [announcement, setAnnouncement] = useState("");
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [highContrast, setHighContrast] = useState(false);
  const [dragOffsetY, setDragOffsetY] = useState(0);

  const drawerId = useId();
  const drawerTitleId = useId();
  const descriptionId = useId();

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const drawerButtonRef = useRef<HTMLButtonElement | null>(null);
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  // Hydrate high-contrast preference on mount
  useEffect(() => {
    if (!isMounted) return;
    try {
      const stored = localStorage?.getItem(HIGH_CONTRAST_STORAGE_KEY);
      const enabled = stored === "true";
      setHighContrast(enabled);
      applyHighContrastToDOM(enabled);
    } catch {
      // Ignore storage access errors
    }
  }, [isMounted]);

  // Memoized next-theme label (translated)
  const getNextThemeLabel = useCallback((): string => {
    const currentIndex = theme
      ? THEME_OPTIONS.indexOf(theme as (typeof THEME_OPTIONS)[number])
      : 0;
    const next = THEME_OPTIONS[(currentIndex + 1) % THEME_OPTIONS.length];
    if (next === "system") {
      return t("systemTheme", { theme: t(`themes.${resolvedTheme ?? "light"}`) });
    }
    return t(`themes.${next}`);
  }, [theme, resolvedTheme, t]);

  // Optimized toggle handler
  const handleToggle = useCallback(() => {
    setAnnouncement(t("switchingTo", { theme: getNextThemeLabel() }));
    toggleTheme();
  }, [toggleTheme, getNextThemeLabel, t]);

  const handleSelectTheme = useCallback(
    (mode: ThemeMode) => {
      const label =
        mode === "system"
          ? t("systemTheme", { theme: t(`themes.${resolvedTheme ?? "light"}`) })
          : t(`themes.${mode}`);
      setAnnouncement(t("switchingTo", { theme: label }));
      setTheme(mode);
    },
    [resolvedTheme, setTheme, t],
  );

  const handleToggleHighContrast = useCallback(() => {
    setHighContrast((prev) => {
      const next = !prev;
      applyHighContrastToDOM(next);
      try {
        localStorage?.setItem(HIGH_CONTRAST_STORAGE_KEY, String(next));
      } catch {
        // Ignore storage errors
      }
      setAnnouncement(
        next ? "High contrast mode enabled" : "High contrast mode disabled",
      );
      return next;
    });
  }, []);

  const closeDrawer = useCallback(() => {
    setIsDrawerOpen(false);
    setDragOffsetY(0);
    setAnnouncement("Theme settings drawer closed");
    // Restore focus to the drawer trigger button per WCAG 2.1 AA
    requestAnimationFrame(() => {
      (drawerButtonRef.current ?? triggerRef.current)?.focus();
    });
  }, []);

  const openDrawer = useCallback(() => {
    setIsDrawerOpen(true);
    setDragOffsetY(0);
    setAnnouncement("Theme settings drawer opened");
  }, []);

  // Move focus into drawer when opened
  useEffect(() => {
    if (!isDrawerOpen) return;
    const activeIdx = Math.max(
      0,
      THEME_OPTIONS.indexOf((theme as ThemeMode) ?? "system"),
    );
    optionRefs.current[activeIdx]?.focus();
  }, [isDrawerOpen, theme]);

  // Screen-reader announcement on theme change
  useEffect(() => {
    if (isMounted) {
      const current =
        theme === "system"
          ? t("systemTheme", { theme: t(`themes.${resolvedTheme ?? "light"}`) })
          : t(`themes.${theme ?? "system"}`);
      setAnnouncement(t("currentTheme", { theme: current }));
    }
  }, [theme, resolvedTheme, isMounted, t]);

  // Keyboard focus trap + Escape + Arrow navigation inside drawer
  const handleDrawerKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDrawer();
        return;
      }

      if (event.key === "Tab" && drawerRef.current) {
        const focusable = drawerRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
        return;
      }

      const focusedOptionIdx = optionRefs.current.findIndex(
        (el) => el === document.activeElement,
      );
      if (focusedOptionIdx !== -1) {
        if (event.key === "ArrowDown" || event.key === "ArrowRight") {
          event.preventDefault();
          optionRefs.current[(focusedOptionIdx + 1) % THEME_OPTIONS.length]?.focus();
        } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
          event.preventDefault();
          optionRefs.current[
            (focusedOptionIdx - 1 + THEME_OPTIONS.length) % THEME_OPTIONS.length
          ]?.focus();
        } else if (event.key === "Home") {
          event.preventDefault();
          optionRefs.current[0]?.focus();
        } else if (event.key === "End") {
          event.preventDefault();
          optionRefs.current[THEME_OPTIONS.length - 1]?.focus();
        }
      }
    },
    [closeDrawer],
  );

  // Touch gesture handlers for drawer (swipe-down to dismiss, horizontal swipe to cycle)
  const handleTouchStart = useCallback((event: TouchEvent<HTMLElement>) => {
    const touch = event.touches[0];
    if (!touch) return;
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  }, []);

  const handleDrawerTouchMove = useCallback((event: TouchEvent<HTMLDivElement>) => {
    const start = touchStartRef.current;
    const touch = event.touches[0];
    if (!start || !touch) return;
    const deltaY = touch.clientY - start.y;
    if (deltaY > 0) {
      setDragOffsetY(deltaY);
    }
  }, []);

  const handleDrawerTouchEnd = useCallback(
    (event: TouchEvent<HTMLDivElement>) => {
      const start = touchStartRef.current;
      const touch = event.changedTouches[0];
      touchStartRef.current = null;
      if (!start || !touch) {
        setDragOffsetY(0);
        return;
      }
      const deltaY = touch.clientY - start.y;
      const deltaX = touch.clientX - start.x;

      if (deltaY >= SWIPE_DISMISS_THRESHOLD_PX) {
        closeDrawer();
      } else if (Math.abs(deltaX) >= SWIPE_THEME_THRESHOLD_PX && Math.abs(deltaY) < 40) {
        setDragOffsetY(0);
        handleToggle();
      } else {
        setDragOffsetY(0);
      }
    },
    [closeDrawer, handleToggle],
  );

  const handleTriggerTouchEnd = useCallback(
    (event: TouchEvent<HTMLButtonElement>) => {
      const start = touchStartRef.current;
      const touch = event.changedTouches[0];
      touchStartRef.current = null;
      if (!start || !touch) return;
      const deltaX = touch.clientX - start.x;
      if (Math.abs(deltaX) >= SWIPE_THEME_THRESHOLD_PX) {
        handleToggle();
      }
    },
    [handleToggle],
  );

  if (!isMounted) {
    return <LoadingSkeleton label={t("ariaLoading")} />;
  }

  const currentDesc =
    theme === "system"
      ? t("systemTheme", { theme: t(`themes.${resolvedTheme ?? "light"}`) })
      : t(`themes.${theme ?? "system"}`);

  const ariaLabel = t("ariaLabel", { theme: currentDesc });

  const titleText =
    theme === "system"
      ? t("titleSystem", { theme: t(`themeNames.${resolvedTheme ?? "light"}`) })
      : theme === "light"
        ? t("titleLight")
        : t("titleDark");

  return (
    <div className="relative inline-flex items-center gap-1">
      {/* Screen-reader live region */}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      {/* Primary quick-cycle theme button */}
      <button
        ref={triggerRef}
        type="button"
        onClick={handleToggle}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTriggerTouchEnd}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 transition-all hover:scale-105 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pluto-500)] focus-visible:ring-offset-2 active:scale-95"
        aria-label={ariaLabel}
        aria-describedby={descriptionId}
        title={titleText}
      >
        {theme === "light" ? (
          <SunIcon title={t("sr.sunIcon")} />
        ) : theme === "dark" ? (
          <MoonIcon title={t("sr.moonIcon")} />
        ) : (
          <SystemIcon resolved={resolvedTheme} title={t("sr.systemIcon")} />
        )}
      </button>

      {/* Responsive drawer trigger for full theme & high-contrast controls */}
      <button
        ref={drawerButtonRef}
        type="button"
        onClick={() => (isDrawerOpen ? closeDrawer() : openDrawer())}
        aria-label="Open theme and high-contrast settings"
        aria-haspopup="dialog"
        aria-expanded={isDrawerOpen}
        aria-controls={drawerId}
        className="flex h-9 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-xs text-slate-300 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pluto-500)] focus-visible:ring-offset-2"
      >
        <svg
          className={`h-3.5 w-3.5 transition-transform ${isDrawerOpen ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Hidden description for screen readers */}
      <div id={descriptionId} className="sr-only">
        {t("description")}
      </div>

      {/* Responsive drawer (mobile bottom sheet, desktop popover) */}
      {isDrawerOpen && (
        <>
          <div
            aria-hidden="true"
            onClick={closeDrawer}
            className="fixed inset-0 z-40 bg-black/40 sm:bg-transparent"
          />
          <div
            id={drawerId}
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={drawerTitleId}
            onKeyDown={handleDrawerKeyDown}
            onTouchStart={handleTouchStart}
            onTouchMove={handleDrawerTouchMove}
            onTouchEnd={handleDrawerTouchEnd}
            style={
              dragOffsetY > 0
                ? { transform: `translateY(${dragOffsetY}px)` }
                : undefined
            }
            className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border border-white/15 bg-slate-900 p-4 text-white shadow-2xl transition-transform sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-11 sm:w-72 sm:rounded-2xl"
          >
            {/* Mobile drag handle */}
            <div
              aria-hidden="true"
              className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-white/25 sm:hidden"
            />

            <div className="mb-3 flex items-center justify-between">
              <h2 id={drawerTitleId} className="text-sm font-semibold">
                Appearance
              </h2>
              <button
                type="button"
                onClick={closeDrawer}
                aria-label="Close theme settings"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pluto-500)]"
              >
                &times;
              </button>
            </div>

            <div
              role="radiogroup"
              aria-label="Color theme"
              className="flex flex-col gap-1.5"
            >
              {THEME_OPTIONS.map((mode, idx) => {
                const selected = theme === mode;
                const label =
                  mode === "system"
                    ? t("systemTheme", {
                        theme: t(`themes.${resolvedTheme ?? "light"}`),
                      })
                    : t(`themes.${mode}`);

                return (
                  <button
                    key={mode}
                    ref={(el) => {
                      optionRefs.current[idx] = el;
                    }}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => handleSelectTheme(mode)}
                    className={`flex min-h-[44px] items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pluto-500)] ${
                      selected
                        ? "bg-[var(--pluto-500)] text-white"
                        : "bg-white/5 text-slate-200 hover:bg-white/10"
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      {mode === "light" ? (
                        <SunIcon title={t("sr.sunIcon")} />
                      ) : mode === "dark" ? (
                        <MoonIcon title={t("sr.moonIcon")} />
                      ) : (
                        <SystemIcon
                          resolved={resolvedTheme}
                          title={t("sr.systemIcon")}
                        />
                      )}
                      <span>{label}</span>
                    </span>
                    {selected && (
                      <span aria-hidden="true" className="text-xs font-bold">
                        Active
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="my-3 h-px bg-white/10" />

            {/* High-Contrast Switch */}
            <button
              type="button"
              role="switch"
              aria-checked={highContrast}
              onClick={handleToggleHighContrast}
              className="flex min-h-[44px] w-full items-center justify-between rounded-xl bg-white/5 px-3 py-2 text-sm font-medium text-slate-100 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pluto-500)]"
            >
              <span>High contrast</span>
              <span
                aria-hidden="true"
                className={`inline-flex h-5 w-9 items-center rounded-full p-0.5 transition-colors ${
                  highContrast ? "bg-emerald-500" : "bg-slate-600"
                }`}
              >
                <span
                  className={`h-4 w-4 rounded-full bg-white transition-transform ${
                    highContrast ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default memo(ThemeToggleOptimized);
