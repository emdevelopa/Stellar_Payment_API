"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  getAnchorServices,
  authenticateWithAnchor,
  initiateWithdrawal,
} from "@/lib/stellar";
import { signWithFreighter, getFreighterPublicKey } from "@/lib/freighter";
import toast from "react-hot-toast";
import { Spinner } from "./ui/Spinner";

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
  const [step, setStep] = useState<"SELECT" | "AUTH" | "INTERACTIVE">("SELECT");
  const [loading, setLoading] = useState(false);
  const [interactiveUrl, setInteractiveUrl] = useState<string | null>(null);
  const [anchorDomain, setAnchorDomain] = useState(DEFAULT_ANCHOR);
  const [selectedAsset, setSelectedAsset] = useState(SUPPORTED_ASSETS[0]);

  const handleStartWithdrawal = async () => {
    setLoading(true);
    try {
      const publicKey = await getFreighterPublicKey();

      // 1. Discovery
      const services = await getAnchorServices(anchorDomain);
      if (!services.webAuthEndpoint || !services.transferServer) {
        throw new Error("Anchor does not support SEP-0024 or SEP-0010");
      }

      // 2. Auth (SEP-0010)
      setStep("AUTH");
      const jwt = await authenticateWithAnchor(
        publicKey,
        services.webAuthEndpoint,
        async (xdr) => {
          const res = await signWithFreighter(
            xdr,
            "Test SDF Network ; September 2015",
          );
          return res.signedXDR;
        },
      );

      // 3. Initiate (SEP-0024)
      const url = await initiateWithdrawal(
        services.transferServer,
        jwt,
        selectedAsset.code,
        publicKey,
      );

      setInteractiveUrl(url);
      setStep("INTERACTIVE");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Withdrawal failed");
      setStep("SELECT");
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setStep("SELECT");
    setInteractiveUrl(null);
    setLoading(false);
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
          className="relative w-full max-w-2xl overflow-hidden rounded-3xl border border-white/10 bg-[#0A0A0A] shadow-2xl"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-white/5 p-6">
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
            {step === "SELECT" && (
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
                            ? "border-mint bg-mint/5 ring-1 ring-mint"
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
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-mint"
                    placeholder="e.g. testanchor.stellar.org"
                  />
                </div>

                <button
                  onClick={handleStartWithdrawal}
                  disabled={loading}
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-mint py-4 text-sm font-bold text-black transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
                >
                  {loading ? (
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

            {step === "AUTH" && (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <div className="relative mb-6">
                  <div className="h-20 w-20 animate-ping rounded-full bg-mint/20" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="h-12 w-12 rounded-full border-4 border-mint border-t-transparent animate-spin" />
                  </div>
                </div>
                <h3 className="text-lg font-bold text-white">Authenticating</h3>
                <p className="mt-2 text-sm text-slate-400">
                  Please sign the challenge transaction in your wallet to
                  securely connect to {anchorDomain}.
                </p>
              </div>
            )}

            {step === "INTERACTIVE" && interactiveUrl && (
              <div className="h-[500px] w-full overflow-hidden rounded-xl border border-white/10 bg-white/5">
                <iframe
                  src={interactiveUrl}
                  className="h-full w-full"
                  onLoad={() => setLoading(false)}
                />
              </div>
            )}
          </div>

          {/* Footer Info */}
          {step !== "INTERACTIVE" && (
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
