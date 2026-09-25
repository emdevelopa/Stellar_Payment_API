"use client";

import { useState } from "react";
import RecentPayments from "@/components/RecentPayments";
import WebhookLogs from "@/components/WebhookLogs";

const tabs = [
  { id: "payments", label: "Payments" },
  { id: "logs", label: "Development Logs" },
];

export default function PaymentsTabs() {
  const [activeTab, setActiveTab] = useState("payments");

  return (
    <div className="flex flex-col gap-4">
      <div
        className="flex flex-wrap items-center gap-3"
        role="tablist"
        aria-label="Payments and development logs"
      >
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              id={`activity-tab-${tab.id}`}
              aria-controls={`activity-panel-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-full border px-4 py-1.5 text-xs font-semibold tracking-[0.18em] transition ${
                isActive
                  ? "border-mint/60 bg-mint/15 text-mint"
                  : "border-white/15 text-slate-300 hover:border-white/30 hover:text-white"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`activity-panel-${activeTab}`}
        aria-labelledby={`activity-tab-${activeTab}`}
      >
        {activeTab === "payments" ? <RecentPayments /> : <WebhookLogs />}
      </div>
    </div>
  );
}
