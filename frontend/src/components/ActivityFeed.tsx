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
      <div className="space-y-4 animate-pulse">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-16 w-full rounded-lg bg-[#F5F5F5]" />
        ))}
      </div>
    );
  }

  if (error) {
    return <div className="rounded-xl border border-red-500/30 p-4 text-red-400">{error}</div>;
  }

  if (payments.length === 0) {
    return (
      <div className="rounded-lg border border-[#E8E8E8] bg-[#F9F9F9] p-16 text-center flex flex-col items-center justify-center">
        <h3 className="text-xl font-bold text-[#0A0A0A] mb-3">No activity detected</h3>
        <p className="text-[#6B6B6B] max-w-sm mb-8 font-medium">
          Your live feed will populate here once you start receiving payments. Create a link to get started.
        </p>
        <Link
          href="/dashboard/create"
          className="rounded-[6px] bg-[#0A0A0A] px-6 py-3 text-sm font-semibold text-white transition-all hover:bg-[#222]"
        >
          Create First Payment
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[#E8E8E8] bg-white overflow-hidden">
      <div className="px-6 py-4 border-b border-[#E8E8E8] bg-[#0A0A0A] flex items-center justify-between">
        <h3 className="font-semibold text-white text-sm">Live Activity Feed</h3>
        <div className="flex items-center gap-2 text-[10px] font-bold text-white/70 uppercase tracking-widest">
          <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
          Live
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-[#F9F9F9] border-b border-[#E8E8E8]">
              <th className="px-6 py-3 text-[11px] font-bold text-[#6B6B6B] uppercase tracking-wider">Status</th>
              <th className="px-6 py-3 text-[11px] font-bold text-[#6B6B6B] uppercase tracking-wider">Description</th>
              <th className="px-6 py-3 text-[11px] font-bold text-[#6B6B6B] uppercase tracking-wider">Date</th>
              <th className="px-6 py-3 text-right text-[11px] font-bold text-[#6B6B6B] uppercase tracking-wider">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E8E8E8]">
            {payments.map((payment, i) => (
              <tr 
                key={payment.id} 
                className={`group transition-all 150ms ease cursor-default hover:bg-[#F0F0F0] ${i % 2 === 0 ? "bg-white" : "bg-[#F9F9F9]"}`}
              >
                <td className="px-6 py-4">
                  <div className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-tight ${
                    payment.status === "confirmed" ? "bg-[#0A0A0A] text-white" : 
                    payment.status === "pending" ? "bg-[#F5F5F5] text-[#6B6B6B] border border-[#E8E8E8]" : 
                    "bg-red-50 text-red-600 border border-red-100"
                  }`}>
                    {payment.status}
                  </div>
                </td>
                <td className="px-6 py-4">
                  <p className="text-sm font-semibold text-[#0A0A0A] truncate max-w-[200px]">
                    {payment.description || "Transaction"}
                  </p>
                </td>
                <td className="px-6 py-4">
                  <p className="text-[11px] font-medium text-[#6B6B6B]">
                    {new Date(payment.created_at).toLocaleDateString()}
                  </p>
                </td>
                <td className="px-6 py-4 text-right">
                  <p className="text-sm font-bold text-[#0A0A0A]">
                    {formatAmount(payment.amount, locale, hideCents)} {payment.asset}
                  </p>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
