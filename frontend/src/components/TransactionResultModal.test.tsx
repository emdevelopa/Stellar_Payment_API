import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { SWIPE_DISMISS_DISTANCE_PX } from "@/hooks/useSwipeToDismiss";
import {
  DynamicTransactionResultModal,
  preloadTransactionResultAssets,
  stellarExpertTxUrl,
  TransactionResultModal,
  truncateTransactionHash,
} from "./TransactionResultModal";

const confettiMock = vi.fn();
vi.mock("canvas-confetti", () => ({
  default: (...args: unknown[]) => confettiMock(...args),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const TX_HASH = "0123456789abcdef".repeat(4);
const EXPLORER_URL = `https://stellar.expert/explorer/testnet/tx/${TX_HASH}`;
const COPY_LABEL = "Copy Stellar Expert link";
const COPIED_LABEL = "Link copied";

function deferred() {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Install (or remove, when undefined) a fake async clipboard. */
function setClipboard(writeText: ((text: string) => Promise<void>) | undefined) {
  Object.defineProperty(navigator, "clipboard", {
    value: writeText ? { writeText } : undefined,
    configurable: true,
  });
}

/** Let promise continuations and the state updates they trigger run. */
const flush = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

let onClose: ReturnType<typeof vi.fn>;

function renderModal(overrides: Partial<React.ComponentProps<typeof TransactionResultModal>> = {}) {
  return render(
    <TransactionResultModal
      isOpen
      onClose={onClose}
      txHash={TX_HASH}
      amount="25.5"
      assetCode="USDC"
      recipientDisplayName="Ada"
      {...overrides}
    />,
  );
}

const copyButton = () => screen.getByRole("button", { name: COPY_LABEL });

beforeEach(() => {
  onClose = vi.fn();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  confettiMock.mockClear();
  setClipboard(vi.fn().mockResolvedValue(undefined));
});

afterEach(() => {
  vi.useRealTimers();
  setClipboard(undefined);
});

describe("TransactionResultModal rendering", () => {
  it("renders nothing while closed", () => {
    const { container } = renderModal({ isOpen: false });

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("is an accessible dialog named by its heading", () => {
    renderModal();

    expect(screen.getByRole("dialog", { name: "Transaction Successful" })).toBeInTheDocument();
  });

  it("shows the amount, asset, recipient and a truncated hash", () => {
    renderModal();

    expect(screen.getByText("25.5 USDC")).toBeInTheDocument();
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("01234567...89abcdef")).toBeInTheDocument();
  });

  it("links to the transaction on Stellar Expert in a new, isolated tab", () => {
    renderModal();

    const link = screen.getByRole("link", { name: "View on Stellar Expert" });
    expect(link).toHaveAttribute("href", EXPLORER_URL);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.getAttribute("rel")).toContain("noreferrer");
  });
});

describe("TransactionResultModal closing", () => {
  it("closes from the close button", () => {
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes from the Done button", () => {
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes when the backdrop is clicked", () => {
    const { container } = renderModal();

    fireEvent.click(container.querySelector(".bg-black\\/60") as HTMLElement);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape but not on other keys", () => {
    renderModal();
    const done = screen.getByRole("button", { name: "Done" });

    fireEvent.keyDown(done, { key: "Enter" });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(done, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("TransactionResultModal copy link", () => {
  it("copies the Stellar Expert link and confirms", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard(writeText);
    renderModal();

    fireEvent.click(copyButton());
    await flush();

    expect(writeText).toHaveBeenCalledWith(EXPLORER_URL);
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("Link copied to clipboard!");
    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: COPIED_LABEL })).toBeInTheDocument();
  });

  it("shows the confirmation immediately, before the clipboard write finishes", async () => {
    const write = deferred();
    setClipboard(vi.fn().mockReturnValue(write.promise));
    renderModal();

    fireEvent.click(copyButton());

    // Optimistic: already confirmed in the UI, but no success toast until it is true.
    expect(screen.getByRole("button", { name: COPIED_LABEL })).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();

    write.resolve();
    await flush();

    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: COPIED_LABEL })).toBeInTheDocument();
  });

  it("rolls back and shows an error toast when the clipboard write fails", async () => {
    const write = deferred();
    setClipboard(vi.fn().mockReturnValue(write.promise));
    renderModal();

    fireEvent.click(copyButton());
    expect(screen.getByRole("button", { name: COPIED_LABEL })).toBeInTheDocument();

    write.reject(new DOMException("Write permission denied", "NotAllowedError"));
    await flush();

    expect(screen.getByRole("button", { name: COPY_LABEL })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: COPIED_LABEL })).not.toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Couldn't copy the link"));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("handles a write that rejects immediately without an unhandled rejection", async () => {
    setClipboard(vi.fn().mockRejectedValue(new Error("denied")));
    renderModal();

    fireEvent.click(copyButton());
    await flush();

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: COPY_LABEL })).toBeInTheDocument();
  });

  it("reports an error, and does not throw, when the clipboard API is unavailable", async () => {
    setClipboard(undefined);
    renderModal();

    fireEvent.click(copyButton());
    await flush();

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: COPY_LABEL })).toBeInTheDocument();
  });

  it("keeps the confirmation when an older attempt fails after a newer one started", async () => {
    const first = deferred();
    const second = deferred();
    setClipboard(vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise));
    renderModal();

    fireEvent.click(copyButton());
    fireEvent.click(screen.getByRole("button", { name: COPIED_LABEL }));

    first.reject(new Error("slow failure"));
    await flush();

    // The stale failure must not roll back or toast over the newer attempt.
    expect(screen.getByRole("button", { name: COPIED_LABEL })).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();

    second.resolve();
    await flush();

    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: COPIED_LABEL })).toBeInTheDocument();
  });

  it("reverts the confirmation two seconds after a successful copy", async () => {
    vi.useFakeTimers();
    renderModal();

    fireEvent.click(copyButton());
    await flush();
    expect(screen.getByRole("button", { name: COPIED_LABEL })).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1999);
    });
    expect(screen.getByRole("button", { name: COPIED_LABEL })).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole("button", { name: COPY_LABEL })).toBeInTheDocument();
  });

  it("does not update state after unmounting while the reset timer is pending", async () => {
    vi.useFakeTimers();
    const { unmount } = renderModal();

    fireEvent.click(copyButton());
    await flush();
    unmount();

    expect(() => vi.advanceTimersByTime(5000)).not.toThrow();
  });
});

function swipe(el: Element, from: { x: number; y: number }, to: { x: number; y: number }) {
  fireEvent.touchStart(el, { touches: [{ clientX: from.x, clientY: from.y }] });
  fireEvent.touchMove(el, { touches: [{ clientX: to.x, clientY: to.y }] });
  fireEvent.touchEnd(el, { changedTouches: [{ clientX: to.x, clientY: to.y }] });
}

describe("TransactionResultModal drawer", () => {
  it("truncates long hashes and leaves short ones intact", () => {
    expect(truncateTransactionHash(TX_HASH)).toBe("01234567...89abcdef");
    expect(truncateTransactionHash("abcd")).toBe("abcd");
  });

  it("keeps the explorer link on a fixed origin", () => {
    const hostile = "abc/../?x=1#hash";
    const url = new URL(stellarExpertTxUrl(hostile));

    expect(url.origin).toBe("https://stellar.expert");
    expect(url.pathname).toBe(`/explorer/testnet/tx/${encodeURIComponent(hostile)}`);
    expect(url.search).toBe("");
    expect(url.hash).toBe("");
  });

  it("is a bottom drawer on small screens and a centered dialog from sm up", () => {
    renderModal();

    const shell = screen.getByTestId("transaction-result-shell");
    expect(shell.className).toContain("items-end");
    expect(shell.className).toContain("sm:items-center");

    const drawer = screen.getByTestId("transaction-result-drawer");
    expect(drawer).toHaveAttribute("aria-modal", "true");
    expect(drawer).toHaveAttribute("aria-describedby");
    expect(drawer.className).toContain("rounded-t-3xl");
    expect(drawer.className).toContain("sm:rounded-3xl");
    expect(drawer.className).toContain("sm:max-w-sm");
    expect(drawer.className).toContain("motion-safe:animate-drawer-in");
    expect(drawer.className).toContain("motion-reduce:transition-none");

    const handle = screen.getByTestId("transaction-result-drawer-handle");
    expect(handle).toHaveAttribute("aria-hidden", "true");
    expect(handle.className).toContain("sm:hidden");
    expect(screen.getByText("Swipe down to close")).toHaveClass("sm:hidden");
  });

  it("moves focus into the dialog, traps Tab, and locks body scroll", () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();

    const { rerender } = renderModal();
    const dialog = screen.getByRole("dialog", { name: "Transaction Successful" });
    const close = screen.getByRole("button", { name: "Close dialog" });
    const done = screen.getByRole("button", { name: "Done" });

    expect(dialog).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");

    done.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(close).toHaveFocus();

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(done).toHaveFocus();

    rerender(
      <TransactionResultModal
        isOpen={false}
        onClose={onClose}
        txHash={TX_HASH}
        amount="25.5"
        assetCode="USDC"
        recipientDisplayName="Ada"
      />,
    );

    expect(document.body.style.overflow).toBe("");
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it("swiping down past the threshold dismisses the drawer", () => {
    renderModal();

    swipe(
      screen.getByTestId("transaction-result-drawer-handle"),
      { x: 100, y: 100 },
      { x: 108, y: 100 + SWIPE_DISMISS_DISTANCE_PX + 10 },
    );

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("follows the finger and snaps back on a short, slow drag", () => {
    const now = vi.spyOn(Date, "now");
    let clock = 1_000_000;
    now.mockImplementation(() => clock);

    renderModal();
    const drawer = screen.getByTestId("transaction-result-drawer");
    const handle = screen.getByTestId("transaction-result-drawer-handle");
    const backdrop = screen.getByTestId("transaction-result-backdrop");

    fireEvent.touchStart(handle, { touches: [{ clientX: 100, clientY: 100 }] });
    clock += 20;
    fireEvent.touchMove(handle, { touches: [{ clientX: 100, clientY: 140 }] });

    expect(drawer.style.transform).toContain("40px");
    expect(drawer).toHaveAttribute("data-dragging", "true");
    expect(backdrop.style.opacity).not.toBe("");

    clock += 1000;
    fireEvent.touchEnd(handle, { changedTouches: [{ clientX: 100, clientY: 140 }] });

    expect(onClose).not.toHaveBeenCalled();
    expect(drawer.style.transform).toBe("");
    expect(drawer).not.toHaveAttribute("data-dragging");
    now.mockRestore();
  });

  it("does not dismiss a sideways swipe", () => {
    renderModal();

    swipe(
      screen.getByTestId("transaction-result-drawer-handle"),
      { x: 40, y: 80 },
      { x: 240, y: 90 },
    );

    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not dismiss when the scrollable body is not at the top", () => {
    renderModal();
    const body = screen.getByTestId("transaction-result-body");
    body.scrollTop = 80;

    swipe(body, { x: 100, y: 40 }, { x: 100, y: 40 + SWIPE_DISMISS_DISTANCE_PX + 40 });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("still dismisses from the handle when the body is scrolled", () => {
    renderModal();
    screen.getByTestId("transaction-result-body").scrollTop = 80;

    swipe(
      screen.getByTestId("transaction-result-drawer-handle"),
      { x: 100, y: 20 },
      { x: 100, y: 20 + SWIPE_DISMISS_DISTANCE_PX + 20 },
    );

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("TransactionResultModal snapshots", () => {
  it("matches snapshot when closed", () => {
    const { container } = renderModal({ isOpen: false });
    expect(container.firstChild).toMatchSnapshot();
  });

  it("matches snapshot when open with default USDC payment", () => {
    const { container } = renderModal();
    expect(container.firstChild).toMatchSnapshot();
  });

  it("matches snapshot in copied confirmation state", async () => {
    const { container } = renderModal();
    fireEvent.click(copyButton());
    await flush();
    expect(container.firstChild).toMatchSnapshot();
  });

  it("matches snapshot with XLM asset and long recipient name", () => {
    const { container } = renderModal({
      amount: "1250.00",
      assetCode: "XLM",
      recipientDisplayName: "Stellar Development Foundation Treasury",
    });
    expect(container.firstChild).toMatchSnapshot();
  });
});

describe("TransactionResultModal interactions, accessibility, and dynamic imports", () => {
  it("sets aria-modal=true on the dialog and does not close when clicking inside the card", () => {
    renderModal();
    const dialog = screen.getByRole("dialog", { name: "Transaction Successful" });
    expect(dialog).toHaveAttribute("aria-modal", "true");

    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("dynamically loads and fires confetti when opened", async () => {
    renderModal({ isOpen: true });
    await flush();

    expect(confettiMock).toHaveBeenCalledTimes(1);
    expect(confettiMock).toHaveBeenCalledWith(
      expect.objectContaining({
        particleCount: 60,
        spread: 65,
      }),
    );
  });

  it("skips confetti when prefers-reduced-motion is enabled", async () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    try {
      renderModal({ isOpen: true });
      await flush();
      expect(confettiMock).not.toHaveBeenCalled();
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it("exports DynamicTransactionResultModal and preloadTransactionResultAssets", async () => {
    expect(DynamicTransactionResultModal).toBeDefined();
    await expect(preloadTransactionResultAssets()).resolves.toBeDefined();
  });
});
