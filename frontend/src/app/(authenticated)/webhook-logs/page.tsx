"use client";

import WebhookLogs from "@/components/WebhookLogs";

export default function WebhookLogsPage() {
  return (
    <div className="flex flex-col gap-8 animate-in fade-in duration-500">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.4em] text-[#6B6B6B] mb-2">Logs</p>
        <h1 className="text-4xl font-bold text-[#0A0A0A] tracking-tight">Webhook Logs</h1>
        <p className="mt-2 text-sm font-medium text-[#6B6B6B]">
          Track the delivery status of payment confirmation webhooks.
        </p>
      </div>
      <WebhookLogs />
    </div>
  );
}
