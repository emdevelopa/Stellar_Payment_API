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
      {/* Dashboard tab switcher: Payments vs Development Logs */}
      <div className="flex flex-wrap items-center gap-3">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
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

      {activeTab === "payments" ? <RecentPayments /> : <WebhookLogs />}
    </div>
  );
}
