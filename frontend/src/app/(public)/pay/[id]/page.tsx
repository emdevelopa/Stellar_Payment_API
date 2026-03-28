"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { useParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useWallet } from "@/lib/wallet-context";
import { Spinner } from "@/components/ui/Spinner";
import { usePayment } from "@/lib/usePayment";
import { useAssetMetadata } from "@/lib/useAssetMetadata";
import { createReceiptPdf } from "@/lib/receipt-pdf";
import CheckoutQrModal from "@/components/CheckoutQrModal";
import CopyButton from "@/components/CopyButton";
import WalletSelector from "@/components/WalletSelector";
import toast from "react-hot-toast";
import Skeleton, { SkeletonTheme } from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";
import { QRCodeSVG } from "qrcode.react";
import { localeToLanguageTag } from "@/i18n/config";
import Confetti from "react-confetti";
import { useCheckoutPresence } from "@/lib/useCheckoutPresence";

function ActiveViewersBadge({
  activeViewers,
  t,
}: {
  activeViewers: number;
  t: ReturnType<typeof useTranslations>;
}) {
  if (activeViewers <= 1) return null;

  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-orange-400/25 bg-orange-400/10 px-3 py-1.5 text-xs font-medium text-orange-200">
      <span className="relative flex h-2.5 w-2.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-300/75" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-orange-300" />
      </span>
      {t("activeViewers", { count: activeViewers })}
    </div>
  );
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

// Use Stellar.Expert as the block explorer (Horizon is an API, not an explorer).
// Defaults to testnet; set NEXT_PUBLIC_STELLAR_NETWORK=public for mainnet.
const NETWORK = process.env.NEXT_PUBLIC_STELLAR_NETWORK ?? "testnet";
const EXPLORER_BASE =
  NETWORK === "public"
    ? "https://stellar.expert/explorer/public"
    : "https://stellar.expert/explorer/testnet";

// ─── Types ───────────────────────────────────────────────────────────────────

interface BrandingConfig {
  primary_color?: string;
  secondary_color?: string;
  background_color?: string;
  /**
   * Absolute URL to the merchant's logo image.
   * Displayed in the checkout header in place of the generic payment label.
   * Recommended size: at least 120 × 40 px; any standard web format accepted.
   */
  logo_url?: string | null;
  /**
   * Alt text for the logo image (accessibility + SEO).
   * Falls back to the generic "Payment Request" heading when absent.
   */
  logo_alt?: string | null;
  /**
   * Optional display name shown beneath the logo (e.g. "Acme Store").
   * When omitted the generic heading is used.
   */
  merchant_name?: string | null;
}

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
  branding_config?: BrandingConfig | null;
}

interface PathQuote {
  source_asset: string;
  source_asset_issuer: string | null;
  source_amount: string;
  send_max: string;
  destination_asset: string;
  destination_asset_issuer: string | null;
  destination_amount: string;
  path: Array<{ asset_code: string; asset_issuer: string | null }>;
  slippage: number;
}

// ─── Branding defaults ───────────────────────────────────────────────────────

const DEFAULT_CHECKOUT_THEME: Required<
  Pick<BrandingConfig, "primary_color" | "secondary_color" | "background_color">
> = {
  primary_color: "#5ef2c0",
  secondary_color: "#b8ffe2",
  background_color: "#050608",
};

/**
 * Merge merchant branding with safe defaults.
 * Only well-formed values from the backend override defaults.
 */
function resolveBranding(
  config: BrandingConfig | null | undefined,
): BrandingConfig & typeof DEFAULT_CHECKOUT_THEME {
  return {
    ...DEFAULT_CHECKOUT_THEME,
    logo_url: null,
    logo_alt: null,
    merchant_name: null,
    ...(config ?? {}),
  };
}

// ─── CSS variables helper ────────────────────────────────────────────────────

/**
 * Build the inline `style` object that injects merchant colors as CSS custom
 * properties.  Every themed element downstream reads from these variables so a
 * single application point drives the entire page palette.
 */
function buildThemeStyle(
  branding: ReturnType<typeof resolveBranding>,
): CSSProperties {
  return {
    "--checkout-primary": branding.primary_color,
    "--checkout-secondary": branding.secondary_color,
    "--checkout-bg": branding.background_color,
    // Derived tokens — computed once, re-used everywhere
    "--checkout-primary-glow": `color-mix(in srgb, var(--checkout-primary) 20%, transparent)`,
    "--checkout-primary-subtle": `color-mix(in srgb, var(--checkout-primary) 7%, transparent)`,
    "--checkout-primary-border": `color-mix(in srgb, var(--checkout-primary) 30%, transparent)`,
    background:
      "radial-gradient(1200px circle at 10% -10%, color-mix(in srgb, var(--checkout-primary) 18%, #15233b) 0%, var(--checkout-bg) 45%, #050608 100%)",
  } as CSSProperties;
}

// ─── Merchant logo / header ───────────────────────────────────────────────────

interface MerchantHeaderProps {
  branding: ReturnType<typeof resolveBranding>;
  paymentId: string;
  t: ReturnType<typeof useTranslations>;
}

/**
 * Renders the top-of-page header section.
 *
 * Priority order:
 *  1. Logo image (with optional merchant name beneath)
 *  2. Merchant name only (text fallback)
 *  3. Generic "Payment Request" label
 */
function MerchantHeader({ branding, paymentId, t }: MerchantHeaderProps) {
  const [logoError, setLogoError] = useState(false);

  const showLogo = Boolean(branding.logo_url) && !logoError;
  const altText =
    branding.logo_alt ?? branding.merchant_name ?? t("paymentRequest");

  return (
    <header className="flex flex-col gap-2">
      {showLogo ? (
        <div className="flex flex-col gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={branding.logo_url!}
            alt={altText}
            onError={() => setLogoError(true)}
            className="h-10 w-auto max-w-[180px] object-contain"
            // It seems you&apos;re currently offline. Please check your connection and
            // Prevent referrer leakage to third-party image hosts
            referrerPolicy="no-referrer"
          />
          {branding.merchant_name && (
            <p
              className="text-xs font-semibold uppercase tracking-[0.25em]"
              style={{ color: "var(--checkout-primary)" }}
            >
              {branding.merchant_name}
            </p>
          )}
        </div>
      ) : (
        <p
          className="font-mono text-xs uppercase tracking-[0.3em]"
          style={{ color: "var(--checkout-primary)" }}
        >
          {branding.merchant_name ?? t("paymentRequest")}
        </p>
      )}

      <h1 className="text-3xl font-bold text-white">{t("completePayment")}</h1>
      <p className="font-mono text-xs text-slate-500 break-all">
        ID: {paymentId}
      </p>
    </header>
  );
}

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
        <img
          src={logo}
          alt={name ?? asset}
          className="h-8 w-8 object-contain"
        />
      </span>
    );
  }

  if (a === "XLM" || a === "NATIVE") {
    return (
      <span
        aria-hidden="true"
        className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-white/15 via-mint/20 to-mint/40 text-mint shadow-[0_0_0_1px_rgba(255,255,255,0.08)]"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
        >
          <path
            d="M14.5 3.5 9 9l4.5.5L13 14l5.5-5.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
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
    pending: {
      label: t("status.pending"),
      classes: "bg-yellow-500/15 text-yellow-400 border border-yellow-500/30",
    },
    confirmed: {
      label: t("status.confirmed"),
      classes: "bg-mint/10 text-mint border border-mint/30",
    },
    completed: {
      label: t("status.completed"),
      classes: "bg-green-500/15 text-green-400 border border-green-500/30",
    },
    failed: {
      label: t("status.failed"),
      classes: "bg-red-500/15 text-red-400 border border-red-500/30",
    },
  };

  const s = statusMap[status.toLowerCase()] ?? {
    label: status,
    classes: "bg-white/10 text-slate-400 border border-white/10",
  };
  return (
    <span
      className={`rounded-full px-3  py-1 text-xs font-semibold ${s.classes}`}
    >
      {s.label}
    </span>
  );
}

// ─── SEP-0007 URI builder ────────────────────────────────────────────────────

function buildSep7Uri(payment: PaymentDetails) {
  const params = new URLSearchParams({
    destination: payment.recipient,
    amount: String(payment.amount),
    asset_code: payment.asset.toUpperCase(),
  });

  if (payment.asset_issuer) params.set("asset_issuer", payment.asset_issuer);
  if (payment.memo) params.set("memo", payment.memo);
  if (payment.memo_type) params.set("memo_type", payment.memo_type);

  return `web+stellar:pay?${params.toString()}`;
}

function buildReceiptFilename(paymentId: string) {
  return `receipt-${paymentId.replace(/[^a-zA-Z0-9_-]/g, "-")}.pdf`;
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <SkeletonTheme baseColor="#151d2e" highlightColor="#1f2d44">
      <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-8 px-6 py-16">
        {/* Header — includes logo placeholder */}
        <header className="flex flex-col gap-2">
          <Skeleton width={120} height={40} borderRadius={8} /> {/* logo */}
          <Skeleton width={220} height={36} borderRadius={10} />
          <Skeleton width={280} height={10} borderRadius={999} />
        </header>

        {/* Card */}
        <div className="rounded-3xl border border-white/10 bg-white/5 shadow-2xl backdrop-blur overflow-hidden">
          <div className="flex flex-col items-center gap-3 border-b border-white/10 px-8 py-10">
            <Skeleton circle width={40} height={40} />
            <Skeleton width={200} height={52} borderRadius={10} />
            <Skeleton width={140} height={14} borderRadius={999} />
            <Skeleton width={120} height={26} borderRadius={999} />
          </div>

          <div className="flex flex-col gap-5 p-8">
            <div className="flex flex-col gap-1.5">
              <Skeleton width={72} height={10} borderRadius={999} />
              <Skeleton height={46} borderRadius={12} />
            </div>
            <div className="flex flex-col gap-1">
              <Skeleton width={56} height={10} borderRadius={999} />
              <Skeleton width={160} height={16} borderRadius={6} />
            </div>
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
  const [showQrModal, setShowQrModal] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [isDownloadingReceipt, setIsDownloadingReceipt] = useState(false);

  useEffect(() => {
    if (
      payment &&
      (payment.status === "confirmed" || payment.status === "completed")
    ) {
      setShowConfetti(true);
    }
  }, [payment]);

  // Path payment state
  const [usePathPayment, setUsePathPayment] = useState(false);
  const [pathQuote, setPathQuote] = useState<PathQuote | null>(null);
  const [pathQuoteLoading, setPathQuoteLoading] = useState(false);
  const [pathQuoteError, setPathQuoteError] = useState<string | null>(null);

  const { activeProvider } = useWallet();
  const {
    isProcessing,
    status: txStatus,
    error: paymentError,
    processPayment,
    processPathPayment,
  } = usePayment(activeProvider);

  const { assets: assetMetadata } = useAssetMetadata();
  const activeViewers = useCheckoutPresence(paymentId);

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
        setFetchError(
          err instanceof Error ? err.message : t("loadPaymentFailed"),
        );
      } finally {
        setLoading(false);
      }
    };

    load();
    return () => controller.abort();
  }, [paymentId, t]);

  // ── Real-time status updates via SSE ──────────────────────────────────────
  useEffect(() => {
    if (loading || !payment) return;
    const settled = ["confirmed", "completed", "failed"].includes(
      payment.status,
    );
    if (settled) return;

    const eventSource = new EventSource(`${API_URL}/api/stream/${paymentId}`);

    eventSource.addEventListener("payment.confirmed", (event) => {
      try {
        const data = JSON.parse(event.data);
        setPayment((prev) =>
          prev ? { ...prev, status: data.status, tx_id: data.tx_id } : null,
        );
        toast.success(t("paymentConfirmed") || "Payment confirmed!");
        eventSource.close();
      } catch (err) {
        console.error("Failed to parse SSE message", err);
      }
    });

    eventSource.onerror = () => {
      console.warn("SSE connection failed, falling back to polling.");
      eventSource.close();
    };

    return () => eventSource.close();
  }, [paymentId, payment, loading, t]);

  // ── Polling fallback (only if not confirmed) ──────────────────────────────
  useEffect(() => {
    if (loading || !payment) return;
    const settled = ["confirmed", "completed", "failed"].includes(
      payment.status,
    );
    if (settled) return;

    // Use a longer interval for polling fallback (e.g., 10s)
    const id = setInterval(async () => {
      try {
        const res = await fetch(`${API_URL}/api/payment-status/${paymentId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.payment && data.payment.status !== payment.status) {
          setPayment(data.payment);
        }
      } catch {
        /* silent — retry next tick */
      }
    }, 10000);

    return () => clearInterval(id);
  }, [paymentId, payment, loading]);

  // ── Fetch path payment quote when wallet is connected ────────────────────
  useEffect(() => {
    if (!payment || !activeProvider || payment.status !== "pending") {
      setPathQuote(null);
      setPathQuoteError(null);
      setPathQuoteLoading(false);
      setUsePathPayment(false);
      return;
    }

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
          if (!cancelled) {
            setPathQuote(null);
            setUsePathPayment(false);
          }
          return;
        }
        const data = (await res.json()) as PathQuote;
        if (!cancelled) {
          setPathQuote(data);
          setUsePathPayment(true);
        }
      } catch {
        if (!cancelled) {
          setPathQuote(null);
          setUsePathPayment(false);
          setPathQuoteError("Could not fetch path payment quote.");
        }
      } finally {
        if (!cancelled) setPathQuoteLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
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
          destAssetIssuer: pathQuote.destination_asset_issuer,
          sendMax: pathQuote.send_max,
          sendAssetCode: pathQuote.source_asset,
          sendAssetIssuer: pathQuote.source_asset_issuer,
          path: pathQuote.path,
          memo: payment.memo,
          memoType: payment.memo_type,
        });
      } else {
        result = await processPayment({
          recipient: payment.recipient,
          amount: String(payment.amount),
          assetCode: payment.asset,
          assetIssuer: payment.asset_issuer,
          memo: payment.memo,
          memoType: payment.memo_type,
        });
      }

      setPayment({ ...payment, status: "completed", tx_id: result.hash });
      toast.success(t("paymentSent"));

      // Best-effort backend verification
      setTimeout(async () => {
        try {
          await fetch(`${API_URL}/api/verify-payment/${paymentId}`, {
            method: "POST",
          });
        } catch {
          /* non-critical */
        }
      }, 2000);
    } catch {
      const msg = paymentError ?? t("paymentFailed");
      setActionError(msg);
      toast.error(msg);
    }
  };

  const handleDownloadReceipt = async () => {
    if (!payment) return;

    try {
      setIsDownloadingReceipt(true);
      setActionError(null);

      const blob = createReceiptPdf({
        merchantName: branding.merchant_name,
        paymentId: payment.id,
        amount: payment.amount.toLocaleString(locale, {
          minimumFractionDigits: 0,
          maximumFractionDigits: 7,
        }),
        asset: payment.asset.toUpperCase(),
        status: t(`status.${payment.status.toLowerCase()}`),
        date: new Date(payment.created_at).toLocaleString(locale, {
          dateStyle: "medium",
          timeStyle: "short",
        }),
        recipient: payment.recipient,
        transactionHash: payment.tx_id ?? t("receiptHashUnavailable"),
        description: payment.description,
      });

      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = buildReceiptFilename(payment.id);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      toast.success(t("receiptDownloaded"));
    } catch {
      const msg = t("receiptDownloadFailed");
      setActionError(msg);
      toast.error(msg);
    } finally {
      setIsDownloadingReceipt(false);
    }
  };

  // ── Early returns ──────────────────────────────────────────────────────────
  if (loading) return <LoadingSkeleton />;

  if (fetchError || !payment) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-6 px-6 py-16">
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-8 text-center">
          <p className="text-sm font-medium uppercase tracking-wider text-red-400">
            {t("errorTitle")}
          </p>
          <h1 className="mt-3 text-lg font-semibold text-white">
            {fetchError ?? t("paymentNotFound")}
          </h1>
          <p className="mt-2 text-sm text-slate-400">{t("errorDescription")}</p>
        </div>
      </main>
    );
  }

  const isSettled =
    payment.status === "confirmed" || payment.status === "completed";
  const isFailed = payment.status === "failed";
  const paymentIntentUri = buildSep7Uri(payment);

  // Resolve branding once — used by both the theme style and the header component
  const branding = resolveBranding(payment.branding_config || {});

  return (
    <>
      {showConfetti && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            zIndex: 100,
            pointerEvents: "none",
          }}
        >
          <Confetti recycle={false} numberOfPieces={400} />
        </div>
      )}
      {/* ── Full-screen processing overlay ── */}
      {isProcessing && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-black/85 backdrop-blur-sm">
          <Spinner size="xl" />
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
        style={buildThemeStyle(branding)}
      >
        {/* ── Page header — merchant logo / name ── */}
        <MerchantHeader branding={branding} paymentId={payment.id} t={t} />
        {payment.status === "pending" && (
          <ActiveViewersBadge activeViewers={activeViewers} t={t} />
        )}

        {/* ── Main card ── */}
        <div className="rounded-3xl border border-white/10 bg-white/5 shadow-2xl backdrop-blur">
          {/* Amount hero */}
          <div className="flex flex-col items-center gap-3 border-b border-white/10 px-8 py-10">
            <AssetBadge
              asset={payment.asset}
              logo={
                assetMetadata.find(
                  (a) => a.code === payment.asset.toUpperCase(),
                )?.logo
              }
              name={
                assetMetadata.find(
                  (a) => a.code === payment.asset.toUpperCase(),
                )?.name
              }
            />
            <div className="flex items-baseline gap-2">
              <span className="text-5xl font-bold tracking-tight text-white">
                {payment.amount.toLocaleString(locale, {
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 7,
                })}
              </span>
              <span
                className="text-2xl font-semibold"
                style={{ color: "var(--checkout-secondary)" }}
              >
                {payment.asset.toUpperCase()}
              </span>
            </div>
            {payment.description && (
              <p className="mt-1 text-sm text-slate-400">
                {payment.description}
              </p>
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
                  value={paymentIntentUri}
                  size={160}
                  level="M"
                  bgColor="#ffffff"
                  fgColor="#000000"
                />
              </div>
              <p className="text-center text-xs text-slate-500">
                {t("scanDescription")}
              </p>
              <button
                type="button"
                onClick={() => setShowQrModal(true)}
                className="inline-flex items-center justify-center gap-2 self-center rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-white/10 hover:text-white"
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4h6v6H4zm10 0h6v6h-6zM4 14h6v6H4zm12 3v3m0 0h3m-3 0h-3m3-6v-3m0 3h3m-9 6h6v-6h-6z"
                  />
                </svg>
                {t("openQrModal")}
              </button>
              <div className="sm:hidden">
                <button
                  type="button"
                  onClick={() => setShowRawIntent((prev) => !prev)}
                  className="mx-auto mt-2 text-xs font-medium transition-colors hover:text-glow"
                  style={{ color: "var(--checkout-primary)" }}
                >
                  {showRawIntent ? t("hideRawIntent") : t("viewRawIntent")}
                </button>
                {showRawIntent && (
                  <div className="mt-3 flex items-start gap-2 rounded-lg border border-white/10 bg-black/40 p-3">
                    <code className="flex-1 break-all font-mono text-[11px] text-slate-200">
                      {paymentIntentUri}
                    </code>
                    <CopyButton text={paymentIntentUri} className="mt-0.5" />
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
                    className="flex-1 truncate font-mono text-sm underline underline-offset-2 transition-opacity hover:opacity-80"
                    style={{ color: "var(--checkout-primary)" }}
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
                      {t("connectedVia", {
                        provider: activeProvider?.name ?? "",
                      })}
                    </p>

                    {pathQuote && !pathQuoteLoading && (
                      <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                        <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                          {t("approximateCostLabel")}
                        </p>
                        <div className="mt-2 flex items-end justify-between gap-4">
                          <div>
                            <p className="text-2xl font-bold text-white">
                              {Number(pathQuote.source_amount).toLocaleString(
                                locale,
                                {
                                  minimumFractionDigits: 0,
                                  maximumFractionDigits: 7,
                                },
                              )}{" "}
                              {pathQuote.source_asset}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              {t("approximateCostHelp", {
                                amount: pathQuote.destination_amount,
                                asset: pathQuote.destination_asset,
                              })}
                            </p>
                          </div>
                          <p className="text-right text-xs text-slate-500">
                            {t("slippageBuffer", {
                              percent: Math.round(pathQuote.slippage * 100),
                              sendMax: pathQuote.send_max,
                              asset: pathQuote.source_asset,
                            })}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Path payment toggle */}
                    {pathQuote && !pathQuoteLoading && (
                      <label className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/30 px-4 py-3 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={usePathPayment}
                          onChange={(e) => setUsePathPayment(e.target.checked)}
                          className="h-4 w-4"
                          style={{ accentColor: "var(--checkout-primary)" }}
                        />
                        <span className="text-sm text-slate-300">
                          {t("pathPaymentTogglePrefix")}{" "}
                          <span className="font-semibold text-white">
                            {pathQuote.source_amount} {pathQuote.source_asset}
                          </span>{" "}
                          {t("pathPaymentToggleSuffix")}
                        </span>
                      </label>
                    )}
                    {pathQuoteLoading && (
                      <p className="text-center text-xs text-slate-500">
                        Checking alternative payment paths…
                      </p>
                    )}
                    {pathQuoteError && (
                      <p className="text-center text-xs text-red-400">
                        {pathQuoteError}
                      </p>
                    )}

                    <button
                      type="button"
                      onClick={handlePay}
                      disabled={isProcessing}
                      className="group relative flex h-12 w-full items-center justify-center rounded-xl font-bold text-black transition-all disabled:cursor-not-allowed disabled:opacity-50"
                      style={{ backgroundColor: "var(--checkout-primary)" }}
                    >
                      {isProcessing ? (
                        <span className="flex items-center gap-2">
                          <svg
                            className="h-4 w-4 animate-spin"
                            viewBox="0 0 24 24"
                          >
                            <circle
                              className="opacity-25"
                              cx="12"
                              cy="12"
                              r="10"
                              stroke="currentColor"
                              strokeWidth="4"
                              fill="none"
                            />
                            <path
                              className="opacity-75"
                              fill="currentColor"
                              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                            />
                          </svg>
                          {t("processing")}
                        </span>
                      ) : usePathPayment && pathQuote ? (
                        `Pay ${pathQuote.send_max} ${pathQuote.source_asset}`
                      ) : activeProvider?.name ? (
                        t("payWith", { provider: activeProvider.name })
                      ) : (
                        t("payWithFallback")
                      )}
                      {/* Glow halo on hover */}
                      <div
                        className="absolute inset-0 -z-10 opacity-0 blur-xl transition-opacity group-hover:opacity-100"
                        style={{
                          backgroundColor: "var(--checkout-primary-glow)",
                        }}
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
              <div className="flex flex-col gap-3">
                <div
                  className="rounded-xl border p-4 text-center"
                  style={{
                    borderColor: "var(--checkout-primary-border)",
                    backgroundColor: "var(--checkout-primary-subtle)",
                  }}
                >
                  <p
                    className="text-sm font-semibold"
                    style={{ color: "var(--checkout-primary)" }}
                  >
                    {t("receivedTitle")}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {t("receivedDescription")}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleDownloadReceipt}
                  disabled={isDownloadingReceipt}
                  className="flex h-11 w-full items-center justify-center rounded-xl border border-white/15 bg-white/5 px-4 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isDownloadingReceipt
                    ? t("downloadReceiptLoading")
                    : t("downloadReceipt")}
                </button>
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
      <CheckoutQrModal
        isOpen={showQrModal}
        onClose={() => setShowQrModal(false)}
        qrValue={paymentIntentUri}
        paymentId={payment.id}
      />
    </>
  );
}
