"use client";

import React, { useState, useEffect } from "react";
import RecentPayments from "@/components/RecentPayments";
import { useMerchantHydrated, useHydrateMerchantStore } from "@/lib/merchant-store";
import { useTranslations } from "next-intl";
import Link from "next/link";

export default function PaymentsPage() {
  const t = useTranslations("paymentsPage");
  const hydrated = useMerchantHydrated();
  const [loading, setLoading] = useState(true);

  useHydrateMerchantStore();

  useEffect(() => {
    if (hydrated) {
      setLoading(false);
    }
  }, [hydrated]);

  return (
    <div className="flex flex-col gap-8 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.4em] text-[#6B6B6B] mb-2">Payments</p>
          <h1 className="text-4xl font-bold text-[#0A0A0A] tracking-tight">{t("title")}</h1>
          <p className="mt-2 text-sm font-medium text-[#6B6B6B]">{t("description")}</p>
        </div>
        <Link
          href="/create"
          className="inline-flex items-center gap-2 rounded-xl bg-[var(--pluto-500)] px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-white transition-all hover:bg-[var(--pluto-600)] active:scale-[0.98] shrink-0"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Payment
        </Link>
      </div>
      <RecentPayments showSkeleton={loading} />
    </div>
  );
}
