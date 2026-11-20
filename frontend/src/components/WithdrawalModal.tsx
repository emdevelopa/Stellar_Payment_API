"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { Spinner } from "@/components/ui/Spinner";
import { useSep24AnchorFlow, SEP24_ERROR_TOAST_ID } from "@/hooks/useSep24AnchorFlow";

export interface WithdrawalModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const DEFAULT_ANCHOR = "testanchor.stellar.org";
export const SUPPORTED_ASSETS = [
  {
    code: "USDC",
    issuer: "GBBD67V63DU7D3SXXF4SOT5O7GNCGYL65B66S3YUKG6VCH3TFRZ7I7YQ",
  }, // Testnet USDC
  {
    code: "SRT",
    issuer: "GCDGUC3OCYLAU7XIK7EUBTWSOT3N4XALR6IRLKEW3V3AEL3Z5W5SOT4F",
  }, // Testnet SRT (Stellar Resource Token)
];

export default function WithdrawalModal({
  isOpen,
  onClose,
}: WithdrawalModalProps) {
  const { step, isBusy, interactiveUrl, start, reset: resetFlow } = useSep24AnchorFlow({
    networkPassphrase: "Test SDF Network ; September 2015",
  });
  const [anchorDomain, setAnchorDomain] = useState(DEFAULT_ANCHOR);
  const [selectedAsset, setSelectedAsset] = useState(SUPPORTED_ASSETS[0]);
  const modalRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef<number | null>(null);

  const reset = useCallback(() => {
    resetFlow();
  }, [resetFlow]);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  // Touch gesture support for mobile drawer dismiss
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartY.current === null) return;
    const deltaY = e.changedTouches[0].clientY - touchStartY.current;
    if (deltaY > 50) {
      handleClose();
    }
    touchStartY.current = null;
  };

  // Keyboard navigation, focus trap, and body scroll lock (WCAG 2.1 AA)
  useEffect(() => {
    if (!isOpen) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
        return;
      }

      if (e.key === "Tab" && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen, handleClose]);

  const handleStartWithdrawal = async () => {
    try {
      await start({
        anchorDomain,
        assetCode: selectedAsset.code,
        direction: "withdraw",
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Withdrawal failed", {
        id: SEP24_ERROR_TOAST_ID,
      });
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={handleClose}
          data-testid="withdrawal-backdrop"
          aria-hidden="true"
          className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        />

        {/* Modal / Drawer Dialog */}
        <motion.div
          ref={modalRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="withdrawal-modal-title"
          aria-describedby="withdrawal-modal-subtitle"
          data-testid="withdrawal-modal"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          initial={{ scale: 0.95, opacity: 0, y: 30 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 30 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className="relative w-full max-w-2xl max-h-[90vh] sm:max-h-[85vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl border-t sm:border border-white/10 bg-black/90 sm:bg-black/80 shadow-2xl backdrop-blur-xl"
        >
          {/* Mobile Drag Handle Indicator */}
          <div
            className="flex justify-center pt-3 pb-1 sm:hidden"
            data-testid="withdrawal-drawer-handle"
            aria-hidden="true"
          >
            <div className="h-1.5 w-12 rounded-full bg-white/20" />
          </div>

          {/* Header */}
          <div className="flex items-center justify-between border-b border-white/10 p-6">
            <div>
              <h2 id="withdrawal-modal-title" className="text-xl font-bold text-white">
                Withdraw Funds
              </h2>
              <p id="withdrawal-modal-subtitle" className="text-sm text-slate-400">
                Via Stellar SEP-0024 Anchor
              </p>
            </div>
            <button
              type="button"
              onClick={handleClose}
              data-testid="withdrawal-close-btn"
              aria-label="Close withdrawal modal"
              className="rounded-full p-2 text-slate-400 hover:bg-white/5 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <svg
                className="h-6 w-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div className="p-8">
            {step === "IDLE" && (
              <div className="flex flex-col gap-6">
                <div className="space-y-2">
                  <label
                    htmlFor="asset-selection-group"
                    id="asset-selection-label"
                    className="text-xs font-semibold uppercase tracking-wider text-slate-500"
                  >
                    Select Asset
                  </label>
                  <div
                    id="asset-selection-group"
                    role="radiogroup"
                    aria-labelledby="asset-selection-label"
                    className="grid grid-cols-2 gap-4"
                  >
                    {SUPPORTED_ASSETS.map((asset) => (
                      <button
                        key={asset.code}
                        type="button"
                        role="radio"
                        aria-checked={selectedAsset.code === asset.code}
                        aria-label={`Select ${asset.code}`}
                        data-testid={`asset-select-${asset.code}`}
                        onClick={() => setSelectedAsset(asset)}
                        className={`flex flex-col items-center gap-2 rounded-2xl border p-4 transition-all focus:outline-none focus:ring-2 focus:ring-accent ${
                          selectedAsset.code === asset.code
                            ? "border-accent bg-accent/5 ring-1 ring-accent"
                            : "border-white/10 bg-white/5 hover:border-white/20"
                        }`}
                      >
                        <span className="text-lg font-bold text-white">
                          {asset.code}
                        </span>
                        <span className="text-[10px] text-slate-500">
                          {asset.issuer.slice(0, 8)}...
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="anchor-domain-input"
                    className="text-xs font-semibold uppercase tracking-wider text-slate-500"
                  >
                    Anchor Domain
                  </label>
                  <input
                    id="anchor-domain-input"
                    type="text"
                    value={anchorDomain}
                    onChange={(e) => setAnchorDomain(e.target.value)}
                    data-testid="withdrawal-anchor-input"
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-accent"
                    placeholder="e.g. testanchor.stellar.org"
                  />
                </div>

                <button
                  type="button"
                  onClick={handleStartWithdrawal}
                  disabled={isBusy}
                  data-testid="withdrawal-submit-btn"
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-4 text-sm font-bold text-black transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-accent"
                >
                  {isBusy ? (
                    <>
                      <Spinner size="sm" className="text-black" />
                      Processing...
                    </>
                  ) : (
                    "Continue to Anchor"
                  )}
                </button>
              </div>
            )}

            {(step === "CONNECTING" || step === "AUTH" || step === "SUBMITTING") && (
              <div
                role="status"
                aria-live="polite"
                data-testid="withdrawal-authenticating-status"
                className="flex flex-col items-center justify-center py-10 text-center"
              >
                <div className="relative mb-6">
                  <div className="h-20 w-20 animate-ping rounded-full bg-accent/20" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="h-12 w-12 rounded-full border-4 border-accent border-t-transparent animate-spin" />
                  </div>
                </div>
                <h3 className="text-lg font-bold text-white">Authenticating</h3>
                <p className="mt-2 text-sm text-slate-400">
                  Please sign the challenge transaction in your wallet to
                  securely connect to {anchorDomain}.
                </p>
              </div>
            )}

            {step === "READY" && interactiveUrl && (
              <div
                data-testid="withdrawal-interactive-frame"
                className="h-[500px] w-full overflow-hidden rounded-xl border border-white/10 bg-white/5"
              >
                <iframe
                  src={interactiveUrl}
                  title="Stellar Anchor Withdrawal"
                  className="h-full w-full"
                />
              </div>
            )}
          </div>

          {/* Footer Info */}
          {step !== "READY" && (
            <div className="bg-white/[0.02] p-6 text-center">
              <p className="text-xs text-slate-500">
                Secured by Stellar Network • SEP-0024 Standard
              </p>
            </div>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
