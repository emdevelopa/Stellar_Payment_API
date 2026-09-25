"use client";

import React, { useId, useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface InfoTooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function InfoTooltip({
  content,
  children,
  className = "",
}: InfoTooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const tooltipId = useId();

  // Close on escape
  useEffect(() => {
    if (!isVisible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsVisible(false);
    };

    const handleOutsidePointer = (event: MouseEvent | TouchEvent) => {
      if (
        triggerRef.current &&
        contentRef.current &&
        !triggerRef.current.contains(event.target as Node) &&
        !contentRef.current.contains(event.target as Node)
      ) {
        setIsVisible(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleOutsidePointer);
    document.addEventListener("touchstart", handleOutsidePointer);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleOutsidePointer);
      document.removeEventListener("touchstart", handleOutsidePointer);
    };
  }, [isVisible]);

  return (
    <div
      className={`relative inline-flex items-center ${className}`}
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
      onFocusCapture={() => setIsVisible(true)}
      onBlurCapture={() => setIsVisible(false)}
    >
      <button
        ref={triggerRef}
        type="button"
        className="group/tooltip cursor-help rounded px-0.5 border-b border-dotted border-[var(--text-secondary)]/40 decoration-[var(--text-secondary)]/40 transition-all duration-300 text-[var(--text-secondary)] hover:text-[var(--pluto-600)] hover:border-[var(--pluto-600)] hover:bg-[var(--pluto-50)] focus-visible:text-[var(--pluto-600)] focus-visible:border-[var(--pluto-600)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pluto-300)] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
        onFocus={() => setIsVisible(true)}
        onClick={() => setIsVisible(true)}
        aria-label="More information"
        aria-expanded={isVisible}
        aria-controls={tooltipId}
        aria-describedby={isVisible ? tooltipId : undefined}
      >
        {children}
      </button>

      <AnimatePresence>
        {isVisible && (
          <motion.div
            ref={contentRef}
            id={tooltipId}
            role="tooltip"
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
            className="absolute bottom-full left-1/2 z-[100] mb-4 w-[min(18rem,calc(100vw-2rem))] max-w-full -translate-x-1/2 rounded-2xl border border-[var(--pluto-100)] bg-white/95 p-4 text-[12px] font-medium leading-relaxed text-[var(--text-primary)] shadow-[0_20px_50px_rgba(0,0,0,0.12)] backdrop-blur-md max-h-[65vh] overflow-auto"
          >
            <div className="relative z-10">{content}</div>
            {/* Arrow */}
            <div className="absolute top-full left-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1.5 rotate-45 border-b border-r border-[var(--pluto-100)] bg-white/95" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
