"use client";

import React from "react";
import dynamic from "next/dynamic";
import type { ToasterProps } from "sonner";

/**
 * Dynamically import `Toaster` from `sonner` with `ssr: false` so the toast
 * notification runtime is code-split out of the initial root layout bundle
 * and hydrated asynchronously on the client.
 */
const DynamicToaster = dynamic(
  () => import("sonner").then((mod) => mod.Toaster),
  {
    ssr: false,
    loading: () => null,
  },
);

export const DEFAULT_TOAST_OPTIONS: NonNullable<ToasterProps["toastOptions"]> = {
  duration: 4500,
  style: {
    fontFamily: "var(--font-sans)",
    fontSize: "13.5px",
  },
};

export interface ToastProviderProps {
  position?: ToasterProps["position"];
  theme?: ToasterProps["theme"];
  closeButton?: boolean;
  expand?: boolean;
  gap?: number;
  visibleToasts?: number;
  richColors?: boolean;
  duration?: number;
  containerAriaLabel?: string;
}

export default function ToastProvider({
  position = "top-right",
  theme = "dark",
  closeButton = true,
  expand = false,
  gap = 8,
  visibleToasts = 3,
  richColors = false,
  duration = DEFAULT_TOAST_OPTIONS.duration,
  containerAriaLabel = "Notifications",
}: ToastProviderProps = {}) {
  return (
    <DynamicToaster
      position={position}
      theme={theme}
      closeButton={closeButton}
      expand={expand}
      gap={gap}
      visibleToasts={visibleToasts}
      richColors={richColors}
      containerAriaLabel={containerAriaLabel}
      toastOptions={{
        ...DEFAULT_TOAST_OPTIONS,
        duration,
      }}
    />
  );
}
