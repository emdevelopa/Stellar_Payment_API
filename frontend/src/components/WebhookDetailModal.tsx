"use client";

/**
 * WebhookDetailModal
 *
 * Shows a single webhook delivery. Renders as a bottom drawer on mobile and a
 * centered dialog from the `sm` breakpoint up.
 *
 * Touch gestures (mobile drawer):
 * - Swipe down to dismiss. The drawer follows the finger and snaps back when
 *   released before the dismiss threshold. Dragging from the scrollable body
 *   only starts once it is scrolled to the top, so normal scrolling still works.
 * - Swipe left / right to move to the next / previous delivery.
 *
 * Every gesture has a non-gesture equivalent (WCAG 2.5.1): the close button,
 * Escape, the previous / next buttons and the ArrowLeft / ArrowRight keys.
 */

import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import CopyButton from "./CopyButton";

export interface WebhookLog {
  id: string;
  payment_id: string;
  status_code: number;
  event: string | null;
  url: string;
  request_payload: Record<string, unknown>;
  request_headers: Record<string, string> | null;
  response_body: string | null;
  timestamp: string;
}

interface WebhookDetailModalProps {
  log: WebhookLog | null;
  isOpen: boolean;
  onClose: () => void;
  /** Show the previous delivery. Omit when there is none. */
  onPrevious?: () => void;
  /** Show the next delivery. Omit when there is none. */
  onNext?: () => void;
  /** Human-readable position, e.g. "3 of 12". */
  positionLabel?: string;
}

/** Minimum downward drag (px) that dismisses the drawer. */
export const DISMISS_DISTANCE_PX = 120;
/** Minimum downward speed (px/ms) that dismisses the drawer on a quick flick. */
export const DISMISS_VELOCITY = 0.5;
/** Minimum horizontal travel (px) that switches to the next / previous log. */
export const NAVIGATE_DISTANCE_PX = 60;
/** Movement (px) before a touch is locked to one axis. */
const AXIS_LOCK_PX = 10;

export type SwipeAction = "dismiss" | "next" | "previous" | "none";

/**
 * Decides what a completed swipe should do.
 *
 * @param dx   horizontal travel in px (positive = right)
 * @param dy   vertical travel in px (positive = down)
 * @param durationMs time from touchstart to touchend
 * @param axis axis the gesture was locked to, if any
 */
export function resolveSwipe(
  dx: number,
  dy: number,
  durationMs: number,
  axis: "x" | "y" | null,
): SwipeAction {
  if (axis === "y" && dy > 0) {
    const velocity = dy / Math.max(durationMs, 1);
    if (dy >= DISMISS_DISTANCE_PX || velocity >= DISMISS_VELOCITY) {
      return "dismiss";
    }
  }
  if (axis === "x" && Math.abs(dx) >= NAVIGATE_DISTANCE_PX) {
    return dx < 0 ? "next" : "previous";
  }
  return "none";
}

function statusClasses(statusCode: number) {
  if (statusCode >= 200 && statusCode < 300) {
    return "bg-green-500/20 text-green-300 border border-green-500/40";
  }
  if (statusCode >= 400 && statusCode < 500) {
    return "bg-red-500/20 text-red-300 border border-red-500/40";
  }
  return "bg-yellow-500/20 text-yellow-300 border border-yellow-500/40";
}

const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface TouchState {
  x: number;
  y: number;
  time: number;
  axis: "x" | "y" | null;
  /** Whether a downward drag may move the drawer (false while body is scrolled). */
  canDismiss: boolean;
  /** Whether a sideways swipe may navigate (false inside horizontally scrollable code). */
  canNavigate: boolean;
}

export default function WebhookDetailModal({
  log,
  isOpen,
  onClose,
  onPrevious,
  onNext,
  positionLabel,
}: WebhookDetailModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const touch = useRef<TouchState | null>(null);
  const [dragY, setDragY] = useState(0);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);

  const generateCurl = (log: WebhookLog) => {
    const headers = log.request_headers || {};
    const payload = JSON.stringify(log.request_payload || {}, null, 2);

    let curl = `curl -X POST "${log.url}"`;
    Object.entries(headers).forEach(([key, value]) => {
      curl += ` \\\n  -H "${key}: ${value}"`;
    });
    curl += ` \\\n  -d '${payload}'`;
    return curl;
  };

  const resetDrag = useCallback(() => {
    touch.current = null;
    setDragging(false);
    setDragY(0);
    setDragX(0);
  }, []);

  // Keyboard: Escape closes, arrows navigate, Tab is trapped in the dialog.
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "ArrowLeft" && onPrevious) {
        event.preventDefault();
        onPrevious();
        return;
      }
      if (event.key === "ArrowRight" && onNext) {
        event.preventDefault();
        onNext();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      );
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, onPrevious, onNext]);

  // Focus the dialog on open, restore focus and body scroll on close.
  useEffect(() => {
    if (!isOpen) return;

    const previousActiveElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();

    return () => {
      document.body.style.overflow = originalOverflow;
      previousActiveElement?.focus();
    };
  }, [isOpen]);

  // Start each log at the top with no leftover drag offset.
  useEffect(() => {
    resetDrag();
    bodyRef.current?.scrollTo?.({ top: 0 });
  }, [log?.id, resetDrag]);

  const handleTouchStart = (event: React.TouchEvent) => {
    const point = event.touches[0];
    const target = event.target as Element;
    const inBody = bodyRef.current?.contains(target) ?? false;
    touch.current = {
      x: point.clientX,
      y: point.clientY,
      time: Date.now(),
      axis: null,
      canDismiss: !inBody || (bodyRef.current?.scrollTop ?? 0) <= 0,
      canNavigate: !target.closest?.("pre, code"),
    };
  };

  const handleTouchMove = (event: React.TouchEvent) => {
    const state = touch.current;
    if (!state) return;

    const point = event.touches[0];
    const dx = point.clientX - state.x;
    const dy = point.clientY - state.y;

    if (!state.axis) {
      if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return;
      state.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    }

    if (state.axis === "y" && state.canDismiss && dy > 0) {
      setDragging(true);
      setDragY(dy);
    } else if (state.axis === "x" && state.canNavigate && (dx < 0 ? onNext : onPrevious)) {
      setDragging(true);
      // Damped so the drawer only nudges sideways as a hint.
      setDragX(dx * 0.35);
    }
  };

  const handleTouchEnd = (event: React.TouchEvent) => {
    const state = touch.current;
    if (!state) return;

    const point = event.changedTouches[0];
    const dx = point.clientX - state.x;
    const dy = point.clientY - state.y;
    const action = resolveSwipe(
      state.canNavigate ? dx : 0,
      state.canDismiss ? dy : 0,
      Date.now() - state.time,
      state.axis,
    );

    resetDrag();

    if (action === "dismiss") onClose();
    else if (action === "next") onNext?.();
    else if (action === "previous") onPrevious?.();
  };

  if (!isOpen) return null;

  const navButtonClasses =
    "inline-flex h-11 w-11 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-mint disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent sm:h-9 sm:w-9";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        style={{ opacity: dragY > 0 ? Math.max(0.3, 1 - dragY / 400) : undefined }}
        onClick={onClose}
        data-testid="modal-backdrop"
        aria-hidden="true"
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid="webhook-detail-drawer"
        data-dragging={dragging || undefined}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={resetDrag}
        style={{
          transform: dragX || dragY ? `translate3d(${dragX}px, ${dragY}px, 0)` : undefined,
        }}
        className={`dark relative flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-3xl border-t border-white/10 bg-slate-900 pb-[env(safe-area-inset-bottom)] shadow-2xl focus:outline-none motion-safe:animate-drawer-in sm:max-h-[85vh] sm:max-w-lg sm:rounded-2xl sm:border sm:pb-0 sm:motion-safe:animate-dialog-in ${
          dragging ? "" : "transition-transform duration-200 ease-out motion-reduce:transition-none"
        }`}
      >
        {/* Drag handle: the primary swipe target on mobile */}
        <div
          className="flex shrink-0 touch-none justify-center pb-1 pt-3 sm:hidden"
          data-testid="webhook-drawer-handle"
          aria-hidden="true"
        >
          <div
            className={`h-1.5 w-12 rounded-full transition-colors ${
              dragging ? "bg-mint/70" : "bg-white/20"
            }`}
          />
        </div>

        <div className="flex shrink-0 touch-none items-center justify-between gap-2 border-b border-white/10 px-4 pb-3 pt-2 sm:px-6 sm:pt-5">
          <div className="min-w-0">
            <h2 id={titleId} className="font-mono text-xs uppercase tracking-[0.3em] text-mint">
              Webhook Delivery Detail
            </h2>
            {positionLabel && (
              <p className="mt-1 text-xs text-slate-500" aria-live="polite">
                Delivery {positionLabel}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {(onPrevious || onNext) && (
              <>
                <button
                  type="button"
                  className={navButtonClasses}
                  onClick={onPrevious}
                  disabled={!onPrevious}
                  aria-label="Previous delivery"
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <button
                  type="button"
                  className={navButtonClasses}
                  onClick={onNext}
                  disabled={!onNext}
                  aria-label="Next delivery"
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              className={navButtonClasses}
              data-testid="modal-close"
              aria-label="Close Webhook Delivery Detail"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div
          ref={bodyRef}
          className="flex-1 overflow-y-auto overscroll-contain px-4 py-5 text-white sm:px-6"
          data-testid="webhook-drawer-body"
        >
          {log && (
            <div className="space-y-6">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0 space-y-1">
                  <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Event</p>
                  <p className="truncate text-sm font-semibold text-white">{log.event || "—"}</p>
                </div>
                <div className="shrink-0 space-y-1 text-right">
                  <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Status</p>
                  <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${statusClasses(log.status_code)}`}>
                    HTTP {log.status_code}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Endpoint</p>
                <code className="block break-all rounded-lg border border-white/10 bg-black/40 p-2 text-xs text-slate-300">
                  {log.url}
                </code>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Time</p>
                <p className="text-sm text-slate-300">{new Date(log.timestamp).toLocaleString()}</p>
              </div>

              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-white">Payload (Request Body)</p>
                  <div className="flex gap-2">
                    <div className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2 py-1">
                      <span className="text-[10px] font-medium text-slate-400">cURL</span>
                      <CopyButton text={generateCurl(log)} />
                    </div>
                    <div className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2 py-1">
                      <span className="text-[10px] font-medium text-slate-400">JSON</span>
                      <CopyButton text={JSON.stringify(log.request_payload, null, 2)} />
                    </div>
                  </div>
                </div>
                <pre className="max-h-60 overflow-auto rounded-xl border border-white/10 bg-black/40 p-4 font-mono text-xs text-sky-300 ring-1 ring-inset ring-white/5">
                  {JSON.stringify(log.request_payload || {}, null, 2)}
                </pre>
              </div>

              {log.response_body && (
                <div className="space-y-3">
                  <p className="text-sm font-semibold text-white">Server Response</p>
                  <div className="max-h-40 overflow-auto rounded-xl border border-white/10 bg-black/40 p-4 font-mono text-xs text-slate-400 ring-1 ring-inset ring-white/5">
                    {log.response_body}
                  </div>
                </div>
              )}

              <p className="text-center text-xs text-slate-500 sm:hidden" aria-hidden="true">
                Swipe down to close{onPrevious || onNext ? " · swipe sideways to browse" : ""}
              </p>

              <div className="pt-2">
                <Button
                  variant="secondary"
                  className="w-full text-slate-400"
                  onClick={onClose}
                >
                  Close
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
