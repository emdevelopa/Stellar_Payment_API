"use client";

/**
 * TransactionResultModal — real-time payment confirmation.
 *
 * Responsive layout (Drips Wave / Pluto):
 * - Below the `sm` breakpoint (640px) the dialog is a bottom drawer: full
 *   width, rounded top, drag handle, and safe-area padding.
 * - From `sm` up it is the centered confirmation dialog.
 *
 * Touch (drawer and touch devices):
 * - A downward swipe of at least 100px, or a fast downward flick, dismisses
 *   the sheet. The sheet follows the finger and snaps back otherwise.
 * - A drag that starts inside the scrollable body is ignored unless that
 *   body is already scrolled to the top, so reading the hash is not hijacked.
 *
 * Every gesture has a non-gesture control (WCAG 2.5.1 and 2.1.2): Close,
 * Done, the backdrop, and Escape. Focus moves into the dialog, Tab wraps
 * inside it, and focus returns to the trigger on close (WCAG 2.4.3).
 * Body scroll is locked while the dialog is open.
 *
 * The Stellar Expert link is built on a fixed https origin. The transaction
 * hash is a single percent-encoded path segment, so a crafted hash cannot
 * change the host or the scheme.
 */

import { memo, useCallback, useEffect, useId, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { CheckIcon, ClipboardIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { toast } from "sonner";
import { useSwipeToDismiss } from "@/hooks/useSwipeToDismiss";

/** How long the optimistic "copied" confirmation stays visible. */
const COPIED_RESET_MS = 2000;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface TransactionResultModalProps {
  isOpen: boolean;
  onClose: () => void;
  txHash: string;
  amount: string;
  assetCode: string;
  recipientDisplayName: string;
}

/** Shorten a hash for display. Short values are shown in full. */
export function truncateTransactionHash(txHash: string): string {
  if (txHash.length <= 16) return txHash;
  return `${txHash.slice(0, 8)}...${txHash.slice(-8)}`;
}

/**
 * Explorer URL for a transaction. The origin is fixed; the hash is encoded
 * so it stays one path segment.
 */
export function stellarExpertTxUrl(txHash: string): string {
  return `https://stellar.expert/explorer/testnet/tx/${encodeURIComponent(txHash)}`;
}

/**
 * Dynamically loads and triggers the confetti celebration only when the modal
 * opens and the user has not requested reduced motion, keeping `canvas-confetti`
 * out of the initial JS bundle.
 */
async function triggerCelebrationConfetti(): Promise<void> {
  if (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    return;
  }

  try {
    const { default: confetti } = await import("canvas-confetti");
    confetti({
      particleCount: 60,
      spread: 65,
      origin: { y: 0.6 },
    });
  } catch {
    // Non-critical visual enhancement; ignore load failures in restricted environments.
  }
}

export const TransactionResultModal = memo(function TransactionResultModal({
  isOpen,
  onClose,
  txHash,
  amount,
  assetCode,
  recipientDisplayName,
}: TransactionResultModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const dismiss = useCallback(() => {
    onCloseRef.current();
  }, []);

  const { offset, dragging, handlers } = useSwipeToDismiss({
    onDismiss: dismiss,
    enabled: isOpen,
    scrollRef: bodyRef,
  });

  const truncatedHash = truncateTransactionHash(txHash);
  const stellarExpertUrl = stellarExpertTxUrl(txHash);

  // Shown the moment copy is pressed, and rolled back if the write fails,
  // so the user is never told a link was copied when it was not.
  const [copied, setCopied] = useState(false);
  // Enter animation is removed once it finishes (or the user drags) so the
  // swipe transform is not overridden by the keyframe.
  const [entered, setEntered] = useState(false);
  const attemptRef = useRef(0);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!isOpen) return;
    void triggerCelebrationConfetti();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setEntered(false);
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setEntered(true);
    }
  }, [isOpen]);

  useEffect(() => {
    if (dragging) setEntered(true);
  }, [dragging]);

  // Focus, scroll lock, Escape, and Tab trap. Depends only on `isOpen` so a
  // new `onClose` identity from the parent does not steal focus mid-session.
  useEffect(() => {
    if (!isOpen) return;

    const previousActiveElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;

      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
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
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = originalOverflow;
      previousActiveElement?.focus();
    };
  }, [isOpen]);

  const copyToClipboard = async () => {
    // Only the newest attempt may roll the state back, so a slow failure
    // from an earlier press cannot undo a later success.
    const attempt = ++attemptRef.current;
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    setCopied(true);

    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard API is not available");
      }
      await navigator.clipboard.writeText(stellarExpertUrl);
      if (attempt !== attemptRef.current) return;
      toast.success("Link copied to clipboard!");
      resetTimerRef.current = setTimeout(() => setCopied(false), COPIED_RESET_MS);
    } catch {
      if (attempt !== attemptRef.current) return;
      setCopied(false);
      toast.error("Couldn't copy the link. Use \"View on Stellar Expert\" instead.");
    }
  };

  if (!isOpen) return null;

  const panelTransform = offset > 0 ? `translate3d(0, ${offset}px, 0)` : undefined;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-4"
      data-testid="transaction-result-shell"
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm motion-reduce:backdrop-blur-none"
        style={{ opacity: offset > 0 ? Math.max(0.35, 1 - offset / 400) : undefined }}
        onClick={dismiss}
        data-testid="transaction-result-backdrop"
        aria-hidden="true"
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        data-testid="transaction-result-drawer"
        data-dragging={dragging ? "true" : undefined}
        onAnimationEnd={() => setEntered(true)}
        {...handlers}
        style={{ transform: panelTransform }}
        className={`relative flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-b-0 border-white/10 bg-slate-900 pb-[max(env(safe-area-inset-bottom),1rem)] shadow-2xl outline-none motion-reduce:transition-none sm:max-w-sm sm:rounded-3xl sm:border-b sm:pb-0 ${
          entered || dragging
            ? ""
            : "motion-safe:animate-drawer-in sm:motion-safe:animate-dialog-in"
        } ${
          dragging
            ? "will-change-transform"
            : "transition-transform duration-200 ease-out motion-reduce:transition-none"
        }`}
      >
        <div
          className="flex shrink-0 touch-none justify-center pb-1 pt-3 sm:hidden"
          data-testid="transaction-result-drawer-handle"
          aria-hidden="true"
        >
          <span
            className={`h-1.5 w-12 rounded-full transition-colors motion-reduce:transition-none ${
              dragging ? "bg-mint" : "bg-white/25"
            }`}
          />
        </div>

        <div className="flex shrink-0 justify-end px-3 pt-1 sm:px-4 sm:pt-4">
          <button
            type="button"
            onClick={dismiss}
            aria-label="Close dialog"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full text-slate-300 transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-mint"
          >
            <XMarkIcon className="h-6 w-6" aria-hidden="true" />
          </button>
        </div>

        <div
          ref={bodyRef}
          className="overflow-y-auto overscroll-contain px-6 pb-6"
          data-testid="transaction-result-body"
        >
          <div className="flex flex-col items-center text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-mint/20 text-mint">
              <CheckIcon className="h-10 w-10" aria-hidden="true" />
            </div>

            <h2 id={titleId} className="text-xl font-bold text-white">
              Transaction Successful
            </h2>
            <p id={descriptionId} className="mt-2 text-sm text-slate-300">
              Sent <span className="font-semibold text-white">{amount} {assetCode}</span> to{" "}
              <span className="font-semibold text-white">{recipientDisplayName}</span>
            </p>

            <div className="mt-6 w-full space-y-4">
              <div className="rounded-xl bg-white/5 p-3 text-left">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  Transaction Hash
                </p>
                <div className="mt-1 flex items-center justify-between gap-3">
                  <code className="min-w-0 break-all font-mono text-xs text-mint">{truncatedHash}</code>
                  <button
                    type="button"
                    onClick={copyToClipboard}
                    className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-mint ${
                      copied ? "text-mint" : "text-slate-300 hover:text-white"
                    }`}
                    title="Copy Stellar Expert link"
                    aria-label={copied ? "Link copied" : "Copy Stellar Expert link"}
                  >
                    {copied ? (
                      <CheckIcon className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <ClipboardIcon className="h-4 w-4" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </div>

              <a
                href={stellarExpertUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-mint/30 bg-mint/10 py-3 text-sm font-semibold text-mint transition-colors hover:bg-mint/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-mint"
              >
                View on Stellar Expert
              </a>

              <button
                type="button"
                onClick={dismiss}
                className="min-h-11 w-full rounded-xl bg-white py-3 text-sm font-bold text-black transition-transform hover:scale-[1.02] focus:outline-none focus-visible:ring-2 focus-visible:ring-mint active:scale-[0.98] motion-reduce:transform-none motion-reduce:transition-none"
              >
                Done
              </button>
            </div>

            <p className="mt-4 text-xs text-slate-400 sm:hidden">Swipe down to close</p>
          </div>
        </div>
      </div>
    </div>
  );
});

/**
 * Code-split dynamic wrapper for consumers that want automatic bundle splitting
 * without manually wiring `React.lazy` and `Suspense`.
 */
export const DynamicTransactionResultModal = dynamic<TransactionResultModalProps>(
  () => import("./TransactionResultModal").then((mod) => mod.TransactionResultModal),
  { ssr: false },
);

/**
 * Prefetches the `canvas-confetti` chunk on user intent (e.g. submit hover) so
 * the celebration plays immediately upon confirmation.
 */
export function preloadTransactionResultAssets(): Promise<unknown> {
  return import("canvas-confetti").catch(() => undefined);
}
