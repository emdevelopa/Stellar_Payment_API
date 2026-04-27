"use client";

import { motion, AnimatePresence } from "framer-motion";
import { CheckIcon, ClipboardIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { toast } from "sonner";

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

  const copyToClipboard = () => {
    navigator.clipboard.writeText(stellarExpertUrl);
    toast.success("Link copied to clipboard!");
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
          className="relative w-full max-w-sm overflow-hidden rounded-3xl border border-white/10 bg-slate-900 p-6 shadow-2xl"
        >
          <button
            onClick={onClose}
            className="absolute right-4 top-4 text-slate-400 hover:text-white"
          >
            <XMarkIcon className="h-6 w-6" />
          </button>

          <div className="flex flex-col items-center text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-mint/20 text-mint">
              <CheckIcon className="h-10 w-10" />
            </div>

            <h2 className="text-xl font-bold text-white">Transaction Successful</h2>
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
                    onClick={copyToClipboard}
                    className="text-slate-400 hover:text-white"
                    title="Copy Stellar Expert link"
                  >
                    <ClipboardIcon className="h-4 w-4" />
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
}
