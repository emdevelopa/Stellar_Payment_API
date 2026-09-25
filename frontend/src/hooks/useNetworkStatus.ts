"use client";

/**
 * useNetworkStatus
 *
 * Polling hook for the Network Status Indicator.
 *
 * Features:
 * - Polls Horizon on a configurable interval (default 30s).
 * - Measures round-trip latency via performance.now().
 * - Derives health from HTTP status code + latency thresholds.
 * - Pauses polling when the document is hidden (Page Visibility API).
 * - Exposes manual re-check with optimistic "checking" state.
 * - Exponential back-off on consecutive errors (max 5 min).
 * - Announcement string for aria-live region updates.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  networkStatusReducer,
  initialNetworkStatusState,
  deriveHealth,
  selectIsLoading,
  selectHasError,
  selectIsOffline,
  selectLastCheckedLabel,
  type NetworkCheckResult,
} from "@/lib/network-status";

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_POLL_INTERVAL_MS = 30_000;
const DEFAULT_HORIZON_URL =
  process.env.NEXT_PUBLIC_HORIZON_URL ??
  "https://horizon-testnet.stellar.org";
const MAX_BACKOFF_MS = 5 * 60 * 1000; // 5 min

// ── Options ───────────────────────────────────────────────────────────────────

export interface UseNetworkStatusOptions {
  horizonUrl?: string;
  pollIntervalMs?: number;
  /** Start polling immediately on mount. Default: true. */
  autoStart?: boolean;
  /** Pause polling when the tab is hidden. Default: true. */
  pauseOnHidden?: boolean;
}

// ── Return type ───────────────────────────────────────────────────────────────

export interface UseNetworkStatusReturn {
  health: import("@/lib/network-status").NetworkHealth;
  fetchState: import("@/lib/network-status").FetchState;
  lastResult: NetworkCheckResult | null;
  errorMessage: string | null;
  checkCount: number;
  consecutiveErrors: number;
  isPolling: boolean;
  isManualCheck: boolean;
  isLoading: boolean;
  hasError: boolean;
  isOffline: boolean;
  /** Human-readable "X ago" string for the last check time. */
  lastCheckedLabel: string;
  /** Trigger an immediate re-check. */
  checkNow: () => void;
  /** Dismiss the error banner without retrying. */
  dismissError: () => void;
  /** Pause the auto-polling interval. */
  pausePolling: () => void;
  /** Resume the auto-polling interval. */
  resumePolling: () => void;
  /** Translated announcement for the aria-live region. */
  announcement: string;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useNetworkStatus({
  horizonUrl = DEFAULT_HORIZON_URL,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  autoStart = true,
  pauseOnHidden = true,
}: UseNetworkStatusOptions = {}): UseNetworkStatusReturn {
  const [state, dispatch] = useReducer(
    networkStatusReducer,
    initialNetworkStatusState,
  );
  const [announcement, setAnnouncement] = useState("");
  const [now, setNow] = useState(() => Date.now());

  // Stable refs so callbacks never go stale
  const stateRef = useRef(state);
  stateRef.current = state;

  const pollingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ── Core check ─────────────────────────────────────────────────────────────

  const performCheck = useCallback(
    async (manual = false) => {
      // Abort any in-flight request
      abortRef.current?.abort();
      abortRef.current = new AbortController();

      dispatch({ type: "CHECK_START", manual });

      const t0 = performance.now();

      try {
        const res = await fetch(`${horizonUrl}`, {
          signal: abortRef.current.signal,
          cache: "no-store",
          headers: { Accept: "application/json" },
        });

        const latencyMs = Math.round(performance.now() - t0);
        const health = deriveHealth(res.status, latencyMs);

        let ledgerSequence: number | null = null;
        try {
          const json = await res.json();
          ledgerSequence =
            typeof json?.history_latest_ledger === "number"
              ? json.history_latest_ledger
              : null;
        } catch {
          // JSON parse failure is non-fatal
        }

        const result: NetworkCheckResult = {
          checkedAt: Date.now(),
          latencyMs,
          ledgerSequence,
          horizonUrl,
          health,
          httpStatus: res.status,
        };

        dispatch({ type: "CHECK_SUCCESS", result });
        setNow(Date.now());

        const statusKey =
          health === "operational"
            ? "Operational"
            : health === "degraded"
              ? "Degraded"
              : health === "partial_outage"
                ? "Partial Outage"
                : "Major Outage";
        setAnnouncement(`Network status: ${statusKey}. Latency: ${latencyMs}ms.`);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;

        const latencyMs = Math.round(performance.now() - t0);
        const message =
          err instanceof Error ? err.message : "Network request failed";

        dispatch({ type: "CHECK_ERROR", error: message });
        setAnnouncement(`Network error: ${message}`);
        setNow(Date.now());

        // Exponential back-off for auto-retries
        const backoff = Math.min(
          pollIntervalMs *
            Math.pow(2, stateRef.current.consecutiveErrors),
          MAX_BACKOFF_MS,
        );
        pollingTimerRef.current = setTimeout(
          () => performCheck(false),
          backoff,
        );
      }
    },
    [horizonUrl, pollIntervalMs],
  );

  // ── Polling management ─────────────────────────────────────────────────────

  const scheduleNextPoll = useCallback(() => {
    if (pollingTimerRef.current) clearTimeout(pollingTimerRef.current);
    pollingTimerRef.current = setTimeout(() => {
      if (stateRef.current.isPolling) {
        void performCheck(false).then(scheduleNextPoll);
      }
    }, pollIntervalMs);
  }, [performCheck, pollIntervalMs]);

  const startPolling = useCallback(() => {
    dispatch({ type: "POLLING_START" });
    void performCheck(false);
    scheduleNextPoll();
  }, [performCheck, scheduleNextPoll]);

  const stopPolling = useCallback(() => {
    dispatch({ type: "POLLING_STOP" });
    if (pollingTimerRef.current) {
      clearTimeout(pollingTimerRef.current);
      pollingTimerRef.current = null;
    }
  }, []);

  // ── Mount / unmount ────────────────────────────────────────────────────────

  useEffect(() => {
    if (autoStart) startPolling();
    return () => {
      stopPolling();
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Page Visibility API ────────────────────────────────────────────────────

  useEffect(() => {
    if (!pauseOnHidden) return;
    const handleVisibility = () => {
      if (document.hidden) {
        stopPolling();
      } else {
        startPolling();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibility);
  }, [pauseOnHidden, startPolling, stopPolling]);

  // ── "Just now" ticker — update label every 5 s ────────────────────────────

  useEffect(() => {
    const ticker = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(ticker);
  }, []);

  // ── Public API ─────────────────────────────────────────────────────────────

  const checkNow = useCallback(() => {
    void performCheck(true);
    scheduleNextPoll();
  }, [performCheck, scheduleNextPoll]);

  const dismissError = useCallback(() => {
    dispatch({ type: "DISMISS_ERROR" });
  }, []);

  const pausePolling = useCallback(() => stopPolling(), [stopPolling]);
  const resumePolling = useCallback(() => startPolling(), [startPolling]);

  const lastCheckedLabel = useMemo(
    () => selectLastCheckedLabel(state.lastResult?.checkedAt ?? null, now),
    [state.lastResult, now],
  );

  return {
    health: state.health,
    fetchState: state.fetchState,
    lastResult: state.lastResult,
    errorMessage: state.errorMessage,
    checkCount: state.checkCount,
    consecutiveErrors: state.consecutiveErrors,
    isPolling: state.isPolling,
    isManualCheck: state.isManualCheck,
    isLoading: selectIsLoading(state),
    hasError: selectHasError(state),
    isOffline: selectIsOffline(state),
    lastCheckedLabel,
    checkNow,
    dismissError,
    pausePolling,
    resumePolling,
    announcement,
  };
}
