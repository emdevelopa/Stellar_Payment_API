"use client";

import { useEffect, useState, useCallback, useMemo, memo } from "react";
import Link from "next/link";
import { useLocale } from "next-intl";
import {
  useHydrateMerchantStore,
  useMerchantApiKey,
  useMerchantHydrated,
  useMerchantId,
} from "@/lib/merchant-store";
import { usePaymentSocket } from "@/lib/usePaymentSocket";
import { useDisplayPreferences, formatAmount } from "@/lib/display-preferences";

interface Payment {
  id: string;
  amount: number;
  asset: string;
  status: string;
  description: string | null;
  created_at: string;
}

interface PaymentRowProps {
  payment: Payment;
  index: number;
  locale: string;
  hideCents: boolean;
}

const PaymentRow = memo(function PaymentRow({
  payment,
  index,
  locale,
  hideCents,
}: PaymentRowProps) {
  const formattedDate = useMemo(
    () => new Date(payment.created_at).toLocaleDateString(),
    [payment.created_at],
  );
  const formattedAmount = useMemo(
    () => formatAmount(payment.amount, locale, hideCents),
    [payment.amount, locale, hideCents],
  );
  const rowClassName = `group cursor-pointer outline-none transition-all duration-200 ease-in-out hover:bg-pluto-50 hover:shadow-sm active:bg-pluto-100 active:scale-[0.985] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-pluto-500 ${index % 2 === 0 ? "bg-white" : "bg-[#F9F9F9]"}`;
  const statusClassName = `inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-tight ${
    payment.status === "confirmed"
      ? "bg-[#0A0A0A] text-white"
      : payment.status === "pending"
        ? "bg-[#F5F5F5] text-[#6B6B6B] border border-[#E8E8E8]"
        : "bg-red-50 text-red-600 border border-red-100"
  }`;
  return (
    <tr
      role="row"
      tabIndex={0}
      className={rowClassName}
      aria-label={`Payment ${payment.description || "Transaction"} for ${formattedAmount} ${payment.asset}`}
    >
      <td className="border-l-0 border-transparent px-6 py-4 transition-all duration-200 group-hover:border-l-2 group-hover:border-l-pluto-500">
        <div className={statusClassName} aria-label={`Status: ${payment.status}`}>
          {payment.status}
        </div>
      </td>
      <td className="px-6 py-4">
        <p className="text-sm font-semibold text-[#0A0A0A] truncate max-w-[200px]">
          {payment.description || "Transaction"}
        </p>
      </td>
      <td className="px-6 py-4">
        <time
          className="text-[11px] font-medium text-[#6B6B6B]"
          dateTime={payment.created_at}
        >
          {formattedDate}
        </time>
      </td>
      <td className="px-6 py-4 text-right">
        <p className="text-sm font-bold text-[#0A0A0A]">
          {formattedAmount} {payment.asset}
        </p>
      </td>
    </tr>
  );
});

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

  const handleConfirmed = useCallback(
    (event: {
      id: string;
      amount: number;
      asset: string;
      confirmed_at: string;
    }) => {
      setPayments((prev) => {
        // If payment exists, update it to confirmed and move to top
        const exists = prev.find((p) => p.id === event.id);
        let updatedList = prev;

        if (exists) {
          updatedList = prev.map((p) =>
            p.id === event.id ? { ...p, status: "confirmed" } : p,
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
          .sort(
            (a, b) =>
              new Date(b.created_at).getTime() -
              new Date(a.created_at).getTime(),
          )
          .slice(0, 10);
      });
    },
    [],
  );

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

        const apiUrl =
          process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
        const response = await fetch(`${apiUrl}/api/payments?limit=10`, {
          headers: { "x-api-key": apiKey },
          signal: controller.signal,
        });

        if (!response.ok) throw new Error("Failed to fetch payments");

        const data = await response.json();
        setPayments(data.payments ?? []);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setError(
          err instanceof Error ? err.message : "Failed to load activity",
        );
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
          <div key={i} className="h-14 w-full rounded-lg bg-[#F5F5F5] sm:h-16" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-500/30 p-4 text-red-400">
        {error}
      </div>
    );
  }

  if (payments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-[#E8E8E8] bg-[#F9F9F9] p-8 text-center sm:p-16">
        <h3 className="mb-3 text-lg font-bold text-[#0A0A0A] sm:text-xl">
          No activity detected
        </h3>
        <p className="mb-8 max-w-sm text-sm font-medium text-[#6B6B6B] sm:text-base">
          Your live feed will populate here once you start receiving payments.
          Create a link to get started.
        </p>
        <Link
          href="/dashboard/create"
          className="w-full rounded-[6px] bg-[#0A0A0A] px-6 py-3 text-sm font-semibold text-white transition-all hover:bg-[#222] sm:w-auto"
        >
          Create First Payment
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[#E8E8E8] bg-white overflow-hidden">
      <div className="flex items-center justify-between border-b border-[#E8E8E8] bg-[#0A0A0A] px-4 py-4 sm:px-6">
        <h3 className="font-semibold text-white text-sm">Live Activity Feed</h3>
        <div className="flex items-center gap-2 text-[10px] font-bold text-white/70 uppercase tracking-widest">
          <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
          Live
        </div>
      </div>

      {/* ── Mobile card list (visible below sm breakpoint) ── */}
      <div className="space-y-3 p-4 sm:hidden">
        {payments.map((payment, i) => (
          <div
            key={payment.id}
            /* Hover: lift with Pluto-50 tint + left accent border.
               Active: scale-down for tactile tap feedback.
               Focus-visible: keyboard-navigable with Pluto-500 ring. */
            tabIndex={0}
            role="row"
            aria-label={`Payment ${payment.description || "Transaction"} for ${formatAmount(payment.amount, locale, hideCents)} ${payment.asset}`}
            className={`rounded-lg border p-3 outline-none
              transition-all duration-200 ease-in-out
              hover:border-l-2 hover:border-l-pluto-500 hover:bg-pluto-50 hover:shadow-sm
              active:scale-[0.985] active:bg-pluto-100
              focus-visible:ring-2 focus-visible:ring-pluto-500 focus-visible:ring-offset-2
              cursor-pointer
              ${i % 2 === 0 ? "border-[#E8E8E8] bg-white" : "border-[#ECECEC] bg-[#F9F9F9]"}`}
          >
            <div className="mb-2 flex items-start justify-between gap-3">
              <p className="truncate text-sm font-semibold text-[#0A0A0A]">
                {payment.description || "Transaction"}
              </p>
              <div
                className={`shrink-0 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-tight ${payment.status === "confirmed"
                    ? "bg-[#0A0A0A] text-white"
                    : payment.status === "pending"
                      ? "bg-[#F5F5F5] text-[#6B6B6B] border border-[#E8E8E8]"
                      : "bg-red-50 text-red-600 border border-red-100"
                  }`}
                aria-label={`Status: ${payment.status}`}
              >
                {payment.status}
              </div>
            </div>
            <div className="flex items-center justify-between gap-3">
              <time
                className="text-[11px] font-medium text-[#6B6B6B]"
                dateTime={payment.created_at}
              >
                {new Date(payment.created_at).toLocaleDateString()}
              </time>
              <p className="text-right text-sm font-bold text-[#0A0A0A]">
                {formatAmount(payment.amount, locale, hideCents)} {payment.asset}
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full text-left border-separate border-spacing-0">
          <thead>
            <tr className="bg-[#F9F9F9] border-b border-[#E8E8E8]">
              <th className="px-6 py-3 text-[11px] font-bold text-[#6B6B6B] uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-[11px] font-bold text-[#6B6B6B] uppercase tracking-wider">
                Description
              </th>
              <th className="px-6 py-3 text-[11px] font-bold text-[#6B6B6B] uppercase tracking-wider">
                Date
              </th>
              <th className="px-6 py-3 text-right text-[11px] font-bold text-[#6B6B6B] uppercase tracking-wider">
                Amount
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E8E8E8]">
            {payments.map((payment, i) => (
              <PaymentRow
                key={payment.id}
                payment={payment}
                index={i}
                locale={locale}
                hideCents={hideCents}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
