"use client";

import { useState, useEffect } from "react";
import { useWallet } from "@/lib/wallet-context";
import { getAccountBalances, type AssetBalance } from "@/lib/stellar";
import { Spinner } from "./ui/Spinner";
import { TransactionResultModal } from "./TransactionResultModal";
import { toast } from "sonner";
import { useBalanceSync } from "@/hooks/useBalanceSync";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const HORIZON_URL = process.env.NEXT_PUBLIC_HORIZON_URL ?? "https://horizon-testnet.stellar.org";

export function SupportPanel() {
  const { activeProvider } = useWallet();
  const [visitorAddress, setVisitorAddress] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [assetCode, setAssetCode] = useState("XLM");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showResultModal, setShowResultModal] = useState(false);
  const [txHash, setTxHash] = useState("");

  // Fetch visitor address on mount/provider change
  useEffect(() => {
    if (activeProvider) {
      activeProvider.getPublicKey().then(setVisitorAddress).catch(console.error);
    } else {
      setVisitorAddress(null);
    }
  }, [activeProvider]);

  const { balances, isLoading: loadingBalance } = useBalanceSync(null, null, {
    address: visitorAddress,
    horizonUrl: HORIZON_URL,
    enabled: !!visitorAddress,
  });

  const selectedBalance = (balances as any).find((b: any) => b.code === assetCode)?.balance ?? "0";
  const isUnfunded = visitorAddress && balances.length === 0 && !loadingBalance;
  
  const handleAmountChange = (val: string) => {
    setAmount(val);
  };

  const handleMessageChange = (val: string) => {
    if (val.length <= 28) {
      setMessage(val);
    }
  };

  const amountError = parseFloat(amount) > parseFloat(selectedBalance) 
    ? "Insufficient balance" 
    : null;

  const canSubmit = visitorAddress && amount && !amountError && !isSubmitting && !isUnfunded;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setIsSubmitting(true);
    
    try {
      // In a real app, we'd build and sign the tx here.
      // For this contribution, we'll hit the backend and mock the success flow 
      // as requested by the issues.
      
      const res = await fetch(`${API_URL}/api/support-transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: parseFloat(amount),
          asset: assetCode,
          recipient: "GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQSXUSMIQSTBE2BRUY4DQAT2B", // Mock admin
          message: message,
        }),
      });

      if (!res.ok) throw new Error("Failed to record support transaction");

      // Mock success tx hash for modal
      const mockHash = Array.from({length: 64}, () => Math.floor(Math.random() * 16).toString(16)).join("");
      setTxHash(mockHash);
      setShowResultModal(true);
      
      // Reset form
      setAmount("");
      setMessage("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-5 p-1">
      <div className="space-y-4">
        {/* Wallet Info */}
        <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-wider">
          <span className="text-slate-500">Your Wallet</span>
          {visitorAddress ? (
            <span className="text-mint truncate max-w-[120px]">{visitorAddress}</span>
          ) : (
            <span className="text-red-400">Not Connected</span>
          )}
        </div>

        {/* Amount Input */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-end">
            <label className="text-xs font-semibold text-white" htmlFor="amount-input">Amount</label>
            <div className="text-[10px] text-slate-400" aria-live="polite" aria-atomic="true">
              {loadingBalance ? (
                <div className="flex items-center gap-2">
                  <span className="sr-only">Loading balance...</span>
                  <Spinner size="xs" aria-hidden="true" />
                </div>
              ) : isUnfunded ? (
                <a 
                  href="https://laboratory.stellar.org/#account-creator?network=testnet" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-yellow-400 hover:underline"
                >
                  Unfunded (Fund on Testnet)
                </a>
              ) : (
                <span aria-label={`Available balance: ${selectedBalance} ${assetCode}`}>
                  Available: {selectedBalance} {assetCode}
                </span>
              )}
            </div>
          </div>
          <div className="relative">
            <input
              id="amount-input"
              type="number"
              value={amount}
              onChange={(e) => handleAmountChange(e.target.value)}
              placeholder="0.00"
              aria-invalid={!!amountError}
              aria-errormessage={amountError ? "amount-error" : undefined}
              className={`w-full rounded-xl border bg-white/5 p-3 text-white placeholder:text-slate-600 focus:outline-none focus:ring-1 ${
                amountError ? "border-red-500/50 focus:ring-red-500/50" : "border-white/10 focus:border-mint/50 focus:ring-mint/50"
              }`}
            />
            {amountError && (
              <p id="amount-error" className="mt-1 text-[10px] text-red-400" aria-live="assertive">{amountError}</p>
            )}
          </div>
        </div>

        {/* Message Input */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-white">Leave a message (optional)</label>
          <div className="relative">
            <textarea
              value={message}
              onChange={(e) => handleMessageChange(e.target.value)}
              rows={2}
              className="w-full rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white placeholder:text-slate-600 focus:border-mint/50 focus:outline-none focus:ring-1 focus:ring-mint/50 resize-none"
              placeholder="Thanks for the great work!"
            />
            <div className={`absolute bottom-2 right-3 text-[9px] font-mono ${message.length === 28 ? 'text-red-400' : 'text-slate-500'}`}>
              {message.length} / 28
            </div>
          </div>
        </div>

        <button
          disabled={!canSubmit}
          onClick={handleSubmit}
          className="w-full rounded-xl bg-mint py-3.5 text-sm font-bold text-black transition-all hover:scale-[1.01] active:translate-y-px disabled:opacity-40 disabled:grayscale disabled:hover:scale-100"
        >
          {isSubmitting ? <Spinner size="sm" /> : "Send Support"}
        </button>
      </div>

      <TransactionResultModal
        isOpen={showResultModal}
        onClose={() => setShowResultModal(false)}
        txHash={txHash}
        amount={amount}
        assetCode={assetCode}
        recipientDisplayName="NovaSupport Admin"
      />
    </div>
  );
}
