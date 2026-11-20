import { describe, it, expect, vi } from "vitest";
import {
  TransactionSignerError,
  withOptimisticRollback,
  describeSignerError,
} from "./freighter";
import {
  getDrawerEdge,
  shouldDismissDrawer,
  type TouchPoint,
} from "./freighter-gestures";

vi.mock("stellar-sdk", () => ({}));
vi.mock("@stellar/freighter-api", () => ({}));

const pt = (x: number, y: number, t: number): TouchPoint => ({ x, y, t });

describe("withOptimisticRollback", () => {
  it("applies and keeps the change on success", async () => {
    const apply = vi.fn();
    const rollback = vi.fn();
    const result = await withOptimisticRollback(apply, rollback, async () => 7);
    expect(result).toBe(7);
    expect(apply).toHaveBeenCalledOnce();
    expect(rollback).not.toHaveBeenCalled();
  });

  it("rolls back and reports a typed error on failure", async () => {
    const rollback = vi.fn();
    const onError = vi.fn();
    const err = await withOptimisticRollback(
      vi.fn(),
      rollback,
      async () => {
        throw new Error("boom");
      },
      onError,
    ).catch((e) => e);
    expect(rollback).toHaveBeenCalledOnce();
    expect(err).toBeInstanceOf(TransactionSignerError);
    expect(err.code).toBe("UNKNOWN");
    expect(onError).toHaveBeenCalledWith(err);
  });

  it("preserves an existing signer error code", async () => {
    const original = new TransactionSignerError("no", "USER_REJECTED");
    const err = await withOptimisticRollback(vi.fn(), vi.fn(), async () => {
      throw original;
    }).catch((e) => e);
    expect(err).toBe(original);
  });
});

describe("describeSignerError", () => {
  it("returns distinct text for rejected and submission errors", () => {
    const rejected = describeSignerError(new TransactionSignerError("x", "USER_REJECTED"));
    const failed = describeSignerError(new TransactionSignerError("x", "SUBMISSION_FAILED"));
    expect(rejected).not.toBe(failed);
    expect(failed).toMatch(/reverted/);
  });
});

describe("drawer gestures", () => {
  it("uses a bottom sheet below 768px and a side drawer above", () => {
    expect(getDrawerEdge(375)).toBe("bottom");
    expect(getDrawerEdge(1024)).toBe("right");
  });

  it("dismisses a bottom sheet on a long downward swipe", () => {
    expect(shouldDismissDrawer(pt(100, 100, 0), pt(105, 200, 600), "bottom")).toBe(true);
  });

  it("dismisses on a short but fast flick", () => {
    expect(shouldDismissDrawer(pt(100, 100, 0), pt(100, 130, 40), "bottom")).toBe(true);
  });

  it("ignores short slow drags and upward swipes", () => {
    expect(shouldDismissDrawer(pt(0, 0, 0), pt(0, 20, 500), "bottom")).toBe(false);
    expect(shouldDismissDrawer(pt(0, 200, 0), pt(0, 50, 100), "bottom")).toBe(false);
  });

  it("ignores mostly-vertical scrolling in a right-side drawer", () => {
    expect(shouldDismissDrawer(pt(0, 0, 0), pt(30, 150, 200), "right")).toBe(false);
    expect(shouldDismissDrawer(pt(0, 0, 0), pt(120, 10, 200), "right")).toBe(true);
  });
});
