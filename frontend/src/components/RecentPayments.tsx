"use client";

import { useCallback, useEffect, useMemo, useState, memo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import Skeleton from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";
import PaymentDetailModal from "@/components/PaymentDetailModal";
import PaymentDetailsSheet from "@/components/PaymentDetailsSheet";
import { localeToLanguageTag } from "@/i18n/config";
import {
  useHydrateMerchantStore,
  useMerchantApiKey,
  useMerchantId,
} from "@/lib/merchant-store";
import { usePaymentSocket } from "@/lib/usePaymentSocket";
import { convertToCSV, downloadCSV } from "@/utils/csv";
import Link from "next/link";

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

const STATUS_OPTIONS = [
  "all",
  "pending",
  "confirmed",
  "failed",
  "refunded",
] as const;
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
const DEFAULT_SORT: SortColumn = "created_at";
const DEFAULT_DIR: SortDirection = "desc";

function filtersFromParams(p: URLSearchParams): FilterState {
  return {
    search: p.get("search") ?? "",
    status: p.get("status") ?? "all",
    asset: p.get("asset") ?? "all",
    dateFrom: p.get("date_from") ?? "",
    dateTo: p.get("date_to") ?? "",
    page: parseInt(p.get("page") ?? "1", 10),
    limit: parseInt(p.get("limit") ?? "10", 10),
  };
}
function sortFromParams(p: URLSearchParams) {
  const c = p.get("sortColumn");
  const d = p.get("sortDirection");
  return {
    sortColumn: (c === "status" ||
    c === "amount" ||
    c === "recipient" ||
    c === "created_at"
      ? c
      : DEFAULT_SORT) as SortColumn,
    sortDirection: (d === "asc" || d === "desc"
      ? d
      : DEFAULT_DIR) as SortDirection,
  };
}
function buildParams(
  f: FilterState,
  sc: SortColumn,
  sd: SortDirection,
): URLSearchParams {
  const p = new URLSearchParams();
  if (f.search) p.set("search", f.search);
  if (f.status !== "all") p.set("status", f.status);
  if (f.asset !== "all") p.set("asset", f.asset);
  if (f.dateFrom) p.set("date_from", f.dateFrom);
  if (f.dateTo) p.set("date_to", f.dateTo);
  if (f.page > 1) p.set("page", String(f.page));
  if (f.limit !== 10) p.set("limit", String(f.limit));
  if (sc !== DEFAULT_SORT) p.set("sortColumn", sc);
  if (sd !== DEFAULT_DIR) p.set("sortDirection", sd);
  return p;
}

const STATUS_STYLE: Record<string, string> = {
  confirmed: "bg-emerald-50 text-emerald-700 border-emerald-200 shadow-sm",
  completed: "bg-emerald-50 text-emerald-700 border-emerald-200 shadow-sm",
  pending: "bg-amber-50 text-amber-700 border-amber-200 shadow-sm",
  failed: "bg-red-50 text-red-700 border-red-200 shadow-sm",
  refunded: "bg-blue-50 text-blue-700 border-blue-200 shadow-sm",
};
const STATUS_DOT: Record<string, string> = {
  confirmed: "bg-emerald-500",
  completed: "bg-emerald-500",
  pending: "bg-amber-500",
  failed: "bg-red-500",
  refunded: "bg-blue-500",
};

function StatusBadge({ status }: { status: string }) {
  const cls =
    STATUS_STYLE[status] ?? "bg-[#F9F9F9] text-[#6B6B6B] border-[#E8E8E8]";
  const dot = STATUS_DOT[status] ?? "bg-[#6B6B6B]";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest ${cls}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {status}
    </span>
  );
}

function SortBtn({
  active,
  dir,
  onClick,
  children,
}: {
  active: boolean;
  dir: SortDirection;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B] hover:text-[#0A0A0A] transition-colors"
    >
      {children}
      <span
        className={`transition-opacity ${active ? "opacity-100" : "opacity-30"}`}
      >
        {dir === "asc" ? "↑" : "↓"}
      </span>
    </button>
  );
}

export const RecentPayments = memo(function RecentPayments({
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
    () => filtersFromParams(searchParams),
    [searchParams],
  );
  const { sortColumn, sortDirection } = useMemo(
    () => sortFromParams(searchParams),
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
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [flashedIds, setFlashedIds] = useState<Set<string>>(new Set());

  // Local search state — avoids losing focus on every keystroke
  const [searchInput, setSearchInput] = useState(filters.search);

  // Sync local search with URL params (e.g. on back navigation)
  useEffect(() => {
    setSearchInput(filters.search);
  }, [filters.search]);

  // Debounce search → URL update
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput !== filters.search) {
        updateFilters({ ...filters, search: searchInput, page: 1 });
      }
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const updateFilters = useCallback(
    (nf: FilterState, sc = sortColumn, sd = sortDirection) => {
      const q = buildParams(nf, sc, sd).toString();
      router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
    },
    [pathname, router, sortColumn, sortDirection],
  );

  const handleFilterChange = useCallback(
    (key: keyof FilterState, value: string | number) => {
      updateFilters({
        ...filters,
        [key]: value,
        ...(key !== "page" ? { page: 1 } : {}),
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

  const handleSort = useCallback(
    (col: SortColumn) => {
      const nd = sortColumn === col && sortDirection === "asc" ? "desc" : "asc";
      updateFilters(filters, col, nd);
    },
    [filters, sortColumn, sortDirection, updateFilters],
  );

  const handleConfirmed = useCallback((event: { id: string }) => {
    setPayments((prev) =>
      prev.map((p) => (p.id === event.id ? { ...p, status: "confirmed" } : p)),
    );
    setFlashedIds((prev) => new Set([...prev, event.id]));
    setTimeout(
      () =>
        setFlashedIds((prev) => {
          const n = new Set(prev);
          n.delete(event.id);
          return n;
        }),
      2000,
    );
  }, []);

  usePaymentSocket(merchantId, handleConfirmed);

  useEffect(() => {
    const controller = new AbortController();
    async function fetch_() {
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
        const params = buildParams(filters, sortColumn, sortDirection);
        const res = await fetch(`${apiUrl}/api/payments?${params}`, {
          headers: { "x-api-key": apiKey },
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(t("fetchFailed"));
        const data: PaginatedResponse = await res.json();
        setPayments(data.payments ?? []);
        setTotalCount(data.total_count ?? 0);
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : t("loadFailed"));
      } finally {
        setLoading(false);
      }
    }
    fetch_();
    return () => controller.abort();
  }, [apiKey, filters, sortColumn, sortDirection, t]);

  const sortedPayments = useMemo(() => {
    const order: Record<string, number> = {
      pending: 0,
      confirmed: 1,
      completed: 2,
      failed: 3,
      refunded: 4,
    };
    return [...payments].sort((a, b) => {
      let r = 0;
      if (sortColumn === "amount") r = Number(a.amount) - Number(b.amount);
      else if (sortColumn === "recipient")
        r = a.recipient.localeCompare(b.recipient);
      else if (sortColumn === "status")
        r = (order[a.status] ?? 99) - (order[b.status] ?? 99);
      else
        r = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      if (r === 0) r = a.id.localeCompare(b.id);
      return sortDirection === "asc" ? r : -r;
    });
  }, [payments, sortColumn, sortDirection]);

  const handleDownloadCSV = () => {
    if (!sortedPayments.length) return;
    const csv = convertToCSV(
      sortedPayments.map((p) => ({
        ID: p.id,
        Amount: `${p.amount} ${p.asset}`,
        Status: p.status,
        Recipient: p.recipient,
        Description: p.description ?? "",
        Date: new Date(p.created_at).toLocaleString(),
      })),
    );
    if (csv)
      downloadCSV(csv, `payments_${new Date().toISOString().slice(0, 10)}.csv`);
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / filters.limit));

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (showSkeleton || loading) {
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-2xl border border-[#E8E8E8] bg-white p-4">
          <Skeleton height={40} borderRadius={12} className="mb-4" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} height={40} borderRadius={10} />
            ))}
          </div>
        </div>
        <div className="overflow-x-auto rounded-2xl border border-[#E8E8E8]">
          <div className="min-w-[760px]">
            <div className="border-b border-[#E8E8E8] bg-[#F9F9F9] px-5 py-3 flex gap-8">
              {[80, 100, 120, 80, 60].map((w, i) => (
                <Skeleton key={i} width={w} height={12} borderRadius={4} />
              ))}
            </div>
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="border-b border-[#E8E8E8] px-5 py-4 flex items-center gap-8"
              >
                <Skeleton width={70} height={22} borderRadius={999} />
                <Skeleton width={100} height={16} borderRadius={4} />
                <Skeleton
                  width={140}
                  height={14}
                  borderRadius={4}
                  className="hidden sm:block"
                />
                <Skeleton
                  width={90}
                  height={14}
                  borderRadius={4}
                  className="hidden md:block"
                />
                <Skeleton width={50} height={14} borderRadius={4} />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-10 text-center flex flex-col items-center gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
          <svg
            className="h-6 w-6 text-red-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
            />
          </svg>
        </div>
        <p className="font-bold text-red-700">Unable to load payments</p>
        <p className="text-sm text-red-500">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="rounded-xl border border-red-200 bg-white px-5 py-2.5 text-sm font-bold text-red-600 hover:bg-red-50 transition-all"
        >
          Retry
        </button>
      </div>
    );
  }

  // ── Empty ─────────────────────────────────────────────────────────────────
  if (payments.length === 0 && !hasActiveFilters) {
    return (
      <div className="rounded-2xl border border-[#E8E8E8] bg-[#F9F9F9] p-12 text-center flex flex-col items-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white border border-[#E8E8E8]">
          <svg
            className="h-7 w-7 text-[#6B6B6B]"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
            />
          </svg>
        </div>
        <p className="text-lg font-bold text-[#0A0A0A]">{t("emptyTitle")}</p>
        <p className="text-sm text-[#6B6B6B] max-w-sm">
          {t("emptyDescription")}
        </p>
        <Link
          href="/create"
          className="mt-2 rounded-xl bg-[var(--pluto-500)] px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-white hover:bg-[var(--pluto-600)] transition-all"
        >
          {t("createPaymentLink")}
        </Link>
      </div>
    );
  }

  // ── Main table ────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4">
      {/* Filters */}
      <div
        role="region"
        aria-label="Transaction Filters"
        className="rounded-2xl border border-[#E8E8E8] bg-white p-3 sm:p-5 flex flex-col gap-3 sm:gap-4"
      >
        <div className="relative">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by ID, description or recipient…"
            className="w-full rounded-xl border border-[#E8E8E8] bg-[#F9F9F9] py-2.5 pl-10 pr-4 text-sm text-[#0A0A0A] placeholder-[#A0A0A0] focus:border-[#0A0A0A] focus:bg-white focus:outline-none transition-all touch-manipulation"
            aria-label="Search transactions"
          />
          <svg
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#A0A0A0] pointer-events-none"
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

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <select
            value={filters.status}
            onChange={(e) => handleFilterChange("status", e.target.value)}
            className="rounded-xl border border-[#E8E8E8] bg-[#F9F9F9] px-3 py-2.5 text-sm text-[#0A0A0A] focus:border-[#0A0A0A] focus:outline-none transition-all"
            aria-label="Filter by status"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s === "all" ? t("allStatuses") : t(`statuses.${s}`)}
              </option>
            ))}
          </select>
          <select
            value={filters.asset}
            onChange={(e) => handleFilterChange("asset", e.target.value)}
            className="rounded-xl border border-[#E8E8E8] bg-[#F9F9F9] px-3 py-2.5 text-sm text-[#0A0A0A] focus:border-[#0A0A0A] focus:outline-none transition-all"
            aria-label="Filter by asset"
          >
            {ASSET_OPTIONS.map((a) => (
              <option key={a} value={a}>
                {a === "all" ? t("allAssets") : a}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={filters.dateFrom}
            onChange={(e) => handleFilterChange("dateFrom", e.target.value)}
            className="rounded-xl border border-[#E8E8E8] bg-[#F9F9F9] px-3 py-2.5 text-sm text-[#0A0A0A] focus:border-[#0A0A0A] focus:outline-none transition-all [color-scheme:light] touch-manipulation"
            aria-label="Filter from date"
          />
          <input
            type="date"
            value={filters.dateTo}
            onChange={(e) => handleFilterChange("dateTo", e.target.value)}
            className="rounded-xl border border-[#E8E8E8] bg-[#F9F9F9] px-3 py-2.5 text-sm text-[#0A0A0A] focus:border-[#0A0A0A] focus:outline-none transition-all [color-scheme:light] touch-manipulation"
            aria-label="Filter to date"
          />
        </div>

        {/* Screen reader announcement for filter changes */}
        <div
          className="sr-only"
          role="status"
          aria-live="polite"
        >
          {hasActiveFilters ? `Filters active: ${Object.entries(filters).filter(([k,v]) => v && v !== 'all' && k !== 'page' && k !== 'limit').map(([k,v]) => `${k}: ${v}`).join(', ')}` : "No filters active"}
        </div>

        {hasActiveFilters && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]">
              {t("activeFilters")}
            </span>
            {filters.search && (
              <Chip
                label={`"${filters.search}"`}
                onRemove={() => clearFilter("search")}
              />
            )}
            {filters.status !== "all" && (
              <Chip
                label={filters.status}
                onRemove={() => clearFilter("status")}
              />
            )}
            {filters.asset !== "all" && (
              <Chip
                label={filters.asset}
                onRemove={() => clearFilter("asset")}
              />
            )}
            {filters.dateFrom && (
              <Chip
                label={`From ${filters.dateFrom}`}
                onRemove={() => clearFilter("dateFrom")}
              />
            )}
            {filters.dateTo && (
              <Chip
                label={`To ${filters.dateTo}`}
                onRemove={() => clearFilter("dateTo")}
              />
            )}
            <button
              onClick={() => updateFilters(DEFAULT_FILTERS)}
              className="ml-auto text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B] underline underline-offset-4 hover:text-[#0A0A0A] transition-colors"
            >
              {t("clearAll")}
            </button>
          </div>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-[#6B6B6B] font-medium">
          {t("showingResults", {
            shown: sortedPayments.length,
            total: totalCount,
          })}{" "}
          {hasActiveFilters ? t("filteredSuffix") : ""}
        </p>
        <button
          onClick={handleDownloadCSV}
          disabled={!sortedPayments.length}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[#E8E8E8] bg-white px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-[#0A0A0A] hover:bg-[#F5F5F5] disabled:opacity-40 sm:w-auto transition-all"
        >
          <svg
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          Export CSV
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-2xl border border-[#E8E8E8]">
        <table className="min-w-[760px] w-full text-left text-sm">
          <thead>
            <tr className="border-b border-[#E8E8E8] bg-[#F9F9F9] hover:bg-[#F5F5F5] transition-colors">
              <th className="px-3 py-3 sm:px-5">
                <SortBtn
                  active={sortColumn === "status"}
                  dir={sortDirection}
                  onClick={() => handleSort("status")}
                >
                  {t("tableStatus")}
                </SortBtn>
              </th>
              <th className="px-3 py-3 sm:px-5">
                <SortBtn
                  active={sortColumn === "amount"}
                  dir={sortDirection}
                  onClick={() => handleSort("amount")}
                >
                  {t("tableAmount")}
                </SortBtn>
              </th>
              <th className="px-3 py-3 sm:px-5">
                <SortBtn
                  active={sortColumn === "recipient"}
                  dir={sortDirection}
                  onClick={() => handleSort("recipient")}
                >
                  {t("tableRecipient")}
                </SortBtn>
              </th>
              <th className="px-3 py-3 sm:px-5 text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]">
                Description
              </th>
              <th className="px-3 py-3 sm:px-5">
                <SortBtn
                  active={sortColumn === "created_at"}
                  dir={sortDirection}
                  onClick={() => handleSort("created_at")}
                >
                  {t("tableDate")}
                </SortBtn>
              </th>
              <th className="px-3 py-3 sm:px-5 text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F0F0F0]">
            {sortedPayments.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-5 py-12 text-center text-sm text-[#6B6B6B]"
                >
                  No payments match your filters.
                </td>
              </tr>
            ) : (
              sortedPayments.map((payment) => (
                <tr
                  key={payment.id}
                  onClick={() => {
                    setSelectedPayment(payment.id);
                    setIsSheetOpen(true);
                  }}
                  className={`group cursor-pointer border-l-2 border-l-transparent transition-all duration-200 ease-in-out hover:bg-[#F9F9F9] hover:shadow-sm hover:border-l-[var(--pluto-500)] active:bg-[#F5F5F5] active:scale-[0.995] ${flashedIds.has(payment.id) ? "bg-emerald-50 border-l-emerald-500" : ""}`}
                >
                  <td className="px-3 py-4 sm:px-5">
                    <StatusBadge status={payment.status} />
                  </td>
                  <td className="px-3 py-4 sm:px-5">
                    <span className="font-bold text-[#0A0A0A]">
                      {payment.amount}
                    </span>
                    <span className="ml-1.5 text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]">
                      {payment.asset}
                    </span>
                  </td>
                  <td className="px-3 py-4 sm:px-5">
                    <code className="font-mono text-xs text-[#6B6B6B]">
                      {payment.recipient.slice(0, 8)}…
                      {payment.recipient.slice(-6)}
                    </code>
                  </td>
                  <td className="px-3 py-4 sm:px-5 text-sm text-[#6B6B6B] max-w-[180px] truncate">
                    {payment.description || (
                      <span className="text-[#C0C0C0]">—</span>
                    )}
                  </td>
                  <td className="px-3 py-4 sm:px-5 text-sm text-[#6B6B6B] whitespace-nowrap">
                    {new Date(payment.created_at).toLocaleDateString(locale, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </td>
                  <td className="px-3 py-4 sm:px-5">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedPayment(payment.id);
                        setIsSheetOpen(true);
                      }}
                      className="rounded-lg border border-[#E8E8E8] bg-white px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-[#0A0A0A] opacity-100 sm:opacity-0 sm:group-hover:opacity-100 hover:bg-[var(--pluto-50)] hover:border-[var(--pluto-400)] hover:text-[var(--pluto-700)] hover:shadow-sm active:scale-95 transition-all duration-200"
                    >
                      View →
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalCount > 0 && (
        <div className="flex flex-col gap-4 rounded-2xl border border-[#E8E8E8] bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="flex w-full items-center gap-2 text-sm text-[#6B6B6B] sm:w-auto">
            <span className="font-medium">Rows:</span>
            <select
              value={filters.limit}
              onChange={(e) =>
                handleFilterChange("limit", parseInt(e.target.value, 10))
              }
              className="rounded-lg border border-[#E8E8E8] bg-[#F9F9F9] px-2 py-1 text-sm text-[#0A0A0A] focus:outline-none touch-manipulation min-h-[36px]"
            >
              {[10, 20, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div className="flex w-full flex-wrap items-center justify-between gap-2 sm:w-auto sm:flex-nowrap">
            <button
              disabled={filters.page <= 1}
              onClick={() => handleFilterChange("page", filters.page - 1)}
              className="rounded-xl border border-[#E8E8E8] bg-white px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-[#0A0A0A] hover:bg-[#F5F5F5] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              ← Prev
            </button>
            <span className="text-xs font-medium text-[#6B6B6B] px-1 sm:px-2 whitespace-nowrap">
              <span className="hidden xs:inline">
                Page {filters.page} of {totalPages}
              </span>
              <span className="xs:hidden">
                {filters.page}/{totalPages}
              </span>
            </span>
            <button
              disabled={filters.page >= totalPages}
              onClick={() => handleFilterChange("page", filters.page + 1)}
              className="rounded-xl border border-[#E8E8E8] bg-white px-3 sm:px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-[#0A0A0A] hover:bg-[#F5F5F5] disabled:opacity-40 disabled:cursor-not-allowed transition-all touch-manipulation min-h-[44px]"
            >
              <span className="hidden xs:inline">Next →</span>
              <span className="xs:hidden">→</span>
            </button>
          </div>
        </div>
      )}

      <PaymentDetailModal
        paymentId={selectedPayment}
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setSelectedPayment(null);
        }}
      />
      <PaymentDetailsSheet
        paymentId={selectedPayment}
        isOpen={isSheetOpen}
        onClose={() => {
          setIsSheetOpen(false);
          setSelectedPayment(null);
        }}
      />
    </div>
  );
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-[#E8E8E8] bg-[#F9F9F9] px-3 py-1.5 text-[10px] font-bold text-[#0A0A0A]">
      {label}
      <button
        onClick={onRemove}
        className="ml-0.5 rounded-full p-1 hover:bg-[#E8E8E8] transition-colors touch-manipulation"
        aria-label={`Remove ${label} filter`}
      >
        <svg
          className="h-2.5 w-2.5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2.5}
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>
    </span>
  );
}
e x p o r t   d e f a u l t   R e c e n t P a y m e n t s ;  
 