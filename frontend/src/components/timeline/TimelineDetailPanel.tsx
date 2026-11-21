"use client";

import { memo, useState, useCallback } from "react";

export interface TimelineDetailLog {
  id: string;
  action: string;
  field_changed?: string;
  old_value?: string;
  new_value?: string;
  created_at: string;
  tx_hash?: string;
  ledger?: number;
  status?: "pending" | "confirmed" | "failed";
}

interface TimelineDetailPanelProps {
  log: TimelineDetailLog;
  onClose: () => void;
}

function TimelineDetailPanel({ log, onClose }: TimelineDetailPanelProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const payload = log.tx_hash ?? log.id;
    try {
      await navigator.clipboard?.writeText(payload);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }, [log.id, log.tx_hash]);

  return (
    <div
      role="region"
      aria-label={`Details for ${log.action}`}
      className="mt-3 rounded-lg border border-gray-700/80 bg-gray-900/90 p-3.5 text-xs text-gray-300 shadow-inner"
    >
      <div className="flex items-center justify-between gap-2 border-b border-gray-800 pb-2">
        <span className="font-semibold uppercase tracking-wider text-gray-400">
          Ledger Event Details
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleCopy}
            className="rounded px-2 py-1 text-[11px] font-medium text-blue-400 transition-colors hover:bg-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            {copied ? "Copied" : log.tx_hash ? "Copy Hash" : "Copy ID"}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close event details"
            className="rounded px-2 py-1 text-[11px] font-medium text-gray-400 transition-colors hover:bg-gray-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            Close
          </button>
        </div>
      </div>

      <dl className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <dt className="text-gray-500">Event ID</dt>
          <dd className="mt-0.5 break-all font-mono text-gray-200">{log.id}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Timestamp</dt>
          <dd className="mt-0.5 font-mono text-gray-200">
            {new Date(log.created_at).toISOString()}
          </dd>
        </div>
        {log.tx_hash && (
          <div className="sm:col-span-2">
            <dt className="text-gray-500">Stellar Transaction Hash</dt>
            <dd className="mt-0.5 break-all font-mono text-blue-300">
              {log.tx_hash}
            </dd>
          </div>
        )}
        {typeof log.ledger === "number" && (
          <div>
            <dt className="text-gray-500">Ledger Sequence</dt>
            <dd className="mt-0.5 font-mono text-gray-200">#{log.ledger}</dd>
          </div>
        )}
        {log.field_changed && (
          <div className="sm:col-span-2">
            <dt className="text-gray-500">State Transition ({log.field_changed})</dt>
            <dd className="mt-1 flex flex-wrap items-center gap-2 font-mono">
              <span className="rounded bg-red-950/60 px-1.5 py-0.5 text-red-300">
                {log.old_value ?? "empty"}
              </span>
              <span aria-hidden="true" className="text-gray-500">
                -&gt;
              </span>
              <span className="rounded bg-emerald-950/60 px-1.5 py-0.5 text-emerald-300">
                {log.new_value ?? "empty"}
              </span>
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}

export default memo(TimelineDetailPanel);
