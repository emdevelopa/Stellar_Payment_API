"use client";

import { useEffect, useState } from "react";

interface WebhookLog {
  id: string;
  status_code: number;
  event: string | null;
  url: string;
  created_at: string;
}

function statusClasses(statusCode: number) {
  if (statusCode >= 200 && statusCode < 300) {
    return "bg-green-500/20 text-green-300 border border-green-500/40";
  }
  if (statusCode >= 400 && statusCode < 500) {
    return "bg-red-500/20 text-red-300 border border-red-500/40";
  }
  return "bg-yellow-500/20 text-yellow-300 border border-yellow-500/40";
}

export default function WebhookLogs() {
  const [logs, setLogs] = useState<WebhookLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    const fetchLogs = async () => {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
        const response = await fetch(`${apiUrl}/api/webhook-logs`, {
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error("Failed to fetch webhook logs");
        }

        const data = await response.json();
        const entries = data.logs ?? data.entries ?? [];
        setLogs(entries);
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Failed to load webhook logs");
      } finally {
        setLoading(false);
      }
    };

    fetchLogs();

    return () => controller.abort();
  }, []);

  if (loading) {
    return (
      <div className="animate-pulse space-y-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-12 w-full rounded-lg bg-white/5" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-6 text-center">
        <p className="text-sm text-yellow-400">{error}</p>
        <p className="mt-2 text-xs text-slate-500">
          Ensure the backend exposes the webhook logs endpoint.
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
    <div className="overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-white/10 bg-white/5">
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
          {logs.map((log) => (
            <tr key={log.id} className="transition-colors hover:bg-white/5">
              <td className="px-4 py-3">
                <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${statusClasses(log.status_code)}`}>
                  {log.status_code}
                </span>
              </td>
              <td className="px-4 py-3 font-medium text-white">
                {log.event ?? "—"}
              </td>
              <td className="hidden px-4 py-3 text-slate-400 sm:table-cell">
                {log.url}
              </td>
              <td className="hidden px-4 py-3 text-slate-400 md:table-cell">
                {new Date(log.created_at).toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
