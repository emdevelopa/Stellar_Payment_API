"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence, type Variants } from "framer-motion";
import confetti from "canvas-confetti";
import { useTranslations } from "next-intl";

/**
 * Props for PaymentSuccessAnimation component
 */
interface PaymentSuccessAnimationProps {
  show: boolean;
  onComplete?: () => void;
  amount?: string;
  asset?: string;
  txId?: string;
}

/**
 * Animation variants for the success container
 */
const containerVariants: Variants = {
  hidden: { opacity: 0, scale: 0.8 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: {
      duration: 0.5,
      ease: [0.16, 1, 0.3, 1],
      staggerChildren: 0.1,
    },
  },
  exit: {
    opacity: 0,
    scale: 0.9,
    transition: { duration: 0.3 },
  },
};

/**
 * Animation variants for success elements
 */
const successVariants: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] },
  },
};

/**
 * Animation variants for confetti bursts
 */
const confettiVariants: Variants = {
  hidden: { scale: 0 },
  visible: {
    scale: 1,
    transition: {
      duration: 0.6,
      ease: "easeOut",
    },
  },
};

/**
 * PaymentSuccessAnimation Component
 *
 * Displays a celebratory animation for successful payments with comprehensive
 * screen reader support and accessibility features.
 */
export const PaymentSuccessAnimation: React.FC<PaymentSuccessAnimationProps> = ({
  show,
  onComplete,
  amount = "0",
  asset = "XLM",
  txId,
}) => {
  const t = useTranslations();
  const [hasAnnounced, setHasAnnounced] = useState(false);
  const [confettiTriggered, setConfettiTriggered] = useState(false);

  /**
   * Trigger confetti animation
   */
  useEffect(() => {
    if (show && !confettiTriggered) {
      setConfettiTriggered(true);

      const duration = 3000;
      const end = Date.now() + duration;

      const frame = () => {
        confetti({
          particleCount: 7,
          angle: 60,
          spread: 70,
          origin: { x: 0 },
          colors: ["#00F5D4", "#6C5CE7", "#00D4AA"],
        });
        confetti({
          particleCount: 7,
          angle: 120,
          spread: 70,
          origin: { x: 1 },
          colors: ["#00F5D4", "#6C5CE7", "#00D4AA"],
        });

        if (Date.now() < end) {
          requestAnimationFrame(frame);
        }
      };

      frame();
    }
  }, [show, confettiTriggered]);

  /**
   * Handle completion and announcements
   */
  useEffect(() => {
    if (show && !hasAnnounced) {
      setHasAnnounced(true);

      // Announce to screen readers
      const announcement = t("payment.successAnnounce") ||
        `Payment successful! ${amount} ${asset} has been received.`;

      // Use a timeout to ensure the announcement is processed
      setTimeout(() => {
        setHasAnnounced(false); // Reset for next animation
      }, 1000);

      // Call onComplete after animation
      setTimeout(() => {
        onComplete?.();
      }, 4000);
    }
  }, [show, hasAnnounced, onComplete, amount, asset, t]);

  if (!show) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-success-title"
        aria-describedby="payment-success-description"
      >
        {/* Screen reader announcement */}
        <div
          className="sr-only"
          role="status"
          aria-live="assertive"
          aria-atomic="true"
        >
          {t("payment.successAnnounce") ||
            `Payment successful! ${amount} ${asset} has been received.`}
        </div>

        <motion.div
          className="relative w-full max-w-md overflow-hidden rounded-3xl border border-accent/30 bg-gradient-to-br from-black via-gray-900 to-black p-8 text-center shadow-2xl"
          variants={successVariants}
        >
          {/* Close button */}
          <motion.button
            onClick={onComplete}
            className="absolute top-4 right-4 text-slate-500 hover:text-white transition-colors z-10"
            variants={successVariants}
            aria-label={t("common.close") || "Close success animation"}
          >
            ✕
          </motion.button>

          {/* Animated success icon */}
          <motion.div
            className="relative mb-6 flex h-20 w-20 items-center justify-center mx-auto"
            variants={confettiVariants}
          >
            {/* Pulsing background */}
            <motion.div
              className="absolute inset-0 rounded-full bg-accent/20"
              animate={{
                scale: [1, 1.2, 1],
                opacity: [0.5, 1, 0.5],
              }}
              transition={{
                duration: 2,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            />

            {/* Check mark with bounce */}
            <motion.div
              className="relative z-10 text-4xl"
              animate={{
                scale: [0, 1.2, 1],
                rotate: [0, 10, -10, 0],
              }}
              transition={{
                duration: 0.8,
                ease: "easeOut",
              }}
            >
              ✅
            </motion.div>
          </motion.div>

          {/* Success title */}
          <motion.h1
            id="payment-success-title"
            className="mb-3 text-3xl font-bold tracking-tight text-white"
            variants={successVariants}
          >
            {t("payment.successTitle") || "Payment Successful!"}
          </motion.h1>

          {/* Amount display */}
          <motion.div
            className="mb-4 rounded-xl bg-accent/10 p-4"
            variants={successVariants}
          >
            <p className="text-sm text-slate-400 mb-1">
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
            variants={successVariants}
          >
            {t("payment.successMessage") ||
              "Your payment has been processed successfully. The transaction is now confirmed on the Stellar network."}
          </motion.p>

          {/* Transaction ID if provided */}
          {txId && (
            <motion.div
              className="mb-6 p-3 rounded-lg bg-slate-800/50"
              variants={successVariants}
            >
              <p className="text-xs text-slate-500 mb-1">
                {t("payment.transactionId") || "Transaction ID"}
              </p>
              <p className="text-xs font-mono text-slate-300 break-all">
                {txId}
              </p>
            </motion.div>
          )}

          {/* Action buttons */}
          <motion.div
            className="flex w-full flex-col gap-3"
            variants={successVariants}
          >
            <button
              onClick={onComplete}
              className="flex items-center justify-center rounded-xl bg-accent px-6 py-3 font-semibold text-black transition-all hover:bg-accent/90 focus:ring-2 focus:ring-accent/50"
              aria-label={t("common.continue") || "Continue"}
            >
              {t("common.continue") || "Continue"}
            </button>
          </motion.div>

          {/* Accessibility hint */}
          <motion.p
            className="sr-only"
            variants={successVariants}
          >
            {t("payment.successHint") ||
              "Press the continue button or close button to dismiss this success message."}
          </motion.p>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default PaymentSuccessAnimation;