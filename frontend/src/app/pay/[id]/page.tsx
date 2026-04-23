"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useWallet } from "@/lib/wallet-context";
import { Spinner } from "@/components/ui/Spinner";
import { usePayment } from "@/lib/usePayment";
import { useAssetMetadata } from "@/lib/useAssetMetadata";
import { getAccountBalances, type AssetBalance } from "@/lib/stellar";
import { createReceiptPdf } from "@/lib/receipt-pdf";
import CheckoutQrModal from "@/components/CheckoutQrModal";
import CopyButton from "@/components/CopyButton";
import WalletSelector from "@/components/WalletSelector";
import { toast } from "sonner";
import Skeleton, { SkeletonTheme } from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";
import { QRCodeSVG } from "qrcode.react";
import { localeToLanguageTag } from "@/i18n/config";
import Confetti from "react-confetti";
import { useCheckoutPresence } from "@/lib/useCheckoutPresence";
import { Modal } from "@/components/ui/Modal";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const NETWORK = process.env.NEXT_PUBLIC_STELLAR_NETWORK ?? "testnet";
const EXPLORER_BASE = NETWORK === "public"
  ? "https://stellar.expert/explorer/public"
  : "https://stellar.expert/explorer/testnet";

interface BrandingConfig {
  primary_color?: string; secondary_color?: string; background_color?: string;
  logo_url?: string | null; logo_alt?: string | null; merchant_name?: string | null;
}
interface PaymentDetails {
  id: string; amount: number; asset: string; asset_issuer: string | null;
  recipient: string; description: string | null; memo?: string | null;
  memo_type?: string | null; status: string; tx_id: string | null;
  created_at: string; branding_config?: BrandingConfig | null;
  metadata?: {
    failure_reason?: string;
    expected_amount?: number | string;
    received_amount?: number | string;
    shortfall?: number | string;
    [key: string]: unknown;
  } | null;
}
interface PathQuote {
  source_asset: string; source_asset_issuer: string | null; source_amount: string;
  send_max: string; destination_asset: string; destination_asset_issuer: string | null;
  destination_amount: string; path: Array<{ asset_code: string; asset_issuer: string | null }>;
  slippage: number;
}
interface NetworkFeeResponse {
  network_fee: { network: string; horizon_url: string; operation_count: number; stroops: number; xlm: string; last_ledger_base_fee: number; };
}

const DEFAULT_THEME = { primary_color: "#00F5D4", secondary_color: "#6C5CE7", background_color: "#0B0F1A" };

function resolveBranding(config: BrandingConfig | null | undefined) {
  return { ...DEFAULT_THEME, logo_url: null, logo_alt: null, merchant_name: null, ...(config ?? {}) };
}

function buildSep7Uri(p: PaymentDetails) {
  const params = new URLSearchParams({ destination: p.recipient, amount: String(p.amount), asset_code: p.asset.toUpperCase() });
  if (p.asset_issuer) params.set("asset_issuer", p.asset_issuer);
  if (p.memo) params.set("memo", p.memo);
  if (p.memo_type) params.set("memo_type", p.memo_type);
  return `web+stellar:pay?${params.toString()}`;
}

function buildReceiptFilename(id: string) { return `receipt-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}.pdf`; }

// ── Sub-components ────────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <SkeletonTheme baseColor="#F5F5F5" highlightColor="#E8E8E8">
      <main className="h-screen bg-white flex items-center justify-center px-4">
        <div className="w-full max-w-sm flex flex-col gap-4 h-full max-h-screen py-8">
          <div className="flex flex-col gap-2 shrink-0">
            <Skeleton width={100} height={12} borderRadius={999} />
            <Skeleton width={180} height={28} borderRadius={8} />
          </div>
          <div className="rounded-2xl border border-[#E8E8E8] overflow-hidden flex flex-col flex-1 min-h-0">
            <div className="flex items-center gap-4 px-6 py-5 border-b border-[#E8E8E8] shrink-0">
              <Skeleton circle width={40} height={40} />
              <div className="flex flex-col gap-1.5 flex-1">
                <Skeleton width={120} height={28} borderRadius={6} />
                <Skeleton width={80} height={20} borderRadius={999} />
              </div>
            </div>
            <div className="flex flex-col gap-4 p-6">
              {[1,2,3].map(i => <Skeleton key={i} height={48} borderRadius={12} />)}
            </div>
          </div>
        </div>
      </main>
    </SkeletonTheme>
  );
}

function StatusPill({ status, t }: { status: string; t: ReturnType<typeof useTranslations> }) {
  const map: Record<string, { label: string; dot: string; cls: string }> = {
    pending:   { label: t("status.pending"),   dot: "bg-yellow-500", cls: "border-yellow-200 bg-yellow-50 text-yellow-700" },
    confirmed: { label: t("status.confirmed"), dot: "bg-emerald-500", cls: "border-emerald-200 bg-emerald-50 text-emerald-700" },
    completed: { label: t("status.completed"), dot: "bg-emerald-500", cls: "border-emerald-200 bg-emerald-50 text-emerald-700" },
    failed:    { label: t("status.failed"),    dot: "bg-red-500",     cls: "border-red-200 bg-red-50 text-red-700" },
  };
  const s = map[status.toLowerCase()] ?? { label: status, dot: "bg-[#6B6B6B]", cls: "border-[#E8E8E8] bg-[#F9F9F9] text-[#6B6B6B]" };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-widest ${s.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

function AssetIcon({ asset, logo, name }: { asset: string; logo?: string | null; name?: string | null }) {
  const a = asset.toUpperCase();
  if (logo) return <span className="inline-flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-[#E8E8E8] bg-[#F9F9F9]"><Image src={logo} alt={name ?? asset} width={32} height={32} className="h-8 w-8 object-contain" /></span>;
  if (a === "XLM" || a === "NATIVE") return (
    <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[#0A0A0A]">
      <svg viewBox="0 0 24 24" className="h-5 w-5 text-white" fill="none" stroke="currentColor" strokeWidth={1.8}>
        <path d="M14.5 3.5 9 9l4.5.5L13 14l5.5-5.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M6 18c3.5-1 6-3.5 7-7" strokeLinecap="round" />
        <path d="M7.5 16.5 4.5 19.5" strokeLinecap="round" />
      </svg>
    </span>
  );
  if (a === "USDC") return <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[#2775CA] text-[10px] font-bold tracking-widest text-white">USDC</span>;
  return <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[#E8E8E8] bg-[#F9F9F9] text-sm font-bold text-[#0A0A0A]">{asset.slice(0, 3)}</span>;
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]">{label}</p>
      {children}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PaymentPage() {
  const t = useTranslations("checkout");
  const locale = localeToLanguageTag(useLocale());
  const params = useParams();
  const paymentId = params.id as string;
  const router = useRouter();

  const [payment, setPayment] = useState<PaymentDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showQrModal, setShowQrModal] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [isDownloadingReceipt, setIsDownloadingReceipt] = useState(false);
  const [isPayModalOpen, setIsPayModalOpen] = useState(false);
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
  const [networkFee, setNetworkFee] = useState<NetworkFeeResponse["network_fee"] | null>(null);
  const [networkFeeLoading, setNetworkFeeLoading] = useState(false);
  const [networkFeeError, setNetworkFeeError] = useState<string | null>(null);
  const [usePathPayment, setUsePathPayment] = useState(false);
  const [pathQuote, setPathQuote] = useState<PathQuote | null>(null);
  const [pathQuoteLoading, setPathQuoteLoading] = useState(false);
  const [pathQuoteError, setPathQuoteError] = useState<string | null>(null);
  const [walletBalances, setWalletBalances] = useState<AssetBalance[]>([]);
  const [sourceAsset, setSourceAsset] = useState<string>("XLM");
  const [sortedSourceAssets, setSortedSourceAssets] = useState<string[]>([]);
  const [walletPublicKey, setWalletPublicKey] = useState<string | null>(null);
  const previousWalletPublicKey = useRef<string | null>(null);

  const { activeProvider } = useWallet();
  const { isProcessing, status: txStatus, error: paymentError, processPayment, processPathPayment } = usePayment(activeProvider);
  const { assets: assetMetadata } = useAssetMetadata();
  const activeViewers = useCheckoutPresence(paymentId);

  useEffect(() => {
    if (payment && (payment.status === "confirmed" || payment.status === "completed")) setShowConfetti(true);
  }, [payment]);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const res = await fetch(`${API_URL}/api/payment-status/${paymentId}`, { signal: controller.signal });
        if (res.status === 404) throw new Error(t("paymentMissing"));
        if (!res.ok) throw new Error(t("loadFailed"));
        const data = await res.json();
        setPayment(data.payment);
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") return;
        setFetchError(err instanceof Error ? err.message : t("loadPaymentFailed"));
      } finally { setLoading(false); }
    };
    load();
    return () => controller.abort();
  }, [paymentId, t]);

  useEffect(() => {
    if (loading || !payment) return;
    if (["confirmed", "completed", "failed"].includes(payment.status)) return;
    const es = new EventSource(`${API_URL}/api/stream/${paymentId}`);
    es.addEventListener("payment.confirmed", (event) => {
      try { const d = JSON.parse(event.data); setPayment((p) => p ? { ...p, status: d.status, tx_id: d.tx_id } : null); toast.success(t("paymentConfirmed")); es.close(); } catch {}
    });
    es.onerror = () => es.close();
    return () => es.close();
  }, [paymentId, payment, loading, t]);

  useEffect(() => {
    if (loading || !payment || ["confirmed", "completed", "failed"].includes(payment.status)) return;
    const id = setInterval(async () => {
      try {
        // Poll payment-status (no rate limit) — the background poller handles Horizon checks
        const res = await fetch(`${API_URL}/api/payment-status/${paymentId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.payment && data.payment.status !== payment.status) {
          setPayment(data.payment);
        }
      } catch {}
    }, 5000);
    return () => clearInterval(id);
  }, [paymentId, payment, loading]);

  useEffect(() => {
    if (!activeProvider) {
      setWalletPublicKey(null);
      previousWalletPublicKey.current = null;
      return;
    }

    let cancelled = false;
    const syncPublicKey = async () => {
      try {
        const nextKey = await activeProvider.getPublicKey();
        if (!cancelled) {
          setWalletPublicKey((prev) => (prev === nextKey ? prev : nextKey));
        }
      } catch {
        if (!cancelled) {
          setWalletPublicKey(null);
        }
      }
    };

    void syncPublicKey();
    const intervalId = window.setInterval(syncPublicKey, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [activeProvider]);

  useEffect(() => {
    if (!walletPublicKey) return;
    if (previousWalletPublicKey.current && previousWalletPublicKey.current !== walletPublicKey) {
      toast.info("Wallet account switched. Checkout balances updated.");
    }
    previousWalletPublicKey.current = walletPublicKey;
  }, [walletPublicKey]);

  useEffect(() => {
    if (!activeProvider || !walletPublicKey) { setWalletBalances([]); setSortedSourceAssets([]); return; }
    const load = async () => {
      try {
        const horizonUrl = process.env.NEXT_PUBLIC_HORIZON_URL || "https://horizon-testnet.stellar.org";
        const balances = await getAccountBalances(walletPublicKey, horizonUrl);
        setWalletBalances(balances);
        const supported = assetMetadata.map(a => a.code);
        const sorted = [...supported].sort((a, b) => parseFloat(balances.find(x => x.code === b)?.balance || "0") - parseFloat(balances.find(x => x.code === a)?.balance || "0"));
        setSortedSourceAssets(sorted);
        if (sorted.length > 0) setSourceAsset(sorted[0]);
      } catch {}
    };
    load();
  }, [activeProvider, assetMetadata, walletPublicKey]);

  useEffect(() => {
    if (!payment || !activeProvider || !walletPublicKey || payment.status !== "pending") { setPathQuote(null); setUsePathPayment(false); return; }
    if (sourceAsset === payment.asset.toUpperCase()) { setPathQuote(null); setUsePathPayment(false); return; }
    let cancelled = false;
    (async () => {
      setPathQuoteLoading(true); setPathQuoteError(null);
      try {
        const qs = new URLSearchParams({ source_asset: sourceAsset, source_asset_issuer: assetMetadata.find(a => a.code === sourceAsset)?.issuer || "", source_account: walletPublicKey });
        const res = await fetch(`${API_URL}/api/path-payment-quote/${paymentId}?${qs}`);
        if (!res.ok) { if (!cancelled) { setPathQuote(null); setUsePathPayment(false); if (res.status === 404) setPathQuoteError(`No path found for ${sourceAsset}.`); } return; }
        const data = await res.json() as PathQuote;
        if (!cancelled) { setPathQuote(data); setUsePathPayment(true); }
      } catch { if (!cancelled) { setPathQuote(null); setUsePathPayment(false); setPathQuoteError("Could not fetch path payment quote."); } }
      finally { if (!cancelled) setPathQuoteLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [payment, activeProvider, paymentId, sourceAsset, assetMetadata, walletPublicKey]);

  useEffect(() => {
    if (!isPayModalOpen) return;
    const controller = new AbortController();
    (async () => {
      setNetworkFeeLoading(true); setNetworkFeeError(null);
      try {
        const res = await fetch(`${API_URL}/api/network-fee`, { signal: controller.signal });
        if (!res.ok) throw new Error(t("networkFeeUnavailable"));
        const data = await res.json() as NetworkFeeResponse;
        setNetworkFee(data.network_fee);
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") return;
        setNetworkFee(null); setNetworkFeeError(t("networkFeeUnavailable"));
      } finally { setNetworkFeeLoading(false); }
    })();
    return () => controller.abort();
  }, [isPayModalOpen, t]);

  const handleConfirmPay = async () => {
    if (!payment) return;
    setIsPayModalOpen(false); setActionError(null);
    try {
      let result: { hash: string };
      if (usePathPayment && pathQuote) {
        result = await processPathPayment({ recipient: payment.recipient, destAmount: pathQuote.destination_amount, destAssetCode: pathQuote.destination_asset, destAssetIssuer: pathQuote.destination_asset_issuer, sendMax: pathQuote.send_max, sendAssetCode: pathQuote.source_asset, sendAssetIssuer: pathQuote.source_asset_issuer, path: pathQuote.path, memo: payment.memo, memoType: payment.memo_type });
      } else {
        result = await processPayment({ recipient: payment.recipient, amount: String(payment.amount), assetCode: payment.asset, assetIssuer: payment.asset_issuer, memo: payment.memo, memoType: payment.memo_type });
      }
      setPayment({ ...payment, status: "completed", tx_id: result.hash });
      toast.success(t("paymentSent"));
      setTimeout(async () => { try { await fetch(`${API_URL}/api/verify-payment/${paymentId}`, { method: "POST" }); } catch {} }, 2000);
    } catch {
      const msg = paymentError ?? t("paymentFailed");
      setActionError(msg); toast.error(msg);
    }
  };

  const handleDownloadReceipt = async () => {
    if (!payment) return;
    try {
      setIsDownloadingReceipt(true); setActionError(null);
      const blob = createReceiptPdf({ merchantName: branding?.merchant_name, paymentId: payment.id, amount: payment.amount.toLocaleString(locale, { minimumFractionDigits: 0, maximumFractionDigits: 7 }), asset: payment.asset.toUpperCase(), status: t(`status.${payment.status.toLowerCase()}`), date: new Date(payment.created_at).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" }), recipient: payment.recipient, transactionHash: payment.tx_id ?? t("receiptHashUnavailable"), description: payment.description });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = buildReceiptFilename(payment.id);
      document.body.appendChild(a); a.click(); a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(t("receiptDownloaded"));
    } catch { const msg = t("receiptDownloadFailed"); setActionError(msg); toast.error(msg); }
    finally { setIsDownloadingReceipt(false); }
  };

  if (loading) return <LoadingSkeleton />;

  if (fetchError || !payment) {
    return (
      <main className="h-screen bg-white flex items-center justify-center px-4">
        <div className="max-w-sm w-full rounded-2xl border border-[#E8E8E8] p-10 text-center flex flex-col gap-4">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-50 border border-red-200">
            <svg className="h-6 w-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>
          </div>
          <h1 className="text-lg font-bold text-[#0A0A0A]">{fetchError ?? t("paymentNotFound")}</h1>
          <p className="text-sm text-[#6B6B6B]">{t("errorDescription")}</p>
        </div>
      </main>
    );
  }

  const isSettled = payment.status === "confirmed" || payment.status === "completed";
  const isFailed = payment.status === "failed";
  const paymentIntentUri = buildSep7Uri(payment);
  const branding = resolveBranding(payment.branding_config || {});
  const assetMeta = assetMetadata.find(a => a.code === payment.asset.toUpperCase());

  return (
    <>
      {showConfetti && <div className="pointer-events-none fixed inset-0 z-50"><Confetti recycle={false} numberOfPieces={350} /></div>}

      {isProcessing && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-white/95 backdrop-blur-sm">
          <Spinner size="xl" />
          <div className="flex flex-col items-center gap-1 text-center">
            <p className="text-sm font-bold text-[#0A0A0A]">{txStatus ?? t("processingFallback")}</p>
            <p className="text-xs text-[#6B6B6B]">{t("doNotClose")}</p>
          </div>
        </div>
      )}

      <main className="h-screen bg-white overflow-hidden flex items-center justify-center px-4">
        <div className="w-full max-w-sm flex flex-col h-full max-h-screen py-6 gap-4">

          {/* Header */}
          <div className="shrink-0 flex items-center justify-between">
            <div className="flex flex-col gap-0.5">
              {branding.logo_url ? (
                <Image src={branding.logo_url} alt={branding.logo_alt ?? branding.merchant_name ?? "PLUTO"} width={120} height={24} className="h-6 w-auto max-w-[120px] object-contain" referrerPolicy="no-referrer" />
              ) : (
                <span className="text-xs font-bold uppercase tracking-[0.3em] text-[#0A0A0A]">{branding.merchant_name ?? "PLUTO"}</span>
              )}
              <p className="text-[10px] text-[#6B6B6B] font-medium">{t("paymentRequest")}</p>
            </div>
            {activeViewers > 1 && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-orange-200 bg-orange-50 px-2.5 py-1 text-[10px] font-bold text-orange-600">
                <span className="relative flex h-1.5 w-1.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-400/75" /><span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-orange-400" /></span>
                {t("activeViewers", { count: activeViewers })}
              </span>
            )}
          </div>

          {/* Card */}
          <div className="flex-1 min-h-0 rounded-2xl border border-[#E8E8E8] bg-white shadow-[0_4px_24px_rgba(0,0,0,0.06)] overflow-hidden flex flex-col">

            {/* Compact amount strip — ~25% of card */}
            <div className="shrink-0 flex items-center gap-4 px-6 py-5 border-b border-[#E8E8E8] bg-[#F9F9F9]">
              <AssetIcon asset={payment.asset} logo={assetMeta?.logo} name={assetMeta?.name} />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-3xl font-bold tracking-tight text-[#0A0A0A]">
                    {payment.amount.toLocaleString(locale, { minimumFractionDigits: 0, maximumFractionDigits: 7 })}
                  </span>
                  <span className="text-base font-bold text-[#6B6B6B]">{payment.asset.toUpperCase()}</span>
                </div>
                {payment.description && <p className="text-xs text-[#6B6B6B] truncate mt-0.5">{payment.description}</p>}
              </div>
              <StatusPill status={payment.status} t={t} />
            </div>

            {/* Scrollable body */}
            <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-5 p-6">

              <DetailRow label={t("recipient")}>
                <div className="flex items-center gap-2 rounded-xl border border-[#E8E8E8] bg-[#F9F9F9] px-4 py-3">
                  <code className="flex-1 truncate font-mono text-xs text-[#0A0A0A]">{payment.recipient}</code>
                  <CopyButton text={payment.recipient} />
                </div>
              </DetailRow>

              <DetailRow label={t("created")}>
                <p className="text-sm font-medium text-[#0A0A0A]">
                  {new Date(payment.created_at).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })}
                </p>
              </DetailRow>

              {payment.tx_id && (
                <DetailRow label={t("transaction")}>
                  <div className="flex items-center gap-2 rounded-xl border border-[#E8E8E8] bg-[#F9F9F9] px-4 py-3">
                    <a href={`${EXPLORER_BASE}/tx/${payment.tx_id}`} target="_blank" rel="noopener noreferrer"
                      className="flex-1 truncate font-mono text-xs text-[#0A0A0A] underline underline-offset-2 hover:text-[#6B6B6B] transition-colors">
                      {payment.tx_id}
                    </a>
                    <CopyButton text={payment.tx_id} />
                  </div>
                </DetailRow>
              )}

              {!isSettled && !isFailed && (
                <DetailRow label={t("scanToPay")}>
                  <div className="flex items-center gap-4 rounded-xl border border-[#E8E8E8] bg-[#F9F9F9] p-4">
                    <div className="rounded-lg border border-[#E8E8E8] bg-white p-2 shrink-0">
                      <QRCodeSVG value={paymentIntentUri} size={72} level="M" bgColor="#ffffff" fgColor="#0A0A0A" />
                    </div>
                    <div className="flex flex-col gap-2">
                      <p className="text-xs text-[#6B6B6B]">{t("scanDescription")}</p>
                      <button type="button" onClick={() => setShowQrModal(true)}
                        className="self-start rounded-lg border border-[#E8E8E8] bg-white px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-[#0A0A0A] hover:bg-[#F5F5F5] transition-colors">
                        {t("openQrModal")}
                      </button>
                    </div>
                  </div>
                </DetailRow>
              )}

              {actionError && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{actionError}</div>
              )}

              {/* CTA */}
              {!isSettled && !isFailed && (
                <div className="flex flex-col gap-3">
                  <div className="rounded-xl border border-[#E8E8E8] bg-[#F9F9F9] p-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B] mb-2">
                      {t("completePayment")}
                    </p>
                    <p className="text-sm text-[#6B6B6B]">
                      {payment.description ?? t("paymentRequest")}
                    </p>
                  </div>
                  {activeProvider ? (
                    <>
                      <p className="text-center text-[10px] text-[#6B6B6B] font-medium">{t("connectedVia", { provider: activeProvider.name ?? "" })}</p>

                      {sortedSourceAssets.length > 0 && (
                        <div className="flex flex-col gap-1.5">
                          <label className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]">Payment Asset</label>
                          <div className="relative">
                            <select value={sourceAsset} onChange={(e) => setSourceAsset(e.target.value)}
                              className="w-full appearance-none rounded-xl border border-[#E8E8E8] bg-[#F9F9F9] px-4 py-3 text-sm font-medium text-[#0A0A0A] focus:border-[#0A0A0A] focus:outline-none transition-colors">
                              {sortedSourceAssets.map(code => (
                                <option key={code} value={code}>{code} — {parseFloat(walletBalances.find(b => b.code === code)?.balance || "0").toFixed(2)}</option>
                              ))}
                            </select>
                            <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[#6B6B6B]">
                              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                            </div>
                          </div>
                        </div>
                      )}

                      {pathQuoteLoading && <p className="text-center text-xs text-[#6B6B6B]">Checking payment routes…</p>}
                      {pathQuoteError && <p className="text-center text-xs text-red-500">{pathQuoteError}</p>}
                      {pathQuote && !pathQuoteLoading && sourceAsset !== payment.asset.toUpperCase() && (
                        <div className="rounded-xl border border-[#E8E8E8] bg-[#F9F9F9] p-4 flex flex-col gap-3">
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B] mb-1">{t("approximateCostLabel")}</p>
                            <p className="text-xl font-bold text-[#0A0A0A]">{Number(pathQuote.source_amount).toLocaleString(locale, { minimumFractionDigits: 0, maximumFractionDigits: 7 })} {pathQuote.source_asset}</p>
                            <p className="text-xs text-[#6B6B6B] mt-1">{t("approximateCostHelp", { amount: pathQuote.destination_amount, asset: pathQuote.destination_asset })}</p>
                          </div>
                          <label className="flex items-center gap-3 cursor-pointer select-none">
                            <input type="checkbox" checked={usePathPayment} onChange={(e) => setUsePathPayment(e.target.checked)} className="h-4 w-4 rounded border-[#E8E8E8] text-[#0A0A0A] focus:ring-[#0A0A0A]" />
                            <span className="text-sm text-[#0A0A0A]">Pay with <span className="font-bold">{pathQuote.send_max} {pathQuote.source_asset}</span></span>
                          </label>
                        </div>
                      )}

                      <button type="button" onClick={() => setIsPayModalOpen(true)} disabled={isProcessing}
                        className="flex h-13 w-full items-center justify-center gap-2 rounded-xl bg-[#0A0A0A] py-4 text-sm font-bold uppercase tracking-widest text-white shadow-lg shadow-black/10 hover:bg-black active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all">
                        {isProcessing ? (
                          <><svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>{t("processing")}</>
                        ) : usePathPayment && pathQuote ? `Pay ${pathQuote.send_max} ${pathQuote.source_asset}`
                          : activeProvider?.name ? t("payWith", { provider: activeProvider.name }) : t("payWithFallback")}
                      </button>

                      <button type="button" onClick={() => setIsCancelModalOpen(true)} className="text-center text-[10px] text-[#6B6B6B] hover:text-[#0A0A0A] transition-colors font-medium">
                        Cancel Payment
                      </button>
                    </>
                  ) : (
                    <WalletSelector networkPassphrase={process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015"} onConnected={() => {}} />
                  )}
                </div>
              )}

              {isSettled && (
                <div className="flex flex-col gap-3">
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-center flex flex-col items-center gap-2">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100">
                      <svg className="h-5 w-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                    </div>
                    <p className="text-sm font-bold text-emerald-800">{t("receivedTitle")}</p>
                    <p className="text-xs text-emerald-600">{t("receivedDescription")}</p>
                  </div>
                  <button type="button" onClick={handleDownloadReceipt} disabled={isDownloadingReceipt}
                    className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-[#E8E8E8] bg-white text-sm font-bold text-[#0A0A0A] hover:bg-[#F5F5F5] disabled:opacity-50 transition-all">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                    {isDownloadingReceipt ? t("downloadReceiptLoading") : t("downloadReceipt")}
                  </button>
                </div>
              )}

              {isFailed && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-center flex flex-col gap-2">
                  <p className="text-sm font-bold text-red-700">{t("failedTitle")}</p>
                  {payment.metadata?.failure_reason === "underpayment" ? (
                    <div className="flex flex-col gap-1">
                      <p className="text-xs text-red-600 font-medium">Underpayment detected</p>
                      <p className="text-xs text-red-500">
                        Expected <span className="font-bold">{payment.metadata.expected_amount} {payment.asset.toUpperCase()}</span>,
                        received <span className="font-bold">{payment.metadata.received_amount} {payment.asset.toUpperCase()}</span>.
                      </p>
                      <p className="text-xs text-red-500 mt-1">
                        Shortfall: <span className="font-bold">{payment.metadata.shortfall} {payment.asset.toUpperCase()}</span>
                      </p>
                      <p className="text-[10px] text-red-400 mt-2">Please contact the merchant to arrange a top-up or refund.</p>
                    </div>
                  ) : (
                    <p className="text-xs text-red-500">{t("failedDescription")}</p>
                  )}
                </div>
              )}
            </div>
          </div>

          <p className="shrink-0 text-center text-[10px] text-[#C0C0C0] font-medium">Powered by PLUTO · Stellar Network</p>
        </div>
      </main>

      <CheckoutQrModal isOpen={showQrModal} onClose={() => setShowQrModal(false)} qrValue={paymentIntentUri} paymentId={payment.id} />

      <Modal isOpen={isPayModalOpen} onClose={() => { if (!isProcessing) setIsPayModalOpen(false); }} title={t("reviewPaymentTitle")}>
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-[#E8E8E8] bg-[#F9F9F9] p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B] mb-2">{t("completePayment")}</p>
            <p className="text-3xl font-bold text-[#0A0A0A]">
              {usePathPayment && pathQuote ? `${pathQuote.send_max} ${pathQuote.source_asset}` : `${payment.amount.toLocaleString(locale, { minimumFractionDigits: 0, maximumFractionDigits: 7 })} ${payment.asset.toUpperCase()}`}
            </p>
            <p className="mt-3 text-sm text-[#6B6B6B]">
              {networkFeeLoading ? t("loadingNetworkFee") : networkFee ? t("networkFeeLabel", { amount: networkFee.xlm }) : networkFeeError ?? t("networkFeeUnavailable")}
            </p>
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={() => setIsPayModalOpen(false)} className="flex h-12 flex-1 items-center justify-center rounded-xl border border-[#E8E8E8] bg-white text-sm font-bold text-[#6B6B6B] hover:bg-[#F5F5F5] transition-all">{t("cancel")}</button>
            <button type="button" onClick={handleConfirmPay} disabled={isProcessing} className="flex h-12 flex-1 items-center justify-center rounded-xl bg-[#0A0A0A] text-sm font-bold text-white hover:bg-black disabled:opacity-50 transition-all">{t("confirmPayment")}</button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={isCancelModalOpen} onClose={() => setIsCancelModalOpen(false)} title="Cancel Payment">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-[#6B6B6B]">Are you sure you want to cancel this payment?</p>
          <div className="flex gap-3">
            <button type="button" onClick={() => setIsCancelModalOpen(false)} className="flex h-12 flex-1 items-center justify-center rounded-xl border border-[#E8E8E8] bg-white text-sm font-bold text-[#6B6B6B] hover:bg-[#F5F5F5] transition-all">No, go back</button>
            <button type="button" onClick={() => { setIsCancelModalOpen(false); router.push(`/pay/${paymentId}/cancelled`); }} className="flex h-12 flex-1 items-center justify-center rounded-xl border border-red-200 bg-red-50 text-sm font-bold text-red-600 hover:bg-red-100 transition-all">Yes, cancel</button>
          </div>
        </div>
      </Modal>
    </>
  );
}
