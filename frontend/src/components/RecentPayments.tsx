"use client";

import { useEffect, useState, useCallback } from "react";
import { useLocale, useTranslations } from "next-intl";
import PaymentDetailModal from "@/components/PaymentDetailModal";
import {
  useHydrateMerchantStore,
  useMerchantApiKey,
  useMerchantHydrated,
  useMerchantId,
} from "@/lib/merchant-store";
import PullToRefresh from "react-simple-pull-to-refresh";
import { usePaymentSocket } from "@/lib/usePaymentSocket";
import Skeleton, { SkeletonTheme } from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";
import { localeToLanguageTag } from "@/i18n/config";
import ExportCsvButton from "@/components/ExportCsvButton";
import { Transaction }  from "@/lib/exportCsv";

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
  page: number;
  limit: number;
}

interface FilterState {
  search: string;
  status: string;
  asset: string;
  dateFrom: string;
  dateTo: string;
}

const LIMIT = 10;
const STATUS_OPTIONS = ["all", "pending", "confirmed", "failed", "refunded"] as const;
const ASSET_OPTIONS = ["all", "XLM", "USDC"];

function toStatusLabel(
  t: ReturnType<typeof useTranslations>,
  status: string,
) {
  return t.has(`statuses.${status}`) ? t(`statuses.${status}`) : status;
}

export default function RecentPayments({ showSkeleton = false }: { showSkeleton?: boolean }) {
  const t = useTranslations("recentPayments");
  const locale = localeToLanguageTag(useLocale());
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [selectedPayment, setSelectedPayment] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  // Track IDs of rows that should display the confirmed flash animation
  const [flashedIds, setFlashedIds] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<FilterState>({
    search: "",
    status: "all",
    asset: "all",
    dateFrom: "",
    dateTo: "",
  });
  const apiKey = useMerchantApiKey();
  const hydrated = useMerchantHydrated();
  const merchantId = useMerchantId();

  useHydrateMerchantStore();

  // Real-time payment confirmation via WebSocket (issue #229)
  const handleConfirmed = useCallback(
    (event: { id: string; amount: number; asset: string; asset_issuer: string | null; recipient: string; tx_id: string; confirmed_at: string }) => {
      // Update the row status in-place without a full refetch
      setPayments((prev) =>
        prev.map((p) =>
          p.id === event.id ? { ...p, status: "confirmed" } : p,
        ),
      );
      // Trigger flash animation on the confirmed row
      setFlashedIds((prev) => new Set([...prev, event.id]));
      // Remove flash class after animation completes (600 ms)
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

  // useEffect(() => {
  //   if (!hydrated) return;

  //   const controller = new AbortController();

  //   const fetchPayments = async () => {
  //     try {
  //       if (!apiKey) {
  //         setError(t("missingApiKey"));
  //         setLoading(false);
  //         return;
  //       }

  //       const apiUrl =
  //         process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
        
  //       // Build query params
  //       const params = new URLSearchParams({
  //         page: page.toString(),
  //         limit: LIMIT.toString(),
  //       });
        
  //       if (filters.search) params.append("search", filters.search);
  //       if (filters.status !== "all") params.append("status", filters.status);
  //       if (filters.asset !== "all") params.append("asset", filters.asset);
  //       if (filters.dateFrom) params.append("date_from", filters.dateFrom);
  //       if (filters.dateTo) params.append("date_to", filters.dateTo);

  //       const response = await fetch(
  //         `${apiUrl}/api/payments?${params.toString()}`,
  //         {
  //           headers: {
  //             "x-api-key": apiKey,
  //           },
  //           signal: controller.signal,
  //         },
  //       );

  //       if (!response.ok) throw new Error(t("fetchFailed"));

  //       const data: PaginatedResponse = await response.json();
  //       setPayments(data.payments ?? []);
  //       setTotalPages(data.total_pages ?? 1);
  //       setTotalCount(data.total_count ?? 0);
  //     } catch (err: unknown) {
  //       if (err instanceof Error && err.name === "AbortError") return;
  //       setError(
  //         err instanceof Error ? err.message : t("loadFailed"),
  //       );
  //     } finally {
  //       setLoading(false);
  //     }
  //   };

  //   fetchPayments();

  //   return () => controller.abort();
  // }, [apiKey, page, hydrated, filters, t]);

  // TEMP: mock data to test CSV export — remove when backend is integrated
useEffect(() => {
  setPayments([
    {
      id: "mock-001",
      amount: "100",
      asset: "XLM",
      status: "confirmed",
      description: "Test payment 1",
      created_at: new Date().toISOString(),
    },
    {
      id: "mock-002",
      amount: "50",
      asset: "USDC",
      status: "pending",
      description: "Test payment 2",
      created_at: new Date().toISOString(),
    },
  ]);
  setLoading(false);
}, []);

  const handleFilterChange = (key: keyof FilterState, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
    setPayments([]);
  };

  const clearFilter = (key: keyof FilterState) => {
    if (key === "status" || key === "asset") {
      setFilters((prev) => ({ ...prev, [key]: "all" }));
    } else {
      setFilters((prev) => ({ ...prev, [key]: "" }));
    }
    setPage(1);
  };

  const clearAllFilters = () => {
    setFilters({
      search: "",
      status: "all",
      asset: "all",
      dateFrom: "",
      dateTo: "",
    });
    setPage(1);
    setPayments([]);
  };

  const hasActiveFilters =
    filters.search ||
    filters.status !== "all" ||
    filters.asset !== "all" ||
    filters.dateFrom ||
    filters.dateTo;

  const handlePaymentClick = (paymentId: string) => {
    setSelectedPayment(paymentId);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setSelectedPayment(null);
  };

  if (showSkeleton || loading) {
    return (
      <SkeletonTheme baseColor="#1e293b" highlightColor="#334155">
        <div className="flex flex-col gap-4">
          {/* Search and Filters Skeleton */}
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Skeleton width={60} height={14} borderRadius={4} />
                <Skeleton height={40} borderRadius={12} />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="flex flex-col gap-2">
                    <Skeleton width={60} height={14} borderRadius={4} />
                    <Skeleton height={40} borderRadius={12} />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Table Skeleton */}
          <div className="overflow-x-auto rounded-xl border border-white/10">
            <div className="border-b border-white/10 bg-white/5 px-4 py-3">
              <div className="flex justify-between">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} width={80} height={14} borderRadius={4} />
                ))}
              </div>
            </div>
            <div className="divide-y divide-white/5">
              {[...Array(5)].map((_, i) => (
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
      </SkeletonTheme>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-8 text-center">
        {/* Error State Illustration */}
        <div className="mx-auto mb-6 w-24 h-24 relative">
          <div className="absolute inset-0 bg-yellow-500/10 rounded-full blur-xl animate-pulse" />
          <div className="relative w-full h-full flex items-center justify-center">
            <svg
              className="w-12 h-12 text-yellow-400"
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
          <div className="space-y-2">
            <h3 className="text-lg font-semibold text-white">
              {t("connectionError")}
            </h3>
            <p className="text-sm text-yellow-400">{error}</p>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              {t("backendHint")}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 rounded-lg bg-yellow-500/20 border border-yellow-500/30 px-4 py-2 text-sm font-medium text-yellow-400 transition-all hover:bg-yellow-500/30"
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
              {t("retryConnection")}
            </button>

            <button
              onClick={() => window.open("https://webhook.site", "_blank")}
              className="inline-flex items-center gap-2 rounded-lg border border-mint/30 bg-mint/5 px-4 py-2 text-sm font-medium text-mint transition-all hover:bg-mint/10"
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
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
              {t("testWebhook")}
            </button>
          </div>

          <div className="mt-4 p-3 rounded-lg border border-yellow-500/20 bg-yellow-500/5">
            <div className="flex items-start gap-3">
              <div className="w-2 h-2 rounded-full bg-yellow-400 mt-1.5 flex-shrink-0" />
              <div className="text-left">
                <p className="text-xs font-medium text-yellow-400">
                  {t("troubleshootingTip")}
                </p>
                <p className="text-xs text-slate-500">
                  {t("troubleshootingDescription")}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (payments.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-8 text-center">
        {/* Empty State Illustration */}
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
          <div className="space-y-2">
            <h3 className="text-lg font-semibold text-white">
              {t("emptyTitle")}
            </h3>
            <p className="text-sm text-slate-400 max-w-md mx-auto">
              {t("emptyDescription")}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
            <button
              onClick={() => window.open("/dashboard/create", "_self")}
              className="group relative inline-flex items-center gap-2 rounded-lg bg-mint px-4 py-2 text-sm font-medium text-black transition-all hover:bg-glow"
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
                  d="M12 4v16m8-8H4"
                />
              </svg>
              {t("createPaymentLink")}
              <div className="absolute inset-0 -z-10 bg-mint/20 opacity-0 blur-xl transition-opacity group-hover:opacity-100" />
            </button>

            <button
              onClick={() => window.open("https://webhook.site", "_blank")}
              className="inline-flex items-center gap-2 rounded-lg border border-mint/30 bg-mint/5 px-4 py-2 text-sm font-medium text-mint transition-all hover:bg-mint/10"
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
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
              {t("sendTestWebhook")}
            </button>
          </div>

          <div className="mt-6 p-4 rounded-lg border border-slate-700/50 bg-slate-800/30">
            <div className="flex items-start gap-3">
              <div className="w-2 h-2 rounded-full bg-mint mt-1.5 flex-shrink-0" />
              <div className="text-left space-y-1">
                <p className="text-xs font-medium text-mint">
                  {t("gettingStartedTitle")}
                </p>
                <p className="text-xs text-slate-400">
                  {t("gettingStartedDescription")}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Search and Filters */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="flex flex-col gap-4">
          {/* Search Bar */}
          <div className="flex flex-col gap-2">
            <label htmlFor="search" className="text-xs font-medium uppercase tracking-wider text-slate-400">
              {t("search")}
            </label>
            <div className="relative">
              <input
                id="search"
                type="text"
                value={filters.search}
                onChange={(e) => handleFilterChange("search", e.target.value)}
                placeholder={t("searchPlaceholder")}
                className="w-full rounded-xl border border-white/10 bg-black/40 py-2.5 pl-10 pr-4 text-sm text-white placeholder:text-slate-600 focus:border-mint/50 focus:outline-none focus:ring-1 focus:ring-mint/50"
              />
              <svg
                className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
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

          {/* Filter Row */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* Status Filter */}
            <div className="flex flex-col gap-2">
              <label htmlFor="status" className="text-xs font-medium uppercase tracking-wider text-slate-400">
                {t("status")}
              </label>
              <select
                id="status"
                value={filters.status}
                onChange={(e) => handleFilterChange("status", e.target.value)}
                className="rounded-xl border border-white/10 bg-black/40 py-2.5 px-3 text-sm text-white focus:border-mint/50 focus:outline-none focus:ring-1 focus:ring-mint/50"
              >
                {STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {status === "all" ? t("allStatuses") : toStatusLabel(t, status)}
                  </option>
                ))}
              </select>
            </div>

            {/* Asset Filter */}
            <div className="flex flex-col gap-2">
              <label htmlFor="asset" className="text-xs font-medium uppercase tracking-wider text-slate-400">
                {t("asset")}
              </label>
              <select
                id="asset"
                value={filters.asset}
                onChange={(e) => handleFilterChange("asset", e.target.value)}
                className="rounded-xl border border-white/10 bg-black/40 py-2.5 px-3 text-sm text-white focus:border-mint/50 focus:outline-none focus:ring-1 focus:ring-mint/50"
              >
                {ASSET_OPTIONS.map((asset) => (
                  <option key={asset} value={asset}>
                    {asset === "all" ? t("allAssets") : asset}
                  </option>
                ))}
              </select>
            </div>

            {/* Date From */}
            <div className="flex flex-col gap-2">
              <label htmlFor="dateFrom" className="text-xs font-medium uppercase tracking-wider text-slate-400">
                {t("fromDate")}
              </label>
              <input
                id="dateFrom"
                type="date"
                value={filters.dateFrom}
                onChange={(e) => handleFilterChange("dateFrom", e.target.value)}
                className="rounded-xl border border-white/10 bg-black/40 py-2.5 px-3 text-sm text-white focus:border-mint/50 focus:outline-none focus:ring-1 focus:ring-mint/50 [color-scheme:dark]"
              />
            </div>

            {/* Date To */}
            <div className="flex flex-col gap-2">
              <label htmlFor="dateTo" className="text-xs font-medium uppercase tracking-wider text-slate-400">
                {t("toDate")}
              </label>
              <input
                id="dateTo"
                type="date"
                value={filters.dateTo}
                onChange={(e) => handleFilterChange("dateTo", e.target.value)}
                className="rounded-xl border border-white/10 bg-black/40 py-2.5 px-3 text-sm text-white focus:border-mint/50 focus:outline-none focus:ring-1 focus:ring-mint/50 [color-scheme:dark]"
              />
            </div>
          </div>

          {/* Filter Chips and Clear All */}
          {hasActiveFilters && (
            <div className="flex flex-wrap items-center gap-2 pt-2">
              <span className="text-xs text-slate-400">{t("activeFilters")}</span>
              
              {filters.search && (
                <span className="inline-flex items-center gap-1 rounded-full border border-mint/30 bg-mint/10 px-3 py-1 text-xs text-mint">
                  {t("searchChip", { value: filters.search })}
                  <button
                    onClick={() => clearFilter("search")}
                    className="ml-1 rounded-full p-0.5 hover:bg-mint/20"
                    aria-label={t("clearSearchFilter")}
                  >
                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </span>
              )}

              {filters.status !== "all" && (
                <span className="inline-flex items-center gap-1 rounded-full border border-mint/30 bg-mint/10 px-3 py-1 text-xs text-mint">
                  {t("statusChip", { value: toStatusLabel(t, filters.status) })}
                  <button
                    onClick={() => clearFilter("status")}
                    className="ml-1 rounded-full p-0.5 hover:bg-mint/20"
                    aria-label={t("clearStatusFilter")}
                  >
                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </span>
              )}

              {filters.asset !== "all" && (
                <span className="inline-flex items-center gap-1 rounded-full border border-mint/30 bg-mint/10 px-3 py-1 text-xs text-mint">
                  {t("assetChip", { value: filters.asset })}
                  <button
                    onClick={() => clearFilter("asset")}
                    className="ml-1 rounded-full p-0.5 hover:bg-mint/20"
                    aria-label={t("clearAssetFilter")}
                  >
                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </span>
              )}

              {filters.dateFrom && (
                <span className="inline-flex items-center gap-1 rounded-full border border-mint/30 bg-mint/10 px-3 py-1 text-xs text-mint">
                  {t("fromChip", { value: filters.dateFrom })}
                  <button
                    onClick={() => clearFilter("dateFrom")}
                    className="ml-1 rounded-full p-0.5 hover:bg-mint/20"
                    aria-label={t("clearFromDateFilter")}
                  >
                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </span>
              )}

              {filters.dateTo && (
                <span className="inline-flex items-center gap-1 rounded-full border border-mint/30 bg-mint/10 px-3 py-1 text-xs text-mint">
                  {t("toChip", { value: filters.dateTo })}
                  <button
                    onClick={() => clearFilter("dateTo")}
                    className="ml-1 rounded-full p-0.5 hover:bg-mint/20"
                    aria-label={t("clearToDateFilter")}
                  >
                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </span>
              )}

              <button
                onClick={clearAllFilters}
                className="ml-auto text-xs font-medium text-slate-400 underline underline-offset-4 hover:text-white"
              >
                {t("clearAll")}
              </button>
            </div>

            {/* Filter Chips and Clear All */}
            {hasActiveFilters && (
              <div className="flex flex-wrap items-center gap-2 pt-2">
                <span className="text-xs text-slate-400">Active filters:</span>

                {filters.search && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-mint/30 bg-mint/10 px-3 py-1 text-xs text-mint">
                    Search: &quot;{filters.search}&quot;
                    <button
                      onClick={() => clearFilter("search")}
                      className="ml-1 rounded-full p-0.5 hover:bg-mint/20"
                      aria-label="Clear search filter"
                    >
                      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </span>
                )}

                {filters.status !== "all" && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-mint/30 bg-mint/10 px-3 py-1 text-xs text-mint">
                    Status: {filters.status}
                    <button
                      onClick={() => clearFilter("status")}
                      className="ml-1 rounded-full p-0.5 hover:bg-mint/20"
                      aria-label="Clear status filter"
                    >
                      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </span>
                )}

                {filters.asset !== "all" && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-mint/30 bg-mint/10 px-3 py-1 text-xs text-mint">
                    Asset: {filters.asset}
                    <button
                      onClick={() => clearFilter("asset")}
                      className="ml-1 rounded-full p-0.5 hover:bg-mint/20"
                      aria-label="Clear asset filter"
                    >
                      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </span>
                )}

                {filters.dateFrom && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-mint/30 bg-mint/10 px-3 py-1 text-xs text-mint">
                    From: {filters.dateFrom}
                    <button
                      onClick={() => clearFilter("dateFrom")}
                      className="ml-1 rounded-full p-0.5 hover:bg-mint/20"
                      aria-label="Clear from date filter"
                    >
                      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </span>
                )}

                {filters.dateTo && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-mint/30 bg-mint/10 px-3 py-1 text-xs text-mint">
                    To: {filters.dateTo}
                    <button
                      onClick={() => clearFilter("dateTo")}
                      className="ml-1 rounded-full p-0.5 hover:bg-mint/20"
                      aria-label="Clear to date filter"
                    >
                      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </span>
                )}

                <button
                  onClick={clearAllFilters}
                  className="ml-auto text-xs font-medium text-slate-400 underline underline-offset-4 hover:text-white"
                >
                  Clear all
                </button>
              </div>
            )}
          </div>
        </div>

      {/* Results count */}
      <div className="flex items-center justify-between">
      <p className="text-xs text-slate-400">
        {t("showingResults", { shown: payments.length, total: totalCount })}
        {hasActiveFilters ? ` ${t("filteredSuffix")}` : ""}
      </p>
      <ExportCsvButton
      transactions={payments.map((p) => ({
        id:            p.id,
        createdAt:     p.created_at,
        type:          "payment",
        status:        p.status,
        amount:        String(p.amount),
        asset:         p.asset,
        sourceAccount: "",
        destAccount:   "",
        hash:          p.id,
        description:   p.description ?? "",
      }))}
      disabled={loading}
      filename={`stellar_payments_${new Date().toISOString().slice(0, 10)}.csv`}
    />
    </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-white/10 bg-white/5">
              <th className="px-4 py-3 font-mono text-xs uppercase tracking-wider text-slate-400">
                {t("tableStatus")}
              </th>
              <th className="px-4 py-3 font-mono text-xs uppercase tracking-wider text-slate-400">
                {t("tableAmount")}
              </th>
              <th className="hidden px-4 py-3 font-mono text-xs uppercase tracking-wider text-slate-400 sm:table-cell">
                {t("tableDescription")}
              </th>
              <th className="hidden px-4 py-3 font-mono text-xs uppercase tracking-wider text-slate-400 md:table-cell">
                {t("tableDate")}
              </th>
              <th className="px-4 py-3 font-mono text-xs uppercase tracking-wider text-slate-400">
                {t("tableLink")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {payments.map((payment) => (
              <tr
                key={payment.id}
                className={`transition-colors hover:bg-white/5 cursor-pointer ${
                  flashedIds.has(payment.id)
                    ? "animate-payment-confirmed bg-green-500/10"
                    : ""
                }`}
                onClick={() => handlePaymentClick(payment.id)}
              >
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      payment.status === "confirmed"
                        ? "bg-green-500/20 text-green-400"
                        : "bg-yellow-500/20 text-yellow-400"
                    }`}
                  >
                    {toStatusLabel(t, payment.status)}
                  </span>
                </td>
                <td className="px-4 py-3 font-medium text-white">
                  {payment.amount} {payment.asset}
                </td>
                <td className="hidden px-4 py-3 text-slate-400 sm:table-cell">
                  {payment.description || t("emptyDescriptionValue")}
                </td>
                <td className="hidden px-4 py-3 text-slate-400 md:table-cell">
                  {new Date(payment.created_at).toLocaleDateString(locale)}
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handlePaymentClick(payment.id);
                    }}
                    className="font-mono text-xs text-mint transition-colors hover:text-glow"
                  >
                    {t("view")} →
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PullToRefresh>

  );
}
