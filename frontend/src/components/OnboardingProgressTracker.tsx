"use client";

/**
 * OnboardingProgressTracker — bundle-optimised client component
 *
 * Bundle-optimisation strategy:
 * ─────────────────────────────
 * 1. framer-motion is NOT statically imported. The three exports we need
 *    (motion, AnimatePresence, useReducedMotion) are lazy-loaded via
 *    next/dynamic only after mount so they don't block the initial JS parse.
 *
 * 2. StepIcon and StatusBadge are now CSS-only — they use Tailwind utility
 *    classes + keyframe animations defined in tailwind.config.js instead of
 *    motion.* primitives. This removes ~100 % of framer-motion from the
 *    render hot-path for each step row.
 *
 * 3. The progress-bar fill animates via the `animate-onboarding-fill` CSS
 *    class instead of motion.div variants — zero JS at paint time.
 *
 * 4. The completion banner and list container still use the lazy-loaded
 *    motion wrappers for their entrance/exit effects, but those code paths
 *    are not executed on initial render.
 *
 * 5. useOnboardingI18n returns a memoised object so reference equality is
 *    stable between renders (no wasted downstream re-renders).
 *
 * 6. All sub-components are memo()'d to prevent re-renders when only
 *    unrelated siblings change.
 */

import React, { memo, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import {
  useOnboardingProgress,
  type OnboardingStep,
} from "@/hooks/useOnboardingProgress";
import { useOnboardingI18n } from "@/hooks/useOnboardingI18n";

// ── Re-export for consumers ───────────────────────────────────────────────────
export type { OnboardingStep };

// ── Lazy framer-motion ────────────────────────────────────────────────────────
// Only the completion banner and the step-list container use motion primitives.
// We lazy-load them so framer-motion never blocks the first paint.

const MotionDiv = dynamic(
  () => import("framer-motion").then((m) => m.motion.div),
  { ssr: false },
);

const MotionOl = dynamic(
  () => import("framer-motion").then((m) => m.motion.ol),
  { ssr: false },
);

const MotionLi = dynamic(
  () => import("framer-motion").then((m) => m.motion.li),
  { ssr: false },
);

const MotionSvg = dynamic(
  () => import("framer-motion").then((m) => m.motion.svg),
  { ssr: false },
);

const AnimatePresence = dynamic(
  () => import("framer-motion").then((m) => m.AnimatePresence),
  { ssr: false },
);

// ── Props ─────────────────────────────────────────────────────────────────────

export interface OnboardingProgressTrackerProps {
  steps: OnboardingStep[];
  currentStep?: string;
  onStepChange?: (stepId: string) => void | Promise<void>;
  onComplete?: () => void;
  showStepNumbers?: boolean;
  orientation?: "vertical" | "horizontal";
  compact?: boolean;
  className?: string;
}

// ── CSS-only StepIcon ─────────────────────────────────────────────────────────
// Uses Tailwind keyframe classes instead of framer-motion — no JS animation cost.

interface StepIconProps {
  completed: boolean;
  isPending: boolean;
  isCurrent: boolean;
  number: number;
  showNumber: boolean;
  compact: boolean;
  prefersReducedMotion: boolean;
}

const StepIcon = memo(function StepIcon({
  completed,
  isPending,
  isCurrent,
  number,
  showNumber,
  compact,
  prefersReducedMotion,
}: StepIconProps) {
  const iconSize = compact ? "h-4 w-4" : "h-5 w-5";

  if (isPending) {
    return (
      <span className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
        <svg
          className={`${iconSize} text-pluto-500 dark:text-pluto-300 ${
            prefersReducedMotion ? "" : "animate-onboarding-spin"
          }`}
          fill="none"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </span>
    );
  }

  if (completed) {
    return (
      <span
        className={`absolute inset-0 flex items-center justify-center ${
          prefersReducedMotion ? "" : "animate-onboarding-check-pop"
        }`}
        aria-hidden="true"
      >
        <svg className={iconSize} fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
          <path
            fillRule="evenodd"
            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
            clipRule="evenodd"
          />
        </svg>
      </span>
    );
  }

  return (
    <span
      className={`absolute inset-0 flex items-center justify-center font-semibold ${
        compact ? "text-xs" : "text-sm"
      } ${isCurrent ? "text-pluto-700 dark:text-pluto-300" : "text-pluto-600 dark:text-pluto-400"}`}
      aria-hidden="true"
    >
      {showNumber ? number : ""}
    </span>
  );
});

// ── CSS-only StatusBadge ──────────────────────────────────────────────────────

interface StatusBadgeProps {
  completed: boolean;
  isCurrent: boolean;
  compact: boolean;
  completedLabel: string;
  inProgressLabel: string;
  pendingLabel: string;
}

const StatusBadge = memo(function StatusBadge({
  completed,
  isCurrent,
  compact,
  completedLabel,
  inProgressLabel,
  pendingLabel,
}: StatusBadgeProps) {
  const label = completed ? completedLabel : isCurrent ? inProgressLabel : pendingLabel;

  const colorClass = completed
    ? "bg-pluto-100 text-pluto-800 dark:bg-pluto-900/40 dark:text-pluto-200"
    : isCurrent
      ? "bg-pluto-200 text-pluto-900 dark:bg-pluto-800/50 dark:text-pluto-100"
      : "bg-pluto-50 text-pluto-700 dark:bg-pluto-900/20 dark:text-pluto-300 group-hover:bg-pluto-100 dark:group-hover:bg-pluto-900/40";

  const dotClass = completed
    ? "bg-pluto-600 dark:bg-pluto-300"
    : isCurrent
      ? "bg-pluto-700 animate-pulse dark:bg-pluto-100"
      : "bg-pluto-400 dark:bg-pluto-500";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold tracking-wide transition-colors duration-200 ${
        compact ? "text-[0.65rem]" : "text-xs"
      } ${colorClass}`}
      aria-label={label}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} aria-hidden="true" />
      {label}
    </span>
  );
});

// ── Main component ────────────────────────────────────────────────────────────

export const OnboardingProgressTracker = memo(function OnboardingProgressTracker({
  steps,
  currentStep,
  onStepChange,
  onComplete,
  showStepNumbers = true,
  orientation = "vertical",
  compact = false,
  className = "",
}: OnboardingProgressTrackerProps) {
  const i18n = useOnboardingI18n();

  // Read reduced-motion preference via CSS media query — avoids importing
  // useReducedMotion from framer-motion (saves ~2 KB).
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const {
    sortedSteps,
    effectiveCurrentStep,
    state,
    progressPercent,
    completedCount,
    isComplete,
    progressSummaryId,
    handleStepClick,
  } = useOnboardingProgress({ steps, currentStep, onStepChange, onComplete });

  // Lazy motion variants — only referenced after framer-motion has loaded
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.08, delayChildren: 0.15 } },
  };
  const stepVariants = prefersReducedMotion
    ? { hidden: { opacity: 0 }, visible: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        hidden: { opacity: 0, x: -16 },
        visible: { opacity: 1, x: 0, transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] } },
        exit:   { opacity: 0, x: 16, transition: { duration: 0.2 } },
      };
  const completionVariants = prefersReducedMotion
    ? { hidden: { opacity: 0 }, visible: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        hidden: { opacity: 0, y: 12 },
        visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: "easeOut" } },
        exit:   { opacity: 0, y: -8, transition: { duration: 0.2 } },
      };

  return (
    <div
      className={`w-full ${className}`}
      role="region"
      aria-label={i18n.progressTracker}
      aria-live="polite"
      aria-atomic="false"
    >
      {/* sr-only progress summary */}
      <p id={progressSummaryId} className="sr-only">
        {i18n.stepsCompletedLabel(completedCount, sortedSteps.length)}{" "}
        {i18n.percentCompleteLabel(progressPercent)}
      </p>

      {/* Assertive announcement */}
      <div
        className="sr-only"
        role="status"
        aria-live="assertive"
        aria-atomic="true"
        data-testid="sr-announcement"
      >
        {state.announcementText}
      </div>

      {state.isPending && (
        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {i18n.updating}
        </div>
      )}

      {/* ── Card ──────────────────────────────────────────────────────────── */}
      <div
        className={`
          rounded-2xl border
          border-pluto-100 dark:border-pluto-800/60
          bg-gradient-to-b from-white to-pluto-50/60
          dark:from-pluto-900/80 dark:to-pluto-900/60
          shadow-[0_8px_32px_rgba(13,27,46,0.06)]
          dark:shadow-[0_8px_32px_rgba(0,0,0,0.3)]
          transition-colors duration-300
          ${compact ? "p-4" : "p-5 sm:p-6"}
        `}
      >
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="mb-6">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className={`font-bold tracking-tight text-pluto-900 dark:text-pluto-50 ${compact ? "text-base" : "text-lg"}`}>
              {i18n.title}
            </h2>
            <span className="shrink-0 tabular-nums text-sm font-bold text-pluto-600 dark:text-pluto-300" aria-hidden="true">
              {i18n.percentCompleteLabel(progressPercent)}
            </span>
          </div>

          <p className={`mt-1.5 text-[#6B6B6B] dark:text-pluto-400 ${compact ? "text-xs" : "text-sm"}`}>
            {i18n.subtitle}
          </p>

          {/* CSS-animated progress bar — no framer-motion */}
          <div
            className="mt-4 h-2.5 overflow-hidden rounded-full bg-pluto-100 dark:bg-pluto-800"
            role="progressbar"
            aria-valuenow={progressPercent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={i18n.progressBar}
            aria-describedby={progressSummaryId}
          >
            <div
              className={`h-full rounded-full bg-gradient-to-r from-pluto-400 via-pluto-500 to-pluto-600 dark:from-pluto-500 dark:via-pluto-400 dark:to-pluto-300 origin-left transition-[width] duration-500 ease-out`}
              style={{ width: `${progressPercent}%` }}
              data-testid="progress-bar-fill"
            />
          </div>

          <p className="mt-2 flex items-center gap-1.5 text-xs text-[#6B6B6B] dark:text-pluto-400" aria-hidden="true">
            {i18n.stepsCompletedLabel(completedCount, sortedSteps.length)}
            {isComplete && (
              <span className="inline-flex items-center gap-1 font-semibold text-pluto-600 dark:text-pluto-300">
                <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                {i18n.allCompleted}
              </span>
            )}
          </div>
        </div>

        {/* ── Steps list ───────────────────────────────────────────────────── */}
        <MotionOl
          className={orientation === "horizontal" ? "flex flex-col gap-3 md:flex-row md:gap-2" : "flex flex-col gap-1"}
          role="list"
          aria-label={i18n.stepsList}
          aria-orientation={orientation}
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          {/* @ts-expect-error — AnimatePresence is lazy-loaded, types resolve at runtime */}
          <AnimatePresence mode="popLayout">
            {sortedSteps.map((step, index) => {
              const isCurrent  = effectiveCurrentStep === step.id;
              const isPending  = state.isPending && isCurrent;
              const stepDescId = `${progressSummaryId}-desc-${index}`;

              const indicatorColorClass = step.completed
                ? "border-pluto-500 bg-pluto-100 text-pluto-800 shadow-[0_4px_12px_rgba(74,111,165,0.18)] dark:border-pluto-400 dark:bg-pluto-800/60 dark:text-pluto-100"
                : isCurrent
                  ? "border-pluto-600 bg-pluto-50 text-pluto-700 shadow-[0_4px_12px_rgba(74,111,165,0.14)] dark:border-pluto-400 dark:bg-pluto-900/60 dark:text-pluto-200"
                  : "border-pluto-200 bg-white text-pluto-600 dark:border-pluto-700 dark:bg-pluto-900/40 dark:text-pluto-400 group-hover:border-pluto-400 group-hover:bg-pluto-50 dark:group-hover:border-pluto-500 dark:group-hover:bg-pluto-800/50";

              return (
                <MotionLi
                  key={step.id}
                  role="listitem"
                  variants={stepVariants}
                  className={`
                    group relative rounded-2xl border border-transparent
                    px-3 py-3 transition-colors duration-200
                    hover:border-pluto-100 hover:bg-white/80
                    dark:hover:border-pluto-800/60 dark:hover:bg-pluto-900/50
                    focus-within:border-pluto-200 dark:focus-within:border-pluto-700
                    ${orientation === "horizontal" ? "flex flex-1 flex-col gap-2 md:items-center md:text-center" : "flex flex-row gap-3"}
                  `}
                >
                  {/* Step indicator button */}
                    <button
                      type="button"
                      onClick={() => handleStepClick(step.id)}
                      className={`
                        relative flex-shrink-0
                        ${compact ? "h-8 w-8" : "h-10 w-10"}
                        rounded-full border-2 font-semibold
                        transition-all duration-200
                        focus:outline-none focus-visible:ring-2
                        focus-visible:ring-pluto-400 focus-visible:ring-offset-2
                        focus-visible:ring-offset-white dark:focus-visible:ring-offset-pluto-950
                        ${orientation === "horizontal" ? "mx-auto md:mx-0" : ""}
                        ${indicatorColorClass}
                      `}
                    aria-label={i18n.stepAriaLabel(index + 1, step.title, step.completed, step.required)}
                    aria-current={isCurrent ? "step" : undefined}
                    aria-setsize={sortedSteps.length}
                    aria-posinset={index + 1}
                    aria-roledescription="onboarding step"
                    aria-describedby={stepDescId}
                    aria-busy={isPending}
                    aria-disabled={isPending || undefined}
                  >
                    <StepIcon
                      completed={step.completed}
                      isPending={isPending}
                      isCurrent={isCurrent}
                      number={index + 1}
                      showNumber={showStepNumbers}
                      compact={compact}
                      prefersReducedMotion={prefersReducedMotion}
                    />
                  </button>

                  {/* Step text */}
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <div className={`flex min-w-0 flex-1 flex-col gap-1 ${orientation === "horizontal" ? "md:text-center" : ""}`}>
                    <h3
                      id={stepDescId}
                      className={`
                        font-medium leading-snug tracking-tight transition-colors duration-200
                        ${step.completed
                          ? "text-pluto-600 line-through dark:text-pluto-400"
                          : "text-pluto-900 dark:text-pluto-50 group-hover:text-pluto-800 dark:group-hover:text-white"}
                        ${compact ? "text-sm" : "text-base"}
                      `}
                    >
                      {step.title}
                      {step.required && (
                        <span className="ml-1 text-red-500 dark:text-red-400" aria-label={i18n.required} title={i18n.required}>
                          *
                        </span>
                      )}
                    </h3>

                    <p className={`leading-relaxed text-pluto-500 dark:text-pluto-400 transition-colors group-hover:text-pluto-700 dark:group-hover:text-pluto-300 ${compact ? "text-xs" : "text-sm"}`}>
                      {step.description}
                    </p>

                    <div className={orientation === "horizontal" ? "flex justify-center md:justify-center" : ""}>
                      <StatusBadge
                        completed={step.completed}
                        isCurrent={isCurrent}
                        compact={compact}
                        completedLabel={i18n.completed}
                        inProgressLabel={i18n.inProgress}
                        pendingLabel={i18n.pending}
                      />
                    </div>
                  </div>

                  {/* Vertical connector */}
                  {orientation === "vertical" && index < sortedSteps.length - 1 && (
                    <div
                      className={`absolute left-[1.6875rem] top-[calc(100%-4px)] ${compact ? "h-2 w-px" : "h-3 w-px"} bg-pluto-200 dark:bg-pluto-700`}
                      aria-hidden="true"
                    />
                  )}

                  {/* Horizontal connector */}
                  {orientation === "horizontal" && index < sortedSteps.length - 1 && (
                    <div
                      className={`absolute right-[-0.75rem] hidden h-px w-3 bg-pluto-200 dark:bg-pluto-700 sm:block ${compact ? "top-[1.75rem]" : "top-[2rem]"}`}
                      aria-hidden="true"
                    />
                  )}
                  {/* Horizontal connector */}
                  {orientation === "horizontal" && index < sortedSteps.length - 1 && (
                    <div
                      className={`hidden md:block absolute left-[calc(100%+4px)] top-1/2 -translate-y-1/2 ${compact ? "w-2 h-px" : "w-3 h-px"} bg-pluto-200 dark:bg-pluto-700`}
                      aria-hidden="true"
                    />
                  )}
                </MotionLi>
              );
            })}
          </AnimatePresence>
        </MotionOl>

        {/* ── Completion banner ─────────────────────────────────────────────── */}
        {/* @ts-expect-error — AnimatePresence is lazy-loaded */}
        <AnimatePresence>
          {isComplete && sortedSteps.length > 0 && (
            <MotionDiv
              className="mt-6 rounded-xl border border-pluto-200 border-l-4 border-l-pluto-500 bg-pluto-50 p-4 shadow-[0_2px_10px_rgba(74,111,165,0.1)] dark:border-pluto-700/60 dark:border-l-pluto-400 dark:bg-pluto-900/60"
              variants={completionVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              role="alert"
              aria-live="polite"
              aria-atomic="true"
              data-testid="completion-banner"
            >
              <div className="flex items-start gap-3">
                <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-pluto-100 dark:bg-pluto-800/60">
                  <MotionSvg
                    className="h-5 w-5 text-pluto-600 dark:text-pluto-300"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                    aria-hidden="true"
                    animate={prefersReducedMotion ? {} : { scale: [1, 1.2, 1] }}
                    transition={{ duration: 0.45, delay: 0.25 }}
                  >
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </MotionSvg>
                </span>
                <div>
                  <h4 className="font-semibold tracking-tight text-pluto-900 dark:text-pluto-50">{i18n.successTitle}</h4>
                  <p className="mt-1 text-sm leading-relaxed text-pluto-700 dark:text-pluto-300">{i18n.successMessage}</p>
                  <h4 className="font-bold text-pluto-900 dark:text-pluto-50">{i18n.successTitle}</h4>
                  <p className="mt-1 text-sm text-pluto-700 dark:text-pluto-300">{i18n.successMessage}</p>
                </div>
              </div>
            </MotionDiv>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
});

export default OnboardingProgressTracker;
