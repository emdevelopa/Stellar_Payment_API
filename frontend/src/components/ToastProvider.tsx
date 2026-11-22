"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Toaster, toast } from "sonner";

const MOBILE_MEDIA_QUERY = "(max-width: 767px)";
const SWIPE_DISMISS_THRESHOLD_PX = 60;

export interface ToastProviderProps {
  /** Optional controlled open state for the mobile notification drawer. */
  drawerOpen?: boolean;
  /** Callback invoked when the mobile notification drawer open state changes. */
  onDrawerOpenChange?: (open: boolean) => void;
  /** Whether to render the mobile drawer handle trigger. Defaults to false for unobtrusive layout. */
  showDrawerTrigger?: boolean;
}

export default function ToastProvider({
  drawerOpen,
  onDrawerOpenChange,
  showDrawerTrigger = false,
}: ToastProviderProps = {}) {
  const [isMobile, setIsMobile] = useState(false);
  const [internalDrawerOpen, setInternalDrawerOpen] = useState(false);
  const [dragOffsetY, setDragOffsetY] = useState(0);
  const touchStartYRef = useRef<number | null>(null);

  const isDrawerOpen = drawerOpen !== undefined ? drawerOpen : internalDrawerOpen;

  const setDrawerOpen = useCallback(
    (next: boolean) => {
      if (drawerOpen === undefined) {
        setInternalDrawerOpen(next);
      }
      onDrawerOpenChange?.(next);
    },
    [drawerOpen, onDrawerOpenChange],
  );

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQuery = window.matchMedia(MOBILE_MEDIA_QUERY);
    const handleChange = (event: MediaQueryListEvent | MediaQueryList) => {
      setIsMobile(event.matches);
    };

    handleChange(mediaQuery);

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }

    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

  useEffect(() => {
    if (!isDrawerOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDrawerOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isDrawerOpen, setDrawerOpen]);

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    if (!touch) return;
    touchStartYRef.current = touch.clientY;
    setDragOffsetY(0);
  };

  const handleTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    if (touchStartYRef.current === null || !touch) return;
    const deltaY = touch.clientY - touchStartYRef.current;
    if (deltaY > 0) {
      setDragOffsetY(deltaY);
    }
  };

  const handleTouchEnd = () => {
    if (dragOffsetY >= SWIPE_DISMISS_THRESHOLD_PX) {
      setDrawerOpen(false);
    }
    touchStartYRef.current = null;
    setDragOffsetY(0);
  };

  const handleClearAll = () => {
    toast.dismiss();
    setDrawerOpen(false);
  };

  return (
    <>
      <Toaster
        position={isMobile ? "bottom-center" : "top-right"}
        theme="dark"
        closeButton
        richColors
        expand={isMobile || isDrawerOpen}
        visibleToasts={isMobile ? 3 : 5}
        gap={isMobile ? 10 : 8}
        swipeDirections={isMobile ? ["down", "left", "right"] : ["right"]}
        toastOptions={{
          duration: 4500,
          className: isMobile
            ? "touch-pan-y select-none rounded-2xl border border-white/10 shadow-2xl"
            : "select-none rounded-xl border border-white/10 shadow-lg",
          style: {
            fontFamily: "var(--font-sans)",
            fontSize: "13.5px",
          },
        }}
      />

      {isMobile && showDrawerTrigger && !isDrawerOpen && (
        <div className="fixed bottom-3 left-1/2 z-50 -translate-x-1/2 md:hidden">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open notifications drawer"
            aria-expanded={false}
            aria-controls="toast-notification-drawer"
            className="flex items-center gap-2 rounded-full border border-white/15 bg-slate-900/90 px-4 py-1.5 text-xs font-medium text-slate-200 shadow-lg backdrop-blur-md transition-colors hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-mint/60"
          >
            <span className="h-1 w-6 rounded-full bg-white/40" aria-hidden="true" />
            <span>Notifications</span>
          </button>
        </div>
      )}

      {isMobile && isDrawerOpen && (
        <div
          className="fixed inset-0 z-[55] flex items-end justify-center md:hidden"
          role="presentation"
        >
          <div
            data-testid="toast-drawer-backdrop"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-black/50 backdrop-blur-xs transition-opacity"
            aria-hidden="true"
          />

          <div
            id="toast-notification-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Notification center drawer"
            aria-live="polite"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            style={{
              transform: dragOffsetY > 0 ? `translateY(${dragOffsetY}px)` : undefined,
            }}
            className="relative z-10 w-full max-w-lg touch-pan-y rounded-t-3xl border-t border-white/15 bg-slate-900 px-5 pb-6 pt-3 text-white shadow-2xl transition-transform"
          >
            <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-white/25" aria-hidden="true" />

            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h2 className="text-sm font-semibold text-white">Notifications</h2>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleClearAll}
                  className="text-xs font-medium text-slate-300 transition-colors hover:text-white focus:outline-none focus:ring-2 focus:ring-mint/60"
                >
                  Clear all
                </button>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  aria-label="Close notifications drawer"
                  className="rounded-lg px-2 py-1 text-xs font-medium text-slate-400 transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-mint/60"
                >
                  Close
                </button>
              </div>
            </div>

            <p className="mt-3 text-xs text-slate-400">
              Swipe down to dismiss this drawer, or swipe individual alerts to clear them.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
