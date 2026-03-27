"use client";

import WebhookLogs from "@/components/WebhookLogs";

export default function WebhookLogsPage() {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-bold text-white">Webhook Logs</h1>
        <p className="mt-2 text-slate-400">
          Track the delivery status of payment confirmation webhooks.
        </p>
      </div>
      <WebhookLogs />
    </div>
  );
}
