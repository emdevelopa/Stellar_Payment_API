"use client";

import React, { useCallback, useEffect, useRef, useReducer, useState } from "react";
import { motion, AnimatePresence, type Variants } from "motion/react";
import confetti from "canvas-confetti";
import { useTranslations } from "next-intl";

export interface PaymentSuccessAnimationProps {
  show: boolean;
  onComplete?: () => void | Promise<void>;
  amount?: string;
  asset?: string;
  txId?: string;
  /** When true, the component indicates an optimistic (pre-confirmation) success state */
  isOptimistic?: boolean;
}

// ── Full-motion animation variants ──────────────────────────────────────────

const containerVariants: Variants = {
  hidden: { opacity: 0, scale: 0.9 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: {
      duration: 0.4,
      ease: [0.16, 1, 0.3, 1],
      staggerChildren: 0.08,
    },
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    transition: { duration: 0.25, ease: "easeIn" },
  },
};

const childVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] },
  },
};

const checkVariants: Variants = {
  hidden: { scale: 0, rotate: -30 },
  visible: {
    scale: 1,
    rotate: 0,
    transition: { type: "spring", stiffness: 320, damping: 18, delay: 0.05 },
  },
};

// ── Reduced-motion variants (#980) ───────────────────────────────────────────

const containerVariantsReduced: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

const childVariantsReduced: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.15 } },
};

const checkVariantsReduced: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
};

interface AnimationState {
  isDismissing: boolean;
  announcementText: string;
}

type AnimationAction =
  | { type: "RESET" }
  | { type: "SET_ANNOUNCEMENT"; payload: string }
  | { type: "START_DISMISS"; payload: string }
  | { type: "DISMISS_ERROR"; payload: string }
  | { type: "DISMISS_SUCCESS" };

const initialState: AnimationState = {
  isDismissing: false,
  announcementText: "",
};

function readPrefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function usePrefersReducedMotion() {
  // Lazy initializer reads the OS preference synchronously on first render,
  // so the confetti-trigger effect (which runs in the same mount commit)
  // never sees a stale "false" default before this can react to it (#980).
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(readPrefersReducedMotion);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches);

    mediaQuery.addEventListener("change", updatePreference);
    return () => mediaQuery.removeEventListener("change", updatePreference);
  }, []);

  return prefersReducedMotion;
}

function animationReducer(state: AnimationState, action: AnimationAction): AnimationState {
  switch (action.type) {
    case "RESET":
      return {
        isDismissing: false,
        announcementText: "",
      };
    case "SET_ANNOUNCEMENT":
      return {
        ...state,
        announcementText: action.payload,
      };
    case "START_DISMISS":
      return {
        isDismissing: true,
        announcementText: action.payload,
      };
    case "DISMISS_ERROR":
      return {
        isDismissing: false,
        announcementText: action.payload,
      };
    case "DISMISS_SUCCESS":
      return {
        ...state,
        isDismissing: false,
      };
    default:
      return state;
  }
}

export const PaymentSuccessAnimationClient: React.FC<PaymentSuccessAnimationProps> = ({
  show,
  onComplete,
  amount = "0",
  asset = "XLM",
  txId,
  isOptimistic = false,
}) => {
  const t = useTranslations();
  // Respect OS-level "prefer reduced motion" setting (#980)
  const prefersReducedMotion = usePrefersReducedMotion();
  const hasTriggeredConfettiRef = useRef(false);
  const completeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const prevIsOptimisticRef = useRef(isOptimistic);

  const [state, dispatch] = useReducer(animationReducer, initialState);
  const { isDismissing, announcementText } = state;

  // Reset dismiss state when dialog closes
  useEffect(() => {
    if (!show) {
      dispatch({ type: "RESET" });
    }
  }, [show]);

  // Announce network confirmation when optimistic state resolves (#980)
  useEffect(() => {
    if (!show) return;
    if (prevIsOptimisticRef.current === true && !isOptimistic) {
      dispatch({
        type: "SET_ANNOUNCEMENT",
        payload: t("payment.networkConfirmed") || "Payment confirmed on the Stellar network.",
      });
    }
    prevIsOptimisticRef.current = isOptimistic;
  }, [isOptimistic, show, t]);

  // Optimistic dismiss handler — UI responds immediately, rolls back on error (#981)
  const handleDismiss = useCallback(async () => {
    if (isDismissing) return;
    dispatch({
      type: "START_DISMISS",
      payload: t("payment.dismissing") || "Processing…",
    });
    try {
      await onComplete?.();
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : t("common.error") || "Something went wrong. Please try again.";
      dispatch({ type: "DISMISS_ERROR", payload: msg });
    }
  }, [isDismissing, onComplete, t]);

  // Confetti + auto-dismiss timer
  useEffect(() => {
    if (!show) {
      hasTriggeredConfettiRef.current = false;
      if (completeTimerRef.current) {
        clearTimeout(completeTimerRef.current);
        completeTimerRef.current = null;
      }
      return;
    }

    const focusTimer = setTimeout(() => {
      closeButtonRef.current?.focus();
    }, 100);

    if (!hasTriggeredConfettiRef.current) {
      hasTriggeredConfettiRef.current = true;
      // Skip confetti for users who prefer reduced motion (#980)
      if (!prefersReducedMotion) {
        const accent = "#00F5D4";
        const secondary = "#6C5CE7";
        confetti({
          particleCount: 120,
          spread: 78,
          startVelocity: 36,
          origin: { y: 0.65 },
          colors: [accent, secondary, "#00D4AA", "#ffffff"],
        });
        setTimeout(() => {
          confetti({
            particleCount: 40,
            spread: 120,
            startVelocity: 28,
            origin: { x: 0.3, y: 0.7 },
            colors: [accent, secondary],
          });
          confetti({
            particleCount: 40,
            spread: 120,
            startVelocity: 28,
            origin: { x: 0.7, y: 0.7 },
            colors: [accent, secondary],
          });
        }, 200);
      }
    }

    completeTimerRef.current = setTimeout(() => {
      onComplete?.();
    }, 4000);

    return () => {
      clearTimeout(focusTimer);
      if (completeTimerRef.current) {
        clearTimeout(completeTimerRef.current);
        completeTimerRef.current = null;
      }
    };
  }, [show, onComplete, prefersReducedMotion]);

  // Focus trap + keyboard handling
  useEffect(() => {
    if (!show) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        void handleDismiss();
        return;
      }
      if (e.key !== "Tab") return;
      const container = containerRef.current;
      if (!container) return;
      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => !el.hasAttribute("disabled"));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [show, handleDismiss]);

  if (!show) return null;

  // Pick variants based on reduced-motion preference (#980)
  const activeContainerVariants = prefersReducedMotion ? containerVariantsReduced : containerVariants;
  const activeChildVariants = prefersReducedMotion ? childVariantsReduced : childVariants;
  const activeCheckVariants = prefersReducedMotion ? checkVariantsReduced : checkVariants;

  const successAnnounce =
    t("payment.successAnnounce", { amount, asset }) ||
    `Payment successful! ${amount} ${asset} has been received.`;

  const optimisticNote = isOptimistic
    ? t("payment.optimisticNote") || "Transaction submitted — awaiting network confirmation."
    : null;

  return (
    <AnimatePresence>
      <motion.div
        ref={containerRef}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
        variants={activeContainerVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-success-title"
        aria-describedby="payment-success-description"
      >
        {/* Initial success announcement — assertive so screen readers interrupt (#980) */}
        <div
          className="sr-only"
          role="status"
          aria-live="assertive"
          aria-atomic="true"
        >
          {successAnnounce}
        </div>

        {/* Dynamic state announcements: confirmation, errors, pending (#980, #981) */}
        <div
          className="sr-only"
          aria-live="polite"
          aria-atomic="true"
          data-testid="sr-announcement"
        >
          {announcementText}
        </div>

        <motion.div
          className="relative w-full max-w-md overflow-hidden rounded-3xl border border-accent/30 bg-gradient-to-br from-black via-gray-900 to-black p-8 text-center shadow-2xl"
          variants={activeChildVariants}
        >
          {/* Subtle radial glow */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-12 -top-12 h-48 w-48 rounded-full bg-accent/10 blur-3xl"
          />

          {/* Close button — aria-busy signals pending dismiss to screen readers (#981) */}
          <motion.button
            ref={closeButtonRef}
            onClick={handleDismiss}
            disabled={isDismissing}
            aria-busy={isDismissing}
            className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={t("common.close") || "Close success animation"}
            variants={activeChildVariants}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </motion.button>

          {/* Animated success icon */}
          <motion.div
            className="relative mx-auto mb-6 flex h-20 w-20 items-center justify-center"
            variants={activeChildVariants}
          >
            {/* Pulsing glow ring — disabled when reduced motion is preferred (#980) */}
            <motion.div
              className="absolute inset-0 rounded-full bg-accent/20"
              animate={
                prefersReducedMotion
                  ? {}
                  : { scale: [1, 1.22, 1], opacity: [0.45, 0.9, 0.45] }
              }
              transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
              aria-hidden="true"
            />
            {/* Inner ring */}
            <motion.div
              className="absolute inset-2 rounded-full bg-accent/10 ring-1 ring-accent/30"
              aria-hidden="true"
            />
            {/* Check icon */}
            <motion.div
              className="relative z-10 flex h-full w-full items-center justify-center"
              variants={activeCheckVariants}
              aria-hidden="true"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-9 w-9 text-accent"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <motion.path
                  d="M5 13l4 4L19 7"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{
                    duration: prefersReducedMotion ? 0 : 0.5,
                    ease: "easeOut",
                    delay: prefersReducedMotion ? 0 : 0.2,
                  }}
                />
              </svg>
            </motion.div>
          </motion.div>

          {/* Heading */}
          <motion.h1
            id="payment-success-title"
            className="mb-3 text-3xl font-bold tracking-tight text-white"
            variants={activeChildVariants}
          >
            {t("payment.successTitle") || "Payment Successful!"}
          </motion.h1>

          {/* Optimistic badge */}
          {isOptimistic && (
            <motion.div
              className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-yellow-400/30 bg-yellow-400/10 px-3 py-1 text-xs font-medium text-yellow-300"
              variants={activeChildVariants}
              role="status"
              aria-live="polite"
            >
              <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-yellow-400/75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-yellow-400" />
              </span>
              {optimisticNote}
            </motion.div>
          )}

          {/* Amount block */}
          <motion.div
            className="mb-4 rounded-xl bg-accent/10 p-4"
            variants={activeChildVariants}
          >
            <p className="mb-1 text-sm text-slate-400">
              {t("payment.amountReceived") || "Amount Received"}
            </p>
            <p className="text-2xl font-bold text-accent">
              {amount} {asset}
            </p>
          </motion.div>

          {/* Description */}
          <motion.p
            id="payment-success-description"
            className="mb-6 text-slate-400"
            variants={activeChildVariants}
          >
            {t("payment.successMessage") ||
              "Your payment has been processed successfully. The transaction is now confirmed on the Stellar network."}
          </motion.p>

          {/* Transaction ID */}
          {txId ? (
            <motion.div
              className="mb-6 rounded-lg bg-slate-800/50 p-3"
              variants={activeChildVariants}
            >
              <p className="mb-1 text-xs text-slate-500">
                {t("payment.transactionId") || "Transaction ID"}
              </p>
              <p className="break-all font-mono text-xs text-slate-300">{txId}</p>
            </motion.div>
          ) : null}

          {/* CTA — shows spinner and disables during optimistic dismiss (#981) */}
          <motion.div
            className="flex w-full flex-col gap-3"
            variants={activeChildVariants}
          >
            <button
              onClick={handleDismiss}
              disabled={isDismissing}
              aria-busy={isDismissing}
              className="flex items-center justify-center gap-2 rounded-xl bg-accent px-6 py-3 font-semibold text-black transition-all hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:cursor-not-allowed disabled:opacity-70"
              aria-label={t("common.continue") || "Continue"}
            >
              {isDismissing && (
                <svg
                  className="h-4 w-4 animate-spin"
                  fill="none"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  data-testid="dismiss-spinner"
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
              )}
              {t("common.continue") || "Continue"}
            </button>
          </motion.div>

          {/* Keyboard hint for screen readers (#980) */}
          <p className="sr-only">
            {t("payment.successHint") ||
              "Press Escape or the close button to dismiss this message."}
          </p>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default PaymentSuccessAnimationClient;
