"use client";

import { useEffect, useState } from "react";
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
  if (statusCode >= 400 && statusCode < 500) {
    return "bg-red-500/20 text-red-300 border border-red-500/40";
  }
  return "bg-yellow-500/20 text-yellow-300 border border-yellow-500/40";
}

function isRetryable(log: WebhookLog) {
  return log.status_code >= 400;
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
        const response = await fetch(`${apiUrl}/api/webhook-logs`, {
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
  const allRetryableSelected =
    retryableLogs.length > 0 && retryableLogs.every((log) => selectedLogIds.includes(log.id));
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

    setSelectedLogIds(retryableLogs.map((log) => log.id));
  };

  const handleBulkRetry = async () => {
    if (!apiKey || selectedLogIds.length === 0) {
      return;
    }

    setRetrying(true);

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
      const response = await fetch(`${apiUrl}/api/webhooks/retry-bulk`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify({ log_ids: selectedLogIds }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Failed to queue bulk webhook retry");
      }

      const queuedCount = Number(data.queued_count) || 0;
      const skippedCount = Number(data.skipped_count) || 0;

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
      }

      setSelectedLogIds([]);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to queue bulk webhook retry";
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
          onClick={handleBulkRetry}
          disabled={selectedRetryableCount === 0}
          isLoading={retrying}
        >
          Retry Selected
        </Button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-white/10 bg-white/5">
              <th className="px-4 py-3">
                <label className="flex items-center gap-3 font-mono text-xs uppercase tracking-wider text-slate-400">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-white/20 bg-transparent text-mint focus:ring-mint"
                    checked={allRetryableSelected}
                    disabled={retryableLogs.length === 0}
                    onChange={toggleSelectAll}
                    aria-label="Select all failed webhook logs"
                  />
                  Select
                </label>
              </th>
              <th className="px-4 py-3 font-mono text-xs uppercase tracking-wider text-slate-400">
                Status
              </th>
              <th className="px-4 py-3 font-mono text-xs uppercase tracking-wider text-slate-400">
                Event
              </th>
              <th className="hidden px-4 py-3 font-mono text-xs uppercase tracking-wider text-slate-400 sm:table-cell">
                Endpoint
              </th>
              <th className="hidden px-4 py-3 font-mono text-xs uppercase tracking-wider text-slate-400 md:table-cell">
                Time
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {logs.map((log) => {
              const retryable = isRetryable(log);
              const selected = selectedLogIds.includes(log.id);

              return (
                <tr 
                  key={log.id} 
                  className="group transition-colors hover:bg-white/5 cursor-pointer"
                  onClick={() => setViewingLog(log)}
                >
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-white/20 bg-transparent text-mint focus:ring-mint disabled:cursor-not-allowed disabled:opacity-40"
                      checked={selected}
                      disabled={!retryable}
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
