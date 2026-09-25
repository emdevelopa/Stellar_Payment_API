/**
 * OnboardingTrackerSkeleton
 *
 * Server-safe, zero-dependency shimmer skeleton used as:
 *  1. The dynamic() loading fallback while the tracker bundle streams in.
 *  2. A standalone placeholder for SSR / Suspense boundaries.
 *
 * No framer-motion, no hooks, no "use client" — renders identically on
 * server and client.
 */

import React from "react";

function Bone({ className = "" }: { className?: string }) {
  return (
    <div
      className={`rounded-lg bg-gradient-to-r from-pluto-100 via-pluto-50 to-pluto-100 bg-[length:400%_100%] animate-shimmer motion-reduce:animate-none dark:from-pluto-800/60 dark:via-pluto-700/30 dark:to-pluto-800/60 ${className}`}
      aria-hidden="true"
    />
  );
}

function StepRowSkeleton({ compact, isLast }: { compact: boolean; isLast: boolean }) {
  return (
    <li className={`relative flex flex-row gap-3 px-3 ${compact ? "py-2" : "py-2.5"}`}>
      {/* Circle */}
      <div
        className={`${compact ? "h-8 w-8" : "h-10 w-10"} flex-shrink-0 rounded-full bg-gradient-to-r from-pluto-100 via-pluto-50 to-pluto-100 bg-[length:400%_100%] animate-shimmer motion-reduce:animate-none dark:from-pluto-800/60 dark:via-pluto-700/30 dark:to-pluto-800/60`}
        aria-hidden="true"
      />
      {/* Text lines */}
      <div className="flex flex-1 flex-col gap-2 pt-1">
        <Bone className={`${compact ? "h-3" : "h-3.5"} w-2/3`} />
        <Bone className={`${compact ? "h-2.5" : "h-3"} w-11/12`} />
        <Bone className="h-4 w-16 rounded-full" />
      </div>
      {!isLast && (
        <div
          className="absolute left-[1.4375rem] top-[calc(100%-4px)] h-3 w-px bg-pluto-100 dark:bg-pluto-800"
          aria-hidden="true"
        />
      )}
    </li>
  );
}

export interface OnboardingTrackerSkeletonProps {
  stepCount?: number;
  compact?: boolean;
  loadingLabel?: string;
  className?: string;
}

export default function OnboardingTrackerSkeleton({
  stepCount = 3,
  compact = false,
  loadingLabel = "Loading onboarding progress…",
  className = "",
}: OnboardingTrackerSkeletonProps) {
  const rows = Array.from({ length: stepCount }, (_, i) => i);

  return (
    <div
      className={`w-full ${className}`}
      role="status"
      aria-label={loadingLabel}
      aria-busy="true"
      data-testid="onboarding-tracker-skeleton"
    >
      <span className="sr-only">{loadingLabel}</span>

      <div
        className={`rounded-2xl border border-pluto-100 dark:border-pluto-800/60
          bg-gradient-to-b from-white to-pluto-50/60
          dark:from-pluto-900/80 dark:to-pluto-900/60
          shadow-[0_8px_32px_rgba(13,27,46,0.06)]
          dark:shadow-[0_8px_32px_rgba(0,0,0,0.3)]
          ${compact ? "p-4" : "p-5 sm:p-6"}`}
      >
        {/* Header */}
        <div className="mb-5 space-y-2" aria-hidden="true">
          <div className="flex items-baseline justify-between gap-2">
            <Bone className={`${compact ? "h-4 w-36" : "h-5 w-44"}`} />
            <Bone className="h-4 w-10" />
          </div>
          <Bone className="h-3 w-4/5" />
          {/* Progress bar track */}
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-pluto-100 dark:bg-pluto-800">
            <div
              className="h-full w-full bg-gradient-to-r from-pluto-200 via-pluto-100 to-pluto-200 bg-[length:400%_100%] animate-shimmer motion-reduce:animate-none dark:from-pluto-700/60 dark:via-pluto-600/30 dark:to-pluto-700/60"
              aria-hidden="true"
            />
          </div>
          <Bone className="h-3 w-32" />
        </div>

        {/* Step rows */}
        <ol className="flex flex-col gap-1" aria-hidden="true">
          {rows.map((i) => (
            <StepRowSkeleton key={i} compact={compact} isLast={i === rows.length - 1} />
          ))}
        </ol>
      </div>
    </div>
  );
}
