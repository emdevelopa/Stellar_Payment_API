/**
 * MetricsSkeleton
 *
 * A pixel-accurate skeleton of the full PaymentMetrics layout.
 * Mirrors every section in render order:
 *   1. 4-card summary grid  (total volume, total payments, confirmed, success rate)
 *   2. Chart panel
 *      a. Header row  (title/subtitle  +  range pills  +  export button)
 *      b. Asset toggle pills
 *      c. Chart area
 *
 * All dimensions are taken directly from the live component so there is zero
 * layout shift once real data replaces the skeleton.
 */

import Skeleton, { SkeletonTheme } from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";

// ─── Individual section skeletons ─────────────────────────────────────────────

/**
 * Matches the 4-column `summary` stat grid.
 * On small screens the grid collapses to 2 columns (sm:grid-cols-2),
 * on large screens it expands to 4 (lg:grid-cols-4).
 */
function SummaryGridSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur"
        >
          {/* Label — e.g. "7-Day Volume" */}
          <Skeleton width={110} height={12} borderRadius={4} />

          {/* Value + unit on the same baseline */}
          <div className="mt-2 flex items-baseline gap-2">
            <Skeleton width={104} height={36} borderRadius={6} />
            <Skeleton width={36} height={18} borderRadius={4} />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Matches the chart panel: the outer card with its header, toggle strip, and
 * chart area.
 *
 * CHART_HEIGHT is 300 px in the live component — keep in sync if changed.
 */
function ChartPanelSkeleton() {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-white/10 bg-white/5 p-6 backdrop-blur">
      {/* ── Header row ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        {/* Title + subtitle (left side) */}
        <div className="flex flex-col gap-2">
          <Skeleton width={220} height={22} borderRadius={6} />
          <Skeleton width={160} height={14} borderRadius={4} />
        </div>

        {/* Range pill group + export button (right side) */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Range selector — 3 pills inside a rounded container */}
          <div className="flex gap-1 rounded-lg border border-white/10 bg-white/5 p-1">
            <Skeleton width={34} height={28} borderRadius={6} />
            <Skeleton width={34} height={28} borderRadius={6} />
            <Skeleton width={34} height={28} borderRadius={6} />
          </div>

          {/* Export button */}
          <Skeleton width={148} height={36} borderRadius={10} />
        </div>
      </div>

      {/* ── Asset toggle pills ── */}
      <div className="flex flex-wrap gap-2">
        <Skeleton width={62} height={26} borderRadius={999} />
        <Skeleton width={62} height={26} borderRadius={999} />
      </div>

      {/* ── Chart area ── */}
      <div className="h-[300px]">
        <Skeleton height="100%" borderRadius={8} />
      </div>
    </div>
  );
}

// ─── Composed export ──────────────────────────────────────────────────────────

/**
 * Drop-in replacement for the full `PaymentMetrics` component during loading.
 *
 * Usage in `PaymentMetrics.tsx`:
 *
 * ```tsx
 * import MetricsSkeleton from "@/components/MetricsSkeleton";
 *
 * // Replace the existing inline skeleton block with:
 * if (showSkeleton || loading || !hydrated) return <MetricsSkeleton />;
 * ```
 */
export default function MetricsSkeleton() {
  return (
    <SkeletonTheme baseColor="#1e293b" highlightColor="#334155">
      <div className="flex flex-col gap-6">
        <SummaryGridSkeleton />
        <ChartPanelSkeleton />
      </div>
    </SkeletonTheme>
  );
}
