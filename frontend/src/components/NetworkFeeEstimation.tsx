"use client";

import { useRef, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslations } from "next-intl";
import { useNetworkFee, type NetworkFeeData } from "@/hooks/useNetworkFee";
import { NETWORK_FEE_LOADING_LABEL, describeNetworkFee } from "@/lib/network-fee-a11y";

interface NetworkFeeEstimationProps {
  enabled?: boolean;
}

function FeeLoadingSkeleton() {
  // Decorative: the loading state is announced by the region's status text.
  return (
    <div className="flex items-center gap-2" aria-hidden="true">
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
      <svg aria-hidden="true" focusable="false" className="h-3.5 w-3.5 shrink-0 text-[var(--pluto-400)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <span className="text-xs text-[var(--pluto-400)]">{message}</span>
      <button
        type="button"
        onClick={onRetry}
        className="rounded text-[10px] font-bold uppercase tracking-widest text-[var(--pluto-500)] underline underline-offset-2 transition-colors hover:text-[var(--pluto-700)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pluto-500)] focus-visible:ring-offset-2"
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
      aria-hidden="true"
    >
      <svg aria-hidden="true" focusable="false" className="h-3.5 w-3.5 shrink-0 text-[var(--pluto-400)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
  const regionRef = useRef<HTMLDivElement>(null);

  // Activating Retry swaps the button for the loading state, which would drop
  // keyboard focus to <body>. Park it on the region so the user keeps their place.
  const handleRetry = () => {
    refetch();
    regionRef.current?.focus();
  };

  const unavailable = t("networkFeeUnavailable");
  const showError = !isLoading && !!error && !fee;
  const showUnavailable = !isLoading && !showError && !fee;

  // One polite status message per state. The visible text is hidden from
  // assistive technology so it is not read twice. The error state announces
  // itself through its own role="alert".
  let statusText = "";
  if (isLoading) statusText = NETWORK_FEE_LOADING_LABEL;
  else if (fee) statusText = describeNetworkFee(fee);
  else if (showUnavailable) statusText = unavailable;

  let content: ReactNode = null;
  if (isLoading) {
    content = <FeeLoadingSkeleton />;
  } else if (showError) {
    // Keep showing the last good estimate when a refresh fails; the hook toasts.
    content = <FeeErrorState message={unavailable} onRetry={handleRetry} />;
  } else if (fee) {
    content = <FeeDisplay fee={fee} />;
  } else {
    content = (
      <AnimatePresence mode="wait">
        <motion.span
          key="unavailable"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="text-sm text-[var(--pluto-400)]"
          aria-hidden="true"
        >
          {unavailable}
        </motion.span>
      </AnimatePresence>
    );
  }

  return (
    <div
      ref={regionRef}
      tabIndex={-1}
      aria-busy={isLoading}
      className="rounded outline-none focus-visible:ring-2 focus-visible:ring-[var(--pluto-500)] focus-visible:ring-offset-2"
      data-testid="network-fee-region"
    >
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {statusText}
      </span>
      {content}
    </div>
  );
}

export default NetworkFeeEstimation;
