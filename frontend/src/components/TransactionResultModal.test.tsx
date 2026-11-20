import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { TransactionResultModal } from "./TransactionResultModal";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Animations are irrelevant here and would add unknown props to the DOM nodes.
type MotionProps = React.HTMLAttributes<HTMLDivElement> & {
  initial?: unknown;
  animate?: unknown;
  exit?: unknown;
};
vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ initial, animate, exit, ...rest }: MotionProps) => {
      void initial;
      void animate;
      void exit;
      return <div {...rest} />;
    },
  },
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
