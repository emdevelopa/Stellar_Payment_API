"use client";

import { useEffect, useReducer } from "react";
import type { OperationalStatus, StatusPageSummary } from "@/lib/system-status";
import {
  initialSystemStatusState,
  resolveSystemStatusSnapshot,
  systemStatusReducer,
} from "@/lib/system-status";

const DOT_COLORS: Record<OperationalStatus, string> = {
  loading: "bg-[#E8E8E8] animate-pulse",
  operational: "bg-green-500",
  degraded_performance: "bg-amber-400",
  partial_outage: "bg-orange-400",
  major_outage: "bg-red-500",
  unknown: "bg-[#E8E8E8]",
};

const TEXT_COLORS: Record<OperationalStatus, string> = {
  loading: "text-[#6B6B6B]",
  operational: "text-[#6B6B6B]",
  degraded_performance: "text-[#6B6B6B]",
  partial_outage: "text-[#6B6B6B]",
  major_outage: "text-[#6B6B6B]",
  unknown: "text-[#6B6B6B]",
};

/** Polling interval in milliseconds (2 minutes). */
const POLL_INTERVAL_MS = 2 * 60 * 1000;

export default function SystemStatus() {
  const [state, dispatch] = useReducer(
    systemStatusReducer,
    initialSystemStatusState,
  );
  const baseUrl = process.env.NEXT_PUBLIC_STATUS_PAGE_URL;

  useEffect(() => {
    if (!baseUrl) {
      dispatch({ type: "unconfigured" });
      return;
    }

    let mounted = true;

    async function poll() {
      if (mounted) {
        dispatch({ type: "request" });
      }

      try {
        const res = await fetch(`${baseUrl}/api/v2/summary.json`, {
          signal: AbortSignal.timeout(5_000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data: StatusPageSummary = await res.json();
        if (!mounted) return;

        dispatch({
          type: "success",
          snapshot: resolveSystemStatusSnapshot(data),
        });
      } catch {
        if (mounted) {
          dispatch({ type: "failure" });
        }
      }
    }

    void poll();
    const id = setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);

    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [baseUrl]);

  if (!baseUrl && state.current.status === "unknown") return null;

  const { status, label } = state.current;
  const ariaPrefix = state.isRefreshing
    ? "Refreshing system status"
    : state.isStale
      ? "Last known system status"
      : "System status";
  const pulseColor =
    status === "operational"
      ? "bg-green-500"
      : DOT_COLORS[status].split(" ")[0] ?? "bg-[#E8E8E8]";

  return (
    <a
      href={baseUrl ?? "#"}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${ariaPrefix}: ${label}`}
      className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest transition-colors hover:text-[#0A0A0A]"
    >
      <div className="relative flex h-2 w-2 items-center justify-center">
        <span
          className={`absolute inline-flex h-full w-full rounded-full opacity-20 ${pulseColor} ${state.isRefreshing ? "animate-ping" : ""}`}
        />
        <span
          className={`relative h-1.5 w-1.5 rounded-full ${DOT_COLORS[status]}`}
        />
      </div>
      <span className={TEXT_COLORS[status]}>
        {label}
        {state.isRefreshing ? " (Refreshing)" : ""}
      </span>
    </a>
  );
}
