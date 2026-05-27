"use client";

import React, { useState, useEffect } from "react";
import AnalyticsCards from "@/components/AnalyticsCards";
import ActivityFeed from "@/components/ActivityFeed";
import DashboardSkeleton from "@/components/DashboardSkeleton";
import Link from "next/link";
import {
  useMerchantHydrated,
  useHydrateMerchantStore,
  useMerchantApiKey,
  useMerchantMetadata,
} from "@/lib/merchant-store";
import { useTranslations } from "next-intl";
import FirstApiKeyModal from "@/components/FirstApiKeyModal";
import WithdrawalModal from "@/components/WithdrawalModal";

export default function DashboardPage() {
  const t = useTranslations("Dashboard");
  const [isWithdrawOpen, setIsWithdrawOpen] = useState(false);
  const [isFirstKeyModalOpen, setIsFirstKeyModalOpen] = useState(false);
  const hydrated = useMerchantHydrated();
  const apiKey = useMerchantApiKey();
  const merchant = useMerchantMetadata();
  const [loading, setLoading] = useState(true);

  useHydrateMerchantStore();

  useEffect(() => {
    if (hydrated) {
      const timer = setTimeout(() => setLoading(false), 1000);
      return () => clearTimeout(timer);
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
    <div className="flex flex-col gap-10 animate-in fade-in duration-500">
      <header className="flex flex-col gap-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.4em] text-[#6B6B6B]">
          Overview
        </p>
        <h1 className="text-4xl font-bold text-[#0A0A0A] tracking-tight">
          {merchant?.business_name ?? t("title")}
        </h1>
        <p className="text-sm font-medium text-[#6B6B6B]">{t("description")}</p>
      </header>

      <div className="grid gap-10 lg:grid-cols-3">
        <div className="flex flex-col gap-10 lg:col-span-2">
          <section className="flex flex-col gap-4">
            <h2 className="text-xl font-semibold text-white">
              {t("businessOverview")}
            </h2>
            <AnalyticsCards />
          </section>

          <section className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-white">
                {t("liveConfirmations")}
              </h2>
              <Link
                href="/payments"
                className="text-sm text-mint hover:text-glow"
              >
                {t("viewAllPayments")}
              </Link>
            </div>
            <ActivityFeed />
          </section>
        </div>

        <aside className="flex flex-col gap-8">
          <section className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur">
            <h3 className="mb-4 text-lg font-semibold text-white">
              {t("quickActions")}
            </h3>

            <div className="flex flex-col gap-3">
              <Link
                href="/create"
                className="flex items-center gap-3 rounded-xl border border-[var(--pluto-200)] bg-[var(--pluto-50)] px-4 py-3 text-sm font-bold text-[var(--pluto-700)] transition-all hover:border-[var(--pluto-500)] hover:bg-[var(--pluto-500)] hover:text-white"
              >
                <svg
                  className="h-4 w-4 shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 4v16m8-8H4"
                  />
                </svg>
                {t("createPaymentLink")}
              </Link>

              <button
                onClick={() => setIsWithdrawOpen(true)}
                className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-slate-300 transition-all hover:bg-white/10 hover:text-white"
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
                    d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
                  />
                </svg>
                {t("withdrawFunds")}
              </button>

              <Link
                href="/settings"
                className="flex items-center gap-3 rounded-xl border border-[#E8E8E8] bg-[#F9F9F9] px-4 py-3 text-sm font-bold text-[#0A0A0A] transition-all hover:border-[#0A0A0A] hover:bg-[#0A0A0A] hover:text-white"
              >
                <svg
                  className="h-4 w-4 shrink-0"
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
                {t("settings")}
              </Link>

              <a
                href="/docs"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 rounded-xl border border-[#E8E8E8] bg-[#F9F9F9] px-4 py-3 text-sm font-bold text-[#0A0A0A] transition-all hover:border-[#0A0A0A] hover:bg-[#0A0A0A] hover:text-white"
              >
                <svg
                  className="h-4 w-4 shrink-0"
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
                {t("viewDocs")}
              </a>
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur">
            <h3 className="mb-3 text-lg font-semibold text-white">
              {t("development")}
            </h3>
            <div className="flex flex-col gap-3 text-sm text-slate-300">
              <Link href="/api-keys" className="hover:text-white">
                {t("apiKeysTip")}
              </Link>
              <Link href="/webhook-logs" className="hover:text-white">
                {t("webhookLogsTip")}
              </Link>
            </div>
          </section>
        </aside>
      </div>

      <FirstApiKeyModal
        isOpen={isFirstKeyModalOpen}
        onClose={() => setIsFirstKeyModalOpen(false)}
      />
      <WithdrawalModal
        isOpen={isWithdrawOpen}
        onClose={() => setIsWithdrawOpen(false)}
      />
    </div>
  );
}