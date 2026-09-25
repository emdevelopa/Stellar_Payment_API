/**
 * TransactionFilterSidebarSkeleton
 *
 * Provides a smooth loading skeleton for the Transaction Filter Sidebar.
 * Used while the sidebar is hydrating from the server or during initial load.
 * Features animated shimmer effect and placeholder fields matching the real component.
 */

"use client";

import { motion } from "framer-motion";

export default function TransactionFilterSidebarSkeleton() {
  const shimmerVariants = {
    initial: { opacity: 0.6 },
    animate: {
      opacity: 1,
      transition: { duration: 1.5, repeat: Infinity, repeatType: "reverse" },
    },
  };

  return (
    <div className="hidden lg:block w-[320px] h-fit sticky top-24">
      <div className="relative flex h-full flex-col rounded-2xl bg-white p-6 shadow-xl border border-[#E8E8E8]">
        {/* Header skeleton */}
        <div className="mb-8 flex items-center gap-3">
          <motion.div
            variants={shimmerVariants}
            initial="initial"
            animate="animate"
            className="h-6 w-24 rounded-lg bg-[#E8E8E8]"
          />
          <motion.div
            variants={shimmerVariants}
            initial="initial"
            animate="animate"
            className="h-4 w-8 rounded-full bg-[#E8E8E8]"
          />
        </div>

        {/* Filter fields skeleton */}
        <div className="flex flex-1 flex-col gap-6 pr-1">
          {/* Search field */}
          <div className="flex flex-col gap-2">
            <motion.div
              variants={shimmerVariants}
              initial="initial"
              animate="animate"
              className="h-3 w-16 rounded bg-[#E8E8E8]"
            />
            <motion.div
              variants={shimmerVariants}
              initial="initial"
              animate="animate"
              className="h-10 w-full rounded-xl bg-[#F9F9F9]"
            />
          </div>

          {/* Status field */}
          <div className="flex flex-col gap-2">
            <motion.div
              variants={shimmerVariants}
              initial="initial"
              animate="animate"
              className="h-3 w-16 rounded bg-[#E8E8E8]"
            />
            <motion.div
              variants={shimmerVariants}
              initial="initial"
              animate="animate"
              className="h-10 w-full rounded-xl bg-[#F9F9F9]"
            />
          </div>

          {/* Asset buttons */}
          <div className="flex flex-col gap-2">
            <motion.div
              variants={shimmerVariants}
              initial="initial"
              animate="animate"
              className="h-3 w-16 rounded bg-[#E8E8E8]"
            />
            <div className="flex flex-wrap gap-2">
              {[1, 2, 3].map((i) => (
                <motion.div
                  key={i}
                  variants={shimmerVariants}
                  initial="initial"
                  animate="animate"
                  className="h-8 w-20 rounded-full bg-[#F9F9F9]"
                />
              ))}
            </div>
          </div>

          {/* Date range section */}
          <div className="mt-2 flex flex-col gap-4 border-t border-[#F0F0F0] pt-4">
            <motion.div
              variants={shimmerVariants}
              initial="initial"
              animate="animate"
              className="h-3 w-24 rounded bg-[#E8E8E8]"
            />
            <div className="flex flex-col gap-3">
              {[1, 2].map((i) => (
                <div key={i} className="flex flex-col gap-1.5">
                  <motion.div
                    variants={shimmerVariants}
                    initial="initial"
                    animate="animate"
                    className="h-3 w-10 rounded bg-[#E8E8E8]"
                  />
                  <motion.div
                    variants={shimmerVariants}
                    initial="initial"
                    animate="animate"
                    className="h-8 w-full rounded-xl bg-[#F9F9F9]"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Clear button skeleton */}
        <div className="mt-8 border-t border-[#F0F0F0] pt-6">
          <motion.div
            variants={shimmerVariants}
            initial="initial"
            animate="animate"
            className="h-10 w-full rounded-xl bg-[#E8E8E8]"
          />
        </div>
      </div>
    </div>
  );
}
