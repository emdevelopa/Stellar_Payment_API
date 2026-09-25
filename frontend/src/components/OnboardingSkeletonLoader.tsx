"use client";

/**
 * OnboardingSkeletonLoader
 *
 * Renders a shimmer placeholder that matches the visual structure of the
 * OnboardingProgressTracker while its data is loading.
 *
 * Design decisions:
 * - Mirrors the card layout exactly (header, progress bar, N step rows)
 *   so the transition from skeleton → real content is smooth and non-jarring.
 * - Uses a CSS keyframe shimmer (bg-gradient + animate-shimmer) defined in
 *   globals.css rather than a JS animation, keeping this component tiny.
 * - Supports compact and orientation props so it is a drop-in replacement.
 * - Fully accessible: role="status" + aria-label so screen readers announce
 *   "Loading onboarding steps" instead of reading the decorative bones.
 * - prefers-reduced-motion: shimmer animation is disabled when the OS
 *   setting is active; bones remain but do not pulse.
 */

import React, { memo } from "react";

// ── Shimmer bone primitives ───────────────────────────────────────────────────

/** A single animated shimmer rectangle. */
const Bone = memo(function Bone({
  className = "",
  "aria-hidden": ariaHidden = true,
}: {
  className?: string;
  "aria-hidden"?: boolean;
}) {
  return (
    <div
      className={`animate-shimmer rounded bg-gradient-to-r from-pluto-100 via-pluto-50 to-pluto-100 bg-[length:400%_100%] motion-reduce:animate-none dark:from-pluto-800/60 dark:via-pluto-700/30 dark:to-pluto-800/60 ${className}`}
      aria-hidden={ariaHidden}
    />
  );
});

/** A circular shimmer bone (step indicator placeholder). */
const CircleBone = memo(function CircleBone({
  size = "h-10 w-10",
}: {
  size?: string;
}) {
  return (
    <div
      className={`animate-shimmer flex-shrink-0 rounded-full bg-gradient-to-r from-pluto-100 via-pluto-50 to-pluto-100 bg-[length:400%_100%] motion-reduce:animate-none dark:from-pluto-800/60 dark:via-pluto-700/30 dark:to-pluto-800/60 ${size}`}
      aria-hidden="true"
    />
  );
});

// ── Skeleton step row ─────────────────────────────────────────────────────────

const SkeletonStepRow = memo(function SkeletonStepRow({
  compact,
  isLast,
}: {
  compact: boolean;
  isLast: boolean;
}) {
  return (
    <li className={`relative flex flex-row gap-3 px-3 ${compact ? "py-2" : "py-2.5"}`}>
      {/* Circle indicator */}
      <CircleBone size={compact ? "h-8 w-8" : "h-10 w-10"} />

      {/* Text lines */}
      <div className="flex flex-1 flex-col gap-2 pt-1">
        {/* Title line */}
        <Bone className={`${compact ? "h-3" : "h-3.5"} w-2/3`} />
        {/* Description line */}
        <Bone className={`${compact ? "h-2.5" : "h-3"} w-11/12`} />
        {/* Status badge */}
        <Bone className="h-4 w-16 rounded-full" />
      </div>

      {/* Vertical connector line */}
      {!isLast && (
        <div
          className="absolute left-[1.4375rem] top-[calc(100%-4px)] h-3 w-px bg-pluto-100 dark:bg-pluto-800"
          aria-hidden="true"
        />
      )}
    </li>
  );
});

// ── Main skeleton component ───────────────────────────────────────────────────

export interface OnboardingSkeletonLoaderProps {
  /** Number of skeleton step rows to render. Default: 3. */
  stepCount?: number;
  compact?: boolean;
  orientation?: "vertical" | "horizontal";
  /** Accessible label. Default: "Loading onboarding steps". */
  loadingLabel?: string;
  className?: string;
}

export const OnboardingSkeletonLoader = memo(function OnboardingSkeletonLoader({
  stepCount = 3,
  compact = false,
  loadingLabel = "Loading onboarding steps",
  className = "",
}: OnboardingSkeletonLoaderProps) {
  const rows = Array.from({ length: stepCount }, (_, i) => i);

  return (
    <div
      className={`w-full ${className}`}
      role="status"
      aria-label={loadingLabel}
      aria-busy="true"
      data-testid="onboarding-skeleton"
    >
      {/* sr-only text for screen readers */}
      <span className="sr-only">{loadingLabel}</span>

      {/* Card shell */}
      <div
        className={`
          rounded-2xl border
          border-pluto-100 dark:border-pluto-800/60
          bg-gradient-to-b from-white to-pluto-50/60
          dark:from-pluto-900/80 dark:to-pluto-900/60
          shadow-[0_8px_32px_rgba(13,27,46,0.06)]
          dark:shadow-[0_8px_32px_rgba(0,0,0,0.3)]
          ${compact ? "p-4" : "p-5 sm:p-6"}
        `}
      >
        {/* ── Header skeleton ────────────────────────────────────────────── */}
        <div className="mb-5">
          {/* Title + percentage row */}
          <div className="flex items-baseline justify-between gap-3">
            <Bone className={`${compact ? "h-4 w-36" : "h-5 w-44"}`} />
            <Bone className="h-4 w-10" />
          </div>

          {/* Subtitle */}
          <Bone className="mt-2 h-3 w-4/5" />

          {/* Progress bar track */}
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-pluto-100 dark:bg-pluto-800">
            {/* Shimmer fill — width unknown so we show full shimmer */}
            <div
              className="h-full w-full animate-shimmer rounded-full bg-gradient-to-r from-pluto-200 via-pluto-100 to-pluto-200 bg-[length:400%_100%] motion-reduce:animate-none dark:from-pluto-700/60 dark:via-pluto-600/30 dark:to-pluto-700/60"
              aria-hidden="true"
              data-testid="skeleton-progress-bar"
            />
          </div>

          {/* Step count line */}
          <Bone className="mt-1.5 h-3 w-32" />
        </div>

        {/* ── Steps skeleton ─────────────────────────────────────────────── */}
        <ol
          className="flex flex-col gap-1"
          aria-hidden="true"
          data-testid="skeleton-steps"
        >
          {rows.map((i) => (
            <SkeletonStepRow
              key={i}
              compact={compact}
              isLast={i === rows.length - 1}
            />
          ))}
        </ol>
      </div>
    </div>
  );
});

export default OnboardingSkeletonLoader;
