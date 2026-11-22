"use client";

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { useSwipeToDismiss } from "@/hooks/useSwipeToDismiss";

export type LifecycleStepStatus = "completed" | "current" | "pending" | "failed";

export interface AuditLog {
  id: string;
  action: string;
  field_changed?: string;
  old_value?: string;
  new_value?: string;
  created_at: string;
  /** Optional explicit lifecycle status; inferred from action/position if omitted. */
  status?: LifecycleStepStatus;
  /** Optional Stellar ledger sequence number for on-chain confirmation ticks. */
  ledgerSequence?: number;
  /** Optional transaction hash associated with this lifecycle step. */
  txHash?: string;
  /** Optional on-chain confirmation count. */
  confirmations?: number;
}

export interface TimelineProps {
  logs: AuditLog[];
  /** Heading displayed in the timeline header and drawer. */
  title?: string;
  /**
   * Layout mode:
   * - "inline": renders directly in flow (default, backward compatible)
   * - "drawer": renders as a slide-up/slide-over drawer controlled by isOpen/onClose
   * - "responsive": renders inline on desktop (md+) and as a touch-enabled bottom drawer on mobile
   */
  variant?: "inline" | "drawer" | "responsive";
  /** Controlled open state when variant is "drawer" or "responsive". */
  isOpen?: boolean;
  /** Callback invoked when the drawer is dismissed via button, backdrop, Escape, or swipe-down. */
  onClose?: () => void;
  /** Optional callback fired when a timeline step is selected. */
  onStepSelect?: (log: AuditLog, index: number) => void;
  /** Additional Tailwind classes for the root container. */
  className?: string;
}

const HORIZONTAL_SWIPE_THRESHOLD_PX = 50;

function inferStepStatus(
  log: AuditLog,
  index: number,
  total: number,
): LifecycleStepStatus {
  if (log.status) return log.status;
  const lower = log.action.toLowerCase();
  if (lower.includes("fail") || lower.includes("error") || lower.includes("reject")) {
    return "failed";
  }
  if (lower.includes("pending") || lower.includes("queued")) {
    return "pending";
  }
  return index === total - 1 ? "current" : "completed";
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function truncateHash(hash: string): string {
  if (hash.length <= 16) return hash;
  return `${hash.slice(0, 8)}...${hash.slice(-6)}`;
}

const STATUS_STYLES: Record<
  LifecycleStepStatus,
  { dot: string; badge: string; label: string }
> = {
  completed: {
    dot: "bg-emerald-500 ring-4 ring-emerald-500/20",
    badge: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    label: "Confirmed",
  },
  current: {
    dot: "bg-blue-500 ring-4 ring-blue-500/25 animate-pulse",
    badge: "bg-blue-500/15 text-blue-300 border-blue-500/30",
    label: "In Progress",
  },
  pending: {
    dot: "bg-slate-500 ring-4 ring-slate-500/20",
    badge: "bg-slate-700/60 text-slate-300 border-slate-600",
    label: "Pending",
  },
  failed: {
    dot: "bg-rose-500 ring-4 ring-rose-500/25",
    badge: "bg-rose-500/15 text-rose-300 border-rose-500/30",
    label: "Failed",
  },
};

export default function Timeline({
  logs,
  title = "Payment Lifecycle Timeline",
  variant = "inline",
  isOpen,
  onClose,
  onStepSelect,
  className = "",
}: TimelineProps) {
  const headingId = useId();
  const [internalOpen, setInternalOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const horizontalTouchRef = useRef<{ x: number; y: number } | null>(null);

  const isControlled = typeof isOpen === "boolean";
  const drawerOpen = isControlled ? isOpen : internalOpen;

  const handleClose = useCallback(() => {
    if (!isControlled) {
      setInternalOpen(false);
    }
    onClose?.();
  }, [isControlled, onClose]);

  const handleOpen = useCallback(() => {
    if (!isControlled) {
      setInternalOpen(true);
    }
  }, [isControlled]);

  // Keep activeIndex in bounds when logs change
  useEffect(() => {
    if (!logs || logs.length === 0) {
      setActiveIndex(0);
    } else if (activeIndex >= logs.length) {
      setActiveIndex(logs.length - 1);
    }
  }, [logs, activeIndex]);

  // Lock body scroll while drawer is open
  useEffect(() => {
    if (!drawerOpen || variant === "inline") return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [drawerOpen, variant]);

  const trapRef = useFocusTrap<HTMLDivElement>({
    enabled: drawerOpen && variant !== "inline",
    onEscape: handleClose,
  });

  const { offset, dragging, handlers: swipeDismissHandlers } = useSwipeToDismiss({
    onDismiss: handleClose,
    enabled: drawerOpen && variant !== "inline",
    scrollRef: scrollContainerRef,
  });

  const stepStatuses = useMemo(
    () => (logs ?? []).map((log, idx) => inferStepStatus(log, idx, logs.length)),
    [logs],
  );

  const completedCount = useMemo(
    () => stepStatuses.filter((s) => s === "completed").length,
    [stepStatuses],
  );

  const progressPercent = useMemo(() => {
    if (!logs || logs.length === 0) return 0;
    return Math.round((completedCount / logs.length) * 100);
  }, [completedCount, logs]);

  const selectStep = useCallback(
    (index: number) => {
      if (!logs || index < 0 || index >= logs.length) return;
      setActiveIndex(index);
      onStepSelect?.(logs[index], index);
    },
    [logs, onStepSelect],
  );

  const handleStepSwipeStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    horizontalTouchRef.current = { x: touch.clientX, y: touch.clientY };
  }, []);

  const handleStepSwipeEnd = useCallback(
    (e: React.TouchEvent) => {
      const start = horizontalTouchRef.current;
      horizontalTouchRef.current = null;
      if (!start || !logs || logs.length <= 1) return;

      const touch = e.changedTouches[0];
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;

      // Only trigger horizontal step navigation when horizontal movement dominates
      if (Math.abs(dx) < HORIZONTAL_SWIPE_THRESHOLD_PX || Math.abs(dx) <= Math.abs(dy)) {
        return;
      }

      if (dx < 0 && activeIndex < logs.length - 1) {
        selectStep(activeIndex + 1);
      } else if (dx > 0 && activeIndex > 0) {
        selectStep(activeIndex - 1);
      }
    },
    [activeIndex, logs, selectStep],
  );

  const handleStepKeyDown = useCallback(
    (e: React.KeyboardEvent, index: number) => {
      if (!logs || logs.length === 0) return;
      if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        e.preventDefault();
        selectStep(Math.min(index + 1, logs.length - 1));
      } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        e.preventDefault();
        selectStep(Math.max(index - 1, 0));
      }
    },
    [logs, selectStep],
  );

  const renderTimelineBody = () => {
    if (!logs || logs.length === 0) {
      return (
        <div
          className="text-gray-400 text-center py-10"
          role="status"
          aria-live="polite"
        >
          No activity yet
        </div>
      );
    }

    return (
      <div
        className="space-y-5"
        onTouchStart={handleStepSwipeStart}
        onTouchEnd={handleStepSwipeEnd}
      >
        {/* Progress Stepper Summary */}
        <div className="rounded-xl bg-gray-900/70 border border-gray-800 p-4">
          <div className="flex items-center justify-between gap-2 text-xs text-gray-300 mb-2">
            <span className="font-medium text-gray-200">{title}</span>
            <span>
              {completedCount} of {logs.length} confirmed ({progressPercent}%)
            </span>
          </div>
          <div
            className="h-2 w-full rounded-full bg-gray-800 overflow-hidden"
            role="progressbar"
            aria-label="Payment lifecycle progress"
            aria-valuenow={progressPercent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full rounded-full bg-gradient-to-r from-blue-500 to-emerald-500 transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          {/* Non-gesture step navigation controls (WCAG 2.5.1) */}
          {logs.length > 1 && (
            <div className="mt-3 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => selectStep(activeIndex - 1)}
                disabled={activeIndex === 0}
                aria-label="Previous lifecycle step"
                className="min-h-[44px] px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-800 text-gray-200 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 transition-colors"
              >
                Previous
              </button>
              <span className="text-xs text-gray-400" aria-live="polite">
                Step {activeIndex + 1} of {logs.length}
              </span>
              <button
                type="button"
                onClick={() => selectStep(activeIndex + 1)}
                disabled={activeIndex === logs.length - 1}
                aria-label="Next lifecycle step"
                className="min-h-[44px] px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-800 text-gray-200 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 transition-colors"
              >
                Next
              </button>
            </div>
          )}
        </div>

        {/* Step-by-step Lifecycle List */}
        <ol
          role="list"
          aria-label={title}
          className="relative border-l border-gray-700 pl-6 space-y-6"
        >
          {logs.map((log, index) => {
            const status = stepStatuses[index];
            const style = STATUS_STYLES[status];
            const isActive = index === activeIndex;

            return (
              <li key={log.id} className="relative">
                {/* On-chain confirmation dot */}
                <span
                  aria-hidden="true"
                  className={`absolute -left-[30px] top-1.5 w-3 h-3 rounded-full ${style.dot}`}
                />

                {/* Step Content Card */}
                <button
                  type="button"
                  onClick={() => selectStep(index)}
                  onKeyDown={(e) => handleStepKeyDown(e, index)}
                  aria-current={isActive ? "step" : undefined}
                  className={`w-full text-left bg-gray-800 rounded-lg p-4 border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
                    isActive
                      ? "border-blue-500/70 bg-gray-800/95"
                      : "border-gray-700/60 hover:border-gray-600"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-white font-medium">{log.action}</p>
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${style.badge}`}
                    >
                      {style.label}
                    </span>
                  </div>

                  {log.field_changed && (
                    <p className="text-gray-400 text-sm mt-1">
                      {log.field_changed}: {log.old_value} → {log.new_value}
                    </p>
                  )}

                  {(log.ledgerSequence !== undefined ||
                    log.confirmations !== undefined ||
                    log.txHash) && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-300">
                      {log.ledgerSequence !== undefined && (
                        <span className="rounded bg-gray-900/80 px-2 py-0.5 font-mono text-gray-300">
                          Ledger #{log.ledgerSequence}
                        </span>
                      )}
                      {log.confirmations !== undefined && (
                        <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-emerald-300">
                          {log.confirmations} confirmation
                          {log.confirmations === 1 ? "" : "s"}
                        </span>
                      )}
                      {log.txHash && (
                        <span
                          className="rounded bg-gray-900/80 px-2 py-0.5 font-mono text-gray-400"
                          title={log.txHash}
                        >
                          {truncateHash(log.txHash)}
                        </span>
                      )}
                    </div>
                  )}

                  <time
                    dateTime={log.created_at}
                    className="block text-gray-500 text-xs mt-2"
                  >
                    {formatTimestamp(log.created_at)}
                  </time>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    );
  };

  if (variant === "inline") {
    return <div className={className}>{renderTimelineBody()}</div>;
  }

  const renderDrawer = () => {
    if (!drawerOpen) return null;

    return (
      <div className="fixed inset-0 z-50 flex items-end md:items-stretch md:justify-end">
        {/* Backdrop */}
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity"
          onClick={handleClose}
          aria-hidden="true"
          data-testid="timeline-drawer-backdrop"
        />

        {/* Responsive Drawer Surface: Bottom sheet on mobile, right drawer on desktop */}
        <div
          ref={trapRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={headingId}
          data-testid="timeline-drawer"
          {...swipeDismissHandlers}
          style={{
            transform: offset > 0 ? `translateY(${offset}px)` : undefined,
            transition: dragging ? "none" : "transform 200ms ease-out",
          }}
          className={`relative z-10 w-full max-h-[85vh] md:max-h-full md:w-[440px] bg-gray-950 border-t md:border-t-0 md:border-l border-gray-800 rounded-t-2xl md:rounded-none shadow-2xl flex flex-col ${className}`}
        >
          {/* Mobile Swipe Handle */}
          <div
            className="flex justify-center pt-3 pb-1 md:hidden"
            aria-hidden="true"
          >
            <div className="w-12 h-1.5 rounded-full bg-gray-600" />
          </div>

          {/* Drawer Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800">
            <h2
              id={headingId}
              className="text-base font-semibold text-white"
            >
              {title}
            </h2>
            <button
              type="button"
              onClick={handleClose}
              aria-label="Close payment lifecycle timeline"
              className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 transition-colors"
            >
              <span aria-hidden="true" className="text-lg leading-none">
                ×
              </span>
            </button>
          </div>

          {/* Scrollable Timeline Content */}
          <div
            ref={scrollContainerRef}
            className="flex-1 overflow-y-auto px-5 py-4"
          >
            {renderTimelineBody()}
          </div>
        </div>
      </div>
    );
  };

  if (variant === "drawer") {
    return renderDrawer();
  }

  // variant === "responsive": inline on desktop (md+), trigger + bottom drawer on mobile
  return (
    <div className={className}>
      {/* Mobile trigger button */}
      <div className="md:hidden">
        <button
          type="button"
          onClick={handleOpen}
          aria-expanded={drawerOpen}
          aria-haspopup="dialog"
          className="w-full min-h-[44px] flex items-center justify-between rounded-xl bg-gray-800 border border-gray-700 px-4 py-3 text-sm font-medium text-white hover:bg-gray-750 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
        >
          <span>{title}</span>
          <span className="text-xs text-blue-400">
            {logs?.length ?? 0} step{(logs?.length ?? 0) === 1 ? "" : "s"}
          </span>
        </button>
        {renderDrawer()}
      </div>

      {/* Desktop inline view */}
      <div className="hidden md:block">{renderTimelineBody()}</div>
    </div>
  );
}
