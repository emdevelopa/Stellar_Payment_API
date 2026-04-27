"use client";

import React, { useState, useEffect } from "react";
import DashboardSkeleton from "@/components/DashboardSkeleton";
import Link from "next/link";
import {
  useMerchantHydrated,
  useHydrateMerchantStore,
  useMerchantApiKey,
} from "@/lib/merchant-store";
import FirstApiKeyModal from "@/components/FirstApiKeyModal";
import FirstPaymentCelebration from "@/components/FirstPaymentCelebration";
import PaymentMetrics from "@/components/PaymentMetrics";
import PaymentsTabs from "@/components/PaymentsTabs";

export default function DashboardPage() {
  const [isFirstKeyModalOpen, setIsFirstKeyModalOpen] = useState(false);
  const hydrated = useMerchantHydrated();
  const apiKey = useMerchantApiKey();
  const [loading, setLoading] = useState(true);

  useHydrateMerchantStore();

  useEffect(() => {
    if (hydrated) {
      setLoading(false);
    }
  }, [hydrated]);

  useEffect(() => {
    if (hydrated && !loading && !apiKey) {
      const timer = setTimeout(() => setIsFirstKeyModalOpen(true), 1500);
      return () => clearTimeout(timer);
    }
  }, [hydrated, loading, apiKey]);

  if (!hydrated || loading) return <DashboardSkeleton />;

  return (
    <div className="flex flex-col gap-12">
      {/* ── Welcome & Quick Actions ────────────────────────────────────────── */}
      <header className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-2">
          <h1 className="text-4xl font-bold tracking-tight text-white">
            Merchant Hub
          </h1>
          <p className="text-slate-400">
            Overview of your Stellar payment ecosystem and performance.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/dashboard/create"
            className="group relative flex items-center gap-2.5 overflow-hidden rounded-xl bg-mint px-5 py-3 text-sm font-bold text-black transition-all hover:scale-[1.02] hover:bg-glow"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d="M12 4v16m8-8H4"
              />
            </svg>
            Create Link
            <div className="absolute inset-0 -z-10 bg-white/20 opacity-0 transition-opacity group-hover:opacity-100" />
          </Link>

          <Link
            href="/docs"
            className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-medium text-slate-300 transition-all hover:bg-white/10 hover:text-white"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
              />
            </svg>
            View Docs
          </Link>

          <Link
            href="/settings"
            className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-medium text-slate-300 transition-all hover:bg-white/10 hover:text-white"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
            Settings
          </Link>
        </div>
      </header>

      {/* ── Main Dashboard Content ────────────────────────────────────────── */}
      <div className="grid gap-10">
        {/* Performance Metrics Section */}
        <section className="flex flex-col gap-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-white">Performance</h2>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="h-2 w-2 rounded-full bg-mint animate-pulse" />
              Live monitoring active
            </div>
          </div>
          <PaymentMetrics />
        </section>

        {/* Payments + webhook delivery logs */}
        <section className="flex flex-col gap-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-white">Activity</h2>
              <p className="mt-1 text-sm text-slate-500">
                Recent payments and webhook delivery attempts (status codes) for your integrations.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/payments"
                className="group flex items-center gap-1.5 text-sm text-mint hover:text-glow transition-all"
              >
                View all payments
                <svg
                  className="h-4 w-4 transition-transform group-hover:translate-x-1"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M14 5l7 7-7 7"
                  />
                </svg>
              </Link>
              <Link
                href="/webhook-logs"
                className="group flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-all"
              >
                Full webhook history
                <svg
                  className="h-4 w-4 transition-transform group-hover:translate-x-1"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M14 5l7 7-7 7"
                  />
                </svg>
              </Link>
            </div>
          </div>
          <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
            <PaymentsTabs />
          </div>
        </section>
      </div>

      <FirstApiKeyModal
        isOpen={isFirstKeyModalOpen}
        onClose={() => setIsFirstKeyModalOpen(false)}
      />
      <FirstPaymentCelebration />
    </div>
  );
}
