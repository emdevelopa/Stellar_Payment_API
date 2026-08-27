/**
 * useOnboardingProgress
 *
 * Encapsulates all stateful logic for the Onboarding Progress Tracker.
 *
 * Bundle-optimisation notes:
 * - No direct framer-motion import — pure React hooks only.
 * - selectProgressPercent now reads from state directly (no extra args).
 * - SYNC_STEPS wired correctly with the updated action union.
 */

"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
} from "react";
import {
  onboardingReducer,
  createInitialOnboardingState,
  selectEffectiveStep,
  selectProgressPercent,
  type OnboardingState,
} from "@/components/onboarding-reducer";
import { useOnboardingI18n } from "@/hooks/useOnboardingI18n";

// ── Shared step type ──────────────────────────────────────────────────────────

export interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  required: boolean;
  order: number;
}

// ── Options / return types ────────────────────────────────────────────────────

export interface UseOnboardingProgressOptions {
  steps: OnboardingStep[];
  currentStep?: string;
  onStepChange?: (stepId: string) => void | Promise<void>;
  onComplete?: () => void;
}

export interface UseOnboardingProgressReturn {
  sortedSteps: OnboardingStep[];
  effectiveCurrentStep: string | undefined;
  state: OnboardingState;
  progressPercent: number;
  completedCount: number;
  isComplete: boolean;
  progressSummaryId: string;
  handleStepClick: (stepId: string) => Promise<void>;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useOnboardingProgress({
  steps,
  currentStep: currentStepProp,
  onStepChange,
  onComplete,
}: UseOnboardingProgressOptions): UseOnboardingProgressReturn {
  const i18n = useOnboardingI18n();
  const progressSummaryId = useId();

  // ── Derived step data ────────────────────────────────────────────────────

  const sortedSteps = useMemo(
    () => [...steps].sort((a, b) => a.order - b.order),
    [steps],
  );

  const completedCount = useMemo(
    () => sortedSteps.filter((s) => s.completed).length,
    [sortedSteps],
  );

  const requiredSteps = useMemo(
    () => sortedSteps.filter((s) => s.required),
    [sortedSteps],
  );

  const completedRequiredCount = useMemo(
    () => requiredSteps.filter((s) => s.completed).length,
    [requiredSteps],
  );

  const isComplete = useMemo(
    () => requiredSteps.length > 0 && completedRequiredCount === requiredSteps.length,
    [requiredSteps, completedRequiredCount],
  );

  // ── Reducer ──────────────────────────────────────────────────────────────

  const [state, dispatch] = useReducer(
    onboardingReducer,
    // Factory now takes (currentStep, totalSteps, completedSteps)
    createInitialOnboardingState(
      currentStepProp ?? sortedSteps[0]?.id,
      sortedSteps.length,
      completedCount,
    ),
  );

  // Progress is measured against required steps so the percentage always
  // reaches 100% exactly when `isComplete` flips true. Trackers with no
  // required steps fall back to counting all steps.
  const progressTotal = requiredSteps.length > 0 ? requiredSteps.length : sortedSteps.length;
  const progressCompleted = requiredSteps.length > 0 ? completedRequiredCount : completedCount;

  // Sync step counts when the steps prop changes
  useEffect(() => {
    dispatch({
      type: "SYNC_STEPS",
      payload: { total: progressTotal, completed: progressCompleted },
    });
  }, [progressTotal, progressCompleted]);

  // Sync external currentStep prop
  const prevCurrentStepPropRef = useRef(currentStepProp);
  useEffect(() => {
    if (
      currentStepProp !== undefined &&
      currentStepProp !== prevCurrentStepPropRef.current
    ) {
      dispatch({ type: "SET_CURRENT_STEP", payload: currentStepProp });
      prevCurrentStepPropRef.current = currentStepProp;
    }
  }, [currentStepProp]);

  // ── Derived values ────────────────────────────────────────────────────────

  const effectiveCurrentStep = selectEffectiveStep(state);
  // selectProgressPercent now reads totalSteps/completedSteps from state
  const progressPercent = selectProgressPercent(state);

  // ── Completion side-effect ────────────────────────────────────────────────

  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    if (isComplete && sortedSteps.length > 0) {
      dispatch({ type: "SET_ANNOUNCEMENT", payload: i18n.successTitle });
      onCompleteRef.current?.();
    }
  }, [isComplete, sortedSteps.length, i18n.successTitle]);

  // ── Progress announcements ────────────────────────────────────────────────

  useEffect(() => {
    dispatch({
      type: "SET_ANNOUNCEMENT",
      payload: i18n.progressAnnouncement(progressPercent),
    });
  }, [progressPercent, i18n]);

  // ── Step click handler ────────────────────────────────────────────────────

  const handleStepClick = useCallback(
    async (stepId: string) => {
      if (state.isPending) return;

      const step = sortedSteps.find((s) => s.id === stepId);
      if (!step) return;

      dispatch({ type: "OPTIMISTIC_STEP", payload: stepId });

      const status = i18n.statusLabel(
        step.completed,
        effectiveCurrentStep === stepId,
      );
      dispatch({
        type: "SET_ANNOUNCEMENT",
        payload: i18n.stepAnnouncement(step, sortedSteps.length, status),
      });

      try {
        await onStepChange?.(stepId);
        dispatch({ type: "CONFIRM_STEP", payload: stepId });
      } catch {
        dispatch({ type: "ROLLBACK_STEP" });
        dispatch({ type: "SET_ANNOUNCEMENT", payload: i18n.stepChangeFailed });
      }
    },
    [sortedSteps, effectiveCurrentStep, onStepChange, state.isPending, i18n],
  );

  return {
    sortedSteps,
    effectiveCurrentStep,
    state,
    progressPercent,
    completedCount,
    isComplete,
    progressSummaryId,
    handleStepClick,
  };
}
