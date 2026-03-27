"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import Skeleton, { SkeletonTheme } from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";
import PaymentDetailModal from "@/components/PaymentDetailModal";
import ExportCsvButton from "@/components/ExportCsvButton";
import { localeToLanguageTag } from "@/i18n/config";
import {
  useHydrateMerchantStore,
  useMerchantApiKey,
  useMerchantId,
} from "@/lib/merchant-store";
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

interface FilterState {
  search: string;
  status: string;
  asset: string;
  dateFrom: string;
  dateTo: string;
}

const LIMIT = 100;
const STATUS_OPTIONS = ["all", "pending", "confirmed", "failed", "refunded"] as const;
const ASSET_OPTIONS = ["all", "XLM", "USDC"] as const;
const DEFAULT_FILTERS: FilterState = {
  search: "",
  status: "all",
  asset: "all",
  dateFrom: "",
  dateTo: "",
};

function toStatusLabel(
  t: ReturnType<typeof useTranslations>,
  status: string,
) {
  return t.has(`statuses.${status}`) ? t(`statuses.${status}`) : status;
}

function filtersFromSearchParams(searchParams: URLSearchParams): FilterState {
  return {
    search: searchParams.get("search") ?? "",
    status: searchParams.get("status") ?? "all",
    asset: searchParams.get("asset") ?? "all",
    dateFrom: searchParams.get("date_from") ?? "",
    dateTo: searchParams.get("date_to") ?? "",
  };
}

function buildSearchParams(filters: FilterState): URLSearchParams {
  const params = new URLSearchParams();

  if (filters.search) params.set("search", filters.search);
  if (filters.status !== "all") params.set("status", filters.status);
  if (filters.asset !== "all") params.set("asset", filters.asset);
  if (filters.dateFrom) params.set("date_from", filters.dateFrom);
  if (filters.dateTo) params.set("date_to", filters.dateTo);

  return params;
}

export default function RecentPayments({
  showSkeleton = false,
}: {
  showSkeleton?: boolean;
}) {
  const t = useTranslations("recentPayments");
  const locale = localeToLanguageTag(useLocale());
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const apiKey = useMerchantApiKey();
  const merchantId = useMerchantId();

  useHydrateMerchantStore();

  const filters = useMemo(
    () => filtersFromSearchParams(searchParams),
    [searchParams],
  );
  const hasActiveFilters =
    filters.search ||
    filters.status !== "all" ||
    filters.asset !== "all" ||
    filters.dateFrom ||
    filters.dateTo;

  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [selectedPayment, setSelectedPayment] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [flashedIds, setFlashedIds] = useState<Set<string>>(new Set());

  const updateFilters = useCallback(
    (nextFilters: FilterState) => {
      const params = buildSearchParams(nextFilters);
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  const handleFilterChange = useCallback(
    (key: keyof FilterState, value: string) => {
      updateFilters({ ...filters, [key]: value });
    },
    [filters, updateFilters],
  );

  const clearFilter = useCallback(
    (key: keyof FilterState) => {
      updateFilters({
        ...filters,
        [key]: key === "status" || key === "asset" ? "all" : "",
      });
    },
    [filters, updateFilters],
  );

  const clearAllFilters = useCallback(() => {
    updateFilters(DEFAULT_FILTERS);
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
          payment.id === event.id ? { ...payment, status: "confirmed" } : payment,
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
        if (!apiKey) {
          setError(t("missingApiKey"));
          setPayments([]);
          setTotalCount(0);
          setLoading(false);
          return;
        }

        setLoading(true);
        setError(null);

        const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
        const params = buildSearchParams(filters);
        params.set("page", "1");
        params.set("limit", LIMIT.toString());

        const response = await fetch(`${apiUrl}/api/payments?${params.toString()}`, {
          headers: {
            "x-api-key": apiKey,
          },
          signal: controller.signal,
        });

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
  }, [apiKey, filters, t]);

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
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Skeleton width={60} height={14} borderRadius={4} />
                <Skeleton height={40} borderRadius={12} />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {[...Array(4)].map((_, index) => (
                  <div key={index} className="flex flex-col gap-2">
                    <Skeleton width={60} height={14} borderRadius={4} />
                    <Skeleton height={40} borderRadius={12} />
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-white/10">
            <div className="border-b border-white/10 bg-white/5 px-4 py-3">
              <div className="flex justify-between">
                {[...Array(5)].map((_, index) => (
                  <Skeleton key={index} width={80} height={14} borderRadius={4} />
                ))}
              </div>
            </div>
            <div className="divide-y divide-white/5">
              {[...Array(5)].map((_, index) => (
                <div key={index} className="px-4 py-4">
                  <div className="flex items-center justify-between">
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
        <h3 className="text-lg font-semibold text-white">{t("connectionError")}</h3>
        <p className="mt-2 text-sm text-yellow-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label
              htmlFor="search"
              className="text-xs font-medium uppercase tracking-wider text-slate-400"
            >
              {t("search")}
            </label>
            <div className="relative">
              <input
                id="search"
                type="text"
                value={filters.search}
                onChange={(event) => handleFilterChange("search", event.target.value)}
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

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col gap-2">
              <label
                htmlFor="status"
                className="text-xs font-medium uppercase tracking-wider text-slate-400"
              >
                {t("status")}
              </label>
              <select
                id="status"
                value={filters.status}
                onChange={(event) => handleFilterChange("status", event.target.value)}
                className="rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-white focus:border-mint/50 focus:outline-none focus:ring-1 focus:ring-mint/50"
              >
                {STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {status === "all" ? t("allStatuses") : toStatusLabel(t, status)}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-2">
              <label
                htmlFor="asset"
                className="text-xs font-medium uppercase tracking-wider text-slate-400"
              >
                {t("asset")}
              </label>
              <select
                id="asset"
                value={filters.asset}
                onChange={(event) => handleFilterChange("asset", event.target.value)}
                className="rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-white focus:border-mint/50 focus:outline-none focus:ring-1 focus:ring-mint/50"
              >
                {ASSET_OPTIONS.map((asset) => (
                  <option key={asset} value={asset}>
                    {asset === "all" ? t("allAssets") : asset}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-2">
              <label
                htmlFor="dateFrom"
                className="text-xs font-medium uppercase tracking-wider text-slate-400"
              >
                {t("fromDate")}
              </label>
              <input
                id="dateFrom"
                type="date"
                value={filters.dateFrom}
                onChange={(event) => handleFilterChange("dateFrom", event.target.value)}
                className="rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-white focus:border-mint/50 focus:outline-none focus:ring-1 focus:ring-mint/50 [color-scheme:dark]"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label
                htmlFor="dateTo"
                className="text-xs font-medium uppercase tracking-wider text-slate-400"
              >
                {t("toDate")}
              </label>
              <input
                id="dateTo"
                type="date"
                value={filters.dateTo}
                onChange={(event) => handleFilterChange("dateTo", event.target.value)}
                className="rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-white focus:border-mint/50 focus:outline-none focus:ring-1 focus:ring-mint/50 [color-scheme:dark]"
              />
            </div>
          </div>

          {hasActiveFilters && (
            <div className="flex flex-wrap items-center gap-2 pt-2">
              <span className="text-xs text-slate-400">{t("activeFilters")}</span>

              {filters.search && (
                <FilterChip
                  label={t("searchChip", { value: filters.search })}
                  onClear={() => clearFilter("search")}
                  ariaLabel={t("clearSearchFilter")}
                />
              )}
              {filters.status !== "all" && (
                <FilterChip
                  label={t("statusChip", {
                    value: toStatusLabel(t, filters.status),
                  })}
                  onClear={() => clearFilter("status")}
                  ariaLabel={t("clearStatusFilter")}
                />
              )}
              {filters.asset !== "all" && (
                <FilterChip
                  label={t("assetChip", { value: filters.asset })}
                  onClear={() => clearFilter("asset")}
                  ariaLabel={t("clearAssetFilter")}
                />
              )}
              {filters.dateFrom && (
                <FilterChip
                  label={t("fromChip", { value: filters.dateFrom })}
                  onClear={() => clearFilter("dateFrom")}
                  ariaLabel={t("clearFromDateFilter")}
                />
              )}
              {filters.dateTo && (
                <FilterChip
                  label={t("toChip", { value: filters.dateTo })}
                  onClear={() => clearFilter("dateTo")}
                  ariaLabel={t("clearToDateFilter")}
                />
              )}

              <button
                onClick={clearAllFilters}
                className="ml-auto text-xs font-medium text-slate-400 underline underline-offset-4 hover:text-white"
              >
                {t("clearAll")}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-slate-400">
          {t("showingResults", { shown: payments.length, total: totalCount })}
          {hasActiveFilters ? ` ${t("filteredSuffix")}` : ""}
        </p>

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
          filename={`stellar_payments_${new Date().toISOString().slice(0, 10)}.csv`}
        />
      </div>

      {payments.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/5 p-8 text-center">
          <h3 className="text-lg font-semibold text-white">{t("emptyTitle")}</h3>
          <p className="mt-2 text-sm text-slate-400">{t("emptyDescription")}</p>
        </div>
      ) : (
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
                  className={`cursor-pointer transition-colors hover:bg-white/5 ${
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
                          : payment.status === "failed"
                            ? "bg-red-500/20 text-red-400"
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
                      onClick={(event) => {
                        event.stopPropagation();
                        handlePaymentClick(payment.id);
                      }}
                      className="font-mono text-xs text-mint transition-colors hover:text-glow"
                    >
                      {t("view")} {"->"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PaymentDetailModal
        paymentId={selectedPayment}
        isOpen={isModalOpen}
        onClose={closeModal}
      />
    </div>
  );
}

function FilterChip({
  label,
  onClear,
  ariaLabel,
}: {
  label: string;
  onClear: () => void;
  ariaLabel: string;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-mint/30 bg-mint/10 px-3 py-1 text-xs text-mint">
      {label}
      <button
        onClick={onClear}
        className="ml-1 rounded-full p-0.5 hover:bg-mint/20"
        aria-label={ariaLabel}
      >
        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </span>
  );
}
