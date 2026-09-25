export type OperationalStatus =
  | "loading"
  | "operational"
  | "degraded_performance"
  | "partial_outage"
  | "major_outage"
  | "unknown";

export interface StatusPageSummary {
  status: { indicator: string; description: string };
  page: { name: string };
}

export interface SystemStatusSnapshot {
  status: OperationalStatus;
  label: string;
}

export interface SystemStatusState {
  current: SystemStatusSnapshot;
  lastSuccessful: SystemStatusSnapshot | null;
  isRefreshing: boolean;
  isStale: boolean;
}

export type SystemStatusAction =
  | { type: "request" }
  | { type: "success"; snapshot: SystemStatusSnapshot }
  | { type: "failure" }
  | { type: "unconfigured" };

export const STATUS_LABELS: Record<OperationalStatus, string> = {
  loading: "Checking status...",
  operational: "All Systems Operational",
  degraded_performance: "Degraded Performance",
  partial_outage: "Partial Outage",
  major_outage: "Major Outage",
  unknown: "Status Unknown",
};

export const INDICATOR_TO_STATUS: Record<string, OperationalStatus> = {
  none: "operational",
  minor: "degraded_performance",
  major: "partial_outage",
  critical: "major_outage",
};

export const initialSystemStatusState: SystemStatusState = {
  current: {
    status: "loading",
    label: STATUS_LABELS.loading,
  },
  lastSuccessful: null,
  isRefreshing: false,
  isStale: false,
};

export function resolveSystemStatusSnapshot(
  data: StatusPageSummary,
): SystemStatusSnapshot {
  const indicator = data?.status?.indicator ?? "unknown";
  const status = INDICATOR_TO_STATUS[indicator] ?? "unknown";

  return {
    status,
    label: data?.status?.description ?? STATUS_LABELS[status],
  };
}

export function systemStatusReducer(
  state: SystemStatusState,
  action: SystemStatusAction,
): SystemStatusState {
  switch (action.type) {
    case "request":
      if (state.lastSuccessful) {
        return {
          ...state,
          current: state.lastSuccessful,
          isRefreshing: true,
          isStale: false,
        };
      }

      return {
        ...state,
        current: {
          status: "loading",
          label: STATUS_LABELS.loading,
        },
        isRefreshing: true,
        isStale: false,
      };
    case "success":
      return {
        current: action.snapshot,
        lastSuccessful: action.snapshot,
        isRefreshing: false,
        isStale: false,
      };
    case "failure":
      if (state.lastSuccessful) {
        return {
          current: state.lastSuccessful,
          lastSuccessful: state.lastSuccessful,
          isRefreshing: false,
          isStale: true,
        };
      }

      return {
        current: {
          status: "unknown",
          label: STATUS_LABELS.unknown,
        },
        lastSuccessful: null,
        isRefreshing: false,
        isStale: false,
      };
    case "unconfigured":
      return {
        current: {
          status: "unknown",
          label: STATUS_LABELS.unknown,
        },
        lastSuccessful: null,
        isRefreshing: false,
        isStale: false,
      };
    default:
      return state;
  }
}
