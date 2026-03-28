"use client";

import { useEffect, useState } from "react";

type OperationalStatus =
  | "loading"
  | "operational"
  | "degraded_performance"
  | "partial_outage"
  | "major_outage"
  | "unknown";

interface StatusPageSummary {
  status: { indicator: string; description: string };
  page: { name: string };
}

const STATUS_LABELS: Record<OperationalStatus, string> = {
  loading: "Checking status…",
  operational: "All Systems Operational",
  degraded_performance: "Degraded Performance",
  partial_outage: "Partial Outage",
  major_outage: "Major Outage",
  unknown: "Status Unknown",
};

const INDICATOR_TO_STATUS: Record<string, OperationalStatus> = {
  none: "operational",
  minor: "degraded_performance",
  major: "partial_outage",
  critical: "major_outage",
};

const DOT_COLORS: Record<OperationalStatus, string> = {
  loading: "bg-slate-500 animate-pulse",
  operational: "bg-emerald-400",
  degraded_performance: "bg-yellow-400",
  partial_outage: "bg-orange-400",
  major_outage: "bg-red-500 animate-pulse",
  unknown: "bg-slate-500",
};

const TEXT_COLORS: Record<OperationalStatus, string> = {
  loading: "text-slate-500",
  operational: "text-emerald-400",
  degraded_performance: "text-yellow-400",
  partial_outage: "text-orange-400",
  major_outage: "text-red-400",
  unknown: "text-slate-500",
};

/** Polling interval in milliseconds (2 minutes). */
const POLL_INTERVAL_MS = 2 * 60 * 1000;

/**
 * Displays a live system status dot + label sourced from an Atlassian
 * Statuspage (or compatible) API.
 *
 * Configuration:
 *   NEXT_PUBLIC_STATUS_PAGE_URL – base URL of the status page, e.g.
 *     "https://status.example.com".  The component calls
 *     `{url}/api/v2/summary.json`.
 *     When the env var is absent the widget renders nothing.
 */
export default function SystemStatus() {
  const [status, setStatus] = useState<OperationalStatus>("loading");
  const [label, setLabel] = useState<string>(STATUS_LABELS.loading);

  const baseUrl = process.env.NEXT_PUBLIC_STATUS_PAGE_URL;

  useEffect(() => {
    // No status page configured → silently skip.
    if (!baseUrl) {
      setStatus("unknown");
      setLabel(STATUS_LABELS.unknown);
      return;
    }

    let mounted = true;

    async function poll() {
      try {
        const res = await fetch(`${baseUrl}/api/v2/summary.json`, {
          // Short timeout so a slow status page never hangs the UI.
          signal: AbortSignal.timeout(5_000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data: StatusPageSummary = await res.json();
        if (!mounted) return;

        const indicator = data?.status?.indicator ?? "unknown";
        const resolved: OperationalStatus =
          INDICATOR_TO_STATUS[indicator] ?? "unknown";

        setStatus(resolved);
        setLabel(data?.status?.description ?? STATUS_LABELS[resolved]);
      } catch {
        if (mounted) {
          setStatus("unknown");
          setLabel(STATUS_LABELS.unknown);
        }
      }
    }

    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [baseUrl]);

  // No URL configured → render nothing.
  if (!baseUrl && status === "unknown") return null;

  return (
    <a
      href={baseUrl ?? "#"}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`System status: ${label}`}
      className="inline-flex items-center gap-1.5 text-xs transition-opacity hover:opacity-80"
    >
      <span
        className={`h-2 w-2 rounded-full flex-shrink-0 ${DOT_COLORS[status]}`}
        aria-hidden="true"
      />
      <span className={TEXT_COLORS[status]}>{label}</span>
    </a>
  );
}
