"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useTranslations } from "next-intl";
import { useNetworkFee, type NetworkFeeData } from "@/hooks/useNetworkFee";

interface NetworkFeeEstimationProps {
  enabled?: boolean;
}

function FeeLoadingSkeleton() {
  return (
    <div className="flex items-center gap-2" role="status" aria-live="polite">
      <span className="inline-flex h-3 w-3">
        <span className="absolute inline-flex h-3 w-3 animate-ping rounded-full bg-[var(--pluto-300)] opacity-40" />
        <span className="relative inline-flex h-3 w-3 rounded-full bg-[var(--pluto-400)]" />
      </span>
      <span className="h-3 w-24 animate-pulse rounded bg-[var(--pluto-100)]" />
    </div>
  );
}

function FeeErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center gap-2"
      role="alert"
    >
      <svg className="h-3.5 w-3.5 shrink-0 text-[var(--pluto-400)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <span className="text-xs text-[var(--pluto-400)]">{message}</span>
      <button
        type="button"
        onClick={onRetry}
        className="text-[10px] font-bold uppercase tracking-widest text-[var(--pluto-500)] underline underline-offset-2 hover:text-[var(--pluto-700)] transition-colors"
        aria-label="Retry fetching network fee"
      >
        Retry
      </button>
    </motion.div>
  );
}

function FeeDisplay({ fee }: { fee: NetworkFeeData }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className="flex items-center gap-1.5"
    >
      <svg className="h-3.5 w-3.5 shrink-0 text-[var(--pluto-400)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <span className="text-sm font-medium text-[var(--pluto-600)]">
        ~{fee.xlm} XLM
      </span>
    </motion.div>
  );
}

export function NetworkFeeEstimation({ enabled = true }: NetworkFeeEstimationProps) {
  const t = useTranslations("checkout");
  const { fee, isLoading, error, refetch } = useNetworkFee(enabled);

  if (isLoading) {
    return <FeeLoadingSkeleton />;
  }

  if (error) {
    return <FeeErrorState message={t("networkFeeUnavailable")} onRetry={refetch} />;
  }

  if (fee) {
    return <FeeDisplay fee={fee} />;
  }

  return (
    <AnimatePresence mode="wait">
      <motion.span
        key="unavailable"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="text-sm text-[var(--pluto-400)]"
      >
        {t("networkFeeUnavailable")}
      </motion.span>
    </AnimatePresence>
  );
}

export default NetworkFeeEstimation;
