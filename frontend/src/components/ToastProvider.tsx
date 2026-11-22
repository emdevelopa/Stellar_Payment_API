"use client";

import React, { useEffect, useRef, useCallback, useState, createContext, useContext } from "react";
import { Toaster, toast as sonnerToast } from "sonner";

// ─── Types ──────────────────────────────────────────────────────────────────

export type ToastType = "info" | "success" | "warning" | "error";

export interface ActionableToastOptions {
  id?: string;
  description?: string;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
    ariaLabel?: string;
  };
  cancel?: {
    label?: string;
    onClick?: () => void;
    ariaLabel?: string;
  };
  onDismiss?: () => void;
}

export interface QueuedToast {
  id: string | number;
  type: ToastType;
  title: string;
  description?: string;
  timestamp: number;
}

export interface ToastContextValue {
  showSuccess: (message: string, options?: ActionableToastOptions) => string | number;
  showError: (message: string, options?: ActionableToastOptions) => string | number;
  showInfo: (message: string, options?: ActionableToastOptions) => string | number;
  showWarning: (message: string, options?: ActionableToastOptions) => string | number;
  showActionable: (title: string, options: ActionableToastOptions & { type?: ToastType }) => string | number;
  dismiss: (id?: string | number) => void;
  activeCount: number;
}

// ─── Toast Context & Singleton ──────────────────────────────────────────────

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    // Return standalone fallback if used outside Provider
    return {
      showSuccess: (msg, opts) => notify.success(msg, opts),
      showError: (msg, opts) => notify.error(msg, opts),
      showInfo: (msg, opts) => notify.info(msg, opts),
      showWarning: (msg, opts) => notify.warning(msg, opts),
      showActionable: (title, opts) => notify.actionable(title, opts),
      dismiss: (id) => sonnerToast.dismiss(id),
      activeCount: 0,
    };
  }
  return context;
}

// ─── Global Notification Utility (Actionable Toast Manager) ────────────────

export const notify = {
  success(message: string, options?: ActionableToastOptions) {
    return sonnerToast.success(message, {
      id: options?.id,
      description: options?.description,
      duration: options?.duration ?? 4500,
      action: options?.action
        ? {
            label: options.action.label,
            onClick: options.action.onClick,
          }
        : undefined,
      cancel: options?.cancel
        ? {
            label: options.cancel.label || "Dismiss",
            onClick: options.cancel.onClick || (() => {}),
          }
        : undefined,
      onDismiss: options?.onDismiss,
    });
  },

  error(message: string, options?: ActionableToastOptions) {
    return sonnerToast.error(message, {
      id: options?.id,
      description: options?.description,
      duration: options?.duration ?? 6000,
      action: options?.action
        ? {
            label: options.action.label,
            onClick: options.action.onClick,
          }
        : undefined,
      cancel: options?.cancel
        ? {
            label: options.cancel.label || "Dismiss",
            onClick: options.cancel.onClick || (() => {}),
          }
        : undefined,
      onDismiss: options?.onDismiss,
    });
  },

  info(message: string, options?: ActionableToastOptions) {
    return sonnerToast.info(message, {
      id: options?.id,
      description: options?.description,
      duration: options?.duration ?? 4500,
      action: options?.action
        ? {
            label: options.action.label,
            onClick: options.action.onClick,
          }
        : undefined,
      onDismiss: options?.onDismiss,
    });
  },

  warning(message: string, options?: ActionableToastOptions) {
    return sonnerToast.warning(message, {
      id: options?.id,
      description: options?.description,
      duration: options?.duration ?? 5000,
      action: options?.action
        ? {
            label: options.action.label,
            onClick: options.action.onClick,
          }
        : undefined,
      onDismiss: options?.onDismiss,
    });
  },

  actionable(title: string, options: ActionableToastOptions & { type?: ToastType }) {
    const fn = options.type ? sonnerToast[options.type] : sonnerToast;
    return fn(title, {
      id: options.id,
      description: options.description,
      duration: options.duration ?? 7000,
      action: options.action
        ? {
            label: options.action.label,
            onClick: options.action.onClick,
          }
        : undefined,
      cancel: options.cancel
        ? {
            label: options.cancel.label || "Dismiss",
            onClick: options.cancel.onClick || (() => {}),
          }
        : undefined,
      onDismiss: options.onDismiss,
    });
  },

  dismiss(id?: string | number) {
    sonnerToast.dismiss(id);
  },
};

// ─── ToastProvider Component ────────────────────────────────────────────────

export interface ToastProviderProps {
  children?: React.ReactNode;
  hotkey?: string[];
  duration?: number;
  position?: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "top-center" | "bottom-center";
  maxVisibleToasts?: number;
}

export default function ToastProvider({
  children,
  hotkey = ["altKey", "KeyT"],
  duration = 4500,
  position = "top-right",
  maxVisibleToasts = 5,
}: ToastProviderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedElement = useRef<HTMLElement | null>(null);
  const [activeCount, setActiveCount] = useState<number>(0);
  const [lastAnnouncement, setLastAnnouncement] = useState<{
    text: string;
    type: "polite" | "assertive";
  }>({ text: "", type: "polite" });

  // ── Keyboard Focus Management (WCAG 2.1 AA) ──────────────────────────────
  // 1. Hotkey (Alt+T): Jumps focus directly to the first focusable control inside the toast region
  // 2. Escape: Dismisses the focused toast and restores focus cleanly
  // 3. ArrowUp / ArrowDown: Moves focus between queued toasts

  const focusToastRegion = useCallback(() => {
    previouslyFocusedElement.current = document.activeElement as HTMLElement | null;

    if (!containerRef.current) return;

    // Prioritize actionable button or close button inside toasts, fallback to toast container
    const preferredFocusable = containerRef.current.querySelector<HTMLElement>(
      'button:not([disabled]), [href], input, select, textarea'
    ) || containerRef.current.querySelector<HTMLElement>(
      '[tabindex]:not([tabindex="-1"])'
    );

    if (preferredFocusable) {
      preferredFocusable.focus();
      setLastAnnouncement({
        text: "Focused notifications container. Press Escape to return.",
        type: "polite",
      });
    }
  }, []);

  const restoreFocus = useCallback(() => {
    if (previouslyFocusedElement.current && typeof previouslyFocusedElement.current.focus === "function") {
      previouslyFocusedElement.current.focus();
      previouslyFocusedElement.current = null;
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Hotkey check (default: Alt + T)
      if (event.altKey && (event.key === "t" || event.key === "T" || event.code === "KeyT")) {
        event.preventDefault();
        focusToastRegion();
        return;
      }

      // Check if active focus is inside our container
      if (containerRef.current && containerRef.current.contains(document.activeElement)) {
        // Escape dismisses current toast or restores focus
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();

          // Find the active toast element to dismiss
          const activeToastEl = (document.activeElement as HTMLElement)?.closest("[data-sonner-toast]");
          if (activeToastEl) {
            const closeBtn = activeToastEl.querySelector<HTMLButtonElement>(
              'button[aria-label*="Close"], [data-close-button]'
            );
            if (closeBtn) {
              closeBtn.click();
            } else {
              sonnerToast.dismiss();
            }
          } else {
            sonnerToast.dismiss();
          }

          restoreFocus();
          return;
        }

        // Arrow navigation between queued toasts
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          const toasts = Array.from(
            containerRef.current.querySelectorAll<HTMLElement>("[data-sonner-toast]")
          );
          if (toasts.length > 1) {
            event.preventDefault();
            const currentIndex = toasts.findIndex((t) => t.contains(document.activeElement));
            const nextIndex =
              event.key === "ArrowDown"
                ? (currentIndex + 1) % toasts.length
                : (currentIndex - 1 + toasts.length) % toasts.length;

            const nextFocusable = toasts[nextIndex].querySelector<HTMLElement>(
              'button, [tabindex]:not([tabindex="-1"])'
            ) || toasts[nextIndex];
            nextFocusable?.focus();
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [focusToastRegion, restoreFocus]);

  const contextValue: ToastContextValue = {
    showSuccess: (msg, opts) => {
      setActiveCount((c) => c + 1);
      setLastAnnouncement({ text: `Success: ${msg}`, type: "polite" });
      return notify.success(msg, {
        ...opts,
        onDismiss: () => {
          setActiveCount((c) => Math.max(0, c - 1));
          opts?.onDismiss?.();
        },
      });
    },
    showError: (msg, opts) => {
      setActiveCount((c) => c + 1);
      setLastAnnouncement({ text: `Error: ${msg}`, type: "assertive" });
      return notify.error(msg, {
        ...opts,
        onDismiss: () => {
          setActiveCount((c) => Math.max(0, c - 1));
          opts?.onDismiss?.();
        },
      });
    },
    showInfo: (msg, opts) => {
      setActiveCount((c) => c + 1);
      setLastAnnouncement({ text: `Information: ${msg}`, type: "polite" });
      return notify.info(msg, {
        ...opts,
        onDismiss: () => {
          setActiveCount((c) => Math.max(0, c - 1));
          opts?.onDismiss?.();
        },
      });
    },
    showWarning: (msg, opts) => {
      setActiveCount((c) => c + 1);
      setLastAnnouncement({ text: `Warning: ${msg}`, type: "polite" });
      return notify.warning(msg, {
        ...opts,
        onDismiss: () => {
          setActiveCount((c) => Math.max(0, c - 1));
          opts?.onDismiss?.();
        },
      });
    },
    showActionable: (title, opts) => {
      setActiveCount((c) => c + 1);
      const level = opts.type === "error" ? "assertive" : "polite";
      setLastAnnouncement({ text: `Actionable notification: ${title}. ${opts.description || ""}`, type: level });
      return notify.actionable(title, {
        ...opts,
        onDismiss: () => {
          setActiveCount((c) => Math.max(0, c - 1));
          opts?.onDismiss?.();
        },
      });
    },
    dismiss: (id) => {
      sonnerToast.dismiss(id);
      setActiveCount((c) => Math.max(0, c - 1));
    },
    activeCount,
  };

  return (
    <ToastContext.Provider value={contextValue}>
      {/* ── Screen Reader Live Announcement Regions (WCAG 2.1 AA) ── */}
      <div className="sr-only">
        {/* Polite region for success/info/warning */}
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          id="toast-announcer-polite"
        >
          {lastAnnouncement.type === "polite" ? lastAnnouncement.text : ""}
        </div>
        {/* Assertive region for critical errors / failures */}
        <div
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
          id="toast-announcer-assertive"
        >
          {lastAnnouncement.type === "assertive" ? lastAnnouncement.text : ""}
        </div>
        {/* Shortcut instructions */}
        <span id="toast-keyboard-instructions">
          Press Alt+T to focus notification banner, Escape to dismiss, Arrow keys to navigate.
        </span>
      </div>

      {/* ── Optional Children for context consumption ── */}
      {children}

      {/* ── Toast Container Region ── */}
      <div
        ref={containerRef}
        role="region"
        aria-label="Global Feedback Notifications (Press Alt+T to focus)"
        aria-describedby="toast-keyboard-instructions"
        className="relative z-[9999]"
      >
        <Toaster
          position={position}
          theme="dark"
          closeButton
          expand={false}
          gap={8}
          maxScrolledToasts={maxVisibleToasts}
          pauseWhenPageIsHidden
          hotkey={hotkey}
          toastOptions={{
            duration,
            style: {
              fontFamily: "var(--font-sans)",
              fontSize: "13.5px",
              borderRadius: "0.75rem",
              border: "1px solid #262626",
              backgroundColor: "#0A0A0A",
              color: "#FFFFFF",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)",
            },
            classNames: {
              toast: "group focus-visible:ring-2 focus-visible:ring-blue-500 focus:outline-none transition-all duration-200",
              title: "font-semibold text-white tracking-tight",
              description: "text-gray-400 text-xs mt-0.5",
              actionButton: "bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs px-3 py-1.5 rounded-lg focus-visible:ring-2 focus-visible:ring-blue-400 focus:outline-none",
              cancelButton: "bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium text-xs px-3 py-1.5 rounded-lg focus-visible:ring-2 focus-visible:ring-gray-400 focus:outline-none",
              closeButton: "focus-visible:ring-2 focus-visible:ring-blue-500 focus:outline-none text-gray-400 hover:text-white rounded-md",
            },
          }}
        />
      </div>
    </ToastContext.Provider>
  );
}
