"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence, MotionConfig } from "framer-motion";
import { CheckIcon, ClipboardIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { toast } from "sonner";
import { useFocusTrap } from "@/hooks/useFocusTrap";

// How long the optimistic "copied" confirmation stays visible after a successful copy.
const COPIED_RESET_MS = 2000;

// Shared by every control in the dialog: a visible keyboard focus indicator (WCAG 2.4.7).
const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900";

interface TransactionResultModalProps {
  isOpen: boolean;
  onClose: () => void;
  txHash: string;
  amount: string;
  assetCode: string;
  recipientDisplayName: string;
}

export function TransactionResultModal({
  isOpen,
  onClose,
  txHash,
  amount,
  assetCode,
  recipientDisplayName,
}: TransactionResultModalProps) {
  const truncatedHash = `${txHash.slice(0, 8)}...${txHash.slice(-8)}`;
  const stellarExpertUrl = `https://stellar.expert/explorer/testnet/tx/${txHash}`;

  // Focus moves to the dialog when it opens (so a screen reader announces its name and
  // description first), stays inside it while open, closes on Escape from anywhere, and
  // returns to whatever opened it (WCAG 2.4.3, 2.1.2).
  const dialogRef = useFocusTrap<HTMLDivElement>({
    enabled: isOpen,
    onEscape: onClose,
    focusContainerOnActivate: true,
  });

  // The "copied" confirmation is shown optimistically, the moment the button is
  // pressed, and rolled back if the clipboard write turns out to fail, so the
  // user is never told a link was copied when it was not.
  const [copied, setCopied] = useState(false);
  // Spoken by the in-dialog live region. The toast is outside the dialog, which a
  // screen reader treats as inert while a modal is open, so it cannot be relied on.
  const [copyAnnouncement, setCopyAnnouncement] = useState("");
  const attemptRef = useRef(0);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    },
    [],
  );

  const copyToClipboard = async () => {
    // Only the newest attempt may roll the state back, so a slow failure from an
    // earlier press cannot undo a later success.
    const attempt = ++attemptRef.current;
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    setCopied(true);
    setCopyAnnouncement("");

    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard API is not available");
      }
      await navigator.clipboard.writeText(stellarExpertUrl);
      if (attempt !== attemptRef.current) return;
      toast.success("Link copied to clipboard!");
      setCopyAnnouncement("Link copied to clipboard.");
      resetTimerRef.current = setTimeout(() => {
        setCopied(false);
        setCopyAnnouncement("");
      }, COPIED_RESET_MS);
    } catch {
      if (attempt !== attemptRef.current) return;
      setCopied(false);
      toast.error("Couldn't copy the link. Use \"View on Stellar Expert\" instead.");
      setCopyAnnouncement("Couldn't copy the link. Use the View on Stellar Expert link instead.");
    }
  };

  if (!isOpen) return null;

  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence>
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            aria-hidden="true"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />

          <motion.div
            ref={dialogRef}
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="transaction-result-title"
            aria-describedby="transaction-result-description"
            tabIndex={-1}
            className="relative w-full max-w-sm overflow-hidden rounded-3xl border border-white/10 bg-slate-900 p-6 shadow-2xl focus:outline-none"
          >
            <button
              type="button"
              onClick={onClose}
              aria-label="Close dialog"
              className={`absolute right-4 top-4 rounded text-slate-400 hover:text-white ${FOCUS_RING}`}
            >
              <XMarkIcon className="h-6 w-6" aria-hidden="true" />
            </button>

            <div className="flex flex-col items-center text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-mint/20 text-mint">
                <CheckIcon className="h-10 w-10" aria-hidden="true" />
              </div>

              <h2 id="transaction-result-title" className="text-xl font-bold text-white">
                Transaction Successful
              </h2>
              <p id="transaction-result-description" className="mt-2 text-sm text-slate-400">
                Sent <span className="font-semibold text-white">{amount} {assetCode}</span> to{" "}
                <span className="font-semibold text-white">{recipientDisplayName}</span>
              </p>

              <div className="mt-6 w-full space-y-4">
                <div
                  role="group"
                  aria-labelledby="transaction-hash-label"
                  className="rounded-xl bg-white/5 p-3 text-left"
                >
                  <p
                    id="transaction-hash-label"
                    className="text-[10px] font-bold uppercase tracking-widest text-slate-500"
                  >
                    Transaction Hash
                  </p>
                  <div className="mt-1 flex items-center justify-between">
                    {/* The shortened hash is for the eye; assistive technology reads the whole thing. */}
                    <code aria-hidden="true" className="text-xs font-mono text-mint">
                      {truncatedHash}
                    </code>
                    <span className="sr-only">{txHash}</span>
                    <button
                      type="button"
                      onClick={copyToClipboard}
                      className={`rounded ${copied ? "text-mint" : "text-slate-400 hover:text-white"} ${FOCUS_RING}`}
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

                {/* Announces the result of the copy to screen readers, success or failure. */}
                <p role="status" aria-live="polite" className="sr-only">
                  {copyAnnouncement}
                </p>

                <a
                  href={stellarExpertUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`flex w-full items-center justify-center gap-2 rounded-xl border border-mint/30 bg-mint/10 py-3 text-sm font-semibold text-mint transition-colors hover:bg-mint/20 ${FOCUS_RING}`}
                >
                  View on Stellar Expert{" "}
                  <span className="sr-only">(opens in a new tab)</span>
                </a>

                <button
                  type="button"
                  onClick={onClose}
                  className={`w-full rounded-xl bg-white py-3 text-sm font-bold text-black transition-transform hover:scale-[1.02] active:scale-[0.98] ${FOCUS_RING}`}
                >
                  Done
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      </AnimatePresence>
    </MotionConfig>
  );
}
