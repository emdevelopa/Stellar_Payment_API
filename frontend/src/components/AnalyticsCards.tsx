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
      <div className="grid gap-4 sm:grid-cols-3 animate-pulse">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-32 rounded-xl bg-white/5" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {/* Total Volume */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-6 backdrop-blur transition-all hover:bg-white/10">
        <p className="font-mono text-xs uppercase tracking-wider text-slate-400">
          Total Volume (7D)
        </p>
        <div className="mt-4 flex items-baseline gap-2">
          <p className="text-4xl font-bold text-mint">
            {formatAmount(totalVolume, locale, hideCents)}
          </p>
          <p className="text-sm text-slate-400">XLM/USDC</p>
        </div>
      </div>

      {/* Success Rate */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-6 backdrop-blur transition-all hover:bg-white/10">
        <p className="font-mono text-xs uppercase tracking-wider text-slate-400">
          Success Rate
        </p>
        <div className="mt-4 flex items-baseline gap-2">
          <p className="text-4xl font-bold text-white">{successRate.toFixed(1)}</p>
          <p className="text-sm text-slate-400">%</p>
        </div>
      </div>

      {/* Active Intents */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-6 backdrop-blur transition-all hover:bg-white/10">
        <p className="font-mono text-xs uppercase tracking-wider text-slate-400">
          Active Payment Intents
        </p>
        <div className="mt-4 flex items-baseline gap-2">
          <p className="text-4xl font-bold text-cyan-400">{activeIntents}</p>
          <p className="text-sm text-slate-400">pending</p>
        </div>
      </div>
    </div>
  );
}
