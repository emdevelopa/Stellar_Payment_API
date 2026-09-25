"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { Spinner } from "@/components/ui/Spinner";
import { useSep24AnchorFlow } from "@/hooks/useSep24AnchorFlow";

interface WithdrawalModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const DEFAULT_ANCHOR = "testanchor.stellar.org";
const SUPPORTED_ASSETS = [
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

  const handleStartWithdrawal = async () => {
    try {
      await start({
        anchorDomain,
        assetCode: selectedAsset.code,
        direction: "withdraw",
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Withdrawal failed");
    }
  };

  const reset = () => {
    resetFlow();
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => {
            reset();
            onClose();
          }}
          className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        />

        <motion.div
          initial={{ scale: 0.9, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 20 }}
          className="relative w-full max-w-2xl overflow-hidden rounded-3xl border border-white/10 bg-black/80 shadow-2xl backdrop-blur-xl"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-white/10 p-6">
            <div>
              <h2 className="text-xl font-bold text-white">Withdraw Funds</h2>
              <p className="text-sm text-slate-400">
                Via Stellar SEP-0024 Anchor
              </p>
            </div>
            <button
              onClick={() => {
                reset();
                onClose();
              }}
              className="rounded-full p-2 text-slate-400 hover:bg-white/5 hover:text-white"
            >
              <svg
                className="h-6 w-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
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
                  <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Select Asset
                  </label>
                  <div className="grid grid-cols-2 gap-4">
                    {SUPPORTED_ASSETS.map((asset) => (
                      <button
                        key={asset.code}
                        onClick={() => setSelectedAsset(asset)}
                        className={`flex flex-col items-center gap-2 rounded-2xl border p-4 transition-all ${
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
                  <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Anchor Domain
                  </label>
                  <input
                    type="text"
                    value={anchorDomain}
                    onChange={(e) => setAnchorDomain(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-accent"
                    placeholder="e.g. testanchor.stellar.org"
                  />
                </div>

                <button
                  onClick={handleStartWithdrawal}
                  disabled={isBusy}
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-4 text-sm font-bold text-black transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
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
              <div className="flex flex-col items-center justify-center py-10 text-center">
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
              <div className="h-[500px] w-full overflow-hidden rounded-xl border border-white/10 bg-white/5">
                <iframe
                  src={interactiveUrl}
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
