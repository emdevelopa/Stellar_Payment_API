/**
 * NetworkStatusSkeleton
 *
 * Server-safe shimmer placeholder rendered while the NetworkStatusIndicator
 * client bundle loads. No hooks, no framer-motion, no "use client" required.
 */

import React from "react";

function Bone({ className = "" }: { className?: string }) {
  return (
    <div
      className={`rounded bg-gradient-to-r from-pluto-100 via-pluto-50 to-pluto-100
        bg-[length:400%_100%] animate-[shimmer_1.6s_ease-in-out_infinite]
        motion-reduce:animate-none
        dark:from-pluto-800/60 dark:via-pluto-700/30 dark:to-pluto-800/60
        ${className}`}
      aria-hidden="true"
    />
  );
}

export interface NetworkStatusSkeletonProps {
  /** Render in compact pill form (for nav/sidebar use). Default: false. */
  compact?: boolean;
  loadingLabel?: string;
  className?: string;
}

export default function NetworkStatusSkeleton({
  compact = false,
  loadingLabel = "Loading network status…",
  className = "",
}: NetworkStatusSkeletonProps) {
  if (compact) {
    return (
      <div
        className={`inline-flex items-center gap-2 rounded-full border border-pluto-100
          dark:border-pluto-800/60 bg-white dark:bg-pluto-900/80 px-3 py-1.5
          ${className}`}
        role="status"
        aria-label={loadingLabel}
        aria-busy="true"
        data-testid="network-status-skeleton"
      >
        <span className="sr-only">{loadingLabel}</span>
        {/* Status dot */}
        <Bone className="h-2 w-2 flex-shrink-0 rounded-full" />
        {/* Label */}
        <Bone className="h-3 w-16" />
      </div>
    );
  }

  return (
    <div
      className={`w-full rounded-2xl border border-pluto-100 dark:border-pluto-800/60
        bg-white dark:bg-pluto-900/80
        shadow-[0_4px_16px_rgba(13,27,46,0.06)] dark:shadow-[0_4px_16px_rgba(0,0,0,0.25)]
        p-4 ${className}`}
      role="status"
      aria-label={loadingLabel}
      aria-busy="true"
      data-testid="network-status-skeleton"
    >
      <span className="sr-only">{loadingLabel}</span>

      {/* Header row: dot + label + badge */}
      <div className="flex items-center justify-between gap-3" aria-hidden="true">
        <div className="flex items-center gap-2.5">
          <Bone className="h-3 w-3 flex-shrink-0 rounded-full" />
          <Bone className="h-3.5 w-24" />
        </div>
        <Bone className="h-5 w-20 rounded-full" />
      </div>

      {/* Detail rows */}
      <div className="mt-3 space-y-2" aria-hidden="true">
        <div className="flex items-center justify-between">
          <Bone className="h-3 w-20" />
          <Bone className="h-3 w-12" />
        </div>
        <div className="flex items-center justify-between">
          <Bone className="h-3 w-16" />
          <Bone className="h-3 w-16" />
        </div>
      </div>

      {/* Action row */}
      <div className="mt-3 flex items-center justify-between" aria-hidden="true">
        <Bone className="h-3 w-28" />
        <Bone className="h-6 w-20 rounded-lg" />
      </div>
    </div>
  );
}
