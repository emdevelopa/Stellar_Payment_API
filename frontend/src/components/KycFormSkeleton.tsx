/**
 * KycFormSkeleton
 *
 * Server-safe Suspense fallback rendered while the KycSubmissionForm client
 * bundle is streaming in. Uses plain CSS classes (no framer-motion, no hooks)
 * so it is safe to render in a Server Component or as a Suspense boundary
 * fallback.
 *
 * Structure mirrors the real form so the layout shift on hydration is minimal:
 *   - Progress bar row
 *   - Step indicator dots
 *   - Skeleton field rows (title + 4 fields)
 *   - Navigation button row
 */

import React from "react";

// ── Shimmer bone ──────────────────────────────────────────────────────────────

function Bone({ className = "" }: { className?: string }) {
  return (
    <div
      className={`kyc-shimmer rounded-lg ${className}`}
      aria-hidden="true"
    />
  );
}

// ── Skeleton step dot ─────────────────────────────────────────────────────────

function StepDot({ active }: { active: boolean }) {
  return (
    <div
      className={`h-2 flex-1 rounded-full ${
        active ? "bg-pluto-600 dark:bg-pluto-400" : "bg-pluto-100 dark:bg-pluto-800"
      }`}
      aria-hidden="true"
    />
  );
}

// ── Main skeleton ─────────────────────────────────────────────────────────────

export default function KycFormSkeleton() {
  return (
    <div
      className="w-full max-w-2xl mx-auto"
      role="status"
      aria-label="Loading KYC form…"
      aria-busy="true"
      data-testid="kyc-form-skeleton"
    >
      {/* sr-only label for screen readers */}
      <span className="sr-only">Loading KYC form…</span>

      <div className="rounded-3xl border border-pluto-100 bg-white p-6 shadow-lg sm:p-8 dark:border-pluto-800/60 dark:bg-pluto-900/80 space-y-6">

        {/* ── Progress bar skeleton ─────────────────────────────────────── */}
        <div className="space-y-2" aria-hidden="true">
          {/* "X of 4" label row */}
          <div className="flex items-center justify-between">
            <Bone className="h-3 w-10" />
          </div>
          {/* Step dots */}
          <div className="flex gap-1.5">
            <StepDot active />
            <StepDot active={false} />
            <StepDot active={false} />
            <StepDot active={false} />
          </div>
        </div>

        {/* ── Step content skeleton ─────────────────────────────────────── */}
        <div className="space-y-4" aria-hidden="true">
          {/* Section heading */}
          <Bone className="h-6 w-48" />

          {/* Two-column name row */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Bone className="h-3.5 w-20" />
              <Bone className="h-11 w-full" />
            </div>
            <div className="space-y-1.5">
              <Bone className="h-3.5 w-20" />
              <Bone className="h-11 w-full" />
            </div>
          </div>

          {/* Full-width email row */}
          <div className="space-y-1.5">
            <Bone className="h-3.5 w-16" />
            <Bone className="h-11 w-full" />
          </div>

          {/* Full-width date row */}
          <div className="space-y-1.5">
            <Bone className="h-3.5 w-24" />
            <Bone className="h-11 w-full" />
          </div>
        </div>

        {/* ── Navigation button skeleton ────────────────────────────────── */}
        <div className="flex gap-3 pt-1" aria-hidden="true">
          <Bone className="h-12 flex-1 rounded-xl" />
          <Bone className="h-12 flex-1 rounded-xl" />
        </div>
      </div>
    </div>
  );
}
