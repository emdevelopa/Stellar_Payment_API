"use client";

import { useTranslations } from "next-intl";

interface TransactionHistoryPaginationProps {
  page: number;
  totalPages: number;
  totalCount: number;
  limit: number;
  onPageChange: (page: number) => void;
  disabled?: boolean;
}

const SIBLING_COUNT = 1;

/**
 * Builds a windowed page list with `null` standing in for an ellipsis, e.g.
 * [1, null, 4, 5, 6, null, 12] for page=5, totalPages=12.
 */
function buildPageWindow(page: number, totalPages: number): (number | null)[] {
  const totalNumbers = SIBLING_COUNT * 2 + 5; // first + last + current + 2 siblings + 2 ellipses
  if (totalPages <= totalNumbers) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const leftSibling = Math.max(page - SIBLING_COUNT, 1);
  const rightSibling = Math.min(page + SIBLING_COUNT, totalPages);

  const showLeftEllipsis = leftSibling > 2;
  const showRightEllipsis = rightSibling < totalPages - 1;

  const pages: (number | null)[] = [1];

  if (showLeftEllipsis) pages.push(null);
  for (let p = Math.max(leftSibling, 2); p <= Math.min(rightSibling, totalPages - 1); p++) {
    pages.push(p);
  }
  if (showRightEllipsis) pages.push(null);

  pages.push(totalPages);

  return pages;
}

/**
 * Pure, presentational pagination control for the payment history table.
 * Deliberately holds no data-fetching or URL logic of its own (all state is
 * passed in via props / raised via `onPageChange`) so it stays trivially
 * composable if the parent page is ever split into a server shell + client
 * island — the page itself can't be a full RSC today because it depends on
 * live WebSocket updates and instant client-side filtering.
 */
export default function TransactionHistoryPagination({
  page,
  totalPages,
  totalCount,
  limit,
  onPageChange,
  disabled = false,
}: TransactionHistoryPaginationProps) {
  const t = useTranslations("recentPayments.pagination");

  if (totalPages <= 1) return null;

  const canGoPrevious = page > 1;
  const canGoNext = page < totalPages;
  const rangeStart = (page - 1) * limit + 1;
  const rangeEnd = Math.min(page * limit, totalCount);
  const pageWindow = buildPageWindow(page, totalPages);

  const baseButtonClasses =
    "inline-flex h-9 min-w-9 items-center justify-center rounded-lg px-2.5 text-xs font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pluto-500)] focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <nav
      aria-label={t("ariaLabel")}
      className="flex flex-col items-center gap-3 border-t border-[#E8E8E8] py-6 sm:flex-row sm:justify-between"
    >
      <p className="text-[10px] font-bold uppercase tracking-widest text-[#A0A0A0]">
        {t("range", { start: rangeStart, end: rangeEnd, total: totalCount })}
      </p>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={!canGoPrevious || disabled}
          aria-label={t("previous")}
          className={`${baseButtonClasses} border border-[#E8E8E8] text-[#0A0A0A] hover:bg-[#F5F5F5]`}
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        {/* Page numbers — hidden on the smallest screens in favour of "Page X of Y" */}
        <div className="hidden items-center gap-1.5 xs:flex">
          {pageWindow.map((p, i) =>
            p === null ? (
              <span key={`ellipsis-${i}`} className="px-1 text-xs text-[#A0A0A0]" aria-hidden="true">
                &hellip;
              </span>
            ) : (
              <button
                key={p}
                type="button"
                onClick={() => onPageChange(p)}
                disabled={disabled}
                aria-label={p === page ? t("currentPage", { page: p }) : t("goToPage", { page: p })}
                aria-current={p === page ? "page" : undefined}
                className={`${baseButtonClasses} ${
                  p === page
                    ? "bg-[var(--pluto-500)] text-white"
                    : "border border-[#E8E8E8] text-[#0A0A0A] hover:bg-[#F5F5F5]"
                }`}
              >
                {p}
              </button>
            ),
          )}
        </div>

        {/* Compact indicator for the smallest screens */}
        <p className="px-2 text-xs font-medium text-[#6B6B6B] xs:hidden" aria-live="polite">
          {t("pageLabel", { page, totalPages })}
        </p>

        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={!canGoNext || disabled}
          aria-label={t("next")}
          className={`${baseButtonClasses} border border-[#E8E8E8] text-[#0A0A0A] hover:bg-[#F5F5F5]`}
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </nav>
  );
}
