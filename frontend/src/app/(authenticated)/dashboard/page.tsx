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
import { toast } from "sonner";
import FirstApiKeyModal from "@/components/FirstApiKeyModal";
import FirstPaymentCelebration from "@/components/FirstPaymentCelebration";

const ONBOARDING_WELCOME_KEY = "merchant_onboarding_welcome";

export default function DashboardPage() {
  const t = useTranslations("dashboardPage");
  const [isFirstKeyModalOpen, setIsFirstKeyModalOpen] = useState(false);
  const hydrated = useMerchantHydrated();
  const apiKey = useMerchantApiKey();
  const merchant = useMerchantMetadata();
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

  useEffect(() => {
    if (!hydrated || loading || typeof window === "undefined") return;
    if (sessionStorage.getItem(ONBOARDING_WELCOME_KEY) !== "true") return;

    sessionStorage.removeItem(ONBOARDING_WELCOME_KEY);
    toast.success("Welcome to your dashboard. Create your first payment when you are ready.", {
      action: {
        label: "Create payment",
        onClick: () => {
          window.location.href = "/create";
        },
      },
    });
  }, [hydrated, loading]);

  if (!hydrated || loading) return <DashboardSkeleton />;

  return (
    <div className="flex flex-col gap-10 animate-in fade-in duration-500">
      {/* Header */}
      <header className="flex flex-col gap-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.4em] text-[#6B6B6B]">Overview</p>
        <h1 className="text-4xl font-bold text-[#0A0A0A] tracking-tight">
          {merchant?.business_name ?? t("title")}
        </h1>
        <p className="text-sm font-medium text-[#6B6B6B]">{t("description")}</p>
      </header>

      <div className="grid gap-10 lg:grid-cols-3">
        {/* Left: Metrics + Activity */}
        <div className="flex flex-col gap-10 lg:col-span-2">
          <section className="flex flex-col gap-4">
            <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B6B6B]">Business Overview</h2>
            <AnalyticsCards />
          </section>

          <section className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B6B6B]">Recent Activity</h2>
              <Link href="/payment-history" className="text-[10px] font-bold uppercase tracking-widest text-[#0A0A0A] underline underline-offset-4 hover:text-[#6B6B6B] transition-colors">
                {t("viewAllPayments")} →
              </Link>
            </div>
            <ActivityFeed />
          </section>
        </div>

        {/* Right: Quick Actions */}
        <aside className="flex flex-col gap-6">
          <section className="rounded-2xl border border-[#E8E8E8] bg-white p-6">
            <h3 className="mb-5 text-xs font-bold uppercase tracking-[0.2em] text-[#6B6B6B]">{t("quickActions")}</h3>
            <div className="flex flex-col gap-2">
              <Link
                href="/create"
                className="flex items-center gap-3 rounded-xl border border-[var(--pluto-200)] bg-[var(--pluto-50)] px-4 py-3 text-sm font-bold text-[var(--pluto-700)] transition-all hover:bg-[var(--pluto-500)] hover:text-white hover:border-[var(--pluto-500)]"
              >
                <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                {t("createPaymentLink")}
              </Link>
              <Link
                href="/settings"
                className="flex items-center gap-3 rounded-xl border border-[#E8E8E8] bg-[#F9F9F9] px-4 py-3 text-sm font-bold text-[#0A0A0A] transition-all hover:bg-[#0A0A0A] hover:text-white hover:border-[#0A0A0A]"
              >
                <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Settings
              </Link>
              <a
                href="/docs"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 rounded-xl border border-[#E8E8E8] bg-[#F9F9F9] px-4 py-3 text-sm font-bold text-[#0A0A0A] transition-all hover:bg-[#0A0A0A] hover:text-white hover:border-[#0A0A0A]"
              >
                <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
                API Docs
              </a>
            </div>
          </section>

          <section className="rounded-2xl border border-[#E8E8E8] bg-white p-6">
            <h3 className="mb-4 text-xs font-bold uppercase tracking-[0.2em] text-[#6B6B6B]">{t("development")}</h3>
            <div className="flex flex-col gap-4 text-sm text-[#6B6B6B]">
              <div className="flex items-start gap-3">
                <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#0A0A0A]" />
                <p>{t("apiKeysTip")}</p>
              </div>
              <div className="flex items-start gap-3">
                <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#0A0A0A]" />
                <p>{t("webhookLogsTip")}</p>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-[#E8E8E8] bg-white p-6">
            <h3 className="mb-4 text-xs font-bold uppercase tracking-[0.2em] text-[#6B6B6B]">API Endpoint</h3>
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 rounded-xl border border-[#E8E8E8] bg-[#F9F9F9] px-4 py-3">
                <code className="flex-1 truncate font-mono text-xs text-[#0A0A0A]">https://pluto-api.up.railway.app/api</code>
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText("https://pluto-api.up.railway.app/api")}
                  className="rounded-lg border border-[#E8E8E8] bg-white p-1.5 text-[#6B6B6B] hover:text-[#0A0A0A] transition-colors"
                  title="Copy API URL"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                </button>
              </div>
              <p className="text-[10px] text-[#6B6B6B]">Use this base URL for all subscription and x402 API requests.</p>
            </div>
          </section>

          <section className="rounded-2xl border border-[#E8E8E8] bg-white p-6">
            <h3 className="mb-4 text-xs font-bold uppercase tracking-[0.2em] text-[#6B6B6B]">x402 Integration</h3>
            <p className="mb-4 text-xs text-[#6B6B6B]">
              Build pay-per-request flows with the production x402 setup guide.
            </p>
            <div className="flex flex-col gap-2">
              <Link
                href="/docs/x402-agentic-payments"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between rounded-xl border border-[var(--pluto-200)] bg-[var(--pluto-50)] px-4 py-3 text-sm font-bold text-[var(--pluto-700)] transition-colors hover:bg-[var(--pluto-100)]"
              >
                <span>Open x402 Integration Guide</span>
                <span className="text-[10px] uppercase tracking-widest text-[var(--pluto-600)]">Docs</span>
              </Link>
            </div>
          </section>
        </aside>
      </div>

      <FirstApiKeyModal isOpen={isFirstKeyModalOpen} onClose={() => setIsFirstKeyModalOpen(false)} />
      <FirstPaymentCelebration />
    </div>
  );
}
