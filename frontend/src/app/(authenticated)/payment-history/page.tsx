"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import Skeleton from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";
import TransactionHistoryPagination from "@/components/TransactionHistoryPagination";
import TransactionFilterSidebar from "@/components/TransactionFilterSidebar.lazy";
import { localeToLanguageTag } from "@/i18n/config";
import { toast } from "sonner";
import {
  useHydrateMerchantStore,
  useMerchantApiKey,
  useMerchantId,
} from "@/lib/merchant-store";
import { useTransactionFilters } from "@/hooks/useTransactionFilters";
import { usePaymentSocket } from "@/lib/usePaymentSocket";

const ExportCsvButton = dynamic(() => import("@/components/ExportCsvButton"), {
  ssr: false,
  loading: () => (
    <div
      className="h-10 w-28 rounded-xl border border-[#E8E8E8] bg-[#F9F9F9]"
      aria-hidden="true"
    />
  ),
});
const PaymentDetailModal = dynamic(
  () => import("@/components/PaymentDetailModal"),
  { ssr: false },
);
const PaymentDetailsSheet = dynamic(
  () => import("@/components/PaymentDetailsSheet"),
  { ssr: false },
);

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
  total_pages: number;
}

const LIMIT = 50;

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    confirmed: "bg-green-500/20 text-green-400",
    failed: "bg-red-500/20 text-red-400",
    refunded: "bg-blue-500/20 text-blue-400",
    pending: "bg-yellow-500/20 text-yellow-400",
  };
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${styles[status] || "bg-slate-500/20 text-slate-400"}`}
    >
      {status}
    </span>
  );
}

export default function PaymentHistoryPage() {
  const t = useTranslations("recentPayments");
  const locale = localeToLanguageTag(useLocale());
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const apiKey = useMerchantApiKey();
  const merchantId = useMerchantId();
  const currentPage = useMemo(() => {
    const parsed = Number(searchParams.get("page") ?? "1");
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
  }, [searchParams]);

  useHydrateMerchantStore();

  // ── Optimistic filter state (replaces manual useReducer + debounce) ─────────
  const pushSearchParams = useCallback(
    (params: URLSearchParams) => {
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  const {
    filters,
    searchSyncPending,
    isFilterPending,
    hasActiveFilters,
    onFilterChange,
    onClearFilter,
    onClearAll,
  } = useTransactionFilters(pushSearchParams, searchParams);
  const handlePageChange = useCallback(
    (page: number) => {
      const nextPage = Math.max(1, page);
      const params = new URLSearchParams(searchParams.toString());
      if (nextPage === 1) {
        params.delete("page");
      } else {
        params.set("page", String(nextPage));
      }
      pushSearchParams(params);
    },
    [pushSearchParams, searchParams],
  );

  // ── UI state ────────────────────────────────────────────────────────────────
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [selectedPayment, setSelectedPayment] = useState<string | null>(null);
  const [hoveredPayment, setHoveredPayment] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [flashedIds, setFlashedIds] = useState<Set<string>>(new Set());

  // ── Keyboard shortcut: Cmd/Ctrl+C copies hovered payment link ───────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c") {
        if (hoveredPayment) {
          e.preventDefault();
          const origin =
            typeof window !== "undefined" ? window.location.origin : "";
          navigator.clipboard.writeText(`${origin}/pay/${hoveredPayment}`);
          toast.success(t("linkCopied"));
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hoveredPayment, t]);

  // ── Real-time payment status updates via WebSocket ───────────────────────────
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
        prev.map((p) =>
          p.id === event.id ? { ...p, status: "confirmed" } : p,
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

  // ── Fetch payments whenever committed URL filters change ─────────────────────
  // NOTE: we fetch against `searchParams` (committed URL state), not the
  // optimistic draft, so the server always sees consistent filter values.
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
        const params = new URLSearchParams(searchParams.toString());
        params.set("page", currentPage.toString());
        params.set("limit", LIMIT.toString());

        const response = await fetch(
          `${apiUrl}/api/payments?${params.toString()}`,
          {
            headers: { "x-api-key": apiKey },
            signal: controller.signal,
          },
        );

        if (!response.ok) throw new Error(t("fetchFailed"));

        const data: PaginatedResponse = await response.json();
        setPayments(data.payments ?? []);
        setTotalCount(data.total_count ?? 0);
        setTotalPages(data.total_pages ?? 0);
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : t("loadFailed"));
      } finally {
        setLoading(false);
      }
    }

    fetchPayments();
    return () => controller.abort();
  }, [searchParams, currentPage, apiKey, t]);

  // ── Handlers ─────────────────────────────────────────────────────────────────
  const handlePaymentClick = (paymentId: string) => {
    setSelectedPayment(paymentId);
    setIsSheetOpen(true);
  };

  // ── Loading state ─────────────────────────────────────────────────────────────
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

  // ── Error state ───────────────────────────────────────────────────────────────
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
          <h3 className="text-lg font-semibold text-[#0A0A0A]">
            Unable to Load Payments
          </h3>
          <p className="text-sm text-red-400 mt-2">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-red-500/20 border border-red-500/30 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-500/30 transition-all"
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
    );
  }

  // ── Empty state (no payments at all, no filters active) ──────────────────────
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
          <h3 className="text-lg font-semibold text-[#0A0A0A]">
            No payment history yet
          </h3>
          <p className="text-sm text-[#6B6B6B] max-w-md mx-auto mt-2">
            Start accepting payments to see your transaction history here.
          </p>
        </div>
      </div>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-8 min-h-screen">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
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
          {/* Mobile filter trigger */}
          <button
            onClick={() => setIsFilterOpen(true)}
            className="inline-flex lg:hidden items-center gap-2 rounded-xl border border-[#E8E8E8] bg-white px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-[#0A0A0A] hover:bg-[#F5F5F5] transition-all"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
              />
            </svg>
            Filters
            {hasActiveFilters && (
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[var(--pluto-500)] text-[8px] text-white">
                !
              </span>
            )}
          </button>

          <ExportCsvButton
            transactions={payments.map((p) => ({
              id: p.id,
              createdAt: p.created_at,
              type: "payment",
              status: p.status,
              amount: String(p.amount),
              asset: p.asset,
              sourceAccount: "",
              destAccount: "",
              hash: p.id,
              description: p.description ?? "",
            }))}
            disabled={loading}
            filename={`payment_history_${new Date().toISOString().slice(0, 10)}.csv`}
          />
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-10">
        {/* ── Filter sidebar — purely presentational, all state from hook ── */}
        <TransactionFilterSidebar
          filters={filters}
          onFilterChange={onFilterChange}
          onClearFilter={onClearFilter}
          onClearAll={onClearAll}
          hasActiveFilters={hasActiveFilters}
          searchSyncPending={searchSyncPending}
          isFilterPending={isFilterPending}
          isOpen={isFilterOpen}
          onClose={() => setIsFilterOpen(false)}
        />

        {/* ── Main content — dims while a filter transition is in flight ── */}
        <div
          className={[
            "flex-1 flex flex-col gap-8 min-w-0 transition-opacity duration-200",
            isFilterPending ? "opacity-60 pointer-events-none" : "opacity-100",
          ].join(" ")}
          aria-busy={isFilterPending}
          aria-live="polite"
        >
          {/* Stats cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              {
                label: "Total Payments",
                value: totalCount,
                color: "text-mint",
                bg: "bg-mint/10",
                icon: (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                  />
                ),
              },
              {
                label: "Confirmed",
                value: payments.filter((p) => p.status === "confirmed").length,
                color: "text-green-400",
                bg: "bg-green-500/10",
                icon: (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                ),
              },
              {
                label: "Pending",
                value: payments.filter((p) => p.status === "pending").length,
                color: "text-yellow-400",
                bg: "bg-yellow-500/10",
                icon: (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                ),
              },
              {
                label: "Failed",
                value: payments.filter((p) => p.status === "failed").length,
                color: "text-red-400",
                bg: "bg-red-500/10",
                icon: (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                ),
              },
            ].map(({ label, value, color, bg, icon }) => (
              <div
                key={label}
                className="rounded-xl border border-[#E8E8E8] bg-[#F9F9F9] p-6"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-[#6B6B6B]">
                      {label}
                    </p>
                    <p className={`mt-2 text-2xl font-bold ${color}`}>
                      {value}
                    </p>
                  </div>
                  <div className={`rounded-full p-3 ${bg}`}>
                    <svg
                      className={`w-6 h-6 ${color}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      {icon}
                    </svg>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Active filter chips */}
          {hasActiveFilters && (
            <div className="hidden lg:flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B] mr-1">
                Active Filters:
              </span>
              {filters.search && (
                <span
                  className={`inline-flex items-center gap-1 rounded-full border border-mint/30 bg-mint/10 px-3 py-1 text-xs text-mint ${searchSyncPending ? "ring-1 ring-mint/40" : ""}`}
                >
                  Search: &quot;{filters.search}&quot;
                  <button
                    type="button"
                    onClick={() => onClearFilter("search")}
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
              {filters.status !== "all" && (
                <span className="inline-flex items-center gap-1 rounded-full border border-mint/30 bg-mint/10 px-3 py-1 text-xs text-mint">
                  Status: {filters.status}
                  <button
                    type="button"
                    onClick={() => onClearFilter("status")}
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
              {filters.asset !== "all" && (
                <span className="inline-flex items-center gap-1 rounded-full border border-mint/30 bg-mint/10 px-3 py-1 text-xs text-mint">
                  Asset: {filters.asset}
                  <button
                    type="button"
                    onClick={() => onClearFilter("asset")}
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
              {filters.dateFrom && (
                <span className="inline-flex items-center gap-1 rounded-full border border-mint/30 bg-mint/10 px-3 py-1 text-xs text-mint">
                  From: {filters.dateFrom}
                  <button
                    type="button"
                    onClick={() => onClearFilter("dateFrom")}
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
              {filters.dateTo && (
                <span className="inline-flex items-center gap-1 rounded-full border border-mint/30 bg-mint/10 px-3 py-1 text-xs text-mint">
                  To: {filters.dateTo}
                  <button
                    type="button"
                    onClick={() => onClearFilter("dateTo")}
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
                type="button"
                onClick={onClearAll}
                className="ml-2 text-[10px] font-bold uppercase tracking-widest text-[var(--pluto-500)] hover:underline"
              >
                Reset All
              </button>
            </div>
          )}

          {/* Results count */}
          <div className="flex items-center justify-between px-2">
            <p className="text-xs text-[#6B6B6B] font-medium">
              {t("showingResults", {
                shown: payments.length,
                total: totalCount,
              })}
            </p>
          </div>

          {/* Payment table / empty filtered state */}
          {payments.length === 0 ? (
            <div className="rounded-2xl border border-[#E8E8E8] bg-[#F9F9F9] py-20 text-center">
              <div className="mx-auto mb-4 w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-sm border border-[#E8E8E8]">
                <svg
                  className="w-8 h-8 text-[#A0A0A0]"
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
              <h3 className="text-lg font-bold text-[#0A0A0A]">
                No payments found
              </h3>
              <p className="text-sm text-[#6B6B6B] mt-1">
                Try adjusting your filters to find what you&apos;re looking for.
              </p>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={onClearAll}
                  className="mt-6 text-[10px] font-bold uppercase tracking-widest text-[var(--pluto-500)] hover:underline"
                >
                  Clear all filters
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-[#E8E8E8] bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-[#E8E8E8] bg-[#F9F9F9]">
                      {["Status", "Amount", "Recipient", "Date", "Actions"].map(
                        (h, i) => (
                          <th
                            key={h}
                            className={`px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]${i === 3 ? " hidden md:table-cell" : ""}`}
                          >
                            {h}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F0F0F0]">
                    {payments.map((payment) => (
                      <tr
                        key={payment.id}
                        onMouseEnter={() => setHoveredPayment(payment.id)}
                        onMouseLeave={() => setHoveredPayment(null)}
                        onClick={() => handlePaymentClick(payment.id)}
                        className={`group cursor-pointer transition-all hover:bg-[#F9F9F9] ${flashedIds.has(payment.id) ? "bg-emerald-50" : ""}`}
                      >
                        <td className="px-6 py-5">
                          <StatusBadge status={payment.status} />
                        </td>
                        <td className="px-6 py-5">
                          <div className="flex items-baseline gap-1">
                            <span className="text-base font-bold text-[#0A0A0A]">
                              {payment.amount}
                            </span>
                            <span className="text-[10px] font-bold text-[#6B6B6B] uppercase">
                              {payment.asset}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-5">
                          <div className="flex flex-col gap-0.5">
                            <code className="text-xs text-[#0A0A0A] font-mono">
                              {payment.id.slice(0, 12)}…
                            </code>
                            <p className="text-[10px] text-[#6B6B6B] truncate max-w-[150px]">
                              {payment.description || "No description"}
                            </p>
                          </div>
                        </td>
                        <td className="px-6 py-5 hidden md:table-cell">
                          <p className="text-xs text-[#6B6B6B] font-medium">
                            {new Date(payment.created_at).toLocaleDateString(
                              locale,
                              {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                              },
                            )}
                          </p>
                        </td>
                        <td className="px-6 py-5">
                          <button className="text-[10px] font-bold uppercase tracking-widest text-[var(--pluto-500)] group-hover:translate-x-0.5 transition-all">
                            Details →
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <TransactionHistoryPagination
            page={currentPage}
            totalPages={totalPages}
            totalCount={totalCount}
            limit={LIMIT}
            onPageChange={handlePageChange}
            disabled={loading || isFilterPending}
          />
        </div>
      </div>

      {/* Modals */}
      {selectedPayment && (
        <PaymentDetailModal
          paymentId={selectedPayment}
          isOpen={isModalOpen}
          onClose={() => {
            setIsModalOpen(false);
            setSelectedPayment(null);
          }}
        />
      )}
      {selectedPayment && (
        <PaymentDetailsSheet
          paymentId={selectedPayment}
          isOpen={isSheetOpen}
          onClose={() => {
            setIsSheetOpen(false);
            setSelectedPayment(null);
          }}
        />
      )}
    </div>
  );
}
