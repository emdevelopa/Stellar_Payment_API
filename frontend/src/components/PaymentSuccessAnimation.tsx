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
