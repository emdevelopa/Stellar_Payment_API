"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { useParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useWallet } from "@/lib/wallet-context";
import { usePayment } from "@/lib/usePayment";
import { useAssetMetadata } from "@/lib/useAssetMetadata";
import CopyButton from "@/components/CopyButton";
import WalletSelector from "@/components/WalletSelector";
import toast from "react-hot-toast";
import Skeleton, { SkeletonTheme } from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";
import { QRCodeSVG } from "qrcode.react";
import { localeToLanguageTag } from "@/i18n/config";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

// Use Stellar.expert as the block explorer (Horizon is an API, not an explorer).
// Defaults to testnet; set NEXT_PUBLIC_STELLAR_NETWORK=public for mainnet.
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
  memo?: string | null;
  memo_type?: string | null;
  status: string; // pending | confirmed | completed | failed
  tx_id: string | null;
  created_at: string;
  branding_config?: {
    primary_color?: string;
    secondary_color?: string;
    background_color?: string;
  } | null;
}

const DEFAULT_CHECKOUT_THEME = {
  primary_color: "#5ef2c0",
  secondary_color: "#b8ffe2",
  background_color: "#050608",
};

// ─── Asset badge ────────────────────────────────────────────────────────────

function AssetBadge({
  asset,
  logo,
  name,
}: {
  asset: string;
  logo?: string | null;
  name?: string | null;
}) {
  const a = asset.toUpperCase();

  if (logo) {
    return (
      <span
        aria-hidden="true"
        className="inline-flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-white/10 shadow-[0_0_0_1px_rgba(255,255,255,0.08)]"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo} alt={name ?? asset} className="h-8 w-8 object-contain" />
      </span>
    );
  }

  if (a === "XLM" || a === "NATIVE") {
    return (
      <span
        aria-hidden="true"
        className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-white/15 via-mint/20 to-mint/40 text-mint shadow-[0_0_0_1px_rgba(255,255,255,0.08)]"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8}>
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
        className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[#2775CA] text-[10px] font-bold tracking-[0.18em] text-white shadow-[0_0_0_1px_rgba(255,255,255,0.08)]"
      >
        USDC
      </span>
    );
  }
  return (
    <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-white/10 text-xs font-bold text-white">
      {asset.slice(0, 3)}
    </span>
  );
}

// ─── Status badge ────────────────────────────────────────────────────────────

function StatusBadge({
  status,
  t,
}: {
  status: string;
  t: ReturnType<typeof useTranslations>;
}) {
  const statusMap: Record<string, { label: string; classes: string }> = {
    pending:   { label: t("status.pending"), classes: "bg-yellow-500/15 text-yellow-400 border border-yellow-500/30" },
    confirmed: { label: t("status.confirmed"), classes: "bg-mint/10 text-mint border border-mint/30" },
    completed: { label: t("status.completed"), classes: "bg-green-500/15 text-green-400 border border-green-500/30" },
    failed:    { label: t("status.failed"), classes: "bg-red-500/15 text-red-400 border border-red-500/30" },
  };

  const s = statusMap[status.toLowerCase()] ?? {
    label: status,
    classes: "bg-white/10 text-slate-400 border border-white/10",
  };
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${s.classes}`}>
      {s.label}
    </span>
  );
}

function buildSep7Uri(payment: PaymentDetails) {
  const params = new URLSearchParams({
    destination: payment.recipient,
    amount: String(payment.amount),
    asset_code: payment.asset.toUpperCase(),
  });

  if (payment.asset_issuer) {
    params.set("asset_issuer", payment.asset_issuer);
  }
  if (payment.memo) {
    params.set("memo", payment.memo);
  }
  if (payment.memo_type) {
    params.set("memo_type", payment.memo_type);
  }

  return `web+stellar:pay?${params.toString()}`;
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

/**
 * Mirrors the layout of the real payment card so there is no layout shift
 * once data loads. Themed to match the dark design system.
 */
function LoadingSkeleton() {
  return (
    <SkeletonTheme baseColor="#151d2e" highlightColor="#1f2d44">
      <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-8 px-6 py-16">
        {/* Header */}
        <header className="flex flex-col gap-2">
          <Skeleton width={96} height={12} borderRadius={999} />
          <Skeleton width={220} height={36} borderRadius={10} />
          <Skeleton width={280} height={10} borderRadius={999} />
        </header>

        {/* Card */}
        <div className="rounded-3xl border border-white/10 bg-white/5 shadow-2xl backdrop-blur overflow-hidden">

          {/* Hero section */}
          <div className="flex flex-col items-center gap-3 border-b border-white/10 px-8 py-10">
            {/* Asset badge */}
            <Skeleton circle width={40} height={40} />
            {/* Amount */}
            <Skeleton width={200} height={52} borderRadius={10} />
            {/* Description line */}
            <Skeleton width={140} height={14} borderRadius={999} />
            {/* Status badge */}
            <Skeleton width={120} height={26} borderRadius={999} />
          </div>

          {/* Details section */}
          <div className="flex flex-col gap-5 p-8">
            {/* Recipient */}
            <div className="flex flex-col gap-1.5">
              <Skeleton width={72} height={10} borderRadius={999} />
              <Skeleton height={46} borderRadius={12} />
            </div>

            {/* Created date */}
            <div className="flex flex-col gap-1">
              <Skeleton width={56} height={10} borderRadius={999} />
              <Skeleton width={160} height={16} borderRadius={6} />
            </div>

            {/* CTA button */}
            <Skeleton height={48} borderRadius={12} className="mt-2" />
          </div>
        </div>
      </main>
    </SkeletonTheme>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PaymentPage() {
  const t = useTranslations("checkout");
  const locale = localeToLanguageTag(useLocale());
  const params = useParams();
  const paymentId = params.id as string;

  const [payment, setPayment] = useState<PaymentDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showRawIntent, setShowRawIntent] = useState(false);

  // Path payment state
  const [usePathPayment, setUsePathPayment] = useState(false);
  const [pathQuote, setPathQuote] = useState<{
    source_asset: string;
    source_asset_issuer: string | null;
    source_amount: string;
    send_max: string;
    destination_asset: string;
    destination_amount: string;
    path: Array<{ asset_code: string; asset_issuer: string | null }>;
    slippage: number;
  } | null>(null);
  const [pathQuoteLoading, setPathQuoteLoading] = useState(false);
  const [pathQuoteError, setPathQuoteError] = useState<string | null>(null);

  const { activeProvider } = useWallet();
  const { isProcessing, status: txStatus, error: paymentError, processPayment, processPathPayment } = usePayment(activeProvider);
  const { assets: assetMetadata } = useAssetMetadata();

  // ── Fetch payment details ──────────────────────────────────────────────────
  useEffect(() => {
    const controller = new AbortController();

    const load = async () => {
      try {
        const res = await fetch(`${API_URL}/api/payment-status/${paymentId}`, {
          signal: controller.signal,
        });
        if (res.status === 404) throw new Error(t("paymentMissing"));
        if (!res.ok) throw new Error(t("loadFailed"));
        const data = await res.json();
        setPayment(data.payment);
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") return;
        setFetchError(err instanceof Error ? err.message : t("loadPaymentFailed"));
      } finally {
        setLoading(false);
      }
    };

    load();
    return () => controller.abort();
  }, [paymentId, t]);

  // ── Poll until settled ─────────────────────────────────────────────────────
  useEffect(() => {
    if (loading || !payment) return;
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
  }, [paymentId, payment, loading]);

  // ── Fetch path payment quote when wallet is connected ────────────────────
  useEffect(() => {
    if (!payment || !activeProvider || payment.status !== "pending") return;

    let cancelled = false;
    (async () => {
      setPathQuoteLoading(true);
      setPathQuoteError(null);
      try {
        const pubKey = await activeProvider.getPublicKey();
        const qs = new URLSearchParams({
          source_asset: "XLM",
          source_asset_issuer: "",
          source_account: pubKey,
        });
        const res = await fetch(
          `${API_URL}/api/path-payment-quote/${paymentId}?${qs}`,
        );
        if (!res.ok) {
          setPathQuote(null);
          return;
        }
        const data = await res.json();
        if (!cancelled) setPathQuote(data);
      } catch {
        if (!cancelled) setPathQuoteError("Could not fetch path payment quote.");
      } finally {
        if (!cancelled) setPathQuoteLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [payment, activeProvider, paymentId]);

  // ── Pay handler ───────────────────────────────────────────────────────────
  const handlePay = async () => {
    if (!payment) return;
    setActionError(null);

    try {
      let result: { hash: string };

      if (usePathPayment && pathQuote) {
        result = await processPathPayment({
          recipient: payment.recipient,
          destAmount: pathQuote.destination_amount,
          destAssetCode: pathQuote.destination_asset,
          destAssetIssuer: payment.asset_issuer,
          sendMax: pathQuote.send_max,
          sendAssetCode: pathQuote.source_asset,
          sendAssetIssuer: pathQuote.source_asset_issuer,
          path: pathQuote.path,
        });
      } else {
        result = await processPayment({
          recipient: payment.recipient,
          amount: String(payment.amount),
          assetCode: payment.asset,
          assetIssuer: payment.asset_issuer,
        });
      }

      setPayment({ ...payment, status: "completed", tx_id: result.hash });
      toast.success(t("paymentSent"));

      // Best-effort backend verification
      setTimeout(async () => {
        try {
          await fetch(`${API_URL}/api/verify-payment/${paymentId}`, { method: "POST" });
        } catch { /* non-critical */ }
      }, 2000);
    } catch {
      const msg = paymentError ?? t("paymentFailed");
      setActionError(msg);
      toast.error(msg);
    }
  };

  // ── Early returns ──────────────────────────────────────────────────────────
  if (loading) return <LoadingSkeleton />;

  if (fetchError || !payment) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-6 px-6 py-16">
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-8 text-center">
          <p className="text-sm font-medium uppercase tracking-wider text-red-400">{t("errorTitle")}</p>
          <h1 className="mt-3 text-lg font-semibold text-white">
            {fetchError ?? t("paymentNotFound")}
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            {t("errorDescription")}
          </p>
        </div>
      </main>
    );
  }

  const isSettled = payment.status === "confirmed" || payment.status === "completed";
  const isFailed  = payment.status === "failed";
  const checkoutTheme = {
    ...DEFAULT_CHECKOUT_THEME,
    ...(payment.branding_config || {}),
  };

  return (
    <>
      {/* ── Full-screen processing overlay ── */}
      {isProcessing && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-black/85 backdrop-blur-sm">
          <div className="h-14 w-14 animate-spin rounded-full border-4 border-white/15 border-t-mint" />
          <div className="flex flex-col items-center gap-1 text-center">
            <p className="text-base font-semibold text-white">
              {txStatus ?? t("processingFallback")}
            </p>
            <p className="text-sm text-slate-400">{t("doNotClose")}</p>
          </div>
        </div>
      )}

      <main
        className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-8 px-6 py-16"
        style={
          {
            "--checkout-primary": checkoutTheme.primary_color,
            "--checkout-secondary": checkoutTheme.secondary_color,
            "--checkout-bg": checkoutTheme.background_color,
            background:
              "radial-gradient(1200px circle at 10% -10%, color-mix(in srgb, var(--checkout-primary) 18%, #15233b) 0%, var(--checkout-bg) 45%, #050608 100%)",
          } as CSSProperties
        }
      >
        {/* ── Page header ── */}
        <header className="flex flex-col gap-2">
          <p className="font-mono text-xs uppercase tracking-[0.3em]" style={{ color: "var(--checkout-primary)" }}>
            {t("paymentRequest")}
          </p>
          <h1 className="text-3xl font-bold text-white">{t("completePayment")}</h1>
          <p className="font-mono text-xs text-slate-500 break-all">
            ID: {payment.id}
          </p>
        </header>

        {/* ── Main card ── */}
        <div className="rounded-3xl border border-white/10 bg-white/5 shadow-2xl backdrop-blur">

          {/* Amount hero */}
          <div className="flex flex-col items-center gap-3 border-b border-white/10 px-8 py-10">
            <AssetBadge
              asset={payment.asset}
              logo={assetMetadata.find((a) => a.code === payment.asset.toUpperCase())?.logo}
              name={assetMetadata.find((a) => a.code === payment.asset.toUpperCase())?.name}
            />
            <div className="flex items-baseline gap-2">
              <span className="text-5xl font-bold tracking-tight text-white">
                {payment.amount.toLocaleString(locale, {
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 7,
                })}
              </span>
              <span className="text-2xl font-semibold" style={{ color: "var(--checkout-secondary)" }}>
                {payment.asset.toUpperCase()}
              </span>
            </div>
            {payment.description && (
              <p className="mt-1 text-sm text-slate-400">{payment.description}</p>
            )}
            <StatusBadge status={payment.status} t={t} />
          </div>

          {/* Details */}
          <div className="flex flex-col gap-5 p-8">

      {/* Recipient */}
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
          {t("recipient")}
        </p>
        <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 p-3">
          <code className="flex-1 truncate font-mono text-sm text-slate-200">
            {payment.recipient}
          </code>
          <CopyButton text={payment.recipient} />
        </div>
      </div>

      {/* QR Code */}
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
          {t("scanToPay")}
        </p>
        <div className="flex items-center justify-center rounded-xl border border-white/10 bg-white p-4">
          <QRCodeSVG
            value={payment.recipient}
            size={160}
            level="M"
            bgColor="#ffffff"
            fgColor="#000000"
          />
        </div>
        <p className="text-center text-xs text-slate-500">
          {t("scanDescription")}
        </p>
        <div className="sm:hidden">
          {/* Mobile-only SEP-0007 fallback for manual wallet paste */}
          <button
            type="button"
            onClick={() => setShowRawIntent((prev) => !prev)}
            className="mx-auto mt-2 text-xs font-medium text-mint transition-colors hover:text-glow"
          >
            {showRawIntent ? t("hideRawIntent") : t("viewRawIntent")}
          </button>
          {showRawIntent && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-white/10 bg-black/40 p-3">
              <code className="flex-1 break-all font-mono text-[11px] text-slate-200">
                {buildSep7Uri(payment)}
              </code>
              <CopyButton text={buildSep7Uri(payment)} className="mt-0.5" />
            </div>
          )}
        </div>
      </div>

            {/* Date */}
            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                {t("created")}
              </p>
              <p className="text-sm text-slate-300">
                {new Date(payment.created_at).toLocaleString(locale, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </p>
            </div>

            {/* Transaction hash (after payment) */}
            {payment.tx_id && (
              <div className="flex flex-col gap-1.5">
                <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                  {t("transaction")}
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

            {/* ── CTA section ── */}
            {!isSettled && !isFailed && (
              <div className="flex flex-col gap-3 pt-2">
                {activeProvider ? (
                  <>
                    <p className="text-center text-xs text-slate-500">
                      {t("connectedVia", { provider: activeProvider?.name ?? "" })}
                    </p>
                    {/* Path payment toggle */}
                    {pathQuote && !pathQuoteLoading && (
                      <label className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/30 px-4 py-3 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={usePathPayment}
                          onChange={(e) => setUsePathPayment(e.target.checked)}
                          className="h-4 w-4 accent-[var(--checkout-primary)]"
                        />
                        <span className="text-sm text-slate-300">
                          Pay with <span className="font-semibold text-white">{pathQuote.send_max} {pathQuote.source_asset}</span> instead
                        </span>
                      </label>
                    )}
                    {pathQuoteLoading && (
                      <p className="text-center text-xs text-slate-500">Checking alternative payment paths…</p>
                    )}
                    {pathQuoteError && (
                      <p className="text-center text-xs text-red-400">{pathQuoteError}</p>
                    )}
                    <button
                      type="button"
                      onClick={handlePay}
                      disabled={isProcessing}
                      className="group relative flex h-12 w-full items-center justify-center rounded-xl font-bold text-black transition-all disabled:cursor-not-allowed disabled:opacity-50"
                      style={{
                        backgroundColor: "var(--checkout-primary)",
                      }}
                    >
                      {isProcessing ? (
                        <span className="flex items-center gap-2">
                          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          {t("processing")}
                        </span>
                      ) : usePathPayment && pathQuote ? (
                        `Pay ${pathQuote.send_max} ${pathQuote.source_asset}`
                      ) : (
                        activeProvider?.name
                          ? t("payWith", { provider: activeProvider.name })
                          : t("payWithFallback")
                      )}
                      <div
                        className="absolute inset-0 -z-10 opacity-0 blur-xl transition-opacity group-hover:opacity-100"
                        style={{ backgroundColor: "color-mix(in srgb, var(--checkout-primary) 20%, transparent)" }}
                      />
                    </button>
                  </>
                ) : (
                  <WalletSelector
                    networkPassphrase={
                      process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ??
                      "Test SDF Network ; September 2015"
                    }
                    onConnected={() => {}}
                  />
                )}
              </div>
            )}

            {/* Settled success note */}
            {isSettled && (
              <div
                className="rounded-xl border p-4 text-center"
                style={{
                  borderColor: "color-mix(in srgb, var(--checkout-primary) 30%, transparent)",
                  backgroundColor: "color-mix(in srgb, var(--checkout-primary) 7%, transparent)",
                }}
              >
                <p className="text-sm font-semibold" style={{ color: "var(--checkout-primary)" }}>
                  {t("receivedTitle")}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  {t("receivedDescription")}
                </p>
              </div>
            )}

            {/* Failed note */}
            {isFailed && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-center">
                <p className="text-sm font-semibold text-red-400">
                  {t("failedTitle")}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {t("failedDescription")}
                </p>
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  );
}