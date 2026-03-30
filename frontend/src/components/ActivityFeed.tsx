"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { useLocale } from "next-intl";
import {
  useHydrateMerchantStore,
  useMerchantApiKey,
  useMerchantHydrated,
  useMerchantId,
} from "@/lib/merchant-store";
import { usePaymentSocket } from "@/lib/usePaymentSocket";
import {
  useDisplayPreferences,
  formatAmount,
} from "@/lib/display-preferences";

interface Payment {
  id: string;
  amount: number;
  asset: string;
  status: string;
  description: string | null;
  created_at: string;
}

export default function ActivityFeed() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const apiKey = useMerchantApiKey();
  const hydrated = useMerchantHydrated();
  const merchantId = useMerchantId();
  const locale = useLocale();
  const { hideCents } = useDisplayPreferences();

  useHydrateMerchantStore();

  const handleConfirmed = useCallback((event: { id: string; amount: number; asset: string; confirmed_at: string }) => {
    setPayments((prev) => {
      // If payment exists, update it to confirmed and move to top
      const exists = prev.find((p) => p.id === event.id);
      let updatedList = prev;
      
      if (exists) {
        updatedList = prev.map((p) => 
          p.id === event.id ? { ...p, status: "confirmed" } : p
        );
      } else {
        // Brand new payment arrived confirmed
        updatedList = [
          {
            id: event.id,
            amount: event.amount,
            asset: event.asset,
            status: "confirmed",
            description: "Real-time payment",
            created_at: event.confirmed_at,
          },
          ...prev,
        ];
      }
      
      // Sort to ensure highest items are top
      return updatedList
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 10);
    });
  }, []);

  usePaymentSocket(merchantId, handleConfirmed);

  useEffect(() => {
    if (!hydrated) return;
    const controller = new AbortController();

    const fetchPayments = async () => {
      try {
        if (!apiKey) {
          setError("API key not found.");
          setLoading(false);
          return;
        }

        const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
        const response = await fetch(`${apiUrl}/api/payments?limit=10`, {
          headers: { "x-api-key": apiKey },
          signal: controller.signal,
        });

        if (!response.ok) throw new Error("Failed to fetch payments");

        const data = await response.json();
        setPayments(data.payments ?? []);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Failed to load activity");
      } finally {
        setLoading(false);
      }
    };

    fetchPayments();
    return () => controller.abort();
  }, [apiKey, hydrated]);

  if (loading) {
    return (
      <div className="animate-pulse space-y-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-16 w-full rounded-xl bg-white/5" />
        ))}
      </div>
    );
  }

  if (error) {
    return <div className="rounded-xl border border-red-500/30 p-4 text-red-400">{error}</div>;
  }

  if (payments.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-12 text-center flex flex-col items-center justify-center">
        <h3 className="text-xl font-bold text-white mb-2">No transaction history</h3>
        <p className="text-slate-400 max-w-sm mb-6">
          Your live feed will populate here once you start receiving payments. Create a link to get started.
        </p>
        <Link
          href="/dashboard/create"
          className="rounded-full bg-mint px-6 py-3 text-sm font-bold text-black transition-all hover:bg-glow"
        >
          Create First Payment
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
      <div className="px-6 py-4 border-b border-white/5 bg-black/20 flex items-center justify-between">
        <h3 className="font-semibold text-white">Live Activity Feed</h3>
        <div className="flex items-center gap-2 text-xs font-mono text-mint">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-mint opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-mint"></span>
          </span>
          Listening for events...
        </div>
      </div>
      <div className="divide-y divide-white/5">
        <AnimatePresence initial={false}>
          {payments.map((payment) => (
            <motion.div
              key={payment.id}
              initial={{ height: 0, opacity: 0, backgroundColor: "rgba(94, 242, 192, 0.4)" }}
              animate={{ 
                height: "auto", 
                opacity: 1, 
                backgroundColor: "transparent",
                scale: [0.95, 1.02, 1]
              }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.6, ease: "easeOut" }}
              className="px-6 py-4 flex items-center justify-between hover:bg-white/[0.02] transition-colors"
            >
              <div className="flex items-center gap-4">
                <div className={`flex h-10 w-10 items-center justify-center rounded-full ${
                  payment.status === "confirmed" ? "bg-green-500/20 text-green-400" : 
                  payment.status === "pending" ? "bg-yellow-500/20 text-yellow-400" : 
                  "bg-slate-500/20 text-slate-400"
                }`}>
                  {payment.status === "confirmed" ? (
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  )}
                </div>
                <div>
                  <p className="font-medium text-white">{payment.description || "Stellar Payment"}</p>
                  <p className="text-xs text-slate-500">{new Date(payment.created_at).toLocaleString()}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="font-bold text-white">
                  {formatAmount(payment.amount, locale, hideCents)} {payment.asset}
                </p>
                <p className="text-xs font-mono text-slate-400 uppercase">{payment.status}</p>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
