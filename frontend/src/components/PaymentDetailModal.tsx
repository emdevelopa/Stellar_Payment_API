"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@/lib/wallet-context";
import { usePayment } from "@/lib/usePayment";
import WalletSelector from "@/components/WalletSelector";
import CopyButton from "@/components/CopyButton";
import toast from "react-hot-toast";
import { QRCodeSVG } from "qrcode.react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const NETWORK = process.env.NEXT_PUBLIC_STELLAR_NETWORK ?? "testnet";
const EXPLORER_BASE =
  NETWORK === "public"
    ? "https://stellar.expert/explorer/public"
    : "https://stellar.expert/explorer/testnet";

interface PaymentDetails {
  id: string;
  amount: number;
  asset: string;
  asset_issuer: string | null;
  recipient: string;
  description: string | null;
  status: string;
  tx_id: string | null;
  created_at: string;
}

interface PaymentDetailModalProps {
  paymentId: string;
  isOpen: boolean;
  onClose: () => void;
}

// Asset badge component
function AssetBadge({ asset }: { asset: string }) {
  const a = asset.toUpperCase();
  if (a === "XLM" || a === "NATIVE") {
    return (
      <span
        aria-hidden="true"
        className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-white/15 via-mint/20 to-mint/40 text-mint shadow-[0_0_0_1px_rgba(255,255,255,0.08)]"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8}>
          <path d="M14.5 3.5 9 9l4.5.5L13 14l5.5-5.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M6 18c3.5-1 6-3.5 7-7" strokeLinecap="round" />
          <path d="M7.5 16.5 4.5 19.5" strokeLinecap="round" />
        </svg>
      </span>
    );
  }
  if (a === "USDC") {
    return (
      <span
        aria-hidden="true"
        className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#2775CA] text-[8px] font-bold tracking-[0.18em] text-white shadow-[0_0_0_1px_rgba(255,255,255,0.08)]"
      >
        USDC
      </span>
    );
  }
  return (
    <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-white/10 text-xs font-bold text-white">
      {asset.slice(0, 3)}
    </span>
  );
}

// Status badge component
const STATUS_MAP: Record<string, { label: string; classes: string }> = {
  pending:   { label: "Awaiting Payment",  classes: "bg-yellow-500/15 text-yellow-400 border border-yellow-500/30" },
  confirmed: { label: "Confirmed",         classes: "bg-mint/10 text-mint border border-mint/30" },
  completed: { label: "Completed",         classes: "bg-green-500/15 text-green-400 border border-green-500/30" },
  failed:    { label: "Failed",            classes: "bg-red-500/15 text-red-400 border border-red-500/30" },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_MAP[status.toLowerCase()] ?? {
    label: status,
    classes: "bg-white/10 text-slate-400 border border-white/10",
  };
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${s.classes}`}>
      {s.label}
    </span>
  );
}

export default function PaymentDetailModal({ paymentId, isOpen, onClose }: PaymentDetailModalProps) {
  const [payment, setPayment] = useState<PaymentDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const { activeProvider } = useWallet();
  const walletReady = !!activeProvider;

  const { isProcessing, error: paymentError, processPayment } = usePayment(activeProvider);

  // Fetch payment details
  useEffect(() => {
    if (!isOpen || !paymentId) return;
    
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    const load = async () => {
      try {
        const res = await fetch(`${API_URL}/api/payment-status/${paymentId}`, {
          signal: controller.signal,
        });
        if (res.status === 404) throw new Error("Payment not found.");
        if (!res.ok) throw new Error("Could not load payment details.");
        const data = await res.json();
        setPayment(data.payment);
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Failed to load payment.");
      } finally {
        setLoading(false);
      }
    };

    load();
    return () => controller.abort();
  }, [paymentId, isOpen]);

  // Poll until settled
  useEffect(() => {
    if (!isOpen || loading || !payment) return;
    const settled = ["confirmed", "completed", "failed"].includes(payment.status);
    if (settled) return;

    const id = setInterval(async () => {
      try {
        const res = await fetch(`${API_URL}/api/payment-status/${paymentId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.payment) setPayment(data.payment);
      } catch { /* silent — retry next tick */ }
    }, 5000);

    return () => clearInterval(id);
  }, [paymentId, payment, loading, isOpen]);

  const networkPassphrase =
    process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015";

  // Pay handler
  const handlePay = async () => {
    if (!payment) return;
    setActionError(null);

    try {
      const result = await processPayment({
        recipient: payment.recipient,
        amount: String(payment.amount),
        assetCode: payment.asset,
        assetIssuer: payment.asset_issuer,
      });

      setPayment({ ...payment, status: "completed", tx_id: result.hash });
      toast.success("Payment sent!");

      // Best-effort backend verification
      setTimeout(async () => {
        try {
          await fetch(`${API_URL}/api/verify-payment/${paymentId}`, { method: "POST" });
        } catch { /* non-critical */ }
      }, 2000);
    } catch {
      const msg = paymentError ?? "Payment failed. Please try again.";
      setActionError(msg);
      toast.error(msg);
    }
  };

  // Close on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    
    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
      return () => document.removeEventListener("keydown", handleEscape);
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const isSettled = payment?.status === "confirmed" || payment?.status === "completed";
  const isFailed = payment?.status === "failed";

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />
      
      {/* Right sliding sheet */}
      <div className={`fixed right-0 top-0 z-50 h-full w-full max-w-lg bg-slate-900 shadow-2xl transform transition-transform duration-300 ease-in-out ${
        isOpen ? "translate-x-0" : "translate-x-full"
      }`}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 p-6">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.3em] text-mint">Payment Details</p>
            <p className="font-mono text-xs text-slate-500 mt-1">ID: {paymentId}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="h-full overflow-y-auto pb-20">
          {loading ? (
            <div className="p-6 space-y-4">
              <div className="animate-pulse space-y-3">
                <div className="h-8 w-32 rounded-lg bg-white/10" />
                <div className="h-12 w-48 rounded-lg bg-white/10" />
                <div className="h-6 w-64 rounded-lg bg-white/10" />
              </div>
            </div>
          ) : error || !payment ? (
            <div className="p-6">
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-center">
                <p className="text-sm font-medium uppercase tracking-wider text-red-400">Error</p>
                <p className="mt-3 text-lg font-semibold text-white">
                  {error ?? "Payment not found"}
                </p>
              </div>
            </div>
          ) : (
            <div className="p-6 space-y-6">
              {/* Amount hero */}
              <div className="flex flex-col items-center gap-3 text-center">
                <AssetBadge asset={payment.asset} />
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-bold tracking-tight text-white">
                    {payment.amount.toLocaleString(undefined, {
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 7,
                    })}
                  </span>
                  <span className="text-xl font-semibold text-slate-400">
                    {payment.asset.toUpperCase()}
                  </span>
                </div>
                {payment.description && (
                  <p className="text-sm text-slate-400">{payment.description}</p>
                )}
                <StatusBadge status={payment.status} />
              </div>

              {/* Details */}
              <div className="space-y-4">
                {/* Recipient */}
                <div className="flex flex-col gap-2">
                  <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                    Recipient
                  </p>
                  <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 p-3">
                    <code className="flex-1 truncate font-mono text-sm text-slate-200">
                      {payment.recipient}
                    </code>
                    <CopyButton text={payment.recipient} />
                  </div>
                </div>

                {/* QR Code */}
                <div className="flex flex-col gap-2">
                  <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                    Scan to Pay
                  </p>
                  <div className="flex items-center justify-center rounded-xl border border-white/10 bg-white p-4">
                    <QRCodeSVG
                      value={payment.recipient}
                      size={140}
                      level="M"
                      bgColor="#ffffff"
                      fgColor="#000000"
                    />
                  </div>
                  <p className="text-center text-xs text-slate-500">
                    Scan with Freighter or any Stellar wallet
                  </p>
                </div>

                {/* Date */}
                <div className="flex flex-col gap-1">
                  <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                    Created
                  </p>
                  <p className="text-sm text-slate-300">
                    {new Date(payment.created_at).toLocaleString(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </p>
                </div>

                {/* Transaction hash */}
                {payment.tx_id && (
                  <div className="flex flex-col gap-2">
                    <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                      Transaction
                    </p>
                    <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 p-3">
                      <a
                        href={`${EXPLORER_BASE}/tx/${payment.tx_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 truncate font-mono text-sm text-mint underline underline-offset-2 hover:text-glow"
                      >
                        {payment.tx_id}
                      </a>
                      <CopyButton text={payment.tx_id} />
                    </div>
                  </div>
                )}

                {/* Action error */}
                {actionError && (
                  <div
                    role="alert"
                    className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400"
                  >
                    {actionError}
                  </div>
                )}

                {/* CTA section */}
                {!isSettled && !isFailed && (
                  <div className="flex flex-col gap-3 pt-2">
                    {walletReady ? (
                      <button
                        type="button"
                        onClick={handlePay}
                        disabled={isProcessing}
                        className="group relative flex h-12 w-full items-center justify-center rounded-xl bg-mint font-bold text-black transition-all hover:bg-glow disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isProcessing ? (
                          <span className="flex items-center gap-2">
                            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                            </svg>
                            Processing…
                          </span>
                        ) : (
                          `Pay with ${activeProvider!.name}`
                        )}
                        <div className="absolute inset-0 -z-10 bg-mint/20 opacity-0 blur-xl transition-opacity group-hover:opacity-100" />
                      </button>
                    ) : (
                      <WalletSelector
                        networkPassphrase={networkPassphrase}
                        onConnected={() => {}}
                      />
                    )}
                  </div>
                )}

                {/* Status messages */}
                {isSettled && (
                  <div className="rounded-xl border border-mint/30 bg-mint/5 p-4 text-center">
                    <p className="text-sm font-semibold text-mint">
                      This payment has been received.
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      The transaction was confirmed on the Stellar network.
                    </p>
                  </div>
                )}

                {isFailed && (
                  <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-center">
                    <p className="text-sm font-semibold text-red-400">
                      This payment has failed.
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Contact the merchant if you believe this is an error.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
