"use client";

import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import Skeleton from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";
import PaymentDetailModal from "@/components/PaymentDetailModal";
import PaymentDetailsSheet from "@/components/PaymentDetailsSheet";
import ExportCsvButton from "@/components/ExportCsvButton";
import { localeToLanguageTag } from "@/i18n/config";
import { toast } from "sonner";
import {
  useHydrateMerchantStore,
  useMerchantApiKey,
  useMerchantId,
} from "@/lib/merchant-store";
import {
  buildPaymentHistorySearchParams,
  DEFAULT_PAYMENT_HISTORY_FILTERS,
  filtersFromSearchParams,
  hasActivePaymentHistoryFilters,
  type PaymentHistoryFilterKey,
  paymentHistoryFiltersReducer,
} from "@/lib/payment-history-filters";
import { usePaymentSocket } from "@/lib/usePaymentSocket";

interface Payment {
  id: string;
  amount: string;
  asset: string;
  status: string;
  description: string | null;
  created_at: string;
}

interface PaginatedResponse {
  payments: Payment[];
  total_count: number;
}

const LIMIT = 50;
const STATUS_OPTIONS = [
  "all",
  "pending",
  "confirmed",
  "failed",
  "refunded",
] as const;
const ASSET_OPTIONS = ["all", "XLM", "USDC"] as const;

function toStatusLabel(t: ReturnType<typeof useTranslations>, status: string) {
  return t.has(`statuses.${status}`) ? t(`statuses.${status}`) : status;
}

export default function PaymentHistoryPage() {
  const t = useTranslations("recentPayments");
  const locale = localeToLanguageTag(useLocale());
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const apiKey = useMerchantApiKey();
  const merchantId = useMerchantId();

  useHydrateMerchantStore();

  const activeFilters = useMemo(
    () => filtersFromSearchParams(searchParams),
    [searchParams],
  );
  const [draftFilters, dispatchDraftFilters] = useReducer(
    paymentHistoryFiltersReducer,
    activeFilters,
  );
  const hasActiveFilters = hasActivePaymentHistoryFilters(activeFilters);

  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const page = 1;
  const [totalCount, setTotalCount] = useState(0);
  const [selectedPayment, setSelectedPayment] = useState<string | null>(null);
  const [hoveredPayment, setHoveredPayment] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [flashedIds, setFlashedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    dispatchDraftFilters({ type: "sync", filters: activeFilters });
  }, [activeFilters]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check for Cmd+C (Mac) or Ctrl+C (Windows/Linux)
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c") {
        if (hoveredPayment) {
          e.preventDefault();
          const origin =
            typeof window !== "undefined" ? window.location.origin : "";
          const link = `${origin}/pay/${hoveredPayment}`;
          navigator.clipboard.writeText(link);
          toast.success(t("linkCopied"));
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hoveredPayment, t]);

  const updateFilters = useCallback(
    (nextFilters: typeof activeFilters) => {
      const params = buildPaymentHistorySearchParams(nextFilters);
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      });
    },
    [pathname, router],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (draftFilters.search !== activeFilters.search) {
        updateFilters({ ...draftFilters });
      }
    }, 300);

    return () => window.clearTimeout(timer);
  }, [activeFilters.search, draftFilters, updateFilters]);

  const handleFilterChange = useCallback(
    (key: PaymentHistoryFilterKey, value: string) => {
      const nextFilters = paymentHistoryFiltersReducer(draftFilters, {
        type: "set",
        key,
        value,
      });
      dispatchDraftFilters({ type: "set", key, value });

      if (key !== "search") {
        updateFilters(nextFilters);
      }
    },
    [draftFilters, updateFilters],
  );

  const clearFilter = useCallback(
    (key: PaymentHistoryFilterKey) => {
      const nextFilters = paymentHistoryFiltersReducer(draftFilters, {
        type: "clear",
        key,
      });
      dispatchDraftFilters({ type: "clear", key });
      updateFilters(nextFilters);
    },
    [draftFilters, updateFilters],
  );

  const clearAllFilters = useCallback(() => {
    dispatchDraftFilters({ type: "reset" });
    updateFilters(DEFAULT_PAYMENT_HISTORY_FILTERS);
  }, [updateFilters]);

  const handleConfirmed = useCallback(
    (event: {
      id: string;
      amount: number;
      asset: string;
      asset_issuer: string | null;
      recipient: string;
      tx_id: string;
      confirmed_at: string;
    }) => {
      setPayments((prev) =>
        prev.map((payment) =>
          payment.id === event.id
            ? { ...payment, status: "confirmed" }
            : payment,
        ),
      );
      setFlashedIds((prev) => new Set([...prev, event.id]));
      setTimeout(() => {
        setFlashedIds((prev) => {
          const next = new Set(prev);
          next.delete(event.id);
          return next;
        });
      }, 1200);
    },
    [],
  );

  usePaymentSocket(merchantId, handleConfirmed);

  useEffect(() => {
    const controller = new AbortController();

    async function fetchPayments() {
      try {
        setLoading(true);
        setError(null);

        if (!apiKey) {
          setError(t("missingApiKey"));
          setPayments([]);
          setTotalCount(0);
          setLoading(false);
          return;
        }

        const apiUrl =
          process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
        const params = buildPaymentHistorySearchParams(activeFilters);
        params.set("page", page.toString());
        params.set("limit", LIMIT.toString());

        const response = await fetch(
          `${apiUrl}/api/payments?${params.toString()}`,
          {
            headers: {
              "x-api-key": apiKey,
            },
            signal: controller.signal,
          },
        );

        if (!response.ok) {
          throw new Error(t("fetchFailed"));
        }

        const data: PaginatedResponse = await response.json();
        setPayments(data.payments ?? []);
        setTotalCount(data.total_count ?? 0);
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
          return;
        }
        setError(err instanceof Error ? err.message : t("loadFailed"));
      } finally {
        setLoading(false);
      }
    }

    fetchPayments();

    return () => controller.abort();
  }, [activeFilters, apiKey, t]);

  const handlePaymentClick = (paymentId: string) => {
    setSelectedPayment(paymentId);
    setIsSheetOpen(true);
  };

  const closeSheet = () => {
    setIsSheetOpen(false);
    setSelectedPayment(null);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setSelectedPayment(null);
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-8">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.4em] text-[#6B6B6B] mb-2">
            History
          </p>
          <h1 className="text-4xl font-bold text-[#0A0A0A] tracking-tight">
            Payment History
          </h1>
          <p className="mt-2 text-sm font-medium text-[#6B6B6B]">
            View and manage all your payment transactions
          </p>
        </div>

        <div className="rounded-xl border border-[#E8E8E8] bg-[#F9F9F9] p-4">
          <Skeleton height={40} borderRadius={12} className="mb-4" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} height={40} borderRadius={12} />
            ))}
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-[#E8E8E8]">
          <div className="border-b border-[#E8E8E8] bg-[#F9F9F9] px-4 py-3">
            <div className="flex justify-between">
              {[...Array(6)].map((_, i) => (
                <Skeleton key={i} width={80} height={14} borderRadius={4} />
              ))}
            </div>
          </div>
          <div className="divide-y divide-[#E8E8E8]">
            {[...Array(10)].map((_, i) => (
              <div key={i} className="px-4 py-4">
                <div className="flex justify-between items-center">
                  <Skeleton width={70} height={24} borderRadius={999} />
                  <Skeleton width={100} height={20} borderRadius={4} />
                  <Skeleton
                    width={120}
                    height={16}
                    borderRadius={4}
                    className="hidden sm:block"
                  />
                  <Skeleton
                    width={80}
                    height={16}
                    borderRadius={4}
                    className="hidden md:block"
                  />
                  <Skeleton width={60} height={16} borderRadius={4} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-8">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.4em] text-[#6B6B6B] mb-2">
            History
          </p>
          <h1 className="text-4xl font-bold text-[#0A0A0A] tracking-tight">
            Payment History
          </h1>
          <p className="mt-2 text-sm font-medium text-[#6B6B6B]">
            View and manage all your payment transactions
          </p>
        </div>

        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-8 text-center">
          <div className="mx-auto mb-6 w-24 h-24 relative">
            <div className="absolute inset-0 bg-red-500/10 rounded-full blur-xl animate-pulse" />
            <div className="relative w-full h-full flex items-center justify-center">
              <svg
                className="w-12 h-12 text-red-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.502 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
                />
              </svg>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-[#0A0A0A]">
              Unable to Load Payments
            </h3>
            <p className="text-sm text-red-400">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 rounded-lg bg-red-500/20 border border-red-500/30 px-4 py-2 text-sm font-medium text-red-400 transition-all hover:bg-red-500/30"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (payments.length === 0 && !hasActiveFilters) {
    return (
      <div className="flex flex-col gap-8">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.4em] text-[#6B6B6B] mb-2">
            History
          </p>
          <h1 className="text-4xl font-bold text-[#0A0A0A] tracking-tight">
            Payment History
          </h1>
          <p className="mt-2 text-sm font-medium text-[#6B6B6B]">
            View and manage all your payment transactions
          </p>
        </div>

        <div className="rounded-xl border border-[#E8E8E8] bg-[#F9F9F9] p-8 text-center">
          <div className="mx-auto mb-6 w-24 h-24 relative">
            <div className="absolute inset-0 bg-mint/10 rounded-full blur-xl" />
            <div className="relative w-full h-full flex items-center justify-center">
              <svg
                className="w-12 h-12 text-mint/60"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"
                />
              </svg>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-[#0A0A0A]">
              No payment history yet
            </h3>
            <p className="text-sm text-[#6B6B6B] max-w-md mx-auto">
              Start accepting payments to see your transaction history here.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.4em] text-[#6B6B6B] mb-2">
            History
          </p>
          <h1 className="text-4xl font-bold text-[#0A0A0A] tracking-tight">
            Payment History
          </h1>
          <p className="mt-2 text-sm font-medium text-[#6B6B6B]">
            View and manage all your payment transactions
          </p>
        </div>

        <div className="flex items-center gap-3">
          <ExportCsvButton
            transactions={payments.map((payment) => ({
              id: payment.id,
              createdAt: payment.created_at,
              type: "payment",
              status: payment.status,
              amount: String(payment.amount),
              asset: payment.asset,
              sourceAccount: "",
              destAccount: "",
              hash: payment.id,
              description: payment.description ?? "",
            }))}
            disabled={loading}
            filename={`payment_history_${new Date().toISOString().slice(0, 10)}.csv`}
          />
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-[#E8E8E8] bg-[#F9F9F9] p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-[#6B6B6B]">
                Total Payments
              </p>
              <p className="mt-2 text-2xl font-bold text-[#0A0A0A]">
                {totalCount}
              </p>
            </div>
            <div className="rounded-full bg-mint/10 p-3">
              <svg
                className="w-6 h-6 text-mint"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                />
              </svg>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-[#E8E8E8] bg-[#F9F9F9] p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-[#6B6B6B]">
                Confirmed
              </p>
              <p className="mt-2 text-2xl font-bold text-green-400">
                {payments.filter((p) => p.status === "confirmed").length}
              </p>
            </div>
            <div className="rounded-full bg-green-500/10 p-3">
              <svg
                className="w-6 h-6 text-green-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-[#E8E8E8] bg-[#F9F9F9] p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-[#6B6B6B]">
                Pending
              </p>
              <p className="mt-2 text-2xl font-bold text-yellow-400">
                {payments.filter((p) => p.status === "pending").length}
              </p>
            </div>
            <div className="rounded-full bg-yellow-500/10 p-3">
              <svg
                className="w-6 h-6 text-yellow-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-[#E8E8E8] bg-[#F9F9F9] p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-[#6B6B6B]">
                Failed
              </p>
              <p className="mt-2 text-2xl font-bold text-red-400">
                {payments.filter((p) => p.status === "failed").length}
              </p>
            </div>
            <div className="rounded-full bg-red-500/10 p-3">
              <svg
                className="w-6 h-6 text-red-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="rounded-xl border border-[#E8E8E8] bg-[#F9F9F9] p-4">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label
              htmlFor="search"
              className="text-xs font-medium uppercase tracking-wider text-[#6B6B6B]"
            >
              Search
            </label>
            <div className="relative">
              <input
                id="search"
                type="text"
                value={draftFilters.search}
                onChange={(event) =>
                  handleFilterChange("search", event.target.value)
                }
                placeholder="Search by ID or description..."
                className="w-full rounded-xl border border-[#E8E8E8] bg-white py-2.5 pl-10 pr-4 text-sm text-[#0A0A0A] placeholder:text-[#6B6B6B] focus:border-mint/50 focus:outline-none focus:ring-1 focus:ring-mint/50"
              />
              <svg
                className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6B6B6B]"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col gap-2">
              <label
                htmlFor="status"
                className="text-xs font-medium uppercase tracking-wider text-[#6B6B6B]"
              >
                Status
              </label>
              <select
                id="status"
                value={draftFilters.status}
                onChange={(event) =>
                  handleFilterChange("status", event.target.value)
                }
                className="rounded-xl border border-[#E8E8E8] bg-white px-3 py-2.5 text-sm text-[#0A0A0A] focus:border-mint/50 focus:outline-none focus:ring-1 focus:ring-mint/50"
              >
                {STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {status === "all"
                      ? "All Statuses"
                      : status.charAt(0).toUpperCase() + status.slice(1)}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-2">
              <label
                htmlFor="asset"
                className="text-xs font-medium uppercase tracking-wider text-[#6B6B6B]"
              >
                Asset
              </label>
              <select
                id="asset"
                value={draftFilters.asset}
                onChange={(event) =>
                  handleFilterChange("asset", event.target.value)
                }
                className="rounded-xl border border-[#E8E8E8] bg-white px-3 py-2.5 text-sm text-[#0A0A0A] focus:border-mint/50 focus:outline-none focus:ring-1 focus:ring-mint/50"
              >
                {ASSET_OPTIONS.map((asset) => (
                  <option key={asset} value={asset}>
                    {asset === "all" ? "All Assets" : asset}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-2">
              <label
                htmlFor="dateFrom"
                className="text-xs font-medium uppercase tracking-wider text-[#6B6B6B]"
              >
                From Date
              </label>
              <input
                id="dateFrom"
                type="date"
                value={draftFilters.dateFrom}
                onChange={(event) =>
                  handleFilterChange("dateFrom", event.target.value)
                }
                className="rounded-xl border border-[#E8E8E8] bg-white px-3 py-2.5 text-sm text-[#0A0A0A] focus:border-mint/50 focus:outline-none focus:ring-1 focus:ring-mint/50 [color-scheme:dark]"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label
                htmlFor="dateTo"
                className="text-xs font-medium uppercase tracking-wider text-[#6B6B6B]"
              >
                To Date
              </label>
              <input
                id="dateTo"
                type="date"
                value={draftFilters.dateTo}
                onChange={(event) =>
                  handleFilterChange("dateTo", event.target.value)
                }
                className="rounded-xl border border-[#E8E8E8] bg-white px-3 py-2.5 text-sm text-[#0A0A0A] focus:border-mint/50 focus:outline-none focus:ring-1 focus:ring-mint/50 [color-scheme:dark]"
              />
            </div>
          </div>

          {hasActiveFilters && (
            <div className="flex flex-wrap items-center gap-2 pt-2">
              <span className="text-xs text-[#6B6B6B]">Active filters:</span>

              {activeFilters.search && (
                <span className="inline-flex items-center gap-1 rounded-full border border-mint/30 bg-mint/10 px-3 py-1 text-xs text-mint">
                  Search: &quot;{activeFilters.search}&quot;
                  <button
                    onClick={() => clearFilter("search")}
                    className="ml-1 rounded-full p-0.5 hover:bg-mint/20"
                    aria-label="Clear search filter"
                  >
                    <svg
                      className="h-3 w-3"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </span>
              )}
              {activeFilters.status !== "all" && (
                <span className="inline-flex items-center gap-1 rounded-full border border-mint/30 bg-mint/10 px-3 py-1 text-xs text-mint">
                  Status: {activeFilters.status}
                  <button
                    onClick={() => clearFilter("status")}
                    className="ml-1 rounded-full p-0.5 hover:bg-mint/20"
                    aria-label="Clear status filter"
                  >
                    <svg
                      className="h-3 w-3"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </span>
              )}
              {activeFilters.asset !== "all" && (
                <span className="inline-flex items-center gap-1 rounded-full border border-mint/30 bg-mint/10 px-3 py-1 text-xs text-mint">
                  Asset: {activeFilters.asset}
                  <button
                    onClick={() => clearFilter("asset")}
                    className="ml-1 rounded-full p-0.5 hover:bg-mint/20"
                    aria-label="Clear asset filter"
                  >
                    <svg
                      className="h-3 w-3"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </span>
              )}
              {activeFilters.dateFrom && (
                <span className="inline-flex items-center gap-1 rounded-full border border-mint/30 bg-mint/10 px-3 py-1 text-xs text-mint">
                  From: {activeFilters.dateFrom}
                  <button
                    onClick={() => clearFilter("dateFrom")}
                    className="ml-1 rounded-full p-0.5 hover:bg-mint/20"
                    aria-label="Clear from date filter"
                  >
                    <svg
                      className="h-3 w-3"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </span>
              )}
              {activeFilters.dateTo && (
                <span className="inline-flex items-center gap-1 rounded-full border border-mint/30 bg-mint/10 px-3 py-1 text-xs text-mint">
                  To: {activeFilters.dateTo}
                  <button
                    onClick={() => clearFilter("dateTo")}
                    className="ml-1 rounded-full p-0.5 hover:bg-mint/20"
                    aria-label="Clear to date filter"
                  >
                    <svg
                      className="h-3 w-3"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </span>
              )}

              <button
                onClick={clearAllFilters}
                className="ml-auto text-xs font-medium text-[#6B6B6B] underline underline-offset-4 hover:text-[#0A0A0A]"
              >
                Clear All
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Results Info */}
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-[#6B6B6B]">
          Showing {payments.length} of {totalCount} payments
          {hasActiveFilters && " (filtered)"}
        </p>
      </div>

      {/* Payment List (Mobile Card View) */}
      <div className="flex flex-col gap-4 sm:hidden">
        {payments.map((payment) => (
          <div
            key={payment.id}
            onClick={() => handlePaymentClick(payment.id)}
            className={`cursor-pointer rounded-2xl border border-[#E8E8E8] bg-white p-5 transition-all active:scale-[0.98] shadow-sm ${
              flashedIds.has(payment.id)
                ? "animate-payment-confirmed bg-green-500/10 border-green-500/30"
                : ""
            }`}
          >
            <div className="flex items-center justify-between mb-4">
              <span
                className={`inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                  payment.status === "confirmed"
                    ? "bg-green-500/20 text-green-400"
                    : payment.status === "failed"
                    ? "bg-red-500/20 text-red-400"
                    : payment.status === "refunded"
                    ? "bg-blue-500/20 text-blue-400"
                    : "bg-yellow-500/20 text-yellow-400"
                }`}
              >
                {toStatusLabel(t, payment.status)}
              </span>
              <p className="text-[10px] font-bold text-[#6B6B6B] uppercase tracking-widest">
                {new Date(payment.created_at).toLocaleDateString(locale, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
            <div className="flex items-end justify-between">
              <div className="min-w-0">
                <p className="text-xl font-bold text-[#0A0A0A] tracking-tight truncate">
                  {payment.amount} {payment.asset}
                </p>
                <p className="mt-1 text-xs font-medium text-[#6B6B6B] truncate">
                  {payment.description || "No description"}
                </p>
              </div>
              <div className="shrink-0 text-[var(--pluto-500)]">
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Payment Table (Desktop View) */}
      <div className="hidden sm:block overflow-x-auto rounded-xl border border-[#E8E8E8]">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-[#E8E8E8] bg-[#F9F9F9]">
              <th className="px-4 py-3 font-mono text-xs uppercase tracking-wider text-[#6B6B6B]">
                ID
              </th>
              <th className="px-4 py-3 font-mono text-xs uppercase tracking-wider text-[#6B6B6B]">
                Status
              </th>
              <th className="px-4 py-3 font-mono text-xs uppercase tracking-wider text-[#6B6B6B]">
                Amount
              </th>
              <th className="hidden px-4 py-3 font-mono text-xs uppercase tracking-wider text-[#6B6B6B] sm:table-cell">
                Description
              </th>
              <th className="hidden px-4 py-3 font-mono text-xs uppercase tracking-wider text-[#6B6B6B] md:table-cell">
                Date
              </th>
              <th className="px-4 py-3 font-mono text-xs uppercase tracking-wider text-[#6B6B6B]">
                Actions
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-[#E8E8E8]">
            {payments.map((payment) => (
              <tr
                key={payment.id}
                onClick={() => handlePaymentClick(payment.id)}
                onMouseEnter={() => setHoveredPayment(payment.id)}
                onMouseLeave={() => setHoveredPayment(null)}
                className={`group relative cursor-pointer transition-all duration-200 ease-in-out hover:bg-[#F9F9F9] hover:shadow-sm hover:border-l-2 hover:border-l-[var(--pluto-500)] active:bg-[#F5F5F5] active:scale-[0.995] ${
                  flashedIds.has(payment.id)
                    ? "animate-payment-confirmed bg-green-500/10"
                    : ""
                }`}
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <code className="text-xs text-[#6B6B6B]">
                      {payment.id.slice(0, 8)}...
                    </code>
                    {hoveredPayment === payment.id && (
                      <span className="animate-in fade-in zoom-in duration-200 pointer-events-none absolute left-2 top-1 z-10 hidden rounded-md border border-[#E8E8E8] bg-black/80 px-2 py-0.5 text-[10px] font-medium text-[#0A0A0A] shadow-xl lg:flex items-center gap-1.5 backdrop-blur-sm">
                        <kbd className="rounded border border-white/20 bg-[#F9F9F9] px-1 font-sans text-[9px] text-[#0A0A0A]">
                          ⌘
                        </kbd>{" "}
                        +{" "}
                        <kbd className="rounded border border-white/20 bg-[#F9F9F9] px-1 font-sans text-[9px] text-[#0A0A0A]">
                          C
                        </kbd>{" "}
                        to copy link
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      payment.status === "confirmed"
                        ? "bg-green-500/20 text-green-400"
                        : payment.status === "failed"
                          ? "bg-red-500/20 text-red-400"
                          : payment.status === "refunded"
                            ? "bg-blue-500/20 text-blue-400"
                            : "bg-yellow-500/20 text-yellow-400"
                    }`}
                  >
                    {toStatusLabel(t, payment.status)}
                  </span>
                </td>
                <td className="px-4 py-3 font-medium text-[#0A0A0A]">
                  {payment.amount} {payment.asset}
                </td>
                <td className="hidden px-4 py-3 text-[#6B6B6B] sm:table-cell">
                  {payment.description || "—"}
                </td>
                <td className="hidden px-4 py-3 text-[#6B6B6B] md:table-cell">
                  {new Date(payment.created_at).toLocaleDateString(locale, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => handlePaymentClick(payment.id)}
                    className="inline-flex items-center gap-1 font-mono text-xs text-[var(--pluto-600)] transition-all duration-200 hover:text-[var(--pluto-800)] hover:gap-2 hover:translate-x-0.5 active:scale-95"
                  >
                    View
                    <svg
                      className="w-3 h-3 transition-transform duration-200 group-hover:translate-x-0.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Empty State for Filtered Results */}
      {payments.length === 0 && hasActiveFilters && (
        <div className="rounded-xl border border-[#E8E8E8] bg-[#F9F9F9] p-8 text-center">
          <div className="mx-auto mb-4 w-16 h-16 relative">
            <div className="absolute inset-0 bg-slate-500/10 rounded-full blur-xl" />
            <div className="relative w-full h-full flex items-center justify-center">
              <svg
                className="w-8 h-8 text-[#6B6B6B]"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </div>
          </div>
          <h3 className="text-base font-semibold text-[#0A0A0A] mb-2">
            No payments found
          </h3>
          <p className="text-sm text-[#6B6B6B] mb-4">
            Try adjusting your filters to see more results
          </p>
          <button
            onClick={clearAllFilters}
            className="inline-flex items-center gap-2 rounded-lg bg-mint/10 border border-mint/30 px-4 py-2 text-sm font-medium text-mint transition-all hover:bg-mint/20"
          >
            Clear All Filters
          </button>
        </div>
      )}

      {/* Payment Detail Modal */}
      {selectedPayment && (
        <PaymentDetailModal
          paymentId={selectedPayment}
          isOpen={isModalOpen}
          onClose={closeModal}
        />
      )}

      {/* Payment Detail Sheet */}
      {selectedPayment && (
        <PaymentDetailsSheet
          paymentId={selectedPayment}
          isOpen={isSheetOpen}
          onClose={closeSheet}
        />
      )}
    </div>
  );
}
