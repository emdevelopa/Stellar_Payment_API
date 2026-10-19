"use client";

import { useCallback, useState, lazy, Suspense } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Modal } from "@/components/ui/Modal";
import { useSep24AnchorFlow, type Sep24BusyStep } from "@/hooks/useSep24AnchorFlow";

// Lazy load framer-motion for better bundle splitting
const AnimatePresence = lazy(() => import("framer-motion").then(mod => ({ default: mod.AnimatePresence })));
const MotionDiv = lazy(() => import("framer-motion").then(mod => ({ default: mod.motion.div })));

// Lightweight custom skeleton component
function Skeleton({ className }: { className?: string }) {
  return (
    <div className={`animate-pulse bg-slate-700/50 rounded ${className}`} />
  );
}

interface FiatOnrampModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const DEFAULT_ANCHOR = "testanchor.stellar.org";
const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
const SUPPORTED_ASSETS = [
  {
    code: "USDC",
    issuer: "GBBD67V63DU7D3SXXF4SOT5O7GNCGYL65B66S3YUKG6VCH3TFRZ7I7YQ",
  },
  {
    code: "SRT",
    issuer: "GCDGUC3OCYLAU7XIK7EUBTWSOT3N4XALR6IRLKEW3V3AEL3Z5W5SOT4F",
  },
];

const STEP_MESSAGE_KEY: Record<Sep24BusyStep, "stepConnecting" | "stepAuth" | "stepGenerating"> = {
  CONNECTING: "stepConnecting",
  AUTH: "stepAuth",
  SUBMITTING: "stepGenerating",
};

// Lightweight spinner component
function Spinner({ className }: { className?: string }) {
  return (
    <div className={`h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin ${className}`} />
  );
}

export default function FiatOnrampModal({ isOpen, onClose }: FiatOnrampModalProps) {
  const t = useTranslations("fiatOnramp");
  const { step, isBusy, interactiveUrl, start, reset: resetFlow } = useSep24AnchorFlow({
    networkPassphrase: NETWORK_PASSPHRASE,
  });
  const [amount, setAmount] = useState("");
  const [anchorDomain, setAnchorDomain] = useState(DEFAULT_ANCHOR);
  const [selectedAsset, setSelectedAsset] = useState(SUPPORTED_ASSETS[0]);
  const [iframeLoading, setIframeLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    resetFlow();
    setIframeLoading(true);
    setError(null);
  }, [resetFlow]);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const handleStartDeposit = useCallback(async () => {
    setError(null);
    try {
      await start({
        anchorDomain,
        assetCode: selectedAsset.code,
        direction: "deposit",
        amount: amount || undefined,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : t("genericError");
      toast.error(message);
      setError(message);
    }
  }, [start, anchorDomain, amount, selectedAsset, t]);

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={t("title")}>
      <Suspense fallback={<div className="flex flex-col gap-6 p-4">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>}>
        <AnimatePresence mode="wait">
          {step === "IDLE" && (
            <MotionDiv
              key="select"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
              className="flex flex-col gap-6"
            >
              <p className="text-sm text-slate-400">{t("description")}</p>

              {error && (
                <div
                  role="alert"
                  className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400"
                >
                  {error}
                </div>
              )}

              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  {t("selectAsset")}
                </label>
                <div className="grid grid-cols-2 gap-4">
                  {SUPPORTED_ASSETS.map((asset) => (
                    <button
                      key={asset.code}
                      type="button"
                      onClick={() => setSelectedAsset(asset)}
                      disabled={isBusy}
                      aria-pressed={selectedAsset.code === asset.code}
                      className={`flex flex-col items-center gap-2 rounded-2xl border p-4 transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
                        selectedAsset.code === asset.code
                          ? "border-mint bg-mint/5 ring-1 ring-mint"
                          : "border-white/10 bg-white/5 hover:border-white/20"
                      }`}
                    >
                      <span className="text-lg font-bold text-white">{asset.code}</span>
                      <span className="text-[10px] text-slate-500">
                        {asset.issuer.slice(0, 8)}...
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="onramp-amount" className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  {t("amountLabel")} <span className="normal-case text-slate-600">{t("amountOptional")}</span>
                </label>
                <input
                  id="onramp-amount"
                  type="text"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  disabled={isBusy}
                  className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-mint disabled:cursor-not-allowed disabled:opacity-50"
                  placeholder={t("amountPlaceholder", { amount: "100", asset: selectedAsset.code })}
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="onramp-anchor" className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  {t("anchorDomainLabel")}
                </label>
                <input
                  id="onramp-anchor"
                  type="text"
                  value={anchorDomain}
                  onChange={(e) => setAnchorDomain(e.target.value)}
                  disabled={isBusy}
                  className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-mint disabled:cursor-not-allowed disabled:opacity-50"
                  placeholder={t("anchorDomainPlaceholder")}
                />
              </div>

              <button
                type="button"
                onClick={handleStartDeposit}
                disabled={isBusy}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-mint py-4 text-sm font-bold text-black transition-all hover:scale-[1.02] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
              >
                {isBusy ? (
                  <>
                    <Spinner className="text-black" />
                    {t(STEP_MESSAGE_KEY[step as Sep24BusyStep])}
                  </>
                ) : (
                  t("continueButton")
                )}
              </button>
            </MotionDiv>
          )}

          {(step === "CONNECTING" || step === "AUTH" || step === "SUBMITTING") && (
            <MotionDiv
              key="busy"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              role="status"
              aria-live="polite"
              className="flex flex-col items-center justify-center py-14 text-center"
            >
              <div className="relative mb-6">
                <div className="h-20 w-20 animate-ping rounded-full bg-mint/20" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="h-8 w-8 rounded-full border-4 border-mint border-t-transparent animate-spin" />
                </div>
              </div>
              <h3 className="text-lg font-bold text-white">{t(STEP_MESSAGE_KEY[step as Sep24BusyStep])}</h3>
              <p className="mt-2 text-sm text-slate-400">
                {step === "AUTH" ? t("authHint", { domain: anchorDomain }) : t("genericHint")}
              </p>
            </MotionDiv>
          )}

          {step === "READY" && interactiveUrl && (
            <MotionDiv
              key="interactive"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="relative h-[500px] w-full overflow-hidden rounded-xl border border-white/10 bg-white/5"
            >
              {iframeLoading && (
                <div className="absolute inset-0 z-10 flex flex-col gap-3 p-4">
                  <Skeleton className="h-7 w-3/5" />
                  <Skeleton className="h-48" />
                  <Skeleton className="h-10" />
                </div>
              )}
              <iframe
                src={interactiveUrl}
                title={t("iframeTitle")}
                className="h-full w-full"
                onLoad={() => setIframeLoading(false)}
              />
            </MotionDiv>
          )}
        </AnimatePresence>
      </Suspense>

      {step !== "READY" && (
        <p className="mt-6 text-center text-xs text-slate-500">{t("footerNote")}</p>
      )}
    </Modal>
  );
}
