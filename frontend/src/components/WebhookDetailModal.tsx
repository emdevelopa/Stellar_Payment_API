"use client";

import React from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import CopyButton from "./CopyButton";

export interface WebhookLog {
  id: string;
  payment_id: string;
  status_code: number;
  event: string | null;
  url: string;
  request_payload: Record<string, unknown>;
  request_headers: Record<string, string> | null;
  response_body: string | null;
  timestamp: string;
}

interface WebhookDetailModalProps {
  log: WebhookLog | null;
  isOpen: boolean;
  onClose: () => void;
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

export default function WebhookDetailModal({
  log,
  isOpen,
  onClose,
}: WebhookDetailModalProps) {
  const generateCurl = (log: WebhookLog) => {
    const headers = log.request_headers || {};
    const payload = JSON.stringify(log.request_payload || {}, null, 2);

    let curl = `curl -X POST "${log.url}"`;
    Object.entries(headers).forEach(([key, value]) => {
      curl += ` \\\n  -H "${key}: ${value}"`;
    });
    curl += ` \\\n  -d '${payload}'`;
    return curl;
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Webhook Delivery Detail"
    >
      {log && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Event</p>
              <p className="text-sm font-semibold text-white">{log.event || "—"}</p>
            </div>
            <div className="text-right space-y-1">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Status</p>
              <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${statusClasses(log.status_code)}`}>
                HTTP {log.status_code}
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Endpoint</p>
            <code className="block rounded-lg border border-white/10 bg-black/40 p-2 text-xs text-slate-300 break-all">
              {log.url}
            </code>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-white">Payload (Request Body)</p>
              <div className="flex gap-2">
                <div className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2 py-1">
                  <span className="text-[10px] font-medium text-slate-400">cURL</span>
                  <CopyButton text={generateCurl(log)} />
                </div>
                <div className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2 py-1">
                  <span className="text-[10px] font-medium text-slate-400">JSON</span>
                  <CopyButton text={JSON.stringify(log.request_payload, null, 2)} />
                </div>
              </div>
            </div>
            <pre className="max-h-60 overflow-auto rounded-xl border border-white/10 bg-black/40 p-4 text-xs text-sky-300 font-mono ring-1 ring-inset ring-white/5">
              {JSON.stringify(log.request_payload || {}, null, 2)}
            </pre>
          </div>

          {log.response_body && (
            <div className="space-y-3">
              <p className="text-sm font-semibold text-white">Server Response</p>
              <div className="max-h-40 overflow-auto rounded-xl border border-white/10 bg-black/40 p-4 font-mono text-xs text-slate-400 ring-1 ring-inset ring-white/5">
                {log.response_body}
              </div>
            </div>
          )}

          <div className="pt-2">
            <Button
              variant="secondary"
              className="w-full text-slate-400"
              onClick={onClose}
            >
              Close
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
