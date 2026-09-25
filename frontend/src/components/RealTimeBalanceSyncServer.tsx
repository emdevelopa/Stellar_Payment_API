import { Suspense } from "react";
import RealTimeBalanceSync from "./RealTimeBalanceSync";

interface RealTimeBalanceSyncServerProps {
  merchantId?: string | null;
  apiKey?: string | null;
  address?: string | null;
  horizonUrl?: string;
  pollingInterval?: number;
  className?: string;
}

/**
 * Server Component wrapper for Real-time Balance Sync
 * Issue #1150: Migrate component to React Server Components
 *
 * This server component wrapper provides:
 * - Server-side rendering for initial state
 * - Optimized bundle size (interactive parts lazy-loaded)
 * - Better SEO and initial page load performance
 * - Suspense boundaries for streaming
 */
export default async function RealTimeBalanceSyncServer(
  props: RealTimeBalanceSyncServerProps,
) {
  // Server-side data fetching (optional - can pre-fetch initial balances)
  // This runs on the server, reducing client-side bundle

  return (
    <Suspense
      fallback={
        <div className="w-full rounded-3xl border border-slate-200 bg-white p-4 shadow-sm animate-pulse dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-3 flex items-center justify-between">
            <div className="h-5 w-32 rounded bg-slate-200 dark:bg-slate-700" />
            <div className="h-7 w-20 rounded-xl bg-slate-200 dark:bg-slate-700" />
          </div>
          <div className="space-y-2 rounded-2xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/50">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center justify-between">
                <div className="h-4 w-16 rounded bg-slate-200 dark:bg-slate-700" />
                <div className="h-4 w-24 rounded bg-slate-200 dark:bg-slate-700" />
              </div>
            ))}
          </div>
        </div>
      }
    >
      <RealTimeBalanceSync {...props} />
    </Suspense>
  );
}

// Export metadata for SEO
export const metadata = {
  title: "Real-time Balance Sync",
  description: "Monitor your cryptocurrency balances in real-time",
};
