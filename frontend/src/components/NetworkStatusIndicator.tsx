"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence, type Variants, useAnimation } from "framer-motion";
import { useTranslations } from "next-intl";
import { useNetworkStatusStore } from "@/lib/network-status-store";
import {
  statusDotVariants,
  statusBadgeVariants,
  detailsPanelVariants,
  refreshButtonVariants,
  latencyVariants,
  connectionQualityVariants,
  errorMessageVariants,
  containerVariants,
  hoverEffectVariants,
  focusRingVariants,
  getLatencyVariant,
  getConnectionQualityVariant,
  getStatusDotVariant,
  useReducedMotion,
  getAdaptiveTransition,
} from "@/lib/network-animations";
import {
  useScreenReader,
  useFocusManagement,
  ScreenReaderManager,
  AriaManager,
  KeyboardManager,
} from "@/lib/accessibility-utils";

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
 * Connection type detector
 */
const getConnectionType = (): string => {
  if (typeof navigator === "undefined") return "unknown";

  const connection =
    (navigator as any).connection ||
    (navigator as any).mozConnection ||
    (navigator as any).webkitConnection;

  return connection?.effectiveType || "unknown";
};

/**
 * Status color mapper
 */
const getStatusColor = (
  status: string
): {
  dot: string;
  bg: string;
  text: string;
  label: string;
} => {
  const colors: Record<
    string,
    { dot: string; bg: string; text: string; label: string }
  > = {
    online: {
      dot: "bg-green-500",
      bg: "bg-green-50",
      text: "text-green-700",
      label: "Online",
    },
    offline: {
      dot: "bg-red-500",
      bg: "bg-red-50",
      text: "text-red-700",
      label: "Offline",
    },
    slow: {
      dot: "bg-yellow-500",
      bg: "bg-yellow-50",
      text: "text-yellow-700",
      label: "Slow",
    },
    checking: {
      dot: "bg-gray-400",
      bg: "bg-gray-50",
      text: "text-gray-700",
      label: "Checking...",
    },
  };

  return colors[status] || colors.checking;
};

/**
 * NetworkStatusIndicator Component
 *
 * Displays real-time network status with automatic monitoring.
 * Uses Zustand for state management and framer-motion for animations.
 * Includes latency measurement and connection type detection.
 */
export const NetworkStatusIndicator: React.FC<
  NetworkStatusIndicatorProps
> = ({
  showDetails = true,
  autoCheck = true,
  checkInterval = 30000, // 30 seconds
  onStatusChange,
  showConnectionQuality = true,
  enableMicroInteractions = true,
  enableScreenReaderSupport = true,
  enableKeyboardNavigation = true,
  announcementsEnabled = true,
}) => {
  const t = useTranslations();
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const controls = useAnimation();
  const reducedMotion = useReducedMotion();
  
  // Accessibility hooks
  const {
    announce,
    announceStatusChange,
    announceLatency,
    announceConnectionType,
    announceError,
    announceQuality,
  } = useScreenReader();
  
  const {
    saveFocus,
    restoreFocus,
    setFocus,
    getCurrentFocus,
  } = useFocusManagement();
  
  // Refs for accessibility
  const statusRegionRef = useRef<HTMLDivElement>(null);
  const detailsRegionRef = useRef<HTMLDivElement>(null);
  const refreshButtonRef = useRef<HTMLButtonElement>(null);
  const previousStatusRef = useRef<string>("checking");

  // Zustand store
  const {
    status,
    latency,
    connectionType,
    errorMessage,
    setStatus,
    setConnectionType,
    setIsMonitoring,
    checkStatus,
  } = useNetworkStatusStore();

  /**
   * Initialize monitoring
   */
  useEffect(() => {
    if (!autoCheck) return;

    // Initial check
    checkStatus();
    setIsMonitoring(true);

    // Detect connection type
    const type = getConnectionType();
    setConnectionType(type);

    // Set up periodic checks
    intervalRef.current = setInterval(() => {
      checkStatus();
    }, checkInterval);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      setIsMonitoring(false);
    };
  }, [autoCheck, checkInterval, checkStatus, setIsMonitoring, setConnectionType]);

  /**
   * Handle status changes with screen reader announcements
   */
  useEffect(() => {
    onStatusChange?.(status);
    
    // Screen reader announcements for status changes
    if (enableScreenReaderSupport && announcementsEnabled && status !== previousStatusRef.current) {
      const previousStatus = previousStatusRef.current;
      previousStatusRef.current = status;
      
      // Announce status change
      let details = "";
      if (latency !== null) {
        details = `Latency is ${latency} milliseconds`;
      }
      if (connectionType && connectionType !== "unknown") {
        details += details ? `, connection type is ${connectionType}` : `Connection type is ${connectionType}`;
      }
      
      announceStatusChange(previousStatus, status, details);
      
      // Announce connection quality if applicable
      if (showConnectionQuality && latency !== null) {
        let quality = "poor";
        if (latency < 50) quality = "excellent";
        else if (latency < 150) quality = "good";
        else if (latency < 300) quality = "fair";
        
        announceQuality(quality, latency);
      }
    }
  }, [status, onStatusChange, enableScreenReaderSupport, announcementsEnabled, latency, connectionType, showConnectionQuality, announceStatusChange, announceQuality]);

  /**
   * Announce latency changes
   */
  useEffect(() => {
    if (enableScreenReaderSupport && announcementsEnabled && latency !== null) {
      announceLatency(latency);
    }
  }, [latency, enableScreenReaderSupport, announcementsEnabled, announceLatency]);

  /**
   * Announce connection type changes
   */
  useEffect(() => {
    if (enableScreenReaderSupport && announcementsEnabled && connectionType && connectionType !== "unknown") {
      announceConnectionType(connectionType);
    }
  }, [connectionType, enableScreenReaderSupport, announcementsEnabled, announceConnectionType]);

  /**
   * Announce errors
   */
  useEffect(() => {
    if (enableScreenReaderSupport && announcementsEnabled && errorMessage) {
      announceError(errorMessage);
    }
  }, [errorMessage, enableScreenReaderSupport, announcementsEnabled, announceError]);

  /**
   * Handle online/offline events with screen reader announcements
   */
  useEffect(() => {
    const handleOnline = () => {
      setStatus("online");
      if (enableScreenReaderSupport && announcementsEnabled) {
        announce("Network connection restored", "assertive");
      }
    };
    
    const handleOffline = () => {
      setStatus("offline");
      if (enableScreenReaderSupport && announcementsEnabled) {
        announce("Network connection lost", "assertive");
      }
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [setStatus, enableScreenReaderSupport, announcementsEnabled, announce]);

  /**
   * Setup keyboard navigation
   */
  useEffect(() => {
    if (!enableKeyboardNavigation) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // Handle keyboard shortcuts for network status
      if (event.ctrlKey && event.key === "r") {
        event.preventDefault();
        handleRefresh();
      }
      
      if (event.key === "Escape" && getCurrentFocus() === refreshButtonRef.current) {
        restoreFocus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [enableKeyboardNavigation, getCurrentFocus, restoreFocus]);

  /**
   * Enhanced refresh handler with accessibility
   */
  const handleRefresh = useCallback(() => {
    if (status === "checking") return;
    
    saveFocus();
    
    if (enableScreenReaderSupport && announcementsEnabled) {
      announce("Checking network status", "polite");
    }
    
    checkStatus();
    
    // Announce completion after a delay
    setTimeout(() => {
      if (enableScreenReaderSupport && announcementsEnabled) {
        const currentStatus = status === "checking" ? "completed" : status;
        announce(`Network status check ${currentStatus}`, "polite");
      }
    }, 2000);
  }, [status, checkStatus, saveFocus, enableScreenReaderSupport, announcementsEnabled, announce]);

  const colors = getStatusColor(status);
  const adaptiveTransition = getAdaptiveTransition({ duration: 0.3, ease: [0.16, 1, 0.3, 1] });

  return (
    <motion.div
      ref={statusRegionRef}
      className="w-full rounded-lg border border-gray-200 bg-white p-4 shadow-sm relative overflow-hidden"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      role="region"
      aria-label={t("network.status") || "Network Status"}
      aria-live={enableScreenReaderSupport ? "polite" : "off"}
      aria-atomic="true"
      aria-busy={status === "checking"}
      aria-describedby={showDetails && (latency !== null || errorMessage) ? "network-details" : undefined}
      tabIndex={enableKeyboardNavigation ? 0 : undefined}
      onHoverStart={() => setIsHovered(true)}
      onHoverEnd={() => setIsHovered(false)}
      onFocusStart={() => setIsFocused(true)}
      onFocusEnd={() => setIsFocused(false)}
    >
      {/* Background hover effect */}
      {enableMicroInteractions && (
        <motion.div
          className="absolute inset-0 bg-blue-50 rounded-lg"
          variants={hoverEffectVariants}
          animate={isHovered ? "hover" : "rest"}
        />
      )}

      {/* Focus ring */}
      {enableMicroInteractions && (
        <motion.div
          className="absolute inset-0 rounded-lg border-2 border-blue-500 pointer-events-none"
          variants={focusRingVariants}
          animate={isFocused ? "focused" : "unfocused"}
        />
      )}

      <div className="relative z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Enhanced status indicator dot */}
            <div className="relative">
              <motion.div
                className={`h-3 w-3 rounded-full ${colors.dot}`}
                variants={statusDotVariants}
                animate={getStatusDotVariant(status)}
              />
              
              {/* Pulse effect for active states */}
              {(status === "checking" || status === "slow") && !reducedMotion && (
                <motion.div
                  className={`absolute inset-0 h-3 w-3 rounded-full ${colors.dot} opacity-50`}
                  animate={{ scale: [1, 1.5, 1], opacity: [0.5, 0, 0.5] }}
                  transition={{
                    duration: status === "checking" ? 1 : 2,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }}
                />
              )}
            </div>

            {/* Enhanced status label */}
            <AnimatePresence mode="wait">
              <motion.div
                key={status}
                className="flex flex-col gap-1"
                variants={statusBadgeVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
              >
                <motion.span
                  className={`text-sm font-medium ${colors.text}`}
                  layoutId="status-label"
                  transition={adaptiveTransition}
                >
                  {colors.label}
                </motion.span>

                {showDetails && latency !== null && (
                  <motion.span
                    className="text-xs text-gray-500"
                    variants={latencyVariants}
                    animate={getLatencyVariant(latency)}
                    layoutId="latency-display"
                    transition={adaptiveTransition}
                  >
                    {latency}ms
                    {connectionType && connectionType !== "unknown" && (
                      <span className="ml-2">({connectionType})</span>
                    )}
                  </motion.span>
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Enhanced refresh button */}
          <motion.button
            ref={refreshButtonRef}
            onClick={handleRefresh}
            className="relative rounded-md p-1.5 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            aria-label={t("network.refresh") || "Check network status"}
            aria-describedby={status === "checking" ? "refresh-status" : undefined}
            aria-pressed={status === "checking"}
            aria-busy={status === "checking"}
            disabled={status === "checking"}
            variants={refreshButtonVariants}
            initial="idle"
            whileHover="hover"
            whileTap="tap"
            animate={status === "checking" ? "spinning" : "idle"}
            onKeyDown={(e) => {
              if (enableKeyboardNavigation && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                handleRefresh();
              }
            }}
          >
            <motion.svg
              className="h-4 w-4 text-gray-600"
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
            </motion.svg>
            
            {/* Loading indicator for refresh button */}
            {status === "checking" && (
              <motion.div
                className="absolute inset-0 rounded-md bg-blue-500 opacity-20"
                animate={{ opacity: [0.2, 0.4, 0.2] }}
                transition={{ duration: 1, repeat: Infinity, ease: "easeInOut" }}
              />
            )}
          </motion.button>

          {/* Hidden screen reader status announcements */}
          {enableScreenReaderSupport && (
            <div className="sr-only" aria-live="polite" aria-atomic="true">
              {status === "checking" && (
                <div id="refresh-status">Currently checking network status</div>
              )}
              {latency !== null && (
                <div>Current network latency: {latency} milliseconds</div>
              )}
              {connectionType && connectionType !== "unknown" && (
                <div>Connection type: {connectionType}</div>
              )}
              {errorMessage && (
                <div role="alert">Network error: {errorMessage}</div>
              )}
            </div>
          )}
        </div>

        {/* Enhanced connection quality indicator */}
        {showConnectionQuality && latency !== null && (
          <motion.div
            className="mt-3 mb-3"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={adaptiveTransition}
          >
            <div className="flex items-center gap-2 text-xs text-gray-600">
              <span>Connection Quality:</span>
              <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                <motion.div
                  className="h-full rounded-full"
                  variants={connectionQualityVariants}
                  animate={getConnectionQualityVariant(latency)}
                />
              </div>
              <span className="font-medium">
                {latency < 50 ? "Excellent" : latency < 150 ? "Good" : latency < 300 ? "Fair" : "Poor"}
              </span>
            </div>
          </motion.div>
        )}

        {/* Enhanced detailed information panel */}
        {showDetails && (
          <AnimatePresence>
            {(errorMessage || latency !== null) && (
              <motion.div
                ref={detailsRegionRef}
                id="network-details"
                className="mt-3 border-t border-gray-200 pt-3"
                variants={detailsPanelVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                role="group"
                aria-label="Network details"
                aria-live={enableScreenReaderSupport ? "polite" : "off"}
                aria-atomic="true"
              >
                <div className="space-y-2">
                  {latency !== null && (
                    <motion.div
                      className="text-xs text-gray-600"
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={adaptiveTransition}
                    >
                      <span className="font-medium">
                        {t("network.latency") || "Latency"}:
                      </span>{" "}
                      <motion.span
                        variants={latencyVariants}
                        animate={getLatencyVariant(latency)}
                      >
                        {latency}ms
                      </motion.span>
                    </motion.div>
                  )}

                  {connectionType && connectionType !== "unknown" && (
                    <motion.div
                      className="text-xs text-gray-600"
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ ...adaptiveTransition, delay: 0.1 }}
                    >
                      <span className="font-medium">
                        {t("network.connection") || "Connection"}:
                      </span>{" "}
                      {connectionType}
                    </motion.div>
                  )}

                  {errorMessage && (
                    <motion.div
                      className="rounded bg-red-50 p-2 text-xs text-red-700"
                      variants={errorMessageVariants}
                      initial="hidden"
                      animate="visible"
                      exit="exit"
                    >
                      <span className="font-medium">
                        {t("network.error") || "Error"}:
                      </span>{" "}
                      {errorMessage}
                    </motion.div>
                  )}

                  {status === "online" && !errorMessage && (
                    <motion.div
                      className="text-xs text-gray-500"
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ ...adaptiveTransition, delay: 0.2 }}
                    >
                      {t("network.lastChecked") || "Last checked"}:{" "}
                      {new Date().toLocaleTimeString()}
                    </motion.div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </div>
    </motion.div>
  );
};

export default NetworkStatusIndicator;
