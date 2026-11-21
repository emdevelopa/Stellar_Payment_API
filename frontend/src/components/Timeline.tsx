"use client";

import { memo, useCallback, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { TimelineDetailLog } from "./timeline/TimelineDetailPanel";
import type { PaymentLifecycleStep } from "./timeline/TimelineProgressStepper";

export type AuditLog = TimelineDetailLog;
export type { PaymentLifecycleStep };

// Code-split secondary timeline modules via dynamic imports to keep initial bundle minimal.
const TimelineDetailPanel = dynamic(
  () => import("./timeline/TimelineDetailPanel"),
  {
    ssr: false,
    loading: () => (
      <div
        role="status"
        aria-live="polite"
        className="mt-3 h-20 animate-pulse rounded-lg border border-gray-700/60 bg-gray-900/60 p-3 text-xs text-gray-400"
      >
        Loading ledger details...
      </div>
    ),
  },
);

const TimelineProgressStepper = dynamic(
  () => import("./timeline/TimelineProgressStepper"),
  {
    ssr: false,
    loading: () => (
      <div
        role="status"
        aria-live="polite"
        className="mb-6 h-10 animate-pulse rounded-lg bg-gray-800/60"
      />
    ),
  },
);

export interface TimelineProps {
  logs: AuditLog[];
  steps?: PaymentLifecycleStep[];
  showProgressStepper?: boolean;
  onSelectLog?: (log: AuditLog) => void;
}

const STATUS_DOT_STYLES: Record<NonNullable<AuditLog["status"]>, string> = {
  confirmed: "bg-emerald-500 ring-emerald-500/30",
  pending: "bg-amber-400 ring-amber-400/30",
  failed: "bg-red-500 ring-red-500/30",
};

function Timeline({
  logs,
  steps,
  showProgressStepper = false,
  onSelectLog,
}: TimelineProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggleExpanded = useCallback(
    (log: AuditLog) => {
      setExpandedId((prev) => (prev === log.id ? null : log.id));
      onSelectLog?.(log);
    },
    [onSelectLog],
  );

  const shouldRenderStepper = useMemo(
    () => Boolean(showProgressStepper && steps && steps.length > 0),
    [showProgressStepper, steps],
  );

  if (!logs || logs.length === 0) {
    return (
      <div
        role="status"
        className="py-10 text-center text-sm text-gray-400"
      >
        No activity yet
      </div>
    );
  }

  return (
    <section aria-label="Payment lifecycle timeline" className="w-full">
      {shouldRenderStepper && steps && (
        <TimelineProgressStepper steps={steps} />
      )}

      <ol className="relative space-y-6 border-l border-gray-700 pl-6">
        {logs.map((log) => {
          const isExpanded = expandedId === log.id;
          const dotStyle = log.status
            ? STATUS_DOT_STYLES[log.status]
            : "bg-blue-500 ring-blue-500/30";

          return (
            <li key={log.id} className="relative">
              {/* Confirmation indicator dot */}
              <span
                aria-hidden="true"
                className={`absolute -left-[30px] top-1.5 h-3 w-3 rounded-full ring-4 ${dotStyle}`}
              />

              {/* Event card */}
              <div className="rounded-lg border border-gray-700/60 bg-gray-800 p-4 transition-colors hover:border-gray-600">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="font-medium text-white">{log.action}</p>
                  <button
                    type="button"
                    onClick={() => toggleExpanded(log)}
                    aria-expanded={isExpanded}
                    aria-controls={`timeline-detail-${log.id}`}
                    className="rounded-md px-2 py-1 text-xs font-medium text-blue-400 transition-colors hover:bg-gray-700/70 hover:text-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  >
                    {isExpanded ? "Hide details" : "Inspect"}
                  </button>
                </div>

                {log.field_changed && (
                  <p className="mt-1 text-sm text-gray-300">
                    {log.field_changed}: {log.old_value} &rarr; {log.new_value}
                  </p>
                )}

                <time
                  dateTime={log.created_at}
                  className="mt-2 block text-xs text-gray-400"
                >
                  {new Date(log.created_at).toLocaleString()}
                </time>

                {isExpanded && (
                  <div id={`timeline-detail-${log.id}`}>
                    <TimelineDetailPanel
                      log={log}
                      onClose={() => setExpandedId(null)}
                    />
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export default memo(Timeline);
