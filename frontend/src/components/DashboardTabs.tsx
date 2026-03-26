"use client";

import { useState } from "react";
import PaymentMetrics from "@/components/PaymentMetrics";
import RecentPayments from "@/components/RecentPayments";
import DevSandbox from "@/components/DevSandbox";

type DashboardTab = "overview" | "sandbox";

export default function DashboardTabs() {
  const [activeTab, setActiveTab] = useState<DashboardTab>("overview");

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/5 p-2">
        <button
          type="button"
          onClick={() => setActiveTab("overview")}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-all ${
            activeTab === "overview"
              ? "bg-white text-black"
              : "text-slate-300 hover:bg-white/10 hover:text-white"
          }`}
        >
          Dashboard
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("sandbox")}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-all ${
            activeTab === "sandbox"
              ? "bg-cyan-300 text-black"
              : "text-slate-300 hover:bg-white/10 hover:text-white"
          }`}
        >
          Dev Sandbox
        </button>
      </div>

      {activeTab === "overview" ? (
        <div className="flex flex-col gap-10">
          <section className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <h2 className="text-lg font-semibold text-white">
                Payment Metrics
              </h2>
              <p className="text-sm text-slate-300">
                Track your payment volume and transaction activity over the past
                7 days.
              </p>
            </div>
            <PaymentMetrics />
          </section>

          <section className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <h2 className="text-lg font-semibold text-white">
                Recent Payments
              </h2>
              <p className="text-sm text-slate-300">
                An overview of your latest payment activity.
              </p>
            </div>
            <RecentPayments />
          </section>
        </div>
      ) : (
        <DevSandbox />
      )}
    </section>
  );
}
