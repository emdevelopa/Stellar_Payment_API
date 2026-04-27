"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence, LayoutGroup } from "framer-motion";
import confetti from "canvas-confetti";
import { useTranslations } from "next-intl";

interface PaymentSuccessAnimationProps {
  amount: number | string;
  asset: string;
  onDone?: () => void;
  optimistic?: boolean;
}

/**
 * Premium Payment Success Animation module.
 * Adheres to high-fidelity design standards: fluid, responsive, and premium.
 * 
 * Features:
 * - SVG Path drawing for the checkmark icon
 * - Staggered entrance for all text elements using motion variants
 * - Dynamic background aura (glow) during celebration phase
 * - Optimized spring physics for a high-end "Drips Wave" feel
 * 
 * @param {PaymentSuccessAnimationProps} props - Component properties
 */
export default function PaymentSuccessAnimation({
  amount,
  asset,
  onDone,
  optimistic = false,
}: PaymentSuccessAnimationProps) {
  const t = useTranslations("checkout");
  const [phase, setPhase] = useState<"enter" | "celebrate" | "result">("enter");

  useEffect(() => {
    const timer1 = setTimeout(() => {
      setPhase("celebrate");
      firePremiumConfetti();
    }, 800);

    const timer2 = setTimeout(() => {
      setPhase("result");
    }, 2600);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
    };
  }, []);

  const firePremiumConfetti = () => {
    const count = 200;
    const defaults = {
      origin: { y: 0.7 },
      colors: ["#6b8fbf", "#4a6fa5", "#ffffff", "#000000"],
    };

    function fire(particleRatio: number, opts: confetti.Options) {
      void confetti({
        ...defaults,
        ...opts,
        particleCount: Math.floor(count * particleRatio),
      });
    }

    fire(0.25, { spread: 26, startVelocity: 55 });
    fire(0.2, { spread: 60 });
    fire(0.35, { spread: 100, decay: 0.91, scalar: 0.8 });
    fire(0.1, { spread: 120, startVelocity: 25, decay: 0.92, scalar: 1.2 });
    fire(0.1, { spread: 120, startVelocity: 45 });
  };

  const containerVariants: import("framer-motion").Variants = {
    hidden: { opacity: 0 },
    visible: { 
      opacity: 1,
      transition: { 
        staggerChildren: 0.1,
        delayChildren: 0.3
      }
    }
  };

  const itemVariants: import("framer-motion").Variants = {
    hidden: { y: 20, opacity: 0 },
    visible: { 
      y: 0, 
      opacity: 1,
      transition: { type: "spring", stiffness: 300, damping: 24 }
    }
  };

  return (
    <div className="flex flex-col items-center justify-center py-8 relative overflow-hidden">
      {/* Background Aura */}
      <AnimatePresence>
        {phase !== "enter" && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-0 pointer-events-none"
          >
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-pluto-500/10 rounded-full blur-[80px]" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 bg-pluto-300/20 rounded-full blur-[60px] animate-pulse" />
          </motion.div>
        )}
      </AnimatePresence>

      <LayoutGroup>
        <AnimatePresence mode="wait">
          {phase === "enter" && (
            <motion.div
              key="enter"
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0, filter: "blur(10px)" }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
              className="relative z-10 flex flex-col items-center"
            >
              <div className="relative flex h-32 w-32 items-center justify-center">
                {/* Ripples */}
                {[...Array(3)].map((_, i) => (
                  <motion.div
                    key={i}
                    initial={{ scale: 1, opacity: 0.3 }}
                    animate={{ scale: 2, opacity: 0 }}
                    transition={{ 
                      duration: 2, 
                      repeat: Infinity, 
                      delay: i * 0.6,
                      ease: "easeOut" 
                    }}
                    className="absolute inset-0 rounded-full border-2 border-pluto-500/30"
                  />
                ))}
                
                <div className="relative z-10 flex h-20 w-20 items-center justify-center rounded-full bg-pluto-500 text-white shadow-[0_0_40px_rgba(74,111,165,0.4)]">
                  <motion.svg
                    className="h-10 w-10"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.8, delay: 0.2, ease: "easeInOut" }}
                  >
                    <motion.path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={3}
                      d="M5 13l4 4L19 7"
                    />
                  </motion.svg>
                </div>
              </div>
            </motion.div>
          )}

          {(phase === "celebrate" || phase === "result") && (
            <motion.div
              key="result"
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              className="relative z-10 w-full text-center flex flex-col items-center"
            >
              <motion.div
                layoutId="success-icon"
                className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-pluto-50 text-pluto-600 border border-pluto-100 shadow-sm"
              >
                <svg
                  className="h-8 w-8"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2.5}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </motion.div>

              <motion.h2
                variants={itemVariants}
                className="text-2xl font-bold text-[#0A0A0A] tracking-tight mb-1"
              >
                {t("receivedTitle")}
              </motion.h2>

              <motion.div
                variants={itemVariants}
                className="flex items-baseline gap-1 mb-4"
              >
                <span className="text-lg font-bold text-pluto-600">{amount}</span>
                <span className="text-sm font-medium text-pluto-400 uppercase tracking-widest">{asset}</span>
              </motion.div>

              <AnimatePresence>
                {optimistic && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className="mb-4 flex items-center gap-2 rounded-full bg-pluto-50 px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest text-pluto-600 border border-pluto-100 shadow-sm"
                  >
                    <span className="flex h-1.5 w-1.5 rounded-full bg-pluto-500 animate-pulse shadow-[0_0_8px_rgba(74,111,165,0.6)]" />
                    Settling on-chain...
                  </motion.div>
                )}
              </AnimatePresence>

              <AnimatePresence>
                {phase === "result" && (
                  <motion.p
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5 }}
                    className="text-sm text-[#6B6B6B] max-w-[280px] mx-auto leading-relaxed"
                  >
                    {t("receivedDescription")}
                  </motion.p>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </LayoutGroup>
    </div>
  );
}
import { motion, type Variants } from "framer-motion";
import { useEffect } from "react";
import confetti from "canvas-confetti";

interface PaymentSuccessAnimationProps {
  onComplete?: () => void;
  className?: string;
}

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
      type: "spring",
      stiffness: 300,
      damping: 20,
      staggerChildren: 0.1,
    },
  },
};

const circleVariants: Variants = {
  hidden: { pathLength: 0, opacity: 0 },
  visible: {
    pathLength: 1,
    opacity: 1,
    transition: {
      duration: 0.6,
      ease: "easeInOut",
    },
  },
};

const checkVariants: Variants = {
  hidden: { pathLength: 0, opacity: 0 },
  visible: {
    pathLength: 1,
    opacity: 1,
    transition: {
      duration: 0.4,
      ease: "easeOut",
      delay: 0.3,
    },
  },
};

export function PaymentSuccessAnimation({ onComplete, className = "" }: PaymentSuccessAnimationProps) {
  useEffect(() => {
    // Fire brand-themed confetti
    const duration = 2000;
    const animationEnd = Date.now() + duration;
    const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 0 };

    const randomInRange = (min: number, max: number) => Math.random() * (max - min) + min;

    const interval: NodeJS.Timeout = setInterval(() => {
      const timeLeft = animationEnd - Date.now();

      if (timeLeft <= 0) {
        clearInterval(interval);
        onComplete?.();
        return;
      }

      const particleCount = 20 * (timeLeft / duration);
      
      // Use Pluto theme colors: steel blue, ice blue, and deep navy
      confetti({
        ...defaults,
        particleCount,
        origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 },
        colors: ["#4A6FA5", "#B8D4E8", "#0D1B2E"],
      });
      confetti({
        ...defaults,
        particleCount,
        origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 },
        colors: ["#4A6FA5", "#B8D4E8", "#0D1B2E"],
      });
    }, 250);

    return () => clearInterval(interval);
  }, [onComplete]);

  return (
    <motion.div
      className={`flex flex-col items-center justify-center gap-4 ${className}`}
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      <div className="relative h-24 w-24">
        {/* Animated Background Pulse */}
        <motion.div
          className="absolute inset-0 rounded-full bg-[var(--pluto-100)]"
          initial={{ scale: 0 }}
          animate={{ scale: [1, 1.2, 1] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
        />
        
        <svg
          viewBox="0 0 100 100"
          className="relative h-full w-full drop-shadow-[0_0_8px_rgba(74,111,165,0.3)]"
        >
          {/* Circle Outline */}
          <motion.circle
            cx="50"
            cy="50"
            r="45"
            fill="none"
            stroke="var(--pluto-500)"
            strokeWidth="6"
            strokeLinecap="round"
            variants={circleVariants}
          />
          
          {/* Checkmark */}
          <motion.path
            d="M30 50L45 65L70 35"
            fill="none"
            stroke="var(--pluto-500)"
            strokeWidth="8"
            strokeLinecap="round"
            strokeLinejoin="round"
            variants={checkVariants}
          />
        </svg>
      </div>
      
      <motion.div
        className="text-center"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
      >
        <h3 className="text-lg font-bold text-[var(--pluto-800)]">Payment Secured</h3>
        <p className="text-sm text-[var(--pluto-600)]">Transaction verified on Stellar</p>
      </motion.div>
    </motion.div>
  );
}
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
