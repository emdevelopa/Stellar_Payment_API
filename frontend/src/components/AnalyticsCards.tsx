"use client";

import { useEffect, useState } from "react";
import { useLocale } from "next-intl";
import {
  useHydrateMerchantStore,
  useMerchantApiKey,
  useMerchantHydrated,
} from "@/lib/merchant-store";
import {
  useDisplayPreferences,
  formatAmount,
} from "@/lib/display-preferences";

interface MetricsResponse {
  total_volume: number;
}

interface Payment {
  id: string;
  status: string;
}

interface PaymentsResponse {
  payments: Payment[];
}

export default function AnalyticsCards() {
  const [totalVolume, setTotalVolume] = useState<number>(0);
  const [successRate, setSuccessRate] = useState<number>(0);
  const [activeIntents, setActiveIntents] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  
  const apiKey = useMerchantApiKey();
  const hydrated = useMerchantHydrated();
  const locale = useLocale();
  const { hideCents } = useDisplayPreferences();

  useHydrateMerchantStore();

  useEffect(() => {
    if (!hydrated || !apiKey) return;
    const controller = new AbortController();
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

    const fetchMetrics = async () => {
      try {
        const [metricsRes, paymentsRes] = await Promise.all([
          fetch(`${apiUrl}/api/metrics/7day`, {
            headers: { "x-api-key": apiKey },
            signal: controller.signal,
          }),
          fetch(`${apiUrl}/api/payments?limit=100`, {
            headers: { "x-api-key": apiKey },
            signal: controller.signal,
          })
        ]);

        if (metricsRes.ok && paymentsRes.ok) {
          const metricsData: MetricsResponse = await metricsRes.json();
          const paymentsData: PaymentsResponse = await paymentsRes.json();

          setTotalVolume(metricsData.total_volume);

          const payments = paymentsData.payments || [];
          const pending = payments.filter((p) => p.status === "pending").length;
          const confirmed = payments.filter((p) => p.status === "confirmed").length;
          const totalResolved = confirmed + payments.filter((p) => p.status === "failed" || p.status === "refunded").length;

          setActiveIntents(pending);
          setSuccessRate(totalResolved > 0 ? (confirmed / totalResolved) * 100 : 0);
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        console.error("Failed to fetch analytics", err);
      } finally {
        setLoading(false);
      }
    };

    fetchMetrics();
    return () => controller.abort();
  }, [apiKey, hydrated]);

  if (loading || !hydrated) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-32 rounded-lg bg-[#F5F5F5] animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {/* Total Volume */}
      <div className="min-w-0 overflow-hidden rounded-lg border border-[#E8E8E8] bg-white p-5 transition-all hover:bg-[#F9F9F9] sm:p-6">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="break-words text-[clamp(26px,8vw,48px)] font-bold leading-none tracking-tight text-[#0A0A0A]">
            {formatAmount(totalVolume, locale, hideCents)}
          </p>
          <p className="text-xs font-medium text-[#6B6B6B] uppercase tracking-wider">
            Total Volume (7D)
          </p>
        </div>
      </div>

      {/* Success Rate */}
      <div className="min-w-0 overflow-hidden rounded-lg border border-[#E8E8E8] bg-white p-5 transition-all hover:bg-[#F9F9F9] sm:p-6">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="break-words text-[clamp(26px,8vw,48px)] font-bold leading-none tracking-tight text-[#0A0A0A]">
            {successRate.toFixed(1)}%
          </p>
          <p className="text-xs font-medium text-[#6B6B6B] uppercase tracking-wider">
            Success Rate
          </p>
        </div>
      </div>

      {/* Active Intents */}
      <div className="min-w-0 overflow-hidden rounded-lg border border-[#E8E8E8] bg-white p-5 transition-all hover:bg-[#F9F9F9] sm:p-6">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="break-words text-[clamp(26px,8vw,48px)] font-bold leading-none tracking-tight text-[#0A0A0A]">
            {activeIntents}
          </p>
          <p className="text-xs font-medium text-[#6B6B6B] uppercase tracking-wider">
            Active intents
          </p>
        </div>
      </div>
    </div>
  );
}
