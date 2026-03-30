"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import Skeleton from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";
import toast from "react-hot-toast";
import PaymentDetailModal from "@/components/PaymentDetailModal";
import PaymentDetailsSheet from "@/components/PaymentDetailsSheet";
import ExportCsvButton from "@/components/ExportCsvButton";
import { localeToLanguageTag } from "@/i18n/config";
import {
  useHydrateMerchantStore,
  useMerchantApiKey,
  useMerchantId,
} from "@/lib/merchant-store";
import { usePaymentSocket } from "@/lib/usePaymentSocket";
import { convertToCSV, downloadCSV } from "@/utils/csv";

interface Payment {
  id: string;
  amount: string;
  asset: string;
  recipient: string;
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
  page: number;
  limit: number;
}

type SortColumn = "status" | "amount" | "recipient" | "created_at";
type SortDirection = "asc" | "desc";

const STATUS_OPTIONS = ["all", "pending", "confirmed", "failed", "refunded"] as const;
const ASSET_OPTIONS = ["all", "XLM", "USDC"] as const;
const DEFAULT_FILTERS: FilterState = {
  search: "",
  status: "all",
  asset: "all",
  dateFrom: "",
  dateTo: "",
  page: 1,
  limit: 10,
};
const DEFAULT_SORT_COLUMN: SortColumn = "created_at";
const DEFAULT_SORT_DIRECTION: SortDirection = "desc";

function toStatusLabel(
  t: ReturnType<typeof useTranslations>,
  status: string,
) {
  return t.has(`statuses.${status}`) ? t(`statuses.${status}`) : status;
}

function filtersFromSearchParams(searchParams: URLSearchParams): FilterState {
  const pageStr = searchParams.get("page");
  const limitStr = searchParams.get("limit");

  return {
    search: searchParams.get("search") ?? "",
    status: searchParams.get("status") ?? "all",
    asset: searchParams.get("asset") ?? "all",
    dateFrom: searchParams.get("date_from") ?? "",
    dateTo: searchParams.get("date_to") ?? "",
    page: pageStr ? parseInt(pageStr, 10) : 1,
    limit: limitStr ? parseInt(limitStr, 10) : 10,
  };
}

function isSortColumn(value: string | null): value is SortColumn {
  return (
    value === "status" ||
    value === "amount" ||
    value === "recipient" ||
    value === "created_at"
  );
}

function isSortDirection(value: string | null): value is SortDirection {
  return value === "asc" || value === "desc";
}

function sortFromSearchParams(searchParams: URLSearchParams) {
  const sortColumn = searchParams.get("sortColumn");
  const sortDirection = searchParams.get("sortDirection");

  return {
    sortColumn: isSortColumn(sortColumn) ? sortColumn : DEFAULT_SORT_COLUMN,
    sortDirection: isSortDirection(sortDirection)
      ? sortDirection
      : DEFAULT_SORT_DIRECTION,
  };
}

function buildSearchParams(
  filters: FilterState,
  sortColumn: SortColumn,
  sortDirection: SortDirection,
): URLSearchParams {
  const params = new URLSearchParams();

  if (filters.search) params.set("search", filters.search);
  if (filters.status !== "all") params.set("status", filters.status);
  if (filters.asset !== "all") params.set("asset", filters.asset);
  if (filters.dateFrom) params.set("date_from", filters.dateFrom);
  if (filters.dateTo) params.set("date_to", filters.dateTo);
  if (filters.page > 1) params.set("page", filters.page.toString());
  if (filters.limit !== 10) params.set("limit", filters.limit.toString());
  if (sortColumn !== DEFAULT_SORT_COLUMN) params.set("sortColumn", sortColumn);
  if (sortDirection !== DEFAULT_SORT_DIRECTION) {
    params.set("sortDirection", sortDirection);
  }

  return params;
}

function SortArrow({
  active,
  direction,
}: {
  active: boolean;
  direction: SortDirection;
}) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex transition-opacity ${active ? "opacity-100" : "opacity-35"}`}
    >
      {direction === "asc" ? "\u2191" : "\u2193"}
    </span>
  );
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
  const { sortColumn, sortDirection } = useMemo(
    () => sortFromSearchParams(searchParams),
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
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [flashedIds, setFlashedIds] = useState<Set<string>>(new Set());

  const updateFilters = useCallback(
    (
      nextFilters: FilterState,
      nextSortColumn: SortColumn = sortColumn,
      nextSortDirection: SortDirection = sortDirection,
    ) => {
      const params = buildSearchParams(
        nextFilters,
        nextSortColumn,
        nextSortDirection,
      );
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, sortColumn, sortDirection],
  );

  const handleFilterChange = useCallback(
    (key: keyof FilterState, value: string | number) => {
      const isResetAction = key !== "page";
      updateFilters({ 
        ...filters, 
        [key]: value,
        ...(isResetAction ? { page: 1 } : {})
      });
    },
    [filters, updateFilters],
  );

  const clearFilter = useCallback(
    (key: keyof FilterState) => {
      updateFilters({
        ...filters,
        [key]: key === "status" || key === "asset" ? "all" : "",
        page: 1,
      });
    },
    [filters, updateFilters],
  );

  const clearAllFilters = useCallback(() => {
    updateFilters(DEFAULT_FILTERS);
  }, [updateFilters]);

  const handleSort = useCallback(
    (column: SortColumn) => {
      const nextDirection =
        sortColumn === column && sortDirection === "asc" ? "desc" : "asc";
      updateFilters(filters, column, nextDirection);
    },
    [filters, sortColumn, sortDirection, updateFilters],
  );

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
      // Update the row status in-place without a full refetch
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
        setLoading(true);
        setError(null);

        if (!apiKey) {
          setError(t("missingApiKey"));
          setPayments([]);
          setTotalCount(0);
          setLoading(false);
          return;
        }

        const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
        const params = buildSearchParams(filters, sortColumn, sortDirection);

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
  }, [apiKey, filters, sortColumn, sortDirection, t]);

  const sortedPayments = useMemo(() => {
    const statusOrder: Record<string, number> = {
      pending: 0,
      confirmed: 1,
      completed: 2,
      failed: 3,
      refunded: 4,
    };

    return [...payments].sort((left, right) => {
      let result = 0;

      switch (sortColumn) {
        case "amount":
          result = Number(left.amount) - Number(right.amount);
          break;
        case "recipient":
          result = left.recipient.localeCompare(right.recipient);
          break;
        case "status":
          result =
            (statusOrder[left.status] ?? Number.MAX_SAFE_INTEGER) -
            (statusOrder[right.status] ?? Number.MAX_SAFE_INTEGER);
          break;
        case "created_at":
        default:
          result =
            new Date(left.created_at).getTime() -
            new Date(right.created_at).getTime();
          break;
      }

      if (result === 0) {
        result = left.id.localeCompare(right.id);
      }

      return sortDirection === "asc" ? result : -result;
    });
  }, [payments, sortColumn, sortDirection]);

  const handlePaymentClick = (paymentId: string) => {
    setSelectedPayment(paymentId);
    setIsSheetOpen(true);
  };

  const handleDownloadCSV = () => {
    if (!sortedPayments.length) return;

    const mapped = sortedPayments.map((p) => ({
      ID: p.id,
      Amount: `${p.amount.toLocaleString()} ${p.asset}`,
      Status: p.status.charAt(0).toUpperCase() + p.status.slice(1),
      Recipient: p.recipient,
      Description: p.description ?? "",
      Date: new Date(p.created_at).toLocaleString(),
    }));

    const csv = convertToCSV(mapped);
    if (!csv) return;

    const filename = `payments_${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;

    downloadCSV(csv, filename);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setSelectedPayment(null);
  };

  const closeSheet = () => {
    setIsSheetOpen(false);
    setSelectedPayment(null);
  };

  const handleCopyId = async (id: string, event: React.MouseEvent) => {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(id);
    } catch {
      const el = document.createElement("textarea");
      el.value = id;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    toast.success("Intent ID copied to clipboard");
  };

  if (showSkeleton || loading) {
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
              Connection Error
            </h3>

            <p className="text-sm text-yellow-400">{error}</p>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Make sure the backend is running and the payments endpoint is
              available.
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
              Retry Connection
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
              Test Webhook Anyway
            </button>
          </div>

          <div className="mt-4 p-3 rounded-lg border border-yellow-500/20 bg-yellow-500/5">
            <div className="flex items-start gap-3">
              <div className="w-2 h-2 rounded-full bg-yellow-400 mt-1.5 flex-shrink-0" />
              <div className="text-left">
                <p className="text-xs font-medium text-yellow-400">
                  Troubleshooting Tip
                </p>
            
                <p className="text-xs text-slate-500">
                  You can still test webhook functionality while backend
                  services are being restored.
                </p>
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
      </div>
    );
  }

  if (error) {
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
              No payments yet
            </h3>
            
            <p className="text-sm text-slate-400 max-w-md mx-auto">
              Start accepting payments by creating your first payment link or
              testing webhooks to see transaction data flow. 
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
              Create Payment Link
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
              Send Test Webhook
            </button>
          </div>

          <div className="mt-6 p-4 rounded-lg border border-slate-700/50 bg-slate-800/30">
            <div className="flex items-start gap-3">
              <div className="w-2 h-2 rounded-full bg-mint mt-1.5 flex-shrink-0" />
              <div className="text-left space-y-1">
                
                <p className="text-xs font-medium text-mint">
                  Getting Started Guide
                </p>
                <p className="text-xs text-slate-400">
                  Use webhook tools to test payment notifications and see
                  real-time data appear in this dashboard. 
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
      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label
              htmlFor="search"
              className="text-xs font-medium uppercase tracking-wider text-slate-400"
            >
              Search
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
                Status
              </label>
              <select
                id="status"
                value={filters.status}
                onChange={(event) => handleFilterChange("status", event.target.value)}
                className="rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-white focus:border-mint/50 focus:outline-none focus:ring-1 focus:ring-mint/50"
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
                className="text-xs font-medium uppercase tracking-wider text-slate-400"
              >
                Asset
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
                From Date
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
                To Date
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
              <span className="text-xs text-slate-400">Active filters:</span>

              {filters.search && (
                <span className="inline-flex items-center gap-1 rounded-full border border-mint/30 bg-mint/10 px-3 py-1 text-xs text-mint">
                  Search: &quot;{filters.search}&quot;
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
              {filters.status !== "all" && (
                <span className="inline-flex items-center gap-1 rounded-full border border-mint/30 bg-mint/10 px-3 py-1 text-xs text-mint">
                  Status: {filters.status}
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
              {filters.asset !== "all" && (
                <span className="inline-flex items-center gap-1 rounded-full border border-mint/30 bg-mint/10 px-3 py-1 text-xs text-mint">
                  Asset: {filters.asset}
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
              {filters.dateFrom && (
                <span className="inline-flex items-center gap-1 rounded-full border border-mint/30 bg-mint/10 px-3 py-1 text-xs text-mint">
                  From: {filters.dateFrom}
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
              {filters.dateTo && (
                <span className="inline-flex items-center gap-1 rounded-full border border-mint/30 bg-mint/10 px-3 py-1 text-xs text-mint">
                  To: {filters.dateTo}
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
          {t("showingResults", { shown: sortedPayments.length, total: totalCount })}
          {hasActiveFilters ? ` ${t("filteredSuffix")}` : ""}
        </p>

        <ExportCsvButton
          transactions={sortedPayments.map((payment) => ({
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

      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold text-white">Recent Payments</h2>

        <button
          onClick={handleDownloadCSV}
          disabled={!sortedPayments.length}
          className="rounded-lg bg-mint px-4 py-2 text-sm font-medium text-black hover:bg-glow disabled:opacity-50"
        >
          Download CSV
        </button>
      </div>
      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-white/10 bg-white/5">
              <th
                aria-sort={
                  sortColumn === "status"
                    ? sortDirection === "asc"
                      ? "ascending"
                      : "descending"
                    : "none"
                }
                className="px-4 py-3 font-mono text-xs uppercase tracking-wider text-slate-400"
              >
                <button
                  type="button"
                  onClick={() => handleSort("status")}
                  className="inline-flex items-center gap-2 transition-colors hover:text-white"
                >
                  {t("tableStatus")}
                  <SortArrow
                    active={sortColumn === "status"}
                    direction={sortDirection}
                  />
                </button>
              </th>
              <th
                aria-sort={
                  sortColumn === "amount"
                    ? sortDirection === "asc"
                      ? "ascending"
                      : "descending"
                    : "none"
                }
                className="px-4 py-3 font-mono text-xs uppercase tracking-wider text-slate-400"
              >
                <button
                  type="button"
                  onClick={() => handleSort("amount")}
                  className="inline-flex items-center gap-2 transition-colors hover:text-white"
                >
                  {t("tableAmount")}
                  <SortArrow
                    active={sortColumn === "amount"}
                    direction={sortDirection}
                  />
                </button>
              </th>
              <th
                aria-sort={
                  sortColumn === "recipient"
                    ? sortDirection === "asc"
                      ? "ascending"
                      : "descending"
                    : "none"
                }
                className="hidden px-4 py-3 font-mono text-xs uppercase tracking-wider text-slate-400 sm:table-cell"
              >
                <button
                  type="button"
                  onClick={() => handleSort("recipient")}
                  className="inline-flex items-center gap-2 transition-colors hover:text-white"
                >
                  {t("tableRecipient")}
                  <SortArrow
                    active={sortColumn === "recipient"}
                    direction={sortDirection}
                  />
                </button>
              </th>
              <th
                aria-sort={
                  sortColumn === "created_at"
                    ? sortDirection === "asc"
                      ? "ascending"
                      : "descending"
                    : "none"
                }
                className="hidden px-4 py-3 font-mono text-xs uppercase tracking-wider text-slate-400 md:table-cell"
              >
                <button
                  type="button"
                  onClick={() => handleSort("created_at")}
                  className="inline-flex items-center gap-2 transition-colors hover:text-white"
                >
                  {t("tableDate")}
                  <SortArrow
                    active={sortColumn === "created_at"}
                    direction={sortDirection}
                  />
                </button>
              </th>
              <th className="px-4 py-3 font-mono text-xs uppercase tracking-wider text-slate-400">
                {t("tableLink")}
              </th>
            </tr>
          </thead>

            <tbody className="divide-y divide-white/5">
              {sortedPayments.map((payment) => (
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
                    <span className="inline-flex items-center gap-1.5">
                      {payment.amount} {payment.asset}
                      <button
                        onClick={(event) => handleCopyId(payment.id, event)}
                        className="text-slate-500 transition-colors hover:text-mint"
                        aria-label="Copy intent ID"
                        title={`Copy ${payment.id}`}
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-3.5 w-3.5"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                      </button>
                    </span>
                  </td>
                  <td className="hidden px-4 py-3 text-slate-400 sm:table-cell">
                    <code className="font-mono text-xs text-slate-300">
                      {payment.recipient}
                    </code>
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

      {/* Pagination Controls */}
      {totalCount > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="flex items-center gap-2">
            <label htmlFor="limit" className="text-sm text-slate-400">
              Items per page
            </label>
            <select
              id="limit"
              value={filters.limit}
              onChange={(e) => handleFilterChange("limit", parseInt(e.target.value, 10))}
              className="rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-sm text-white focus:border-mint/50 focus:outline-none focus:ring-1 focus:ring-mint/50"
            >
              {[10, 20, 50, 100].map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <button
              disabled={filters.page <= 1}
              onClick={() => handleFilterChange("page", filters.page - 1)}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <span className="text-sm text-slate-400">
              Page {filters.page} of {Math.max(1, Math.ceil(totalCount / filters.limit))}
            </span>
            <button
              disabled={filters.page >= Math.ceil(totalCount / filters.limit)}
              onClick={() => handleFilterChange("page", filters.page + 1)}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      )}

      <PaymentDetailModal
        paymentId={selectedPayment}
        isOpen={isModalOpen}
        onClose={closeModal}
      />

      <PaymentDetailsSheet
        paymentId={selectedPayment}
        isOpen={isSheetOpen}
        onClose={closeSheet}
      />
    </div>
  );
}
