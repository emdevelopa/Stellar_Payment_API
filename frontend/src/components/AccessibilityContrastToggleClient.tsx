"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { useAccessibilityContrast } from "@/hooks/useAccessibilityContrast";

export default function AccessibilityContrastToggleClient() {
  const t = useTranslations("accessibility");
  const {
    theme,
    resolvedTheme,
    isMounted,
    isLoading,
    error,
    announcement,
    loadingState,
    handleContrastToggle,
    getAriaLabel,
    getTitle,
  } = useAccessibilityContrast();
  const shouldReduceMotion = useReducedMotion();

  const iconTransition = { duration: shouldReduceMotion ? 0 : 0.2 };
  const loadingDuration = shouldReduceMotion ? 0.1 : 0.8;

  if (!isMounted || isLoading) {
    return (
      <div className="relative flex h-9 w-9 items-center justify-center">
        <button
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 transition-all"
          aria-label={t("loadingTheme")}
          disabled
          aria-busy="true"
        >
          <motion.div
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ duration: loadingDuration, repeat: Infinity }}
            className="absolute inset-0 rounded-lg bg-gradient-to-r from-transparent via-white/10 to-transparent"
            aria-hidden="true"
          />
          <div className="relative h-5 w-5 rounded bg-white/20" />
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      <motion.button
        type="button"
        onClick={handleContrastToggle}
        whileHover={loadingState !== "loading" ? { scale: 1.05 } : undefined}
        whileTap={loadingState !== "loading" ? { scale: 0.95 } : undefined}
        transition={{ type: "spring", stiffness: 400, damping: 17 }}
        className={[
          "relative flex h-9 w-9 items-center justify-center rounded-lg border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pluto-500)] focus-visible:ring-offset-2 focus-visible:ring-offset-white",
          error
            ? "border-red-500/50 bg-red-500/10 text-red-500 hover:bg-red-500/20"
            : "border-white/10 bg-white/5 hover:bg-white/10",
          loadingState === "loading" ? "cursor-wait" : "",
        ].join(" ")}
        aria-label={getAriaLabel()}
        aria-describedby="contrast-description"
        title={getTitle()}
        disabled={loadingState === "loading"}
        aria-busy={loadingState === "loading"}
      >
        {loadingState === "loading" && (
          <motion.div
            className="absolute inset-0 rounded-lg border-2 border-transparent border-r-current border-t-current"
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
            aria-hidden="true"
          />
        )}

        {loadingState === "success" && (
          <motion.div
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.5, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="absolute inset-0 rounded-lg border-2 border-green-500/50"
            aria-hidden="true"
          />
        )}

        {loadingState === "error" && (
          <motion.div
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.5, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="absolute inset-0 rounded-lg border-2 border-red-500/50"
            aria-hidden="true"
          />
        )}

        <AnimatePresence mode="wait" initial={false}>
          {error ? (
            <ToggleIcon keyName="error" className="text-red-500" transition={iconTransition}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </ToggleIcon>
          ) : theme === "light" ? (
            <ToggleIcon keyName="light" className="text-amber-500" transition={iconTransition}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0z" />
            </ToggleIcon>
          ) : theme === "dark" ? (
            <ToggleIcon keyName="dark" className="text-slate-300" transition={iconTransition}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998z" />
            </ToggleIcon>
          ) : (
            <motion.div
              key="system"
              initial={{ scale: 0.5, opacity: 0, rotate: -45 }}
              animate={{ scale: 1, opacity: 1, rotate: 0 }}
              exit={{ scale: 0.5, opacity: 0, rotate: 45 }}
              transition={iconTransition}
              className="relative z-10 flex items-center justify-center"
              aria-hidden="true"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5 text-slate-400 transition-colors">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 0 1-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0 1 15 18.257V17.25m6-12V15a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 15V5.25m18 0A2.25 2.25 0 0 0 18.75 3H5.25A2.25 2.25 0 0 0 3 5.25m18 0V12a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 12V5.25" />
              </svg>
              <div className="absolute -bottom-0.5 -right-0.5 flex h-2 w-2 items-center justify-center">
                <motion.div
                  className={`h-1.5 w-1.5 rounded-full transition-colors ${resolvedTheme === "dark" ? "bg-slate-300" : "bg-amber-500"}`}
                  animate={loadingState === "loading" ? { scale: [1, 1.2, 1] } : { scale: 1 }}
                  transition={{ duration: 0.5, repeat: loadingState === "loading" ? Infinity : 0 }}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.button>

      <div id="contrast-description" className="sr-only">
        {t("description")}
      </div>
    </>
  );
}

function ToggleIcon({
  keyName,
  className,
  transition,
  children,
}: {
  keyName: string;
  className: string;
  transition: { duration: number };
  children: ReactNode;
}) {
  return (
    <motion.svg
      key={keyName}
      initial={{ scale: 0.5, opacity: 0, rotate: -45 }}
      animate={{ scale: 1, opacity: 1, rotate: 0 }}
      exit={{ scale: 0.5, opacity: 0, rotate: 45 }}
      transition={transition}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className={`relative z-10 h-5 w-5 transition-colors ${className}`}
      aria-hidden="true"
    >
      {children}
    </motion.svg>
  );
}
