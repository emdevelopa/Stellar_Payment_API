/**
 * network-status.ts
 *
 * Pure reducer, types, and selectors for the Network Status Indicator.
 * Zero runtime dependencies — fully tree-shakeable and independently testable.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type NetworkHealth =
  | "operational"
  | "degraded"
  | "partial_outage"
  | "major_outage"
  | "offline"
  | "checking"
  | "unknown";

export type FetchState = "idle" | "loading" | "success" | "error";

export interface NetworkCheckResult {
  checkedAt: number;
  latencyMs: number | null;
  ledgerSequence: number | null;
  horizonUrl: string;
  health: NetworkHealth;
  httpStatus: number | null;
}

export interface NetworkStatusState {
  readonly health: NetworkHealth;
  readonly fetchState: FetchState;
  readonly lastResult: NetworkCheckResult | null;
  readonly errorMessage: string | null;
  readonly checkCount: number;
  readonly consecutiveErrors: number;
  readonly isPolling: boolean;
  readonly isManualCheck: boolean;
}

export type NetworkStatusAction =
  | { type: "CHECK_START"; manual?: boolean }
  | { type: "CHECK_SUCCESS"; result: NetworkCheckResult }
  | { type: "CHECK_ERROR"; error: string }
  | { type: "POLLING_START" }
  | { type: "POLLING_STOP" }
  | { type: "DISMISS_ERROR" }
  | { type: "RESET" };

// ── Thresholds ────────────────────────────────────────────────────────────────

export const LATENCY_THRESHOLDS = {
  operational: 800,
  degraded: 2000,
} as const;

// ── Initial state ─────────────────────────────────────────────────────────────

export const initialNetworkStatusState: NetworkStatusState = {
  health: "unknown",
  fetchState: "idle",
  lastResult: null,
  errorMessage: null,
  checkCount: 0,
  consecutiveErrors: 0,
  isPolling: false,
  isManualCheck: false,
};

// ── Reducer ───────────────────────────────────────────────────────────────────

export function networkStatusReducer(
  state: NetworkStatusState,
  action: NetworkStatusAction,
): NetworkStatusState {
  switch (action.type) {
    case "CHECK_START":
      return {
        ...state,
        fetchState: "loading",
        health: "checking",
        errorMessage: null,
        isManualCheck: action.manual ?? false,
      };
    case "CHECK_SUCCESS":
      return {
        ...state,
        fetchState: "success",
        health: action.result.health,
        lastResult: action.result,
        errorMessage: null,
        checkCount: state.checkCount + 1,
        consecutiveErrors: 0,
        isManualCheck: false,
      };
    case "CHECK_ERROR":
      return {
        ...state,
        fetchState: "error",
        health: "offline",
        errorMessage: action.error,
        checkCount: state.checkCount + 1,
        consecutiveErrors: state.consecutiveErrors + 1,
        isManualCheck: false,
      };
    case "POLLING_START":
      return { ...state, isPolling: true };
    case "POLLING_STOP":
      return { ...state, isPolling: false };
    case "DISMISS_ERROR":
      return {
        ...state,
        errorMessage: null,
        fetchState: state.fetchState === "error" ? "idle" : state.fetchState,
        health: state.health === "offline" ? "unknown" : state.health,
      };
    case "RESET":
      return initialNetworkStatusState;
    default:
      return state;
  }
}

// ── Selectors ─────────────────────────────────────────────────────────────────

export const selectIsLoading = (s: NetworkStatusState) =>
  s.fetchState === "loading";

export const selectHasError = (s: NetworkStatusState) =>
  s.fetchState === "error" && s.errorMessage !== null;

export const selectIsHealthy = (s: NetworkStatusState) =>
  s.health === "operational";

export const selectIsDegraded = (s: NetworkStatusState) =>
  s.health === "degraded" ||
  s.health === "partial_outage" ||
  s.health === "major_outage";

export const selectIsOffline = (s: NetworkStatusState) =>
  s.health === "offline";

export function selectLastCheckedLabel(
  checkedAt: number | null,
  nowMs: number,
): string {
  if (checkedAt === null) return "";
  const diffSec = Math.floor((nowMs - checkedAt) / 1000);
  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  return `${Math.floor(diffMin / 60)}h ago`;
}

export function deriveHealth(
  httpStatus: number,
  latencyMs: number,
): NetworkHealth {
  if (httpStatus < 200 || httpStatus >= 500) return "major_outage";
  if (httpStatus >= 400) return "partial_outage";
  if (latencyMs <= LATENCY_THRESHOLDS.operational) return "operational";
  if (latencyMs <= LATENCY_THRESHOLDS.degraded) return "degraded";
  return "partial_outage";
}

export function healthToColor(health: NetworkHealth): {
  dot: string;
  badge: string;
  border: string;
  text: string;
} {
  switch (health) {
    case "operational":
      return {
        dot: "bg-emerald-500",
        badge: "bg-emerald-50 dark:bg-emerald-950/40",
        border: "border-emerald-200 dark:border-emerald-800/50",
        text: "text-emerald-700 dark:text-emerald-400",
      };
    case "degraded":
      return {
        dot: "bg-amber-500",
        badge: "bg-amber-50 dark:bg-amber-950/40",
        border: "border-amber-200 dark:border-amber-800/50",
        text: "text-amber-700 dark:text-amber-400",
      };
    case "partial_outage":
      return {
        dot: "bg-orange-500",
        badge: "bg-orange-50 dark:bg-orange-950/40",
        border: "border-orange-200 dark:border-orange-800/50",
        text: "text-orange-700 dark:text-orange-400",
      };
    case "major_outage":
      return {
        dot: "bg-red-500",
        badge: "bg-red-50 dark:bg-red-950/40",
        border: "border-red-200 dark:border-red-800/50",
        text: "text-red-700 dark:text-red-400",
      };
    case "offline":
      return {
        dot: "bg-red-600",
        badge: "bg-red-50 dark:bg-red-950/40",
        border: "border-red-200 dark:border-red-800/50",
        text: "text-red-700 dark:text-red-400",
      };
    case "checking":
      return {
        dot: "bg-pluto-400",
        badge: "bg-pluto-50 dark:bg-pluto-900/40",
        border: "border-pluto-200 dark:border-pluto-800/50",
        text: "text-pluto-600 dark:text-pluto-300",
      };
    default:
      return {
        dot: "bg-[#6B6B6B]",
        badge: "bg-[#f9f9f9] dark:bg-pluto-900/20",
        border: "border-[#e8e8e8] dark:border-pluto-800/40",
        text: "text-[#6B6B6B] dark:text-pluto-400",
      };
  }
}
