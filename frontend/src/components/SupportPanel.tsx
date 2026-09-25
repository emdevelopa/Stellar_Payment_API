"use client";

import { useState, useEffect, Suspense, lazy } from "react";
import { useTranslations } from "next-intl";
import { useWallet } from "@/lib/wallet-context";
import { Spinner } from "./ui/Spinner";
import { toast } from "sonner";

// Lazy-load the modal so its heroicons + framer-motion chunks are only
// fetched after a successful transaction, keeping the panel's initial
// bundle lean. (#1204)
const TransactionResultModal = lazy(() =>
  import("./TransactionResultModal").then((m) => ({ default: m.TransactionResultModal }))
);
import { motion, AnimatePresence } from "framer-motion";
import { useBalanceSync } from "@/hooks/useBalanceSync";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const HORIZON_URL = process.env.NEXT_PUBLIC_HORIZON_URL ?? "https://horizon-testnet.stellar.org";

export function SupportPanel() {
  const t = useTranslations("support");
  const { activeProvider } = useWallet();
  const [visitorAddress, setVisitorAddress] = useState<string | null>(null);
  const [isLoadingWallet, setIsLoadingWallet] = useState(false);
  const [amount, setAmount] = useState("");
  const [assetCode] = useState("XLM");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showResultModal, setShowResultModal] = useState(false);
  const [txHash, setTxHash] = useState("");

  // Fetch visitor address on mount/provider change
  useEffect(() => {
    if (activeProvider) {
      setIsLoadingWallet(true);
      activeProvider
        .getPublicKey()
        .then(setVisitorAddress)
        .catch(console.error)
        .finally(() => setIsLoadingWallet(false));
    } else {
      setVisitorAddress(null);
    }
  }, [activeProvider]);

  const { balances, isLoading: loadingBalance } = useBalanceSync(null, null, {
    address: visitorAddress,
    horizonUrl: HORIZON_URL,
    enabled: !!visitorAddress,
  });

  const selectedBalance = balances.find((b) => b.code === assetCode)?.balance ?? "0";
  const isUnfunded = visitorAddress && balances.length === 0 && !loadingBalance;

  // Single authoritative screen-reader announcement for real-time balance sync,
  // so updates are spoken as one clear message instead of raw visual swaps.
  const balanceAnnouncement = !visitorAddress
    ? ""
    : loadingBalance
      ? t("balanceSyncing")
      : isUnfunded
        ? t("walletUnfunded")
        : t("balanceSynced", { balance: selectedBalance, asset: assetCode });

  const handleAmountChange = (val: string) => {
    setAmount(val);
  };

  const handleMessageChange = (val: string) => {
    if (val.length <= 28) {
      setMessage(val);
    }
  };

  const amountError = parseFloat(amount) > parseFloat(selectedBalance)
    ? t("insufficientBalance")
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

      if (!res.ok) throw new Error(t("failedToRecord"));

      // Mock success tx hash for modal
      const mockHash = Array.from({length: 64}, () => Math.floor(Math.random() * 16).toString(16)).join("");
      setTxHash(mockHash);
      setShowResultModal(true);
      
      // Reset form
      setAmount("");
      setMessage("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("submissionFailed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-5 p-1">
      {/* Authoritative live region for real-time balance-sync announcements */}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {balanceAnnouncement}
      </div>

      <div className="space-y-4">
        {/* Wallet Info */}
        <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-wider">
          <span className="text-slate-500">{t("yourWallet")}</span>
          {isLoadingWallet ? (
            <span
              className="h-3 w-24 animate-pulse rounded bg-white/10"
              aria-label={t("connectingWallet")}
            />
          ) : visitorAddress ? (
            <span className="text-mint truncate max-w-[120px]">{visitorAddress}</span>
          ) : (
            <span className="text-red-400">{t("notConnected")}</span>
          )}
        </div>

        {/* Amount Input */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-end">
            <label className="text-xs font-semibold text-white" htmlFor="amount-input">{t("amount")}</label>
            <div className="text-[10px] text-slate-400" aria-live="polite" aria-atomic="true">
              <AnimatePresence mode="wait" initial={false}>
                {loadingBalance ? (
                  <motion.div
                    key="loading"
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 4 }}
                    transition={{ duration: 0.18 }}
                    className="flex items-center gap-2"
                  >
                    <span className="sr-only">{t("loadingBalance")}</span>
                    <Spinner size="sm" className="h-3 w-3" aria-hidden="true" />
                  </motion.div>
                ) : isUnfunded ? (
                  <motion.a
                    key="unfunded"
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 4 }}
                    transition={{ duration: 0.18 }}
                    href="https://laboratory.stellar.org/#account-creator?network=testnet"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block text-yellow-400 hover:underline"
                  >
                    {t("unfunded")}
                  </motion.a>
                ) : (
                  // Keying by value animates the figure each time polling syncs a new balance.
                  <motion.span
                    key={`balance-${selectedBalance}-${assetCode}`}
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 4 }}
                    transition={{ duration: 0.18 }}
                    className="inline-block"
                    aria-label={t("availableAriaLabel", { balance: selectedBalance, asset: assetCode })}
                  >
                    {t("available", { balance: selectedBalance, asset: assetCode })}
                  </motion.span>
                )}
              </AnimatePresence>
            </div>
            {/* Visual-only — announcements are handled by the live region above. */}
            <div className="text-[10px] text-slate-400">
              {loadingBalance ? (
                <div className="flex items-center gap-2">
                  <span className="sr-only">{t("loadingBalance")}</span>
                  <Spinner size="sm" className="h-3 w-3" aria-hidden="true" />
                </div>
              ) : isUnfunded ? (
                <a
                  href="https://laboratory.stellar.org/#account-creator?network=testnet"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-yellow-400 hover:underline"
                >
                  {t("unfunded")}
                </a>
              ) : (
                <span aria-label={t("availableAriaLabel", { balance: selectedBalance, asset: assetCode })}>
                  {t("available", { balance: selectedBalance, asset: assetCode })}
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
          <label className="text-xs font-semibold text-white">{t("messageLabel")}</label>
          <div className="relative">
            <textarea
              value={message}
              onChange={(e) => handleMessageChange(e.target.value)}
              rows={2}
              className="w-full rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white placeholder:text-slate-600 focus:border-mint/50 focus:outline-none focus:ring-1 focus:ring-mint/50 resize-none"
              placeholder={t("messagePlaceholder")}
            />
            <div className={`absolute bottom-2 right-3 text-[9px] font-mono ${message.length === 28 ? 'text-red-400' : 'text-slate-500'}`}>
              {message.length} / 28
            </div>
          </div>
        </div>

        <button
          disabled={!canSubmit}
          onClick={handleSubmit}
          aria-busy={isSubmitting}
          className="w-full rounded-xl bg-mint py-3.5 text-sm font-bold text-black transition-all hover:scale-[1.01] active:translate-y-px disabled:opacity-40 disabled:grayscale disabled:hover:scale-100"
        >
          {isSubmitting ? (
            <span className="flex items-center justify-center gap-2">
              <Spinner size="sm" aria-hidden="true" />
              {t("sending")}
            </span>
          ) : (
            t("sendSupport")
          )}
        </button>
      </div>

      <Suspense fallback={null}>
        <TransactionResultModal
          isOpen={showResultModal}
          onClose={() => setShowResultModal(false)}
          txHash={txHash}
          amount={amount}
          assetCode={assetCode}
          recipientDisplayName="NovaSupport Admin"
        />
      </Suspense>
    </div>
  );
}
