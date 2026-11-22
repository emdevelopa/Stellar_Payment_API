"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";
import { CheckIcon, ClipboardIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { toast } from "sonner";

// How long the optimistic "copied" confirmation stays visible after a successful copy.
const COPIED_RESET_MS = 2000;

export interface TransactionResultModalProps {
  isOpen: boolean;
  onClose: () => void;
  txHash: string;
  amount: string;
  assetCode: string;
  recipientDisplayName: string;
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
  const truncatedHash = useMemo(
    () => `${txHash.slice(0, 8)}...${txHash.slice(-8)}`,
    [txHash],
  );
  const stellarExpertUrl = useMemo(
    () => `https://stellar.expert/explorer/testnet/tx/${txHash}`,
    [txHash],
  );

  // The "copied" confirmation is shown optimistically, the moment the button is
  // pressed, and rolled back if the clipboard write turns out to fail, so the
  // user is never told a link was copied when it was not.
  const [copied, setCopied] = useState(false);
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

  const copyToClipboard = async () => {
    // Only the newest attempt may roll the state back, so a slow failure from an
    // earlier press cannot undo a later success.
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

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center p-4"
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        />

        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="transaction-result-title"
          className="relative w-full max-w-sm overflow-hidden rounded-3xl border border-white/10 bg-slate-900 p-6 shadow-2xl"
        >
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="absolute right-4 top-4 text-slate-400 hover:text-white"
          >
            <XMarkIcon className="h-6 w-6" />
          </button>

          <div className="flex flex-col items-center text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-mint/20 text-mint">
              <CheckIcon className="h-10 w-10" />
            </div>

            <h2 id="transaction-result-title" className="text-xl font-bold text-white">Transaction Successful</h2>
            <p className="mt-2 text-sm text-slate-400">
              Sent <span className="font-semibold text-white">{amount} {assetCode}</span> to{" "}
              <span className="font-semibold text-white">{recipientDisplayName}</span>
            </p>

            <div className="mt-6 w-full space-y-4">
              <div className="rounded-xl bg-white/5 p-3 text-left">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                  Transaction Hash
                </p>
                <div className="mt-1 flex items-center justify-between">
                  <code className="text-xs font-mono text-mint">{truncatedHash}</code>
                  <button
                    type="button"
                    onClick={copyToClipboard}
                    className={copied ? "text-mint" : "text-slate-400 hover:text-white"}
                    title="Copy Stellar Expert link"
                    aria-label={copied ? "Link copied" : "Copy Stellar Expert link"}
                  >
                    {copied ? (
                      <CheckIcon className="h-4 w-4" />
                    ) : (
                      <ClipboardIcon className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              <a
                href={stellarExpertUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-mint/30 bg-mint/10 py-3 text-sm font-semibold text-mint transition-colors hover:bg-mint/20"
              >
                View on Stellar Expert
              </a>

              <button
                type="button"
                onClick={onClose}
                className="w-full rounded-xl bg-white py-3 text-sm font-bold text-black transition-transform hover:scale-[1.02] active:scale-[0.98]"
              >
                Done
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
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
