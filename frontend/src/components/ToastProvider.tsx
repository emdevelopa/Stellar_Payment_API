"use client";

import React, { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { Toaster, toast as sonnerToast } from "sonner";

export interface OptimisticRollbackOptions<T> {
  applyOptimistic: () => void;
  rollback: () => void;
  action: () => Promise<T>;
  optimisticMessage?: string;
  successMessage?: string;
  errorMessage?: string;
  onRetry?: () => Promise<T> | void;
}

export interface ToastContextValue {
  toast: typeof sonnerToast;
  announce: (message: string, priority?: "polite" | "assertive") => void;
  withOptimisticRollback: <T>(options: OptimisticRollbackOptions<T>) => Promise<T | undefined>;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export async function executeOptimisticRollback<T>(
  options: OptimisticRollbackOptions<T>,
  announceFn?: (msg: string, priority?: "polite" | "assertive") => void
): Promise<T | undefined> {
  const {
    applyOptimistic,
    rollback,
    action,
    successMessage = "Operation completed successfully",
    errorMessage = "Network failure. Changes were rolled back.",
    onRetry,
  } = options;

  applyOptimistic();

  try {
    const result = await action();
    sonnerToast.success(successMessage);
    if (announceFn) {
      announceFn(successMessage, "polite");
    }
    return result;
  } catch (err) {
    rollback();
    if (announceFn) {
      announceFn(errorMessage, "assertive");
    }
    sonnerToast.error(errorMessage, {
      description: "State was restored to its previous value.",
      action: onRetry
        ? {
            label: "Retry",
            onClick: () => {
              void executeOptimisticRollback(options, announceFn);
            },
          }
        : undefined,
      duration: 6000,
    });
    return undefined;
  }
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return {
      toast: sonnerToast,
      announce: () => {},
      withOptimisticRollback: <T,>(options: OptimisticRollbackOptions<T>) =>
        executeOptimisticRollback(options),
    };
  }
  return ctx;
}

export function useOptimisticRollback() {
  const { withOptimisticRollback } = useToast();
  return withOptimisticRollback;
}

export { sonnerToast as toast };

export interface ToastProviderProps {
  children?: ReactNode;
  position?: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "top-center" | "bottom-center";
}

export default function ToastProvider({
  children,
  position = "top-right",
}: ToastProviderProps) {
  const [announcement, setAnnouncement] = useState<{ text: string; priority: "polite" | "assertive" }>({
    text: "",
    priority: "polite",
  });

  const announce = useCallback((text: string, priority: "polite" | "assertive" = "polite") => {
    setAnnouncement({ text, priority });
  }, []);

  const withOptimisticRollback = useCallback(
    <T,>(options: OptimisticRollbackOptions<T>) => executeOptimisticRollback(options, announce),
    [announce]
  );

  return (
    <ToastContext.Provider value={{ toast: sonnerToast, announce, withOptimisticRollback }}>
      {children}
      <Toaster
        position={position}
        theme="dark"
        closeButton
        expand={false}
        gap={8}
        toastOptions={{
          duration: 4500,
          style: {
            fontFamily: "var(--font-sans)",
            fontSize: "13.5px",
          },
          className: "border border-white/10 bg-zinc-900/90 text-white backdrop-blur-md shadow-xl",
        }}
      />
      <div
        role="status"
        aria-live={announcement.priority}
        aria-atomic="true"
        className="sr-only"
        data-testid="live-region"
      >
        {announcement.text}
      </div>
    </ToastContext.Provider>
  );
}
