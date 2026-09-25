"use client";

import { useEffect, useRef, useCallback } from "react";
import { useNetworkStatusStore } from "@/lib/network-status-store";
import {
  useScreenReader,
  useFocusManagement,
} from "@/lib/accessibility-utils";

const getConnectionType = (): string => {
  if (typeof navigator === "undefined") return "unknown";
  const connection =
    (navigator as any).connection ||
    (navigator as any).mozConnection ||
    (navigator as any).webkitConnection;
  return connection?.effectiveType || "unknown";
};

export interface UseNetworkMonitorOptions {
  autoCheck?: boolean;
  checkInterval?: number;
  onStatusChange?: (status: string) => void;
  showConnectionQuality?: boolean;
  enableScreenReaderSupport?: boolean;
  enableKeyboardNavigation?: boolean;
  announcementsEnabled?: boolean;
}

export interface UseNetworkMonitorReturn {
  statusRegionRef: React.RefObject<HTMLDivElement>;
  detailsRegionRef: React.RefObject<HTMLDivElement>;
  refreshButtonRef: React.RefObject<HTMLButtonElement>;
  handleRefresh: () => void;
}

export function useNetworkMonitor({
  autoCheck = true,
  checkInterval = 30000,
  onStatusChange,
  showConnectionQuality = true,
  enableScreenReaderSupport = true,
  enableKeyboardNavigation = true,
  announcementsEnabled = true,
}: UseNetworkMonitorOptions = {}): UseNetworkMonitorReturn {
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const statusRegionRef = useRef<HTMLDivElement>(null);
  const detailsRegionRef = useRef<HTMLDivElement>(null);
  const refreshButtonRef = useRef<HTMLButtonElement>(null);
  const previousStatusRef = useRef<string>("checking");

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

  const {
    announce,
    announceStatusChange,
    announceLatency,
    announceConnectionType,
    announceError,
    announceQuality,
  } = useScreenReader();

  const { saveFocus, restoreFocus, getCurrentFocus } = useFocusManagement();

  useEffect(() => {
    if (!autoCheck) return;
    checkStatus();
    setIsMonitoring(true);
    setConnectionType(getConnectionType());
    intervalRef.current = setInterval(() => checkStatus(), checkInterval);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      setIsMonitoring(false);
    };
  }, [autoCheck, checkInterval, checkStatus, setIsMonitoring, setConnectionType]);

  useEffect(() => {
    onStatusChange?.(status);
    if (
      enableScreenReaderSupport &&
      announcementsEnabled &&
      status !== previousStatusRef.current
    ) {
      const previousStatus = previousStatusRef.current;
      previousStatusRef.current = status;

      let details = "";
      if (latency !== null) details = `Latency is ${latency} milliseconds`;
      if (connectionType && connectionType !== "unknown") {
        details += details
          ? `, connection type is ${connectionType}`
          : `Connection type is ${connectionType}`;
      }
      announceStatusChange(previousStatus, status, details);

      if (showConnectionQuality && latency !== null) {
        let quality = "poor";
        if (latency < 50) quality = "excellent";
        else if (latency < 150) quality = "good";
        else if (latency < 300) quality = "fair";
        announceQuality(quality, latency);
      }
    }
  }, [
    status,
    onStatusChange,
    enableScreenReaderSupport,
    announcementsEnabled,
    latency,
    connectionType,
    showConnectionQuality,
    announceStatusChange,
    announceQuality,
  ]);

  useEffect(() => {
    if (enableScreenReaderSupport && announcementsEnabled && latency !== null) {
      announceLatency(latency);
    }
  }, [latency, enableScreenReaderSupport, announcementsEnabled, announceLatency]);

  useEffect(() => {
    if (
      enableScreenReaderSupport &&
      announcementsEnabled &&
      connectionType &&
      connectionType !== "unknown"
    ) {
      announceConnectionType(connectionType);
    }
  }, [
    connectionType,
    enableScreenReaderSupport,
    announcementsEnabled,
    announceConnectionType,
  ]);

  useEffect(() => {
    if (enableScreenReaderSupport && announcementsEnabled && errorMessage) {
      announceError(errorMessage);
    }
  }, [errorMessage, enableScreenReaderSupport, announcementsEnabled, announceError]);

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

  const handleRefresh = useCallback(() => {
    if (status === "checking") return;
    saveFocus();
    if (enableScreenReaderSupport && announcementsEnabled) {
      announce("Checking network status", "polite");
    }
    checkStatus();
    setTimeout(() => {
      if (enableScreenReaderSupport && announcementsEnabled) {
        // status can't be "checking" here — the early return above already
        // guards against that for this captured value.
        announce(`Network status check ${status}`, "polite");
      }
    }, 2000);
  }, [
    status,
    checkStatus,
    saveFocus,
    enableScreenReaderSupport,
    announcementsEnabled,
    announce,
  ]);

  useEffect(() => {
    if (!enableKeyboardNavigation) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key === "r") {
        event.preventDefault();
        handleRefresh();
      }
      if (event.key === "Escape") {
        restoreFocus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    enableKeyboardNavigation,
    getCurrentFocus,
    restoreFocus,
    handleRefresh,
  ]);

  return {
    statusRegionRef,
    detailsRegionRef,
    refreshButtonRef,
    handleRefresh,
  };
}
