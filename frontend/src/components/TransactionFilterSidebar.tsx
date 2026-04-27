"use client";

import React from "react";
import { motion, AnimatePresence } from "framer-motion";

interface FilterState {
  search: string;
  status: string;
  asset: string;
  dateFrom: string;
  dateTo: string;
}

interface TransactionFilterSidebarProps {
  /** Draft / optimistic filter state; should update synchronously on interaction. */
  filters: FilterState;
  onFilterChange: (key: keyof FilterState, value: string) => void;
  onClearFilter: (key: keyof FilterState) => void;
  onClearAll: () => void;
  /** Reflects draft filters so actions like Clear All stay usable before URL sync (e.g. search debounce). */
  hasActiveFilters: boolean;
  /** When true, draft search differs from URL-applied search; URL update is in flight. */
  searchSyncPending?: boolean;
  isOpen?: boolean;
  onClose?: () => void;
}

const STATUS_OPTIONS = [
  "all",
  "pending",
  "confirmed",
  "failed",
  "refunded",
] as const;

const ASSET_OPTIONS = ["all", "XLM", "USDC"] as const;

export default function TransactionFilterSidebar({
  filters,
  onFilterChange,
  onClearFilter,
  onClearAll,
  hasActiveFilters,
  searchSyncPending = false,
  isOpen = false,
  onClose,
}: TransactionFilterSidebarProps) {
  const renderContent = (isMobile: boolean) => {
    const idSuffix = isMobile ? "-mobile" : "";
    return (
      <div className="flex h-full flex-col bg-white p-6 shadow-xl border-l border-[#E8E8E8]">
        <div className="mb-8 flex items-center justify-between">
          <h2 className="text-xl font-bold text-[#0A0A0A]">Filters</h2>
          {onClose && isMobile && (
            <button
              onClick={onClose}
              className="rounded-full p-2 hover:bg-[#F5F5F5] transition-colors lg:hidden"
              aria-label="Close filters"
            >
              <svg className="h-5 w-5 text-[#6B6B6B]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-6 overflow-y-auto pr-2 custom-scrollbar">
          {/* Search: optimistic — parent owns draft + debounced URL sync */}
          <div className="flex flex-col gap-2">
            <label htmlFor={`sidebar-search${idSuffix}`} className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]">
              Search
              {searchSyncPending ? (
                <span className="sr-only">Applying search to results</span>
              ) : null}
            </label>
            <div className="relative">
              <input
                id={`sidebar-search${idSuffix}`}
                type="text"
                value={filters.search}
                onChange={(e) => onFilterChange("search", e.target.value)}
                aria-busy={searchSyncPending}
                placeholder="ID or description..."
                className={`w-full rounded-xl border bg-[#F9F9F9] py-2.5 pl-10 pr-4 text-sm text-[#0A0A0A] placeholder:text-[#6B6B6B] focus:bg-white focus:outline-none transition-all ${
                  searchSyncPending
                    ? "border-dashed border-[var(--pluto-400)] focus:border-[var(--pluto-500)]"
                    : "border-[#E8E8E8] focus:border-[var(--pluto-500)]"
                }`}
              />
              <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#A0A0A0]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>

          {/* Status */}
          <div className="flex flex-col gap-2">
            <label htmlFor={`sidebar-status${idSuffix}`} className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]">
              Status
            </label>
            <select
              id={`sidebar-status${idSuffix}`}
              value={filters.status}
              onChange={(e) => onFilterChange("status", e.target.value)}
              className="w-full rounded-xl border border-[#E8E8E8] bg-[#F9F9F9] px-4 py-2.5 text-sm text-[#0A0A0A] focus:border-[var(--pluto-500)] focus:bg-white focus:outline-none transition-all appearance-none cursor-pointer"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s === "all" ? "All Statuses" : s.charAt(0).toUpperCase() + s.slice(1)}
                </option>
              ))}
            </select>
          </div>

          {/* Asset */}
          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]">
              Asset
            </label>
            <div className="flex flex-wrap gap-2">
              {ASSET_OPTIONS.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => onFilterChange("asset", a)}
                  className={`rounded-full px-4 py-1.5 text-xs font-bold uppercase tracking-widest transition-all ${
                    filters.asset === a
                      ? "bg-[var(--pluto-500)] text-white shadow-md shadow-pluto-500/20"
                      : "bg-[#F9F9F9] text-[#6B6B6B] border border-[#E8E8E8] hover:border-[var(--pluto-300)]"
                  }`}
                >
                  {a === "all" ? "All" : a}
                </button>
              ))}
            </div>
          </div>

          {/* Date Range */}
          <div className="flex flex-col gap-4 pt-2 border-t border-[#F0F0F0] mt-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]">Date Range</p>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`sidebar-date-from${idSuffix}`} className="text-[10px] text-[#A0A0A0] font-medium">From</label>
                <input
                  id={`sidebar-date-from${idSuffix}`}
                  type="date"
                  value={filters.dateFrom}
                  onChange={(e) => onFilterChange("dateFrom", e.target.value)}
                  className="w-full rounded-xl border border-[#E8E8E8] bg-[#F9F9F9] px-3 py-2 text-sm text-[#0A0A0A] focus:border-[var(--pluto-500)] focus:outline-none [color-scheme:light]"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`sidebar-date-to${idSuffix}`} className="text-[10px] text-[#A0A0A0] font-medium">To</label>
                <input
                  id={`sidebar-date-to${idSuffix}`}
                  type="date"
                  value={filters.dateTo}
                  onChange={(e) => onFilterChange("dateTo", e.target.value)}
                  className="w-full rounded-xl border border-[#E8E8E8] bg-[#F9F9F9] px-3 py-2 text-sm text-[#0A0A0A] focus:border-[var(--pluto-500)] focus:outline-none [color-scheme:light]"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 pt-6 border-t border-[#F0F0F0]">
          <button
            type="button"
            onClick={onClearAll}
            disabled={!hasActiveFilters}
            className="w-full rounded-xl bg-[#0A0A0A] py-3 text-[10px] font-bold uppercase tracking-widest text-white transition-all hover:bg-[#2A2A2A] active:scale-[0.98] disabled:opacity-20 disabled:cursor-not-allowed"
          >
            Clear All Filters
          </button>
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Desktop view: persistent on the right if needed, or floating */}
      <div className="hidden lg:block w-[320px] h-fit sticky top-24">
        {renderContent(false)}
      </div>

      {/* Mobile view: Drawer */}
      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onClose}
              className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm lg:hidden"
              aria-hidden="true"
            />
            <motion.aside
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="fixed inset-y-0 right-0 z-[110] w-[min(320px,90vw)] lg:hidden"
              role="dialog"
              aria-modal="true"
              aria-label="Filter sidebar"
            >
              {renderContent(true)}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
