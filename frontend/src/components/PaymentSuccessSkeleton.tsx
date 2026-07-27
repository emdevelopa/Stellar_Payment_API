/**
 * PaymentSuccessSkeleton
 *
 * Server-safe placeholder rendered while the PaymentSuccessAnimation client
 * bundle (framer-motion, canvas-confetti) streams in. No hooks, no "use
 * client" required, so it can be used as a next/dynamic `loading` fallback
 * or a Suspense boundary fallback.
 */

import React from "react";

function Bone({ className = "" }: { className?: string }) {
  return (
    <div
      className={`rounded-lg bg-gradient-to-r from-slate-800 via-slate-700 to-slate-800
        bg-[length:400%_100%] animate-[shimmer_1.6s_ease-in-out_infinite]
        motion-reduce:animate-none
        ${className}`}
      aria-hidden="true"
    />
  );
}

export interface PaymentSuccessSkeletonProps {
  loadingLabel?: string;
}

export default function PaymentSuccessSkeleton({
  loadingLabel = "Loading payment confirmation…",
}: PaymentSuccessSkeletonProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      role="status"
      aria-label={loadingLabel}
      aria-busy="true"
      data-testid="payment-success-skeleton"
    >
      <span className="sr-only">{loadingLabel}</span>

      <div className="relative w-full max-w-md overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-black via-gray-900 to-black p-8 text-center shadow-2xl">
        {/* Icon circle */}
        <Bone className="mx-auto mb-6 h-20 w-20 rounded-full" />
        {/* Heading */}
        <Bone className="mx-auto mb-3 h-8 w-48" />
        {/* Amount block */}
        <Bone className="mb-4 h-16 w-full rounded-xl" />
        {/* Description lines */}
        <div className="mb-6 space-y-2" aria-hidden="true">
          <Bone className="mx-auto h-3 w-full" />
          <Bone className="mx-auto h-3 w-3/4" />
        </div>
        {/* CTA button */}
        <Bone className="h-12 w-full rounded-xl" />
      </div>
    </div>
  );
}
