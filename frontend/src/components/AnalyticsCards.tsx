"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale } from "next-intl";
import { AnimatePresence, motion, type PanInfo } from "framer-motion";
import {
  useHydrateMerchantStore,
  useMerchantApiKey,
  useMerchantHydrated,
} from "@/lib/merchant-store";
import {
  useDisplayPreferences,
  formatAmount,
} from "@/lib/display-preferences";

interface MetricsResponse {
  total_volume: number;
}

interface Payment {
  id: string;
  status: string;
}

interface PaymentsResponse {
  payments: Payment[];
}

interface CardDetail {
  id: string;
  label: string;
  value: string;
  description: string;
}

const DRAWER_DISMISS_DRAG_THRESHOLD = 120;

/** Mirrors the (max-width: 640px) breakpoint ApiUsageChart.tsx already uses for compact layouts. */
function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 640px)");
    const sync = (event?: MediaQueryList | MediaQueryListEvent) => {
      setIsMobile(event?.matches ?? mediaQuery.matches);
    };
    sync(mediaQuery);
    const listener = (event: MediaQueryListEvent) => sync(event);
    mediaQuery.addEventListener("change", listener);
    return () => mediaQuery.removeEventListener("change", listener);
  }, []);

  return isMobile;
}

/**
 * Detects a network-layer failure (the request never reached the server) as
 * distinct from a server-side rejection, so the caller can preserve
 * already-fetched state and offer a retry rather than clearing everything on
 * every failure mode alike.
 */
function isNetworkFailure(error: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  if (error instanceof TypeError) return true;
  if (error instanceof Error) return /network|fetch|offline|connection/i.test(error.message);
  return false;
}

export default function AnalyticsCards() {
  const [totalVolume, setTotalVolume] = useState<number>(0);
  const [successRate, setSuccessRate] = useState<number>(0);
  const [activeIntents, setActiveIntents] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [networkError, setNetworkError] = useState(false);
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  const apiKey = useMerchantApiKey();
  const hydrated = useMerchantHydrated();
  const locale = useLocale();
  const { hideCents } = useDisplayPreferences();
  const isMobile = useIsMobile();

  useHydrateMerchantStore();

  useEffect(() => {
    if (!hydrated || !apiKey) return;
    const controller = new AbortController();
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

    const fetchMetrics = async () => {
      try {
        const [metricsRes, paymentsRes] = await Promise.all([
          fetch(`${apiUrl}/api/metrics/7day`, {
            headers: { "x-api-key": apiKey },
            signal: controller.signal,
          }),
          fetch(`${apiUrl}/api/payments?limit=100`, {
            headers: { "x-api-key": apiKey },
            signal: controller.signal,
          })
        ]);

        if (metricsRes.ok && paymentsRes.ok) {
          const metricsData: MetricsResponse = await metricsRes.json();
          const paymentsData: PaymentsResponse = await paymentsRes.json();

          setTotalVolume(metricsData.total_volume);

          const payments = paymentsData.payments || [];
          const pending = payments.filter((p) => p.status === "pending").length;
          const confirmed = payments.filter((p) => p.status === "confirmed").length;
          const totalResolved = confirmed + payments.filter((p) => p.status === "failed" || p.status === "refunded").length;

          setActiveIntents(pending);
          setSuccessRate(totalResolved > 0 ? (confirmed / totalResolved) * 100 : 0);
          setNetworkError(false);
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        console.error("Failed to fetch analytics", err);
        // Optimistic rollback: on a network failure, keep whatever metrics
        // are already on screen (stale-but-present) rather than resetting
        // them to zero, and surface a retry instead of a blank/misleading
        // "0" state. A non-network (e.g. 4xx/5xx-mapped) failure falls
        // through the `if (metricsRes.ok ...)` above without touching state
        // either, so this only distinguishes the retry affordance.
        setNetworkError(isNetworkFailure(err));
      } finally {
        setLoading(false);
      }
    };

    fetchMetrics();
    return () => controller.abort();
  }, [apiKey, hydrated, retryNonce]);

  const cards: CardDetail[] = useMemo(
    () => [
      {
        id: "total-volume",
        label: "Total Volume (7D)",
        value: formatAmount(totalVolume, locale, hideCents),
        description: "Total payment volume processed across all confirmed transactions in the last 7 days.",
      },
      {
        id: "success-rate",
        label: "Success Rate",
        value: `${successRate.toFixed(1)}%`,
        description: "Share of resolved payments (confirmed vs. confirmed + failed/refunded) in the last 7 days. Pending payments aren't counted until they resolve.",
      },
      {
        id: "active-intents",
        label: "Active intents",
        value: String(activeIntents),
        description: "Payments currently awaiting confirmation. These are not yet counted in the success rate above.",
      },
    ],
    [totalVolume, successRate, activeIntents, locale, hideCents]
  );

  const openCard = cards.find((c) => c.id === openCardId) ?? null;

  const handleRetry = () => {
    setNetworkError(false);
    setLoading(true);
    setRetryNonce((n) => n + 1);
  };

  const closeDetail = () => setOpenCardId(null);

  const handleDrawerDragEnd = (
    _event: PointerEvent | MouseEvent | TouchEvent,
    info: PanInfo
  ) => {
    if (info.offset.y > DRAWER_DISMISS_DRAG_THRESHOLD || info.velocity.y > 500) {
      closeDetail();
    }
  };

  if (loading || !hydrated) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-32 rounded-lg bg-[#F5F5F5] animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {networkError && (
        <div
          role="alert"
          className="col-span-full flex items-center justify-between gap-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
        >
          <span>Couldn&apos;t refresh analytics. Showing the last known values.</span>
          <button
            type="button"
            onClick={handleRetry}
            className="shrink-0 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100"
          >
            Retry
          </button>
        </div>
      )}

      {cards.map((card, index) => (
        <button
          key={card.id}
          type="button"
          onClick={() => setOpenCardId(card.id)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" || e.key === "ArrowDown") {
              e.preventDefault();
              const next = document.getElementById(`analytics-card-${(index + 1) % cards.length}`);
              next?.focus();
            } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
              e.preventDefault();
              const prev = document.getElementById(
                `analytics-card-${(index - 1 + cards.length) % cards.length}`
              );
              prev?.focus();
            }
          }}
          id={`analytics-card-${index}`}
          className="min-w-0 overflow-hidden rounded-lg border border-[#E8E8E8] bg-white p-5 text-left transition-all hover:bg-[#F9F9F9] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#0A0A0A] sm:p-6"
          aria-haspopup="dialog"
        >
          <div className="flex min-w-0 flex-col gap-1">
            <p className="break-words text-[clamp(26px,8vw,48px)] font-bold leading-none tracking-tight text-[#0A0A0A]">
              {card.value}
            </p>
            <p className="text-xs font-medium text-[#6B6B6B] uppercase tracking-wider">
              {card.label}
            </p>
          </div>
        </button>
      ))}

      {isMobile ? (
        <AnalyticsCardDrawer
          card={openCard}
          onClose={closeDetail}
          onDragEnd={handleDrawerDragEnd}
        />
      ) : (
        <AnalyticsCardDialog card={openCard} onClose={closeDetail} />
      )}
    </div>
  );
}

/** Desktop: centered dialog, consistent with this app's existing Modal component's conventions. */
function AnalyticsCardDialog({
  card,
  onClose,
}: {
  card: CardDetail | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!card) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [card, onClose]);

  return (
    <AnimatePresence>
      {card && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
            aria-hidden="true"
            data-testid="analytics-card-backdrop"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="analytics-card-dialog-title"
            className="dark fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl"
            data-testid="analytics-card-dialog"
          >
            <DetailBody card={card} onClose={onClose} titleId="analytics-card-dialog-title" />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/** Mobile: bottom drawer, swipe-down (or a fast downward flick) to dismiss. */
function AnalyticsCardDrawer({
  card,
  onClose,
  onDragEnd,
}: {
  card: CardDetail | null;
  onClose: () => void;
  onDragEnd: (event: PointerEvent | MouseEvent | TouchEvent, info: PanInfo) => void;
}) {
  useEffect(() => {
    if (!card) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [card, onClose]);

  return (
    <AnimatePresence>
      {card && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
            aria-hidden="true"
            data-testid="analytics-card-backdrop"
          />
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.5 }}
            onDragEnd={onDragEnd}
            role="dialog"
            aria-modal="true"
            aria-labelledby="analytics-card-drawer-title"
            className="dark fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t border-white/10 bg-slate-900 p-6 pb-8 shadow-2xl"
            data-testid="analytics-card-drawer"
          >
            <div
              className="mx-auto mb-4 h-1.5 w-12 shrink-0 rounded-full bg-white/20"
              aria-hidden="true"
              data-testid="analytics-card-drawer-handle"
            />
            <DetailBody card={card} onClose={onClose} titleId="analytics-card-drawer-title" />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function DetailBody({
  card,
  onClose,
  titleId,
}: {
  card: CardDetail;
  onClose: () => void;
  titleId: string;
}) {
  return (
    <>
      <div className="mb-4 flex items-center justify-between border-b border-white/10 pb-4">
        <p id={titleId} className="font-mono text-xs uppercase tracking-[0.3em] text-mint">
          {card.label}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
          aria-label={`Close ${card.label}`}
          data-testid="analytics-card-detail-close"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="flex flex-col gap-3 text-white">
        <p className="text-3xl font-bold tracking-tight">{card.value}</p>
        <p className="text-sm text-slate-300">{card.description}</p>
      </div>
    </>
  );
}
