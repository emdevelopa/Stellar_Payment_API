/** @vitest-environment jsdom */
import type React from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  shouldDismissSwipe,
  SWIPE_DISMISS_DISTANCE_PX,
  useSwipeToDismiss,
} from "./useSwipeToDismiss";

function touchEvent(x: number, y: number, target: EventTarget = document.body) {
  return {
    touches: [{ clientX: x, clientY: y }],
    changedTouches: [{ clientX: x, clientY: y }],
    target,
  } as unknown as React.TouchEvent;
}

describe("shouldDismissSwipe", () => {
  it("dismisses past the distance threshold", () => {
    expect(shouldDismissSwipe(SWIPE_DISMISS_DISTANCE_PX, 1000)).toBe(true);
  });

  it("dismisses a short, fast flick", () => {
    expect(shouldDismissSwipe(40, 50)).toBe(true);
  });

  it("does not dismiss a short, slow drag", () => {
    expect(shouldDismissSwipe(40, 1000)).toBe(false);
  });

  it("never dismisses upward movement", () => {
    expect(shouldDismissSwipe(-200, 10)).toBe(false);
    expect(shouldDismissSwipe(0, 10)).toBe(false);
  });
});

describe("useSwipeToDismiss", () => {
  it("tracks the drag offset and dismisses on release past the threshold", () => {
    const onDismiss = vi.fn();
    const { result } = renderHook(() => useSwipeToDismiss({ onDismiss }));

    act(() => result.current.handlers.onTouchStart(touchEvent(0, 0)));
    act(() => result.current.handlers.onTouchMove(touchEvent(0, 150)));
    expect(result.current.offset).toBe(150);
    expect(result.current.dragging).toBe(true);

    act(() => result.current.handlers.onTouchEnd(touchEvent(0, 150)));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(result.current.offset).toBe(0);
    expect(result.current.dragging).toBe(false);
  });

  it("ignores mostly-horizontal swipes", () => {
    const onDismiss = vi.fn();
    const { result } = renderHook(() => useSwipeToDismiss({ onDismiss }));

    act(() => result.current.handlers.onTouchStart(touchEvent(0, 0)));
    act(() => result.current.handlers.onTouchMove(touchEvent(200, 30)));
    act(() => result.current.handlers.onTouchEnd(touchEvent(200, 30)));

    expect(result.current.offset).toBe(0);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("does nothing when disabled", () => {
    const onDismiss = vi.fn();
    const { result } = renderHook(() => useSwipeToDismiss({ onDismiss, enabled: false }));

    act(() => result.current.handlers.onTouchStart(touchEvent(0, 0)));
    act(() => result.current.handlers.onTouchMove(touchEvent(0, 300)));
    act(() => result.current.handlers.onTouchEnd(touchEvent(0, 300)));

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("only drags from scrollable content when it is scrolled to the top", () => {
    const onDismiss = vi.fn();
    const scrollEl = document.createElement("div");
    const child = document.createElement("span");
    scrollEl.appendChild(child);
    const scrollRef = { current: scrollEl };
    const { result } = renderHook(() => useSwipeToDismiss({ onDismiss, scrollRef }));

    scrollEl.scrollTop = 50;
    act(() => result.current.handlers.onTouchStart(touchEvent(0, 0, child)));
    act(() => result.current.handlers.onTouchMove(touchEvent(0, 300, child)));
    act(() => result.current.handlers.onTouchEnd(touchEvent(0, 300, child)));
    expect(onDismiss).not.toHaveBeenCalled();

    scrollEl.scrollTop = 0;
    act(() => result.current.handlers.onTouchStart(touchEvent(0, 0, child)));
    act(() => result.current.handlers.onTouchMove(touchEvent(0, 300, child)));
    act(() => result.current.handlers.onTouchEnd(touchEvent(0, 300, child)));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("resets on touch cancel without dismissing", () => {
    const onDismiss = vi.fn();
    const { result } = renderHook(() => useSwipeToDismiss({ onDismiss }));

    act(() => result.current.handlers.onTouchStart(touchEvent(0, 0)));
    act(() => result.current.handlers.onTouchMove(touchEvent(0, 200)));
    act(() => result.current.handlers.onTouchCancel());

    expect(result.current.offset).toBe(0);
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
