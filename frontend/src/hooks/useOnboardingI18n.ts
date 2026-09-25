/**
 * useOnboardingI18n
 *
 * Centralises every translated string for the Onboarding Progress Tracker.
 *
 * Bundle-optimisation notes:
 * - The returned object is memoised with useMemo keyed on `t` (which only
 *   changes on locale switch) so the hook never causes downstream re-renders
 *   from reference inequality.
 * - Helper functions are stable useCallback references, not plain arrow
 *   functions, so memo'd children won't re-render on each parent cycle.
 */

"use client";

import { useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";

// ── Step data shape ───────────────────────────────────────────────────────────

interface StepMeta {
  order: number;
  title: string;
  description: string;
  completed: boolean;
  required: boolean;
}

// ── Return type ───────────────────────────────────────────────────────────────

export interface OnboardingI18n {
  title: string;
  subtitle: string;
  progressBar: string;
  stepsList: string;
  progressTracker: string;
  allCompleted: string;
  successTitle: string;
  successMessage: string;
  completed: string;
  inProgress: string;
  pending: string;
  required: string;
  optional: string;
  updating: string;
  stepChangeFailed: string;
  stepsCompletedLabel: (completed: number, total: number) => string;
  percentCompleteLabel: (percent: number) => string;
  progressAnnouncement: (percent: number) => string;
  stepAriaLabel: (number: number, title: string, completed: boolean, required: boolean) => string;
  stepAnnouncement: (step: StepMeta, total: number, statusLabel: string) => string;
  statusLabel: (completed: boolean, isCurrent: boolean) => string;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useOnboardingI18n(): OnboardingI18n {
  const t = useTranslations("onboarding");

  // ── Stable helper callbacks ───────────────────────────────────────────────

  const stepsCompletedLabel = useCallback(
    (completed: number, total: number) => t("stepsCompleted", { completed, total }),
    [t],
  );

  const percentCompleteLabel = useCallback(
    (percent: number) => t("percentComplete", { percent }),
    [t],
  );

  const progressAnnouncement = useCallback(
    (percent: number) => t("progressAnnouncement", { percent }),
    [t],
  );

  const stepAriaLabel = useCallback(
    (number: number, title: string, completed: boolean, required: boolean): string => {
      if (completed && required) return t("stepLabelCompletedRequired", { number, title });
      if (completed) return t("stepLabelCompleted", { number, title });
      if (required) return t("stepLabelRequired", { number, title });
      return t("stepLabel", { number, title });
    },
    [t],
  );

  const stepAnnouncement = useCallback(
    (step: StepMeta, total: number, statusLabel: string): string =>
      t("stepAnnouncement", {
        number: step.order,
        total,
        title: step.title,
        description: step.description,
        status: statusLabel,
      }),
    [t],
  );

  const statusLabel = useCallback(
    (completed: boolean, isCurrent: boolean): string => {
      if (completed) return t("completed");
      if (isCurrent) return t("inProgress");
      return t("pending");
    },
    [t],
  );

  // ── Memoised return object ────────────────────────────────────────────────
  // Re-computes only when `t` changes (i.e. on locale switch).

  return useMemo<OnboardingI18n>(
    () => ({
      title: t("title"),
      subtitle: t("subtitle"),
      progressBar: t("progressBar"),
      stepsList: t("stepsList"),
      progressTracker: t("progressTracker"),
      allCompleted: t("allCompleted"),
      successTitle: t("successTitle"),
      successMessage: t("successMessage"),
      completed: t("completed"),
      inProgress: t("inProgress"),
      pending: t("pending"),
      required: t("required"),
      optional: t("optional"),
      updating: t("updating"),
      stepChangeFailed: t("stepChangeFailed"),
      stepsCompletedLabel,
      percentCompleteLabel,
      progressAnnouncement,
      stepAriaLabel,
      stepAnnouncement,
      statusLabel,
    }),
    // t is stable between renders unless the locale changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, stepsCompletedLabel, percentCompleteLabel, progressAnnouncement,
     stepAriaLabel, stepAnnouncement, statusLabel],
  );
}
