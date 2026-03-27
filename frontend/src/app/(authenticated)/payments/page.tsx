"use client";

import React, { useState, useEffect } from "react";
import RecentPayments from "@/components/RecentPayments";
import Skeleton, { SkeletonTheme } from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";
import { useMerchantHydrated, useHydrateMerchantStore } from "@/lib/merchant-store";
import { useTranslations } from "next-intl";

function PaymentsSkeleton() {
  return (
    <SkeletonTheme baseColor="#1e293b" highlightColor="#334155">
      <div className="flex flex-col gap-8">
        <div>
          <Skeleton width={240} height={32} borderRadius={8} />
          <Skeleton width={400} height={20} borderRadius={4} className="mt-2" />
        </div>
        
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <Skeleton height={40} borderRadius={12} />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mt-4">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} height={40} borderRadius={12} />
              ))}
            </div>
          </div>
          
          <div className="overflow-x-auto rounded-xl border border-white/10">
            <div className="border-b border-white/10 bg-white/5 px-4 py-3">
              <div className="flex justify-between">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} width={80} height={14} borderRadius={4} />
                ))}
              </div>
            </div>
            <div className="divide-y divide-white/5">
              {[...Array(10)].map((_, i) => (
                <div key={i} className="px-4 py-4">
                  <div className="flex justify-between items-center">
                    <Skeleton width={70} height={24} borderRadius={999} />
                    <Skeleton width={100} height={20} borderRadius={4} />
                    <Skeleton width={120} height={16} borderRadius={4} className="hidden sm:block" />
                    <Skeleton width={80} height={16} borderRadius={4} className="hidden md:block" />
                    <Skeleton width={60} height={16} borderRadius={4} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </SkeletonTheme>
  );
}

export default function PaymentsPage() {
  const t = useTranslations("paymentsPage");
  const hydrated = useMerchantHydrated();
  const [loading, setLoading] = useState(true);

  useHydrateMerchantStore();

  useEffect(() => {
    if (hydrated) {
      const timer = setTimeout(() => setLoading(false), 800);
      return () => clearTimeout(timer);
    }
  }, [hydrated]);

  if (!hydrated || loading) {
    return <PaymentsSkeleton />;
  }

  return (
    <div className="flex flex-col gap-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold text-white">{t("title")}</h1>
        <p className="mt-2 text-slate-400">
          {t("description")}
        </p>
      </div>
      <RecentPayments showSkeleton={loading} />
    </div>
  );
}
