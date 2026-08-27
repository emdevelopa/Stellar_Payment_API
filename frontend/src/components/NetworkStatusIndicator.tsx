"use client";

import React, { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useNetworkStatusStore } from "@/lib/network-status-store";
import { useNetworkMonitor } from "@/hooks/useNetworkMonitor";

// Use CSS animations instead of framer-motion for bundle optimization
// This reduces the bundle size significantly by removing the framer-motion dependency

/**
 * Props for NetworkStatusIndicator component
 */
interface NetworkStatusIndicatorProps {
  showDetails?: boolean;
  autoCheck?: boolean;
  checkInterval?: number;
  onStatusChange?: (status: string) => void;
  showConnectionQuality?: boolean;
  enableMicroInteractions?: boolean;
  enableScreenReaderSupport?: boolean;
  enableKeyboardNavigation?: boolean;
  announcementsEnabled?: boolean;
}

/**
 * Status color mapper - returns Tailwind classes for each status
 */
const getStatusColor = (
  status: string
): {
  dot: string;
  bg: string;
  text: string;
  badge: string;
  border: string;
} => {
  const colors: Record<
    string,
    { dot: string; bg: string; text: string; badge: string; border: string }
  > = {
    online: {
      dot: "bg-green-500",
      bg: "bg-green-50",
      text: "text-green-700",
      badge: "bg-green-100 text-green-800 border-green-200",
      border: "border-green-200",
    },
    offline: {
      dot: "bg-red-500",
      bg: "bg-red-50",
      text: "text-red-700",
      badge: "bg-red-100 text-red-800 border-red-200",
      border: "border-red-200",
    },
    slow: {
      dot: "bg-yellow-500",
      bg: "bg-yellow-50",
      text: "text-yellow-700",
      badge: "bg-yellow-100 text-yellow-800 border-yellow-200",
      border: "border-yellow-200",
    },
    checking: {
      dot: "bg-gray-400",
      bg: "bg-gray-50",
      text: "text-gray-700",
      badge: "bg-gray-100 text-gray-700 border-gray-200",
      border: "border-gray-200",
    },
  };

  return colors[status] || colors.checking;
};

/**
 * Get connection quality label and bar width based on latency
 */
const getConnectionQuality = (latency: number): { label: string; barClass: string } => {
  if (latency < 50) return { label: "excellent", barClass: "bg-green-500 w-full" };
  if (latency < 150) return { label: "good", barClass: "bg-green-400 w-3/4" };
  if (latency < 300) return { label: "fair", barClass: "bg-yellow-500 w-1/2" };
  return { label: "poor", barClass: "bg-red-500 w-1/4" };
};

/**
 * Get latency color class based on value
 */
const getLatencyColor = (latency: number): string => {
  if (latency < 100) return "text-green-600";
  if (latency < 300) return "text-yellow-600";
  return "text-red-600";
};

/**
 * NetworkStatusIndicator Component
 *
 * Displays real-time network status with automatic monitoring.
 * Uses Zustand for state management and CSS animations.
 * Includes latency measurement and connection type detection.
 * Fully internationalized with next-intl.
 */
export const NetworkStatusIndicator: React.FC<
  NetworkStatusIndicatorProps
> = ({
  showDetails = true,
  autoCheck = true,
  checkInterval = 30000,
  onStatusChange,
  showConnectionQuality = true,
  enableMicroInteractions = true,
  enableScreenReaderSupport = true,
  enableKeyboardNavigation = true,
  announcementsEnabled = true,
}) => {
  const t = useTranslations();
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const { statusRegionRef, detailsRegionRef, refreshButtonRef, handleRefresh } =
    useNetworkMonitor({
      autoCheck,
      checkInterval,
      onStatusChange,
      showConnectionQuality,
      enableScreenReaderSupport,
      enableKeyboardNavigation,
      announcementsEnabled,
    });

  const { status, latency, connectionType, errorMessage } = useNetworkStatusStore();
  const colors = getStatusColor(status);
  const resolveLabel = (key: string, fallback: string) => {
    const value = t(key);
    return value && value !== key ? value : fallback;
  };
  const statusLabel = resolveLabel(`network.${status}`, status);
  const quality = latency !== null ? getConnectionQuality(latency) : null;
  const detailsLabel = "Network details";

  return (
    <div
      ref={statusRegionRef}
      className={`relative w-full overflow-hidden rounded-2xl border bg-white p-3 shadow-sm transition-all duration-300 sm:p-4 ${colors.border} ${
        isHovered && enableMicroInteractions ? "scale-[1.01] shadow-md" : ""
      } ${
        isFocused && enableMicroInteractions ? "ring-2 ring-blue-500 ring-offset-1" : ""
      }`}
      role="region"
      aria-label={t("network.status")}
      aria-live={enableScreenReaderSupport ? "polite" : "off"}
      aria-atomic="true"
      aria-busy={status === "checking"}
      aria-describedby={showDetails && (latency !== null || errorMessage) ? "network-details" : undefined}
      tabIndex={enableKeyboardNavigation ? 0 : undefined}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
    >
      <div className="relative z-10">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="relative shrink-0">
              <div
                className={`h-3 w-3 rounded-full ${colors.dot} transition-all duration-300 ${
                  status === "online" ? "animate-pulse" : ""
                } ${status === "checking" ? "animate-spin" : ""} ${
                  status === "slow" ? "animate-pulse" : ""
                }`}
              />

              {autoCheck && !reducedMotion && (
                <div
                  className={`absolute inset-0 h-3 w-3 rounded-full ${colors.dot} opacity-60 animate-ping`}
                />
              )}
            </div>

            <div className="flex min-w-0 flex-col gap-1">
              <span
                className={`inline-flex w-fit items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide transition-colors duration-300 sm:text-xs ${colors.badge}`}
              >
                {statusLabel}
              </span>

              {showDetails && latency !== null && (
                <span className={`text-xs transition-colors duration-300 ${getLatencyColor(latency)}`}>
                  {latency}ms
                  {connectionType && connectionType !== "unknown" && (
                    <span className="ml-1 text-gray-400">({connectionType})</span>
                  )}
                </span>
              )}
            </div>
          </div>

          <button
            ref={refreshButtonRef}
            type="button"
            onClick={handleRefresh}
            className={`relative inline-flex h-9 w-9 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-700 transition-all duration-200 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
              status !== "checking" ? "hover:scale-105 active:scale-95" : ""
            }`}
            aria-label={t("network.refresh")}
            aria-describedby={status === "checking" ? "refresh-status" : undefined}
            aria-busy={status === "checking"}
            aria-pressed={status === "checking"}
            disabled={status === "checking"}
            onKeyDown={(e) => {
              if (enableKeyboardNavigation && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                handleRefresh();
              }
            }}
          >
            <svg
              className={`h-4 w-4 ${status === "checking" ? "animate-spin" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            {status === "checking" && (
              <div className="absolute inset-0 rounded-md bg-blue-500 opacity-20 animate-pulse" />
            )}
          </button>

          {enableScreenReaderSupport && (
            <div className="sr-only" aria-live="polite" aria-atomic="true">
              {status === "checking" && <div id="refresh-status">{t("network.checking")}</div>}
              {latency !== null && (
                <div>
                  {t("network.latency")}: {latency}ms
                </div>
              )}
              {connectionType && connectionType !== "unknown" && (
                <div>
                  {t("network.connection")}: {connectionType}
                </div>
              )}
              {errorMessage && (
                <div role="alert">
                  {t("network.error")}: {errorMessage}
                </div>
              )}
            </div>
          )}
        </div>

        {showConnectionQuality && quality && (
          <div className="mt-3 transition-all duration-300">
            <div className="flex flex-col gap-2 text-xs text-gray-600 sm:flex-row sm:items-center">
              <span className="font-medium">{resolveLabel("network.connectionQuality", "Connection Quality")}:</span>
              <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200 sm:flex-1">
                <div className={`h-full rounded-full transition-all duration-500 ${quality.barClass}`} />
              </div>
              <span className="font-medium text-gray-700">{resolveLabel(`network.${quality.label}`, quality.label)}</span>
            </div>
          </div>
        )}

        {showDetails && (errorMessage || latency !== null) && (
          <div
            ref={detailsRegionRef}
            id="network-details"
            className="mt-3 border-t border-gray-200 pt-3 transition-all duration-300"
            role="group"
            aria-label={detailsLabel}
            aria-live={enableScreenReaderSupport ? "polite" : "off"}
            aria-atomic="true"
          >
            <div className="space-y-2 text-xs text-gray-600">
              {latency !== null && (
                <div>
                  <span className="font-medium">{t("network.latency")}:</span>{" "}
                  <span className={`transition-colors duration-300 ${getLatencyColor(latency)}`}>
                    {latency}ms
                  </span>
                </div>
              )}

              {connectionType && connectionType !== "unknown" && (
                <div>
                  <span className="font-medium">{t("network.connection")}:</span>{" "}
                  {connectionType}
                </div>
              )}

              {errorMessage && (
                <div className="rounded bg-red-50 p-2 text-red-700">
                  <span className="font-medium">{t("network.error")}:</span>{" "}
                  {errorMessage}
                </div>
              )}

              {status === "online" && !errorMessage && (
                <div className="text-gray-500">
                  {t("network.lastChecked")}: {new Date().toLocaleTimeString()}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default NetworkStatusIndicator;
