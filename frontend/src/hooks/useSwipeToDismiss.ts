/**
 * useSwipeToDismiss hook
 *
 * Swipe-down-to-dismiss for bottom drawers. The drawer follows the finger
 * while dragging (via the returned `offset`) and either dismisses or snaps
 * back on release, based on distance or flick velocity.
 *
 * Pass `scrollRef` for drawers with scrollable content: a drag that starts
 * inside it only moves the drawer when the content is scrolled to the top,
 * so normal scrolling is never hijacked.
 *
 * Gestures must always have a non-gesture alternative (WCAG 2.5.1) such as a
 * close button or Escape; this hook only adds the touch affordance.
 *
 * @example
 * ```tsx
 * const { offset, dragging, handlers } = useSwipeToDismiss({ onDismiss: close });
 * return (
 *   <div {...handlers} style={{ transform: `translateY(${offset}px)` }}>…</div>
 * );
 * ```
 */

import React, { useCallback, useRef, useState } from "react";

/** Downward drag (px) that dismisses on release. */
export const SWIPE_DISMISS_DISTANCE_PX = 100;
/** Downward speed (px/ms) that dismisses a short, quick flick. */
export const SWIPE_DISMISS_VELOCITY = 0.5;
/** Movement (px) before a touch is locked to one axis. */
const AXIS_LOCK_PX = 10;

/**
 * Whether a completed downward drag should dismiss the drawer.
 */
export function shouldDismissSwipe(
  dy: number,
  durationMs: number,
  distance = SWIPE_DISMISS_DISTANCE_PX,
  velocity = SWIPE_DISMISS_VELOCITY,
): boolean {
  if (dy <= 0) return false;
  return dy >= distance || dy / Math.max(durationMs, 1) >= velocity;
}

interface UseSwipeToDismissOptions {
  onDismiss: () => void;
  /** When false, touches are ignored. Defaults to true. */
  enabled?: boolean;
  /** Scrollable region inside the drawer; drags there start only at scrollTop 0. */
  scrollRef?: React.RefObject<HTMLElement | null>;
  distance?: number;
  velocity?: number;
}

interface TouchState {
  x: number;
  y: number;
  time: number;
  axis: "x" | "y" | null;
  canDrag: boolean;
}

export function useSwipeToDismiss({
  onDismiss,
  enabled = true,
  scrollRef,
  distance = SWIPE_DISMISS_DISTANCE_PX,
  velocity = SWIPE_DISMISS_VELOCITY,
}: UseSwipeToDismissOptions) {
  const touch = useRef<TouchState | null>(null);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);

  const reset = useCallback(() => {
    touch.current = null;
    setOffset(0);
    setDragging(false);
  }, []);

  const onTouchStart = useCallback(
    (event: React.TouchEvent) => {
      if (!enabled) return;
      const point = event.touches[0];
      const scrollEl = scrollRef?.current;
      const inScroll = scrollEl?.contains(event.target as Node) ?? false;
      touch.current = {
        x: point.clientX,
        y: point.clientY,
        time: Date.now(),
        axis: null,
        canDrag: !inScroll || (scrollEl?.scrollTop ?? 0) <= 0,
      };
    },
    [enabled, scrollRef],
  );

  const onTouchMove = useCallback((event: React.TouchEvent) => {
    const state = touch.current;
    if (!state || !state.canDrag) return;

    const point = event.touches[0];
    const dx = point.clientX - state.x;
    const dy = point.clientY - state.y;

    if (!state.axis) {
      if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return;
      state.axis = Math.abs(dy) >= Math.abs(dx) ? "y" : "x";
    }

    if (state.axis === "y" && dy > 0) {
      setDragging(true);
      setOffset(dy);
    } else if (state.axis === "y") {
      // Dragging back up past the start point: keep the drawer anchored.
      setOffset(0);
    }
  }, []);

  const onTouchEnd = useCallback(
    (event: React.TouchEvent) => {
      const state = touch.current;
      if (!state) return;

      const dy = event.changedTouches[0].clientY - state.y;
      const dismiss =
        state.canDrag &&
        state.axis === "y" &&
        shouldDismissSwipe(dy, Date.now() - state.time, distance, velocity);

      reset();
      if (dismiss) onDismiss();
    },
    [distance, velocity, onDismiss, reset],
  );

  return {
    /** Current downward drag in px; apply as translateY. */
    offset,
    /** True while the user is actively dragging the drawer. */
    dragging,
    handlers: {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      onTouchCancel: reset,
    },
  };
}
