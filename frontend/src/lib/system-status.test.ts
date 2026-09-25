import { describe, expect, it } from "vitest";
import {
  initialSystemStatusState,
  resolveSystemStatusSnapshot,
  STATUS_LABELS,
  systemStatusReducer,
} from "./system-status";

describe("systemStatusReducer", () => {
  it("shows loading when the first poll starts without prior data", () => {
    expect(
      systemStatusReducer(initialSystemStatusState, {
        type: "request",
      }),
    ).toEqual({
      current: {
        status: "loading",
        label: STATUS_LABELS.loading,
      },
      lastSuccessful: null,
      isRefreshing: true,
      isStale: false,
    });
  });

  it("preserves the last successful snapshot during optimistic refresh", () => {
    const successState = systemStatusReducer(initialSystemStatusState, {
      type: "success",
      snapshot: {
        status: "operational",
        label: "All Systems Operational",
      },
    });

    expect(
      systemStatusReducer(successState, {
        type: "request",
      }),
    ).toEqual({
      current: {
        status: "operational",
        label: "All Systems Operational",
      },
      lastSuccessful: {
        status: "operational",
        label: "All Systems Operational",
      },
      isRefreshing: true,
      isStale: false,
    });
  });

  it("keeps the optimistic snapshot after a transient polling failure", () => {
    const successState = systemStatusReducer(initialSystemStatusState, {
      type: "success",
      snapshot: {
        status: "degraded_performance",
        label: "Degraded Performance",
      },
    });

    expect(
      systemStatusReducer(successState, {
        type: "failure",
      }),
    ).toEqual({
      current: {
        status: "degraded_performance",
        label: "Degraded Performance",
      },
      lastSuccessful: {
        status: "degraded_performance",
        label: "Degraded Performance",
      },
      isRefreshing: false,
      isStale: true,
    });
  });

  it("falls back to unknown only when no successful snapshot exists", () => {
    expect(
      systemStatusReducer(initialSystemStatusState, {
        type: "failure",
      }),
    ).toEqual({
      current: {
        status: "unknown",
        label: STATUS_LABELS.unknown,
      },
      lastSuccessful: null,
      isRefreshing: false,
      isStale: false,
    });
  });
});

describe("resolveSystemStatusSnapshot", () => {
  it("maps status page indicators into UI statuses", () => {
    expect(
      resolveSystemStatusSnapshot({
        page: { name: "Status" },
        status: {
          indicator: "minor",
          description: "Minor service degradation",
        },
      }),
    ).toEqual({
      status: "degraded_performance",
      label: "Minor service degradation",
    });
  });
});
