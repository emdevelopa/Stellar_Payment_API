"use client";

import { useState } from "react";
import PaymentMetrics from "@/components/PaymentMetrics";
import RecentPayments from "@/components/RecentPayments";
import DevSandbox from "@/components/DevSandbox";
import { motion, AnimatePresence } from "framer-motion";

type DashboardTab = "overview" | "sandbox";

export default function DashboardTabs() {
  const [activeTab, setActiveTab] = useState<DashboardTab>("overview");

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center gap-1 rounded-lg border border-[#E8E8E8] bg-[#F5F5F5] p-1 w-fit">
        <button
          type="button"
          onClick={() => setActiveTab("overview")}
          className={`relative rounded-md px-6 py-2 text-[10px] font-bold uppercase tracking-wider transition-all ${
            activeTab === "overview"
              ? "bg-white text-[#0A0A0A] shadow-sm"
              : "text-[#6B6B6B] hover:text-[#0A0A0A]"
          }`}
        >
          Overview
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("sandbox")}
          className={`relative rounded-md px-6 py-2 text-[10px] font-bold uppercase tracking-wider transition-all ${
            activeTab === "sandbox"
              ? "bg-white text-[#0A0A0A] shadow-sm"
              : "text-[#6B6B6B] hover:text-[#0A0A0A]"
          }`}
        >
          Dev Sandbox
        </button>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        >
          {activeTab === "overview" ? (
            <div className="flex flex-col gap-10">
              <section className="flex flex-col gap-6">
                <div className="flex flex-col gap-1">
                  <h2 className="text-sm font-bold text-[#0A0A0A] uppercase tracking-wider">
                    Payment Metrics
                  </h2>
                  <p className="text-xs font-medium text-[#6B6B6B]">
                    Track your payment volume and transaction activity over the past
                    7 days.
                  </p>
                </div>
                <PaymentMetrics />
              </section>

              <section className="flex flex-col gap-6">
                <div className="flex flex-col gap-1">
                  <h2 className="text-sm font-bold text-[#0A0A0A] uppercase tracking-wider">
                    Recent Payments
                  </h2>
                  <p className="text-xs font-medium text-[#6B6B6B]">
                    An overview of your latest payment activity.
                  </p>
                </div>
                <RecentPayments />
              </section>
            </div>
          ) : (
            <DevSandbox />
          )}
        </motion.div>
      </AnimatePresence>
    </section>
  );
}
