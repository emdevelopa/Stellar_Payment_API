/**
 * Touch gesture helpers for the wallet drawer. Kept free of React and the DOM
 * so they can be unit tested and reused by any drawer component.
 */

export interface TouchPoint {
  x: number;
  y: number;
  t: number;
}

export type DrawerEdge = "bottom" | "right";

const MIN_DISTANCE_PX = 64;
const MIN_VELOCITY_PX_PER_MS = 0.5;

/** Mobile widths use a bottom sheet; wider screens use a side drawer. */
export function getDrawerEdge(viewportWidth: number): DrawerEdge {
  return viewportWidth < 768 ? "bottom" : "right";
}

/**
 * Decide whether a touch movement should dismiss the drawer. A swipe counts
 * when it travels far enough toward the closing direction, or is a fast flick,
 * and is mostly along the drawer's axis (so vertical scrolling inside a
 * right-side drawer does not close it).
 */
export function shouldDismissDrawer(
  start: TouchPoint,
  end: TouchPoint,
  edge: DrawerEdge,
): boolean {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const along = edge === "bottom" ? dy : dx;
  const across = edge === "bottom" ? dx : dy;

  if (along <= 0 || Math.abs(across) > Math.abs(along)) return false;

  const elapsed = Math.max(end.t - start.t, 1);
  return along >= MIN_DISTANCE_PX || along / elapsed >= MIN_VELOCITY_PX_PER_MS;
}
