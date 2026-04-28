"use client";

import { useEffect, useState } from "react";
import { motion, type Variants } from "framer-motion";
import confetti from "canvas-confetti";

interface PaymentSuccessAnimationProps {
  onComplete?: () => void;
  className?: string;
}

const PLUTO_CONFETTI_COLORS = ["#4A6FA5", "#6B8FBF", "#B8D4E8", "#0D1B2E"];

const cardVariants: Variants = {
  hidden: {
    opacity: 0,
    scale: 0.94,
    y: 18,
  },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: {
      duration: 0.55,
      ease: [0.16, 1, 0.3, 1],
      staggerChildren: 0.08,
      delayChildren: 0.08,
    },
  },
};

const contentVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.4,
      ease: [0.16, 1, 0.3, 1],
    },
  },
};

const ringVariants: Variants = {
  hidden: { opacity: 0, scale: 0.72 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: {
      duration: 0.7,
      ease: [0.22, 1, 0.36, 1],
    },
  },
};

const sparkVariants: Variants = {
  hidden: { opacity: 0, scale: 0.6 },
  visible: (index: number) => ({
    opacity: [0, 1, 0.75],
    scale: [0.6, 1, 0.9],
    y: [0, -6, 0],
    transition: {
      delay: 0.2 + index * 0.08,
      duration: 0.8,
      ease: "easeOut",
    },
  }),
};

const SPARK_POSITIONS = [
  "left-3 top-7",
  "right-5 top-4",
  "left-7 bottom-4",
  "right-3 bottom-8",
];

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncPreference = () => setPrefersReducedMotion(mediaQuery.matches);

    syncPreference();
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", syncPreference);
      return () => mediaQuery.removeEventListener("change", syncPreference);
    }

    mediaQuery.addListener(syncPreference);
    return () => mediaQuery.removeListener(syncPreference);
  }, []);

  return prefersReducedMotion;
}

/**
 * Checkout celebration card for confirmed payments.
 * Keeps the motion work self-contained so the page can control the overlay shell.
 */
export function PaymentSuccessAnimation({
  onComplete,
  className = "",
}: PaymentSuccessAnimationProps) {
  const shouldReduceMotion = usePrefersReducedMotion();

  useEffect(() => {
    const animationDuration = shouldReduceMotion ? 900 : 2000;
    const completionTimer = onComplete
      ? window.setTimeout(onComplete, animationDuration)
      : undefined;

    confetti({
      particleCount: shouldReduceMotion ? 26 : 46,
      spread: shouldReduceMotion ? 70 : 100,
      startVelocity: shouldReduceMotion ? 24 : 32,
      ticks: shouldReduceMotion ? 60 : 90,
      scalar: 0.9,
      origin: { x: 0.5, y: 0.45 },
      colors: PLUTO_CONFETTI_COLORS,
      disableForReducedMotion: shouldReduceMotion,
    });

    if (shouldReduceMotion) {
      return () => {
        if (completionTimer) {
          window.clearTimeout(completionTimer);
        }
      };
    }

    const animationEnd = Date.now() + animationDuration;
    const interval = window.setInterval(() => {
      const timeLeft = animationEnd - Date.now();

      if (timeLeft <= 0) {
        window.clearInterval(interval);
        return;
      }

      const particleCount = Math.max(8, Math.round(22 * (timeLeft / animationDuration)));

      confetti({
        particleCount,
        spread: 72,
        startVelocity: 28,
        ticks: 70,
        scalar: 0.72,
        origin: { x: 0.18, y: 0.52 },
        colors: PLUTO_CONFETTI_COLORS,
      });
      confetti({
        particleCount,
        spread: 72,
        startVelocity: 28,
        ticks: 70,
        scalar: 0.72,
        origin: { x: 0.82, y: 0.52 },
        colors: PLUTO_CONFETTI_COLORS,
      });
    }, 260);

    return () => {
      window.clearInterval(interval);
      if (completionTimer) {
        window.clearTimeout(completionTimer);
      }
    };
  }, [onComplete, shouldReduceMotion]);

  return (
    <motion.div
      className={[
        "relative mx-4 w-full max-w-sm overflow-hidden rounded-[2rem]",
        "border border-[var(--pluto-200)]/80 bg-[linear-gradient(160deg,rgba(255,255,255,0.96),rgba(240,246,251,0.96))]",
        "px-8 py-9 text-center shadow-[0_24px_80px_rgba(13,27,46,0.18)]",
        className,
      ].join(" ")}
      variants={cardVariants}
      initial="hidden"
      animate="visible"
      aria-live="polite"
    >
      <div
        aria-hidden="true"
        className="absolute inset-x-8 top-0 h-24 rounded-full bg-[radial-gradient(circle,rgba(184,212,232,0.8)_0%,rgba(184,212,232,0)_72%)] blur-2xl"
      />

      <motion.div
        className="relative mx-auto mb-6 flex h-28 w-28 items-center justify-center"
        variants={ringVariants}
      >
        <motion.div
          aria-hidden="true"
          className="absolute inset-0 rounded-full border border-[var(--pluto-200)] bg-white/70"
          animate={
            shouldReduceMotion
              ? undefined
              : {
                  scale: [1, 1.06, 1],
                  boxShadow: [
                    "0 0 0 rgba(74,111,165,0.10)",
                    "0 0 30px rgba(74,111,165,0.24)",
                    "0 0 0 rgba(74,111,165,0.10)",
                  ],
                }
          }
          transition={{
            duration: 2.2,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />

        <motion.div
          aria-hidden="true"
          className="absolute inset-3 rounded-full border border-[var(--pluto-300)]/70 bg-[var(--pluto-50)]"
          animate={
            shouldReduceMotion
              ? undefined
              : {
                  scale: [1, 0.97, 1],
                  opacity: [0.9, 1, 0.9],
                }
          }
          transition={{
            duration: 1.8,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />

        {SPARK_POSITIONS.map((position, index) => (
          <motion.span
            key={position}
            aria-hidden="true"
            className={`absolute h-2.5 w-2.5 rounded-full bg-[var(--pluto-400)]/85 ${position}`}
            custom={index}
            variants={sparkVariants}
          />
        ))}

        <svg
          viewBox="0 0 100 100"
          className="relative z-10 h-full w-full drop-shadow-[0_12px_24px_rgba(74,111,165,0.18)]"
          aria-hidden="true"
        >
          <motion.circle
            cx="50"
            cy="50"
            r="34"
            fill="none"
            stroke="var(--pluto-500)"
            strokeWidth="6"
            strokeLinecap="round"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 0.6, ease: "easeInOut" }}
          />
          <motion.path
            d="M32 51L45 64L69 38"
            fill="none"
            stroke="var(--pluto-800)"
            strokeWidth="8"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ delay: 0.25, duration: 0.42, ease: "easeOut" }}
          />
        </svg>
      </motion.div>

      <motion.div className="space-y-2" variants={contentVariants}>
        <h2 className="text-lg font-bold tracking-tight text-[var(--pluto-800)]">
          Payment Secured
        </h2>
        <p className="mx-auto max-w-[15rem] text-sm leading-6 text-[var(--pluto-600)]">
          Transaction verified on Stellar
        </p>
      </motion.div>
    </motion.div>
  );
}

export default PaymentSuccessAnimation;
