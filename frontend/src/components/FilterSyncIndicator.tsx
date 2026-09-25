/**
 * FilterSyncIndicator Component
 *
 * Provides visual feedback for filter synchronization states.
 * Shows different states for search debounce, filter transitions, and clearing operations.
 * Used throughout the Transaction Filter Sidebar for consistent loading feedback.
 */

"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";

interface FilterSyncIndicatorProps {
  /** Type of operation being performed */
  type: "search" | "filter" | "clearing" | "date";
  /** Whether the operation is currently in progress */
  isActive: boolean;
  /** Optional custom label for accessibility */
  label?: string;
  /** Whether to show compact version (for inline use) or full version */
  compact?: boolean;
}

/**
 * Compact inline spinner for use within buttons and labels
 */
function CompactSpinner({ label }: { label?: string }) {
  return (
    <span
      role="status"
      aria-label={label}
      className="inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--pluto-500)]"
    >
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
        className="inline-flex"
      >
        <svg
          className="h-3 w-3"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      </motion.div>
      {label && <span className="sr-only">{label}</span>}
    </span>
  );
}

/**
 * Full-featured sync indicator with badge and animations
 */
export default function FilterSyncIndicator({
  type,
  isActive,
  label,
  compact = false,
}: FilterSyncIndicatorProps) {
  const t = useTranslations("transactionFilters");

  if (compact) {
    return <CompactSpinner label={label} />;
  }

  const typeLabels: Record<string, string> = {
    search: t("search.syncLabel"),
    filter: t("applyingFilter"),
    clearing: t("clearing"),
    date: t("applyingFilter"),
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: isActive ? 1 : 0, y: isActive ? 0 : -4 }}
      transition={{ duration: 0.2 }}
      className="inline-flex items-center gap-2 rounded-full bg-[var(--pluto-50,#f0f4ff)] px-3 py-1.5 text-[10px] font-semibold text-[var(--pluto-500)] ring-1 ring-[var(--pluto-200)] shadow-sm"
      aria-hidden={!isActive}
    >
      <CompactSpinner label={label || typeLabels[type]} />
      <span>{label || typeLabels[type]}</span>
    </motion.div>
  );
}
