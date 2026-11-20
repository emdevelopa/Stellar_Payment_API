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
// `motion.div` forwards its ref, as the real one does: the dialog's focus trap needs it.
vi.mock("framer-motion", async () => {
  const { forwardRef } = await import("react");
  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    MotionConfig: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    motion: {
      div: forwardRef<HTMLDivElement, MotionProps>(function MotionDiv(
        { initial, animate, exit, ...rest },
        ref,
      ) {
        void initial;
        void animate;
        void exit;
        return <div ref={ref} {...rest} />;
      }),
    },
  };
});

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

    // The accessible name says it opens a new tab, so the surprise is announced.
    const link = screen.getByRole("link", { name: "View on Stellar Expert (opens in a new tab)" });
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

describe("TransactionResultModal accessibility (WCAG 2.1 AA, #1839)", () => {
  const originalOffsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetParent");

  beforeEach(() => {
    vi.useFakeTimers();
    // jsdom does no layout, so offsetParent is always null and the focus trap's "is this
    // visible" check would exclude every control. Every attached element counts as visible.
    Object.defineProperty(HTMLElement.prototype, "offsetParent", {
      configurable: true,
      get() {
        return this.parentNode;
      },
    });
  });

  afterEach(() => {
    if (originalOffsetParent) {
      Object.defineProperty(HTMLElement.prototype, "offsetParent", originalOffsetParent);
    } else {
      delete (HTMLElement.prototype as { offsetParent?: unknown }).offsetParent;
    }
  });

  const settle = () => act(() => void vi.advanceTimersByTime(10));
  const pressTab = (shift = false) =>
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Tab", shiftKey: shift });

  /** A trigger and the modal it opens, the way a page uses them. */
  function Page() {
    const [open, setOpen] = React.useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>Open receipt</button>
        <TransactionResultModal
          isOpen={open}
          onClose={() => setOpen(false)}
          txHash={TX_HASH}
          amount="25.5"
          assetCode="USDC"
          recipientDisplayName="Ada"
        />
      </>
    );
  }

  describe("dialog semantics", () => {
    it("is modal, so assistive technology ignores the page behind it", () => {
      renderModal();

      expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
    });

    it("is described by the sentence saying what was sent and to whom", () => {
      renderModal();

      expect(screen.getByRole("dialog")).toHaveAccessibleDescription("Sent 25.5 USDC to Ada");
    });

    it("hides the decorative backdrop and every icon from assistive technology", () => {
      const { container } = renderModal();

      expect(container.querySelector(".bg-black\\/60")).toHaveAttribute("aria-hidden", "true");
      expect(container.querySelectorAll("svg:not([aria-hidden='true'])")).toHaveLength(0);
    });
  });

  describe("focus management", () => {
    it("moves focus to the dialog when it opens, so its name and description are announced first", () => {
      renderModal();
      settle();

      expect(screen.getByRole("dialog")).toHaveFocus();
    });

    it("keeps Tab inside the dialog, wrapping from the last control to the first", () => {
      renderModal();
      settle();
      screen.getByRole("button", { name: "Done" }).focus();

      const notPrevented = pressTab();

      expect(notPrevented).toBe(false);
      expect(screen.getByRole("button", { name: "Close dialog" })).toHaveFocus();
    });

    it("keeps Shift+Tab inside the dialog, wrapping from the dialog to the last control", () => {
      renderModal();
      settle();

      pressTab(true);

      expect(screen.getByRole("button", { name: "Done" })).toHaveFocus();
    });

    it("closes on Escape even when focus is not inside the dialog", () => {
      renderModal();
      settle();
      (document.activeElement as HTMLElement).blur();

      fireEvent.keyDown(document.body, { key: "Escape" });

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("does not listen for Escape while closed", () => {
      renderModal({ isOpen: false });

      fireEvent.keyDown(document.body, { key: "Escape" });

      expect(onClose).not.toHaveBeenCalled();
    });

    it("returns focus to the control that opened it when it closes", () => {
      render(<Page />);
      const opener = screen.getByRole("button", { name: "Open receipt" });
      opener.focus();

      fireEvent.click(opener);
      settle();
      expect(screen.getByRole("dialog")).toHaveFocus();

      fireEvent.keyDown(document.activeElement!, { key: "Escape" });

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(opener).toHaveFocus();
    });

    it("returns focus to the opener after closing with the Done button too", () => {
      render(<Page />);
      const opener = screen.getByRole("button", { name: "Open receipt" });
      opener.focus();
      fireEvent.click(opener);
      settle();

      fireEvent.click(screen.getByRole("button", { name: "Done" }));

      expect(opener).toHaveFocus();
    });
  });

  describe("screen reader labels", () => {
    it("exposes the full transaction hash to screen readers and hides the shortened one", () => {
      renderModal();

      expect(screen.getByText(TX_HASH)).toHaveClass("sr-only");
      expect(screen.getByText("01234567...89abcdef")).toHaveAttribute("aria-hidden", "true");
    });

    it("groups the hash under its visible label", () => {
      renderModal();

      expect(screen.getByRole("group", { name: "Transaction Hash" })).toBeInTheDocument();
    });

    it("announces that the explorer link opens in a new tab", () => {
      renderModal();

      expect(screen.getByRole("link")).toHaveAccessibleName(/opens in a new tab/);
    });

    it("has a polite live region that is empty until something is copied", () => {
      renderModal();

      const status = screen.getByRole("status");
      expect(status).toHaveAttribute("aria-live", "polite");
      expect(status).toBeEmptyDOMElement();
    });

    it("announces a successful copy", async () => {
      renderModal();

      fireEvent.click(copyButton());
      await flush();

      expect(screen.getByRole("status")).toHaveTextContent("Link copied to clipboard.");
    });

    it("announces a failed copy, so the failure is not only a toast outside the dialog", async () => {
      setClipboard(vi.fn().mockRejectedValue(new Error("denied")));
      renderModal();

      fireEvent.click(copyButton());
      await flush();

      expect(screen.getByRole("status")).toHaveTextContent(/Couldn't copy the link/);
    });

    it("clears the announcement when the confirmation reverts", async () => {
      renderModal();
      fireEvent.click(copyButton());
      await flush();
      expect(screen.getByRole("status")).toHaveTextContent("Link copied");

      act(() => void vi.advanceTimersByTime(2000));

      expect(screen.getByRole("status")).toBeEmptyDOMElement();
    });
  });

  describe("visible keyboard focus", () => {
    it.each([
      ["button", "Close dialog"],
      ["button", COPY_LABEL],
      ["button", "Done"],
    ])("gives the %s %j a visible focus ring", (_kind, name) => {
      renderModal();

      expect(screen.getByRole("button", { name })).toHaveClass("focus-visible:ring-2");
    });

    it("gives the explorer link a visible focus ring", () => {
      renderModal();

      expect(screen.getByRole("link")).toHaveClass("focus-visible:ring-2");
    });
  });
});
