"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import WebhookLogSkeleton from "./WebhookLogSkeleton";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/Button";
import WebhookDetailModal, { WebhookLog } from "./WebhookDetailModal";
import {
  useHydrateMerchantStore,
  useMerchantApiKey,
  useMerchantHydrated,
} from "@/lib/merchant-store";



function statusClasses(statusCode: number) {
  if (statusCode >= 200 && statusCode < 300) {
    return "bg-green-500/20 text-green-300 border border-green-500/40";
  }
  if (statusCode >= 400) {
    return "bg-red-500/20 text-red-300 border border-red-500/40";
  }
  if (statusCode >= 300 && statusCode < 400) {
    return "bg-amber-500/15 text-amber-200 border border-amber-500/35";
  }
  return "bg-yellow-500/20 text-yellow-300 border border-yellow-500/40";
}

function isRetryable(log: WebhookLog) {
  return log.status_code >= 400;
}

/**
 * Client-side retry state for a single log row.
 * - "pending": optimistically shown while the bulk retry request is in flight.
 * - "queued": confirmed by the server; the row stays locked until the next refresh.
 */
export type RetryState = "pending" | "queued";

/** How long rolled-back rows stay highlighted after a failed retry. */
export const ROLLBACK_HIGHLIGHT_MS = 4000;

interface RollbackNotice {
  message: string;
  logIds: string[];
}

function describeRetryFailure(err: unknown) {
  // fetch() rejects with a TypeError when the network is unreachable.
  if (err instanceof TypeError) {
    return "Network error: the retry request could not reach the server.";
  }
  return err instanceof Error && err.message
    ? err.message
    : "Failed to queue bulk webhook retry";
}

export default function WebhookLogs() {
  useHydrateMerchantStore();

  const apiKey = useMerchantApiKey();
  const hydrated = useMerchantHydrated();

  const [logs, setLogs] = useState<WebhookLog[]>([]);
  const [selectedLogIds, setSelectedLogIds] = useState<string[]>([]);
  const [viewingLog, setViewingLog] = useState<WebhookLog | null>(null);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryStates, setRetryStates] = useState<Record<string, RetryState>>({});
  const [rollbackNotice, setRollbackNotice] = useState<RollbackNotice | null>(null);
  const [highlightedLogIds, setHighlightedLogIds] = useState<string[]>([]);
  const [liveMessage, setLiveMessage] = useState("");
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
    };
  }, []);

  const flashRolledBackRows = useCallback((logIds: string[]) => {
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    setHighlightedLogIds(logIds);
    highlightTimer.current = setTimeout(() => {
      setHighlightedLogIds([]);
      highlightTimer.current = null;
    }, ROLLBACK_HIGHLIGHT_MS);
  }, []);

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    if (!apiKey) {
      setLogs([]);
      setSelectedLogIds([]);
      setLoading(false);
      setError("Missing merchant API key. Reconnect your session to view webhook logs.");
      return;
    }

    const controller = new AbortController();

    const fetchLogs = async () => {
      setLoading(true);
      setError(null);

      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
        const response = await fetch(`${apiUrl}/api/webhook-logs?limit=50`, {
          signal: controller.signal,
          headers: {
            "x-api-key": apiKey,
          },
        });

        if (!response.ok) {
          throw new Error("Failed to fetch webhook logs");
        }

        const data = await response.json();
        const entries = data.logs ?? data.entries ?? [];
        setLogs(entries);
        setRetryStates({});
        setSelectedLogIds((current) =>
          current.filter((logId) =>
            entries.some((entry: WebhookLog) => entry.id === logId && isRetryable(entry)),
          ),
        );
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Failed to load webhook logs");
      } finally {
        setLoading(false);
      }
    };

    fetchLogs();

    return () => controller.abort();
  }, [apiKey, hydrated]);

  const retryableLogs = logs.filter(isRetryable);
  // Rows with an in-flight or queued retry cannot be selected again.
  const selectableLogs = retryableLogs.filter((log) => !retryStates[log.id]);
  const allRetryableSelected =
    selectableLogs.length > 0 && selectableLogs.every((log) => selectedLogIds.includes(log.id));
  const selectedRetryableCount = selectedLogIds.length;

  const toggleLogSelection = (logId: string) => {
    setSelectedLogIds((current) =>
      current.includes(logId)
        ? current.filter((id) => id !== logId)
        : [...current, logId],
    );
  };

  const toggleSelectAll = () => {
    if (allRetryableSelected) {
      setSelectedLogIds([]);
      return;
    }

    setSelectedLogIds(selectableLogs.map((log) => log.id));
  };

  /**
   * Queues retries for the given logs with an optimistic UI update.
   *
   * Rows flip to "Retrying…" immediately and the selection is cleared. If the
   * request fails (network error or non-2xx response) the previous retry
   * states and selection are restored exactly, the affected rows are
   * highlighted, and an inline alert offers to try again. On success, rows the
   * server skipped are rolled back individually while queued rows stay locked.
   */
  const handleBulkRetry = async (logIds: string[] = selectedLogIds) => {
    if (!apiKey || logIds.length === 0 || retrying) {
      return;
    }

    const previousRetryStates = retryStates;
    const previousSelection = selectedLogIds;

    setRetrying(true);
    setRollbackNotice(null);
    setRetryStates((current) => {
      const next = { ...current };
      logIds.forEach((id) => {
        next[id] = "pending";
      });
      return next;
    });
    setSelectedLogIds((current) => current.filter((id) => !logIds.includes(id)));
    setLiveMessage(
      logIds.length === 1
        ? "Retrying 1 webhook delivery."
        : `Retrying ${logIds.length} webhook deliveries.`,
    );

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
      const response = await fetch(`${apiUrl}/api/webhooks/retry-bulk`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify({ log_ids: logIds }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Failed to queue bulk webhook retry");
      }

      const queuedCount = Number(data.queued_count) || 0;
      const skippedCount = Number(data.skipped_count) || 0;
      const queuedIds: string[] = Array.isArray(data.queued_log_ids)
        ? data.queued_log_ids
        : skippedCount === 0
          ? logIds
          : [];

      setRetryStates((current) => {
        const next = { ...current };
        logIds.forEach((id) => {
          if (queuedIds.includes(id)) {
            next[id] = "queued";
          } else {
            delete next[id];
          }
        });
        return next;
      });

      if (queuedCount > 0) {
        toast.success(
          queuedCount === 1
            ? "1 webhook retry queued."
            : `${queuedCount} webhook retries queued.`,
        );
      }

      if (skippedCount > 0) {
        toast(
          skippedCount === 1
            ? "1 selected log was skipped."
            : `${skippedCount} selected logs were skipped.`,
        );
        flashRolledBackRows(logIds.filter((id) => !queuedIds.includes(id)));
      }

      setLiveMessage(
        `${queuedCount} queued${skippedCount > 0 ? `, ${skippedCount} skipped` : ""}.`,
      );
    } catch (err: unknown) {
      const message = describeRetryFailure(err);

      // Roll back to the exact pre-request snapshot.
      setRetryStates(previousRetryStates);
      setSelectedLogIds(previousSelection);
      setRollbackNotice({ message, logIds });
      flashRolledBackRows(logIds);
      setLiveMessage(`Retry failed. ${message} Your selection has been restored.`);
      toast.error(message);
    } finally {
      setRetrying(false);
    }
  };



  if (loading) {
    return <WebhookLogSkeleton />;
  }

  if (error) {
    return (
      <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-6 text-center">
        <p className="text-sm text-yellow-400">{error}</p>
        <p className="mt-2 text-xs text-slate-500">
          Ensure the backend exposes the authenticated webhook logs endpoint.
        </p>
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-8 text-center">
        <p className="text-sm text-slate-400">No webhook deliveries yet.</p>
        <p className="mt-1 text-xs text-slate-500">
          Delivery attempts will appear here once webhooks start firing.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-white">Bulk retry failed deliveries</p>
          <p className="mt-1 text-xs text-slate-400">
            {retryableLogs.length === 0
              ? "There are no failed webhook deliveries available for retry."
              : `${selectedRetryableCount} selected of ${retryableLogs.length} failed deliveries.`}
          </p>
        </div>

        <Button
          type="button"
          className="w-full sm:w-auto"
          onClick={() => handleBulkRetry()}
          disabled={selectedRetryableCount === 0 || retrying}
          isLoading={retrying}
        >
          Retry Selected
        </Button>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {liveMessage}
      </p>

      {rollbackNotice && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div>
            <p className="text-sm font-medium text-red-300">Retry not queued, changes rolled back</p>
            <p className="mt-1 text-xs text-red-200/80">
              {rollbackNotice.message} Your selection has been restored.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              className="flex-1 sm:flex-none"
              onClick={() => handleBulkRetry(rollbackNotice.logIds)}
              disabled={retrying}
            >
              Try again
            </Button>
            <button
              type="button"
              className="flex-1 rounded-xl px-4 py-2 text-sm font-medium text-red-200 transition-colors hover:bg-red-500/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 sm:flex-none"
              onClick={() => setRollbackNotice(null)}
              aria-label="Dismiss retry error"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full text-left text-sm" aria-label="Webhook delivery logs">
          <thead>
            <tr className="border-b border-white/10 bg-white/5">
              <th scope="col" className="px-4 py-3">
                <label className="flex items-center gap-3 font-mono text-xs uppercase tracking-wider text-slate-400">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-white/20 bg-transparent text-mint focus:ring-mint"
                    checked={allRetryableSelected}
                    disabled={selectableLogs.length === 0 || retrying}
                    onChange={toggleSelectAll}
                    aria-label="Select all failed webhook logs"
                  />
                  Select
                </label>
              </th>
              <th scope="col" className="px-4 py-3 font-mono text-xs uppercase tracking-wider text-slate-400">
                Status
              </th>
              <th scope="col" className="px-4 py-3 font-mono text-xs uppercase tracking-wider text-slate-400">
                Event
              </th>
              <th scope="col" className="hidden px-4 py-3 font-mono text-xs uppercase tracking-wider text-slate-400 sm:table-cell">
                Endpoint
              </th>
              <th scope="col" className="hidden px-4 py-3 font-mono text-xs uppercase tracking-wider text-slate-400 md:table-cell">
                Time
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {logs.map((log) => {
              const retryable = isRetryable(log);
              const selected = selectedLogIds.includes(log.id);
              const retryState = retryStates[log.id];
              const rolledBack = highlightedLogIds.includes(log.id);

              return (
                <tr
                  key={log.id}
                  tabIndex={0}
                  role="button"
                  aria-label={`View delivery detail for ${log.event ?? "webhook"} (HTTP ${log.status_code})`}
                  aria-busy={retryState === "pending" || undefined}
                  data-retry-state={retryState ?? (rolledBack ? "rolled-back" : undefined)}
                  className={`group cursor-pointer transition-colors duration-300 hover:bg-white/5 focus:outline-none focus-visible:bg-white/5 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-mint ${
                    rolledBack ? "bg-red-500/10 ring-1 ring-inset ring-red-500/40" : ""
                  } ${retryState === "pending" ? "opacity-70" : ""}`}
                  onClick={() => setViewingLog(log)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setViewingLog(log);
                    }
                  }}
                >
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-white/20 bg-transparent text-mint focus:ring-mint disabled:cursor-not-allowed disabled:opacity-40"
                      checked={selected}
                      disabled={!retryable || !!retryState || retrying}
                      onChange={() => toggleLogSelection(log.id)}
                      aria-label={`Select webhook log ${log.id}`}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${statusClasses(log.status_code)}`}>
                      {log.status_code}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-medium text-white">
                    <div className="flex flex-col gap-1">
                      <span>{log.event ?? "—"}</span>
                      {retryState === "pending" && (
                        <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-sky-500/40 bg-sky-500/15 px-2 py-0.5 text-xs font-medium text-sky-200">
                          <span
                            aria-hidden="true"
                            className="h-3 w-3 rounded-full border-2 border-sky-200/40 border-t-sky-200 motion-safe:animate-spin"
                          />
                          Retrying…
                        </span>
                      )}
                      {retryState === "queued" && (
                        <span className="inline-flex w-fit rounded-full border border-mint/40 bg-mint/15 px-2 py-0.5 text-xs font-medium text-mint">
                          Retry queued
                        </span>
                      )}
                      {!retryState && rolledBack && (
                        <span className="inline-flex w-fit rounded-full border border-red-500/40 bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-200">
                          Retry not queued
                        </span>
                      )}
                      {!retryable && (
                        <span className="text-xs text-slate-500">Successful deliveries do not need retries.</span>
                      )}
                    </div>
                  </td>
                  <td className="hidden px-4 py-3 text-slate-400 sm:table-cell">
                    {log.url}
                  </td>
                  <td className="hidden px-4 py-3 text-slate-400 md:table-cell">
                    {new Date(log.timestamp).toLocaleString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <WebhookDetailModal
        isOpen={!!viewingLog}
        onClose={() => setViewingLog(null)}
        log={viewingLog}
      />
    </div>
  );
}
