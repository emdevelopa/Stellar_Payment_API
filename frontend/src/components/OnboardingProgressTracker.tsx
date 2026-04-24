"use client";

import React, { useState, useCallback, useMemo, useEffect, useReducer } from "react";
import { motion, AnimatePresence, type Variants } from "framer-motion";
import { useTranslations } from "next-intl";

/**
 * Step interface for onboarding progress
 */
interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  required: boolean;
  order: number;
}

/**
 * Props for OnboardingProgressTracker component
 */
interface OnboardingProgressTrackerProps {
  steps: OnboardingStep[];
  currentStep?: string;
  onStepChange?: (stepId: string) => void;
  onComplete?: () => void;
  showStepNumbers?: boolean;
  orientation?: "vertical" | "horizontal";
  compact?: boolean;
}

/**
 * State for onboarding tracker
 */
interface OnboardingState {
  currentStep: string | undefined;
  announcementText: string;
}

/**
 * Actions for onboarding state
 */
type OnboardingAction =
  | { type: "SET_CURRENT_STEP"; payload: string }
  | { type: "SET_ANNOUNCEMENT"; payload: string };

/**
 * Reducer for onboarding state
 */
function onboardingReducer(state: OnboardingState, action: OnboardingAction): OnboardingState {
  switch (action.type) {
    case "SET_CURRENT_STEP":
      return { ...state, currentStep: action.payload };
    case "SET_ANNOUNCEMENT":
      return { ...state, announcementText: action.payload };
    default:
      return state;
  }
}

/**
 * Animation variants for step container
 */
const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.2,
    },
  },
};

/**
 * Animation variants for individual steps
 */
const stepVariants: Variants = {
  hidden: { opacity: 0, x: -20 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] },
  },
  exit: {
    opacity: 0,
    x: 20,
    transition: { duration: 0.2 },
  },
};

/**
 * Animation variants for progress bar
 */
const progressBarVariants: Variants = {
  hidden: { scaleX: 0 },
  visible: {
    scaleX: 1,
    transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] },
  },
};

/**
 * Animation variants for check mark
 */
const checkMarkVariants: Variants = {
  hidden: { scale: 0, opacity: 0 },
  visible: {
    scale: 1,
    opacity: 1,
    transition: {
      type: "spring",
      stiffness: 260,
      damping: 20,
      delay: 0.2,
    },
  },
};

/**
 * OnboardingProgressTracker Component
 *
 * Displays onboarding progress with comprehensive accessibility support.
 * Includes proper ARIA labels, semantic HTML, and screen reader announcements.
 * Features animations for visual feedback and status tracking.
 */
export const OnboardingProgressTracker: React.FC<
  OnboardingProgressTrackerProps
> = ({
  steps,
  currentStep: currentStepProp,
  onStepChange,
  onComplete,
  showStepNumbers = true,
  orientation = "vertical",
  compact = false,
}) => {
  const t = useTranslations();
  const [state, dispatch] = useReducer(onboardingReducer, {
    currentStep: currentStepProp || steps[0]?.id,
    announcementText: "",
  });

  /**
   * Sort steps by order
   */
  const sortedSteps = useMemo(
    () => [...steps].sort((a, b) => a.order - b.order),
    [steps]
  );

  /**
   * Calculate progress percentage
   */
  const progressPercentage = useMemo(() => {
    const completedCount = sortedSteps.filter((s) => s.completed).length;
    return Math.round((completedCount / sortedSteps.length) * 100);
  }, [sortedSteps]);

  /**
   * Calculate estimated completion status
   */
  const isOnboardingComplete = useMemo(() => {
    const requiredSteps = sortedSteps.filter((s) => s.required);
    return requiredSteps.every((s) => s.completed);
  }, [sortedSteps]);

  /**
   * Handle step click with optimistic updates and accessibility announcement
   */
  const handleStepClick = useCallback(
    (stepId: string) => {
      const step = sortedSteps.find((s) => s.id === stepId);
      if (!step) return;

      // Optimistic update: immediately update current step
      dispatch({ type: "SET_CURRENT_STEP", payload: stepId });

      // Announce to screen readers immediately
      const announcement = `${t("onboarding.stepProgress") || "Step"} ${step.order}: ${step.title}. ${step.description}`;
      dispatch({ type: "SET_ANNOUNCEMENT", payload: announcement });

      // Call the callback (which may handle server-side updates)
      onStepChange?.(stepId);
    },
    [sortedSteps, onStepChange, t]
  );

  /**
   * Handle onboarding completion
   */
  useEffect(() => {
    if (isOnboardingComplete && sortedSteps.length > 0) {
      const announcement = t("onboarding.completed") || "Onboarding completed";
      dispatch({ type: "SET_ANNOUNCEMENT", payload: announcement });
      onComplete?.();
    }
  }, [isOnboardingComplete, sortedSteps.length, onComplete, t]);

  /**
   * Announce status changes at intervals
   */
  useEffect(() => {
    const StatusMessage = `${t("onboarding.progress") || "Progress"}: ${progressPercentage}% complete`;
    dispatch({ type: "SET_ANNOUNCEMENT", payload: StatusMessage });
  }, [progressPercentage, t]);

  return (
    <div
      className="w-full"
      role="region"
      aria-label={t("onboarding.progressTracker") || "Onboarding Progress"}
      aria-live="polite"
      aria-atomic="false"
    >
      {/* Screen reader announcement area */}
          <div
            className="sr-only"
            role="status"
            aria-live="assertive"
            aria-atomic="true"
          >
            {state.announcementText}
          </div>

      {/* Container */}
      <div
        className={`rounded-[2rem] border border-pluto-100 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(240,246,251,0.92))] p-6 shadow-[0_20px_50px_rgba(13,27,46,0.08)] ${
          compact ? "p-4" : ""
        }`}
      >
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-semibold text-pluto-900">
              {t("onboarding.title") || "Onboarding Progress"}
            </h2>
            <span className="text-sm font-medium text-pluto-700">
              {progressPercentage}%
            </span>
          </div>
          <p className="mt-1 text-sm text-[#6B6B6B]">
            {t("onboarding.subtitle") ||
              "Complete all required steps to finish setup"}
          </p>

          {/* Overall progress bar */}
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-pluto-100">
            <motion.div
              className="h-full bg-gradient-to-r from-pluto-500 via-pluto-600 to-pluto-700"
              variants={progressBarVariants}
              initial="hidden"
              animate="visible"
              style={{ width: `${progressPercentage}%` }}
              aria-valuenow={progressPercentage}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={
                t("onboarding.progressBar") || "Overall progress"
              }
            />
          </div>

          {/* Status text */}
          <p className="mt-2 text-xs text-[#6B6B6B]">
            {sortedSteps.filter((s) => s.completed).length} of{" "}
            {sortedSteps.length} steps completed
            {isOnboardingComplete && (
              <span className="ml-2 inline-flex items-center gap-1 font-medium text-pluto-700">
                <svg
                  className="h-3 w-3"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
                {t("onboarding.allCompleted") || "All done!"}
              </span>
            )}
          </p>
        </div>

        {/* Steps list */}
        <motion.div
          className={`space-y-3 ${
            orientation === "horizontal" ? "flex gap-4" : ""
          }`}
          role="list"
          aria-label={t("onboarding.stepsList") || "Onboarding steps"}
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          <AnimatePresence mode="popLayout">
            {sortedSteps.map((step, index) => {
              const isCurrentStep = state.currentStep === step.id;

              return (
                <motion.div
                  key={step.id}
                  role="listitem"
                  variants={stepVariants}
                  className={`group relative rounded-3xl border border-transparent px-3 py-3 transition-colors duration-200 hover:border-pluto-100 hover:bg-white/90 ${
                    orientation === "horizontal"
                      ? "flex flex-1 flex-col"
                      : "flex flex-row gap-4"
                  }`}
                >
                  {/* Step indicator */}
                  <button
                    onClick={() => handleStepClick(step.id)}
                    className={`relative flex-shrink-0 ${
                      compact ? "h-8 w-8" : "h-10 w-10"
                    } rounded-full border-2 font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-pluto-400 focus:ring-offset-2 ${
                      step.completed
                        ? "border-pluto-500 bg-pluto-100 text-pluto-800 shadow-[0_10px_24px_rgba(74,111,165,0.14)]"
                        : isCurrentStep
                          ? "border-pluto-600 bg-pluto-50 text-pluto-700 shadow-[0_12px_28px_rgba(74,111,165,0.12)]"
                          : "border-pluto-200 bg-white text-pluto-700 group-hover:border-pluto-400 group-hover:bg-pluto-50 group-hover:text-pluto-800 group-hover:shadow-[0_10px_24px_rgba(13,27,46,0.08)]"
                    }`}
                    aria-label={`Step ${showStepNumbers ? index + 1 : ""}: ${step.title}${
                      step.completed ? ". Completed" : ""
                    }${step.required ? ". Required" : ""}`}
                    aria-pressed={isCurrentStep}
                    aria-current={isCurrentStep ? "step" : undefined}
                    disabled={false}
                  >
                    <AnimatePresence mode="wait">
                      {step.completed ? (
                        <motion.div
                          key="checkmark"
                          className="absolute inset-0 flex items-center justify-center"
                          variants={checkMarkVariants}
                          initial="hidden"
                          animate="visible"
                        >
                          <svg
                            className="h-5 w-5 text-pluto-700"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                            aria-hidden="true"
                          >
                            <path
                              fillRule="evenodd"
                              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                              clipRule="evenodd"
                            />
                          </svg>
                        </motion.div>
                      ) : (
                        <motion.span
                          key="number"
                          className={`text-${compact ? "sm" : "base"} ${
                            isCurrentStep
                              ? "text-pluto-700"
                              : "text-pluto-600"
                          }`}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                        >
                          {showStepNumbers ? index + 1 : ""}
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </button>

                  {/* Step content */}
                  <motion.div
                    className="flex-1 min-w-0"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.1 }}
                  >
                    <h3
                      className={`font-medium text-pluto-900 transition-colors duration-200 group-hover:text-pluto-800 ${
                        step.completed ? "text-pluto-700 line-through" : ""
                      } ${compact ? "text-sm" : "text-base"}`}
                    >
                      {step.title}
                      {step.required && (
                        <span
                          className="ml-1 text-red-500"
                          aria-label="Required"
                          title="Required step"
                        >
                          *
                        </span>
                      )}
                    </h3>
                    <p className={`text-[#6B6B6B] transition-colors duration-200 group-hover:text-pluto-700 ${compact ? "text-xs" : "text-sm"}`}>
                      {step.description}
                    </p>

                    {/* Status badge */}
                    <div className="mt-2 flex items-center gap-2">
                      <motion.span
                        className={`inline-flex text-xs font-semibold rounded-full px-2 py-1 ${
                          step.completed
                            ? "bg-pluto-100 text-pluto-800"
                            : isCurrentStep
                              ? "bg-pluto-200 text-pluto-800"
                              : "bg-pluto-50 text-pluto-700 group-hover:bg-pluto-100"
                        }`}
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ delay: 0.15 }}
                      >
                        {step.completed
                          ? t("onboarding.completed") || "Completed"
                          : isCurrentStep
                            ? t("onboarding.inProgress") || "In Progress"
                            : t("onboarding.pending") || "Pending"}
                      </motion.span>
                    </div>
                  </motion.div>

                  {/* Connector line (vertical orientation only) */}
                  {orientation === "vertical" &&
                    index < sortedSteps.length - 1 && (
                      <div className="absolute left-8 top-[calc(100%_-_0.5rem)] h-3 w-0.5 bg-pluto-200" />
                    )}
                </motion.div>
              );
            })}
          </AnimatePresence>
        </motion.div>

        {/* Completion message */}
        <AnimatePresence>
          {isOnboardingComplete && sortedSteps.length > 0 && (
            <motion.div
              className="mt-6 rounded-2xl border border-pluto-200 bg-pluto-50 p-4"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              role="alert"
              aria-live="polite"
            >
              <div className="flex items-start gap-3">
                <motion.svg
                  className="mt-0.5 h-5 w-5 flex-shrink-0 text-pluto-600"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                  animate={{ scale: [1, 1.2, 1] }}
                  transition={{ duration: 0.5, delay: 0.3 }}
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </motion.svg>
                <div>
                  <h4 className="font-semibold text-pluto-900">
                    {t("onboarding.successTitle") || "Onboarding Complete!"}
                  </h4>
                  <p className="mt-1 text-sm text-pluto-700">
                    {t("onboarding.successMessage") ||
                      "You have successfully completed all required onboarding steps."}
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default OnboardingProgressTracker;
