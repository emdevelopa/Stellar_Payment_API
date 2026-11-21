"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export type TimelineStepStatus = "pending" | "confirmed" | "failed" | "synced";

export interface AuditLog {
  id: string;
  action: string;
  field_changed?: string;
  old_value?: string;
  new_value?: string;
  created_at: string;
  status?: TimelineStepStatus;
  optimistic?: boolean;
  tx_hash?: string;
  ledger_sequence?: number;
}

export interface TimelineProps {
  logs: AuditLog[];
  /**
   * Optional async handler invoked when retrying a failed or pending lifecycle step.
   * On rejection, the timeline rolls back to the pre-optimistic snapshot and shows a toast.
   */
  onRetryStep?: (log: AuditLog) => Promise<void>;
  /**
   * Optional async handler invoked when transitioning a step's lifecycle status.
   * On rejection, the timeline rolls back to the pre-optimistic snapshot and shows a toast.
   */
  onSyncStatus?: (logId: string, nextStatus: TimelineStepStatus) => Promise<void>;
  /**
   * Optional async handler for optimistically appending a new lifecycle event.
   * On rejection, the optimistic entry is removed and a toast notification is shown.
   */
  onAddEvent?: (
    event: Omit<AuditLog, "id" | "created_at">,
  ) => Promise<AuditLog | void>;
  /** Optional callback fired whenever an optimistic update rolls back due to network failure. */
  onRollback?: (error: Error, previousLogs: AuditLog[]) => void;
}

const STATUS_DOT_STYLES: Record<TimelineStepStatus, string> = {
  confirmed: "bg-emerald-500 ring-2 ring-emerald-500/30",
  synced: "bg-emerald-500 ring-2 ring-emerald-500/30",
  pending: "bg-amber-400 animate-pulse ring-2 ring-amber-400/30",
  failed: "bg-rose-500 ring-2 ring-rose-500/30",
};

const STATUS_BADGE_STYLES: Record<TimelineStepStatus, string> = {
  confirmed: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  synced: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  pending: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  failed: "bg-rose-500/15 text-rose-300 border-rose-500/30",
};

export default function Timeline({
  logs,
  onRetryStep,
  onSyncStatus,
  onAddEvent,
  onRollback,
}: TimelineProps) {
  const [optimisticLogs, setOptimisticLogs] = useState<AuditLog[]>(logs ?? []);
  const [pendingIds, setPendingIds] = useState<Record<string, boolean>>({});
  const [statusAnnouncement, setStatusAnnouncement] = useState<string>("");
  const logsRef = useRef<AuditLog[]>(logs ?? []);

  useEffect(() => {
    const next = logs ?? [];
    setOptimisticLogs(next);
    logsRef.current = next;
  }, [logs]);

  const setItemPending = useCallback((id: string, isPending: boolean) => {
    setPendingIds((prev) => {
      if (isPending) {
        return { ...prev, [id]: true };
      }
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const handleRetryStep = useCallback(
    async (log: AuditLog) => {
      if (!onRetryStep) return;

      const previousLogs = logsRef.current;
      const nextLogs = previousLogs.map((item) =>
        item.id === log.id
          ? { ...item, status: "pending" as const, optimistic: true }
          : item,
      );

      setOptimisticLogs(nextLogs);
      logsRef.current = nextLogs;
      setItemPending(log.id, true);
      setStatusAnnouncement(`Retrying ${log.action}…`);

      try {
        await onRetryStep(log);
        const confirmedLogs = logsRef.current.map((item) =>
          item.id === log.id
            ? { ...item, status: "confirmed" as const, optimistic: false }
            : item,
        );
        setOptimisticLogs(confirmedLogs);
        logsRef.current = confirmedLogs;
        setStatusAnnouncement(`${log.action} confirmed.`);
        toast.success(`"${log.action}" confirmed on Stellar ledger.`);
      } catch (error) {
        const err =
          error instanceof Error
            ? error
            : new Error("Network failure while updating timeline step.");

        setOptimisticLogs(previousLogs);
        logsRef.current = previousLogs;
        setStatusAnnouncement(
          `Failed to update ${log.action}. Reverted to previous state.`,
        );
        onRollback?.(err, previousLogs);

        toast.error(
          err.message || "Network failure. Reverted timeline step.",
          {
            description: `Could not complete "${log.action}". Previous state restored.`,
            action: {
              label: "Retry",
              onClick: () => {
                void handleRetryStep(log);
              },
            },
          },
        );
      } finally {
        setItemPending(log.id, false);
      }
    },
    [onRetryStep, onRollback, setItemPending],
  );

  const handleSyncStatus = useCallback(
    async (log: AuditLog, nextStatus: TimelineStepStatus) => {
      if (!onSyncStatus) return;

      const previousLogs = logsRef.current;
      const nextLogs = previousLogs.map((item) =>
        item.id === log.id
          ? { ...item, status: nextStatus, optimistic: true }
          : item,
      );

      setOptimisticLogs(nextLogs);
      logsRef.current = nextLogs;
      setItemPending(log.id, true);
      setStatusAnnouncement(`Updating ${log.action} to ${nextStatus}…`);

      try {
        await onSyncStatus(log.id, nextStatus);
        const committedLogs = logsRef.current.map((item) =>
          item.id === log.id ? { ...item, optimistic: false } : item,
        );
        setOptimisticLogs(committedLogs);
        logsRef.current = committedLogs;
        setStatusAnnouncement(`${log.action} updated to ${nextStatus}.`);
      } catch (error) {
        const err =
          error instanceof Error
            ? error
            : new Error("Network failure while syncing lifecycle status.");

        setOptimisticLogs(previousLogs);
        logsRef.current = previousLogs;
        setStatusAnnouncement(
          `Failed to sync ${log.action}. Reverted to previous state.`,
        );
        onRollback?.(err, previousLogs);

        toast.error(
          err.message || "Network failure. Reverted lifecycle status.",
          {
            description: `Could not update "${log.action}" to ${nextStatus}.`,
            action: {
              label: "Retry",
              onClick: () => {
                void handleSyncStatus(log, nextStatus);
              },
            },
          },
        );
      } finally {
        setItemPending(log.id, false);
      }
    },
    [onSyncStatus, onRollback, setItemPending],
  );

  const handleAddEvent = useCallback(
    async (event: Omit<AuditLog, "id" | "created_at">) => {
      if (!onAddEvent) return;

      const previousLogs = logsRef.current;
      const tempId = `optimistic-${Date.now()}`;
      const optimisticEntry: AuditLog = {
        ...event,
        id: tempId,
        created_at: new Date().toISOString(),
        status: event.status ?? "pending",
        optimistic: true,
      };

      const nextLogs = [optimisticEntry, ...previousLogs];
      setOptimisticLogs(nextLogs);
      logsRef.current = nextLogs;
      setItemPending(tempId, true);
      setStatusAnnouncement(`Adding ${event.action}…`);

      try {
        const created = await onAddEvent(event);
        const finalizedLogs = logsRef.current.map((item) =>
          item.id === tempId
            ? {
                ...(created ?? item),
                status: created?.status ?? "confirmed",
                optimistic: false,
              }
            : item,
        );
        setOptimisticLogs(finalizedLogs);
        logsRef.current = finalizedLogs;
        setStatusAnnouncement(`${event.action} recorded.`);
      } catch (error) {
        const err =
          error instanceof Error
            ? error
            : new Error("Network failure while recording timeline event.");

        setOptimisticLogs(previousLogs);
        logsRef.current = previousLogs;
        setStatusAnnouncement(
          `Failed to record ${event.action}. Reverted timeline.`,
        );
        onRollback?.(err, previousLogs);

        toast.error(
          err.message || "Network failure. Reverted timeline event.",
          {
            description: `Could not record "${event.action}".`,
          },
        );
      } finally {
        setItemPending(tempId, false);
      }
    },
    [onAddEvent, onRollback, setItemPending],
  );

  if (!optimisticLogs || optimisticLogs.length === 0) {
    return (
      <div className="text-gray-400 text-center py-10">
        No activity yet
      </div>
    );
  }

  return (
    <div className="relative" aria-label="Stellar ledger payment lifecycle timeline">
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {statusAnnouncement}
      </div>

      <ol
        role="list"
        className="relative border-l border-gray-700 pl-6 space-y-6"
      >
        {optimisticLogs.map((log) => {
          const isPending = Boolean(pendingIds[log.id] || log.optimistic);
          const status = log.status;
          const dotClass = status
            ? STATUS_DOT_STYLES[status]
            : "bg-blue-500";

          return (
            <li
              key={log.id}
              className="relative"
              aria-busy={isPending}
              data-optimistic={isPending ? "true" : "false"}
            >
              {/* Status Dot */}
              <div
                className={`absolute -left-3 top-1 w-3 h-3 rounded-full transition-colors ${dotClass}`}
                aria-hidden="true"
              />

              {/* Content Card */}
              <div
                className={`bg-gray-800 rounded-lg p-4 border transition-all ${
                  isPending
                    ? "border-dashed border-amber-400/60 opacity-85"
                    : "border-transparent"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-white font-medium">{log.action}</p>

                  <div className="flex items-center gap-2">
                    {status && (
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${STATUS_BADGE_STYLES[status]}`}
                      >
                        {isPending ? "Syncing…" : status}
                      </span>
                    )}

                    {onRetryStep && status === "failed" && (
                      <button
                        type="button"
                        onClick={() => void handleRetryStep(log)}
                        disabled={isPending}
                        aria-label={`Retry ${log.action}`}
                        className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50 transition-colors"
                      >
                        Retry
                      </button>
                    )}

                    {onSyncStatus && status === "pending" && !isPending && (
                      <button
                        type="button"
                        onClick={() => void handleSyncStatus(log, "confirmed")}
                        aria-label={`Confirm ${log.action}`}
                        className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-400 transition-colors"
                      >
                        Confirm
                      </button>
                    )}
                  </div>
                </div>

                {log.field_changed && (
                  <p className="text-gray-400 text-sm mt-1">
                    {log.field_changed}: {log.old_value} → {log.new_value}
                  </p>
                )}

                {log.ledger_sequence !== undefined && (
                  <p className="text-gray-400 text-xs mt-1 font-mono">
                    Ledger #{log.ledger_sequence}
                  </p>
                )}

                <p className="text-gray-500 text-xs mt-2">
                  {new Date(log.created_at).toLocaleString()}
                </p>
              </div>
            </li>
          );
        })}
      </ol>

      {onAddEvent && (
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={() =>
              void handleAddEvent({
                action: "Manual ledger sync",
                status: "pending",
              })
            }
            className="rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400 transition-colors"
          >
            Record sync check
          </button>
        </div>
      )}
    </div>
  );
}
