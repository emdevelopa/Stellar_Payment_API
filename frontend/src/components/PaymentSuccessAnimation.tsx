"use client";

import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import CheckIcon from "@heroicons/react/24/outline/CheckIcon";

interface PaymentSuccessAnimationProps {
  title: string;
  description: string;
}

/**
 * PaymentSuccessAnimation Component
 * 
 * A premium, framer-motion powered success animation following Drips Wave design standards.
 * Features:
 * - Spring-loaded scale entry for the success icon
 * - Ripple effect using multiple pulsating rings
 * - Path animation for the checkmark
 * - Staggered text entry
 */
export default function PaymentSuccessAnimation({
  title,
  description,
}: PaymentSuccessAnimationProps) {
  return (
    <div className="flex flex-col items-center justify-center py-6 text-center">
      <div className="relative mb-8 flex h-24 w-24 items-center justify-center">
        {/* Radial Glow / Ripple Effect */}
        <AnimatePresence>
          {[...Array(3)].map((_, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{
                opacity: [0, 0.15, 0],
                scale: [0.8, 1.8, 2.2],
              }}
              transition={{
                duration: 2.5,
                repeat: Infinity,
                delay: i * 0.8,
                ease: "easeOut",
              }}
              className="absolute inset-0 rounded-full bg-emerald-400"
              aria-hidden="true"
            />
          ))}
        </AnimatePresence>

        {/* Success Icon Container */}
        <motion.div
          initial={{ scale: 0, rotate: -15 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{
            type: "spring",
            stiffness: 260,
            damping: 20,
            delay: 0.1,
          }}
          className="relative z-10 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500 shadow-xl shadow-emerald-500/30"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.3, duration: 0.4 }}
          >
            <CheckIcon
              className="h-12 w-12 text-white"
              strokeWidth={3}
              aria-hidden="true"
            />
          </motion.div>
        </motion.div>
      </div>

      {/* Title & Description */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          duration: 0.6,
          delay: 0.5,
          ease: [0.21, 1.02, 0.73, 1], // Custom cubic-bezier for smooth landing
        }}
        className="flex flex-col gap-2 px-4"
      >
        <h3 className="text-xl font-bold tracking-tight text-[#0A0A0A]">
          {title}
        </h3>
        <p className="mx-auto max-w-[280px] text-sm font-medium leading-relaxed text-[#6B6B6B]">
          {description}
        </p>
      </motion.div>

      {/* Subtle Confetti alternative: floating sparks */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {[...Array(6)].map((_, i) => (
          <motion.div
            key={`spark-${i}`}
            initial={{ 
              opacity: 0, 
              x: "50%", 
              y: "50%" 
            }}
            animate={{ 
              opacity: [0, 1, 0],
              x: `${40 + Math.random() * 20}%`, 
              y: `${30 + Math.random() * 40}%`,
              scale: [0, 1.5, 0]
            }}
            transition={{
              duration: 3 + Math.random() * 2,
              repeat: Infinity,
              delay: i * 0.5,
              ease: "easeInOut"
            }}
            className="absolute h-1 w-1 rounded-full bg-emerald-300"
          />
        ))}
      </div>
    </div>
  );
}
