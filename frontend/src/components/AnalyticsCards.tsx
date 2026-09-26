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
import { Modal } from "./ui/Modal";

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

interface CardDetail {
  id: string;
  label: string;
  value: string;
  description: string;
}

export default function AnalyticsCards() {
  const [totalVolume, setTotalVolume] = useState<number>(0);
  const [successRate, setSuccessRate] = useState<number>(0);
  const [activeIntents, setActiveIntents] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [openCardId, setOpenCardId] = useState<string | null>(null);

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

  const cards: CardDetail[] = [
    {
      id: "total-volume",
      label: "Total Volume (7D)",
      value: formatAmount(totalVolume, locale, hideCents),
      description: "Total payment volume processed across all confirmed transactions in the last 7 days.",
    },
    {
      id: "success-rate",
      label: "Success Rate",
      value: `${successRate.toFixed(1)}%`,
      description: "Share of resolved payments (confirmed vs. confirmed + failed/refunded) in the last 7 days. Pending payments aren't counted until they resolve.",
    },
    {
      id: "active-intents",
      label: "Active intents",
      value: String(activeIntents),
      description: "Payments currently awaiting confirmation. These are not yet counted in the success rate above.",
    },
  ];

  const openCard = cards.find((c) => c.id === openCardId) ?? null;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map((card) => (
        <button
          key={card.id}
          type="button"
          onClick={() => setOpenCardId(card.id)}
          className="min-w-0 overflow-hidden rounded-lg border border-[#E8E8E8] bg-white p-5 text-left transition-all hover:bg-[#F9F9F9] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#0A0A0A] sm:p-6"
          aria-haspopup="dialog"
        >
          <div className="flex min-w-0 flex-col gap-1">
            <p className="break-words text-[clamp(26px,8vw,48px)] font-bold leading-none tracking-tight text-[#0A0A0A]">
              {card.value}
            </p>
            <p className="text-xs font-medium text-[#6B6B6B] uppercase tracking-wider">
              {card.label}
            </p>
          </div>
        </button>
      ))}

      <Modal
        isOpen={openCard !== null}
        onClose={() => setOpenCardId(null)}
        title={openCard?.label ?? ""}
      >
        {openCard && (
          <div className="flex flex-col gap-3">
            <p className="text-3xl font-bold tracking-tight">{openCard.value}</p>
            <p className="text-sm text-slate-300">{openCard.description}</p>
          </div>
        )}
      </Modal>
    </div>
  );
}
