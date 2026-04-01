"use client";

import { useCallback, useEffect, useState } from "react";
import { useDropzone } from "react-dropzone";
import Link from "next/link";
import CopyButton from "@/components/CopyButton";
import { toast } from "sonner";
import {
  useHydrateMerchantStore,
  useMerchantApiKey,
  useMerchantHydrated,
  useSetMerchantApiKey,
} from "@/lib/merchant-store";
import { useDisplayPreferences } from "@/lib/display-preferences";
import WebhookHealthIndicator from "@/components/WebhookHealthIndicator";
import DangerZone from "@/components/DangerZone";
import { EmailReceiptPreview } from "@/components/EmailReceiptPreview";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const HEX_COLOR_REGEX = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
const DEFAULT_BRANDING = {
  primary_color: "#5ef2c0",
  secondary_color: "#b8ffe2",
  background_color: "#050608",
  logo_url: null as string | null,
};

type SettingsTab = "api" | "branding" | "display" | "webhooks" | "danger";

interface WebhookDomainVerification {
  status: "verified" | "unverified";
  domain: string | null;
  verification_token: string | null;
  verification_file_url: string | null;
  checked_at: string | null;
  verified_at: string | null;
  failure_reason: string | null;
}

function normalizeHexInput(value: string) {
  const trimmed = value.trim();
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

function hexToRgb(hex: string) {
  const clean = hex.replace("#", "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => `${c}${c}`)
          .join("")
      : clean;
  const int = Number.parseInt(full, 16);

  return {
    r: (int >> 16) & 255,
    g: (int >> 8) & 255,
    b: int & 255,
  };
}

function luminance(hex: string) {
  const { r, g, b } = hexToRgb(hex);
  const transform = (value: number) => {
    const channel = value / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * transform(r) + 0.7152 * transform(g) + 0.0722 * transform(b);
}

function contrastRatio(foregroundHex: string, backgroundHex: string) {
  const l1 = luminance(foregroundHex);
  const l2 = luminance(backgroundHex);
  const brighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);

  return (brighter + 0.05) / (darker + 0.05);
}

// ─── Eye icon (show / hide key) ──────────────────────────────────────────────

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
    >
      <path
        d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx="12"
        cy="12"
        r="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ) : (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
    >
      <path
        d="M17.94 17.94A10.1 10.1 0 0 1 12 19c-6.4 0-10-7-10-7a18.1 18.1 0 0 1 5.06-5.94M9.9 4.24A9.1 9.1 0 0 1 12 4c6.4 0 10 7 10 7a18.1 18.1 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line x1="1" y1="1" x2="23" y2="23" strokeLinecap="round" />
    </svg>
  );
}

// ─── Masked key display ───────────────────────────────────────────────────────

function mask(key: string) {
  if (key.length <= 12) return "•".repeat(key.length);
  return key.slice(0, 7) + "•".repeat(key.length - 13) + key.slice(-6);
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const apiKey = useMerchantApiKey();
  const hydrated = useMerchantHydrated();
  const setApiKey = useSetMerchantApiKey();

  const [revealed, setRevealed] = useState(false);

  // Rotation flow state
  const [confirming, setConfirming] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [rotateError, setRotateError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SettingsTab>("api");
  const { hideCents, setHideCents } = useDisplayPreferences();
  const [branding, setBranding] = useState(DEFAULT_BRANDING);
  const [brandingError, setBrandingError] = useState<string | null>(null);
  const [loadingBranding, setLoadingBranding] = useState(false);
  const [savingBranding, setSavingBranding] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  // Webhook state
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookSecretMasked, setWebhookSecretMasked] = useState("");
  const [webhookNewSecret, setWebhookNewSecret] = useState<string | null>(null);
  const [webhookUrlError, setWebhookUrlError] = useState<string | null>(null);
  const [webhookSaveError, setWebhookSaveError] = useState<string | null>(null);
  const [loadingWebhook, setLoadingWebhook] = useState(false);
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [regeneratingSecret, setRegeneratingSecret] = useState(false);
  const [confirmRegenSecret, setConfirmRegenSecret] = useState(false);
  const [webhookRevealedSecret, setWebhookRevealedSecret] = useState(false);
  const [testingWebhook, setTestingWebhook] = useState(false);
  const [webhookVerification, setWebhookVerification] =
    useState<WebhookDomainVerification | null>(null);
  const [verifyingWebhookDomain, setVerifyingWebhookDomain] = useState(false);

  useHydrateMerchantStore();

  useEffect(() => {
    if (!apiKey) return;

    const loadBranding = async () => {
      setLoadingBranding(true);
      setBrandingError(null);
      try {
        const res = await fetch(`${API_URL}/api/merchant-branding`, {
          headers: { "x-api-key": apiKey },
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to load branding");
        setBranding(data.branding_config ?? DEFAULT_BRANDING);
      } catch (err: unknown) {
        const msg =
          err instanceof Error ? err.message : "Failed to load branding";
        setBrandingError(msg);
      } finally {
        setLoadingBranding(false);
      }
    };

    loadBranding();
  }, [apiKey]);

  const startRotate = () => {
    setRotateError(null);
    setConfirming(true);
  };

  const cancelRotate = () => {
    setConfirming(false);
  };

  const confirmRotate = async () => {
    if (!apiKey) return;
    setRotating(true);
    setRotateError(null);

    try {
      const res = await fetch(`${API_URL}/api/rotate-key`, {
        method: "POST",
        headers: { "x-api-key": apiKey },
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to rotate key");

      const newKey: string = data.api_key;
      setApiKey(newKey);
      setRevealed(true); // show the new key immediately
      setConfirming(false);
      toast.success(
        "API key rotated — update any integrations using the old key.",
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to rotate key";
      setRotateError(msg);
      toast.error(msg);
    } finally {
      setRotating(false);
    }
  };

  const updateBrandingField = (
    key: keyof typeof DEFAULT_BRANDING,
    value: string | null,
  ) => {
    setBranding((current) => ({
      ...current,
      [key]: key === "logo_url" ? value : normalizeHexInput(value as string),
    }));
  };

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      toast.error("Image size must be less than 2MB");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      updateBrandingField("logo_url", reader.result as string);
      toast.success("Logo uploaded!");
    };
    reader.readAsDataURL(file);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "image/png": [".png"],
      "image/jpeg": [".jpg", ".jpeg"],
      "image/svg+xml": [".svg"],
    },
    multiple: false,
  });

  const saveBranding = async () => {
    if (!apiKey) return;
    setBrandingError(null);

    for (const [key, value] of Object.entries(branding)) {
      if (key === "logo_url") continue;
      if (!HEX_COLOR_REGEX.test(value as string)) {
        setBrandingError(`${key} must be a valid hex color`);
        return;
      }
    }

    setSavingBranding(true);
    try {
      const res = await fetch(`${API_URL}/api/merchant-branding`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify(branding),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save branding");
      setBranding(data.branding_config ?? branding);
      toast.success("Branding saved");
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to save branding";
      setBrandingError(msg);
      toast.error(msg);
    } finally {
      setSavingBranding(false);
    }
  };

  // ── Webhook: load settings ────────────────────────────────────────────────
  useEffect(() => {
    if (!apiKey) return;

    const loadWebhookSettings = async () => {
      setLoadingWebhook(true);
      setWebhookSaveError(null);
      try {
        const res = await fetch(`${API_URL}/api/webhook-settings`, {
          headers: { "x-api-key": apiKey },
        });
        const data = await res.json();
        if (!res.ok)
          throw new Error(data.error ?? "Failed to load webhook settings");
        setWebhookUrl(data.webhook_url ?? "");
        setWebhookSecretMasked(data.webhook_secret_masked ?? "");
        setWebhookVerification(data.webhook_domain_verification ?? null);
      } catch (err: unknown) {
        const msg =
          err instanceof Error
            ? err.message
            : "Failed to load webhook settings";
        setWebhookSaveError(msg);
      } finally {
        setLoadingWebhook(false);
      }
    };

    loadWebhookSettings();
  }, [apiKey]);

  // ── Webhook: URL validation ───────────────────────────────────────────────
  const validateWebhookUrl = (url: string): string | null => {
    if (!url.trim()) return null; // empty is ok — clears the URL
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:") return "Webhook URL must use HTTPS";
      return null;
    } catch {
      return "Invalid URL format (e.g. https://example.com/webhook)";
    }
  };

  const handleWebhookUrlChange = (value: string) => {
    setWebhookUrl(value);
    setWebhookUrlError(validateWebhookUrl(value));
  };

  // ── Webhook: save URL ─────────────────────────────────────────────────────
  const saveWebhookUrl = async () => {
    if (!apiKey) return;
    const err = validateWebhookUrl(webhookUrl);
    if (err) {
      setWebhookUrlError(err);
      return;
    }

    setSavingWebhook(true);
    setWebhookSaveError(null);
    try {
      const res = await fetch(`${API_URL}/api/webhook-settings`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify({ webhook_url: webhookUrl.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save webhook URL");
      setWebhookUrl(data.webhook_url ?? "");
      setWebhookVerification(data.webhook_domain_verification ?? null);
      toast.success(
        data.webhook_url ? "Webhook URL saved" : "Webhook URL cleared",
      );
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to save webhook URL";
      setWebhookSaveError(msg);
      toast.error(msg);
    } finally {
      setSavingWebhook(false);
    }
  };

  const verifyWebhookDomain = async () => {
    if (!apiKey) return;

    setVerifyingWebhookDomain(true);
    setWebhookSaveError(null);
    try {
      const res = await fetch(`${API_URL}/api/webhook-settings/verify`, {
        method: "POST",
        headers: { "x-api-key": apiKey },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to verify webhook domain");
      }

      setWebhookVerification(data.webhook_domain_verification ?? null);
      toast.success(
        data.webhook_domain_verification?.status === "verified"
          ? "Webhook domain verified"
          : "Webhook domain is still unverified",
      );
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to verify webhook domain";
      setWebhookSaveError(msg);
      toast.error(msg);
    } finally {
      setVerifyingWebhookDomain(false);
    }
  };

  // ── Webhook: regenerate secret ────────────────────────────────────────────
  const regenerateWebhookSecret = async () => {
    if (!apiKey) return;
    setRegeneratingSecret(true);
    setWebhookSaveError(null);
    try {
      const res = await fetch(`${API_URL}/api/regenerate-webhook-secret`, {
        method: "POST",
        headers: { "x-api-key": apiKey },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to regenerate secret");
      setWebhookNewSecret(data.webhook_secret);
      setWebhookRevealedSecret(true);
      setConfirmRegenSecret(false);
      toast.success("Webhook secret regenerated — update your integrations.");
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to regenerate secret";
      setWebhookSaveError(msg);
      toast.error(msg);
    } finally {
      setRegeneratingSecret(false);
    }
  };

  // ── Webhook: test endpoint ────────────────────────────────────────────────
  const testWebhook = async () => {
    if (!apiKey) return;
    setTestingWebhook(true);
    setWebhookSaveError(null);
    try {
      const res = await fetch(`${API_URL}/api/webhooks/test`, {
        method: "POST",
        headers: { "x-api-key": apiKey },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Test webhook request failed");

      const statusClass =
        data.status >= 200 && data.status < 300
          ? "text-green-400"
          : "text-red-400";
      toast.success(
        <div className="flex flex-col">
          <span>Test webhook sent!</span>
          <span className="text-xs text-slate-400 mt-1">
            Status: <span className={statusClass}>{data.status}</span>
          </span>
        </div>,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to test webhook";
      toast.error(msg);
      setWebhookSaveError(msg);
    } finally {
      setTestingWebhook(false);
    }
  };

  // ── Await hydration ──────────────────────────────────────────────────────
  if (!hydrated) return null;

  // ── No key stored ────────────────────────────────────────────────────────
  if (!apiKey) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-10 px-6 py-20 bg-white">
        <header className="flex flex-col gap-4 text-center">
          <p className="text-[10px] font-bold uppercase tracking-[0.4em] text-[#6B6B6B]">
            Settings
          </p>
          <h1 className="text-4xl font-bold text-[#0A0A0A] uppercase tracking-tight">Merchant Settings</h1>
        </header>

        <div className="flex flex-col items-center gap-4 rounded-lg border border-yellow-200 bg-yellow-50 p-8 text-center">
          <p className="text-base font-bold text-yellow-800">
            No API key found
          </p>
          <p className="text-sm text-yellow-700">
            Register a merchant account first to manage your credentials here.
          </p>
          <Link
            href="/register"
            className="mt-2 rounded-md bg-[#0A0A0A] px-5 py-2.5 text-sm font-bold text-white transition-all hover:bg-black"
          >
            Register as Merchant
          </Link>
        </div>
      </main>
    );
  }

  const displayKey = revealed ? apiKey : mask(apiKey);
  const primaryOnBackground = contrastRatio(
    branding.primary_color,
    branding.background_color,
  );
  const secondaryOnBackground = contrastRatio(
    branding.secondary_color,
    branding.background_color,
  );
  const lowContrastWarning =
    primaryOnBackground < 4.5 || secondaryOnBackground < 3;
  const webhookStatusTone =
    webhookVerification?.status === "verified"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
      : "border-yellow-500/30 bg-yellow-500/10 text-yellow-200";

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-12 px-6 py-20 bg-white">
      {/* ── Header ── */}
      <header className="flex flex-col gap-4 text-center">
        <p className="text-[10px] font-bold uppercase tracking-[0.4em] text-[#6B6B6B]">
          Settings
        </p>
        <h1 className="text-5xl font-bold text-[#0A0A0A] tracking-tight uppercase">Merchant Settings</h1>
        <p className="text-sm font-medium text-[#6B6B6B] leading-relaxed">
          Manage your credentials and preferences. Keep your API key secret and secure.
        </p>
      </header>

      {/* ── Main card ── */}
      <div className="rounded-lg border border-[#E8E8E8] bg-white p-10 relative overflow-hidden">
        <div className="mb-10 flex flex-wrap gap-1 rounded-md border border-[#E8E8E8] bg-[#F5F5F5] p-1">
          <button
            type="button"
            onClick={() => setActiveTab("api")}
            className={`flex-1 rounded-[4px] px-4 py-3 text-[10px] font-bold uppercase tracking-widest transition-all ${
              activeTab === "api"
                ? "bg-white text-[#0A0A0A] shadow-sm"
                : "text-[#6B6B6B] hover:text-[#0A0A0A]"
            }`}
          >
            API Keys
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("branding")}
            className={`flex-1 rounded-[4px] px-4 py-3 text-[10px] font-bold uppercase tracking-widest transition-all ${
              activeTab === "branding"
                ? "bg-white text-[#0A0A0A] shadow-sm"
                : "text-[#6B6B6B] hover:text-[#0A0A0A]"
            }`}
          >
            Branding
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("display")}
            className={`flex-1 rounded-[4px] px-4 py-3 text-[10px] font-bold uppercase tracking-widest transition-all ${
              activeTab === "display"
                ? "bg-white text-[#0A0A0A] shadow-sm"
                : "text-[#6B6B6B] hover:text-[#0A0A0A]"
            }`}
          >
            Display
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("webhooks")}
            className={`flex-1 rounded-[4px] px-4 py-3 text-[10px] font-bold uppercase tracking-widest transition-all ${
              activeTab === "webhooks"
                ? "bg-white text-[#0A0A0A] shadow-sm"
                : "text-[#6B6B6B] hover:text-[#0A0A0A]"
            }`}
          >
            Webhooks
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("danger")}
            className={`flex-1 rounded-[4px] px-4 py-3 text-[10px] font-bold uppercase tracking-widest transition-all ${
              activeTab === "danger"
                ? "bg-red-500 text-white"
                : "text-red-500/70 hover:text-red-500"
            }`}
          >
            Danger
          </button>
        </div>

        {activeTab === "api" && (
          <div className="flex flex-col gap-8">
            {/* API Key section */}
            <section className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#6B6B6B]">
                  API Key
                </h2>
                <button
                  type="button"
                  onClick={() => setRevealed((v) => !v)}
                  aria-label={revealed ? "Hide API key" : "Reveal API key"}
                  className="flex items-center gap-2 rounded-md px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B] transition-all hover:bg-[#F5F5F5] hover:text-[#0A0A0A]"
                >
                  <EyeIcon open={revealed} />
                  {revealed ? "Hide" : "Reveal"}
                </button>
              </div>

              <div className="flex items-center gap-3 overflow-hidden rounded-md border border-[#E8E8E8] bg-white p-1 pl-5">
                <code
                  className={`flex-1 truncate text-sm font-bold tracking-widest transition-colors ${
                    revealed ? "text-[#0A0A0A]" : "text-[#E8E8E8]"
                  }`}
                >
                  {displayKey}
                </code>
                {revealed && <CopyButton text={apiKey} />}
              </div>

              <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]">
                Pass this as the{" "}
                <code className="text-[#0A0A0A]">x-api-key</code> header on
                every API request.
              </p>
            </section>

            {/* Divider */}
            <div className="h-px bg-white/10" />

            {/* Rotate Key section */}
            <section className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <h2 className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]">
                  Rotate API Key
                </h2>
                <p className="text-xs text-[#6B6B6B]">
                  Generates a new key and immediately invalidates the current
                  one.
                </p>
              </div>

              {rotateError && (
                <div
                  role="alert"
                  className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400"
                >
                  {rotateError}
                </div>
              )}

              {!confirming ? (
                <button
                  type="button"
                  onClick={startRotate}
                  className="flex h-11 items-center justify-center rounded-md border border-red-200 bg-red-50 px-5 text-xs font-bold uppercase tracking-widest text-red-600 transition-all hover:bg-red-100"
                >
                  Rotate Key…
                </button>
              ) : (
                <div className="flex flex-col gap-3 rounded-md border border-yellow-200 bg-yellow-50 p-4">
                  <p className="text-xs font-bold text-yellow-800 uppercase tracking-widest">
                    Are you sure?
                  </p>
                  <p className="text-[10px] text-yellow-700 leading-relaxed">
                    The old key will stop working immediately. Access will be lost until updated.
                  </p>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={confirmRotate}
                      disabled={rotating}
                      className="group relative flex flex-1 h-10 items-center justify-center rounded-md bg-[#0A0A0A] font-bold text-white text-xs uppercase tracking-widest transition-all hover:bg-black disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      onClick={cancelRotate}
                      disabled={rotating}
                      className="flex flex-1 h-10 items-center justify-center rounded-md border border-[#E8E8E8] bg-white text-xs font-bold uppercase tracking-widest text-[#6B6B6B] transition-all hover:bg-[#F5F5F5] disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}

        {activeTab === "branding" && (
          <section className="flex flex-col gap-5">
            <div className="flex flex-col gap-1">
              <h2 className="text-xs font-medium uppercase tracking-wider text-slate-400">
                Checkout Branding
              </h2>
              <p className="text-sm text-slate-500">
                Set default checkout branding. Upload your logo and set colors.
              </p>
            </div>

            <div className="flex flex-col gap-3">
              <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
                Store Logo
              </span>
            <div
                {...getRootProps()}
                className={`relative flex min-h-[120px] cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed transition-all ${
                  isDragActive
                    ? "border-accent bg-accent/5"
                    : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-slate-100/50"
                }`}
              >
                <input {...getInputProps()} />
                {branding.logo_url ? (
                  <div className="group relative flex flex-col items-center gap-3 p-4">
                    <img
                      src={branding.logo_url}
                      alt="Logo preview"
                      className="h-16 w-16 object-contain"
                    />
                    <span className="text-xs text-slate-500 group-hover:text-slate-300">
                      Click or drag to change logo
                    </span>
                    {isDragActive && (
                      <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/60 backdrop-blur-sm">
                        <p className="text-sm font-bold text-mint">
                          Drop to upload
                        </p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2 p-6 text-center">
                    <div className="rounded-full bg-white/5 p-3 text-slate-400">
                      <svg
                        className="h-6 w-6"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                        />
                      </svg>
                    </div>
                    <div className="flex flex-col gap-1">
                      <p className="text-sm font-medium text-slate-300">
                        {isDragActive ? "Drop your logo here" : "Upload logo"}
                      </p>
                      <p className="text-xs text-slate-500">
                        PNG, JPG or SVG up to 2MB
                      </p>
                    </div>
                  </div>
                )}
              </div>
              {branding.logo_url && (
                <button
                  type="button"
                  onClick={() => updateBrandingField("logo_url", null)}
                  className="self-start text-xs text-red-400 hover:text-red-300"
                >
                  Remove logo
                </button>
              )}
            </div>

            {brandingError && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
                {brandingError}
              </div>
            )}
            {lowContrastWarning && (
              <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-4 text-sm text-yellow-100">
                Selected colors may not meet WCAG contrast targets (4.5:1 for
                body text). Consider adjusting primary or background colors.
              </div>
            )}

            <div className="grid gap-4">
              {(
                [
                  ["primary_color", "Primary Color"],
                  ["secondary_color", "Secondary Color"],
                  ["background_color", "Background Color"],
                ] as const
              ).map(([field, label]) => (
                <label key={field} className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]">
                    {label}
                  </span>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={branding[field]}
                      onChange={(e) =>
                        updateBrandingField(field, e.target.value)
                      }
                      className="h-10 w-16 rounded-md border border-[#E8E8E8] bg-white p-1 cursor-pointer"
                    />
                    <input
                      type="text"
                      value={branding[field]}
                      onChange={(e) =>
                        updateBrandingField(field, e.target.value)
                      }
                      className="flex-1 rounded-md border border-[#E8E8E8] bg-[#F9F9F9] p-2.5 font-mono text-sm font-bold text-[#0A0A0A]"
                    />
                  </div>
                </label>
              ))}
            </div>

            <div
              className="rounded-lg border border-[#E8E8E8] p-5"
              style={{ background: branding.background_color }}
            >
              <p
                className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em]"
                style={{ color: branding.secondary_color }}
              >
                Preview
              </p>
              <div
                className="rounded-md border p-4"
                style={{ borderColor: `${branding.secondary_color}44` }}
              >
                <p style={{ color: branding.secondary_color }}>
                  Sample checkout card
                </p>
                {branding.logo_url && (
                  <div className="mb-4 flex justify-center">
                    <img
                      src={branding.logo_url}
                      alt="Logo preview"
                      className="h-12 w-auto object-contain"
                    />
                  </div>
                )}
                <button
                  type="button"
                  className="mt-3 rounded-lg px-4 py-2 font-semibold"
                  style={{
                    background: branding.primary_color,
                    color:
                      contrastRatio(branding.primary_color, "#000000") > 5
                        ? "#000000"
                        : "#ffffff",
                  }}
                >
                  Pay Now
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={saveBranding}
              disabled={loadingBranding || savingBranding}
              className="h-12 rounded-md bg-[#0A0A0A] font-bold text-[10px] uppercase tracking-widest text-white transition-all hover:bg-black disabled:cursor-not-allowed disabled:opacity-50"
            >
              {savingBranding
                ? "Saving..."
                : loadingBranding
                  ? "Loading..."
                  : "Save Branding"}
            </button>

            <button
              type="button"
              onClick={() => setIsPreviewOpen(true)}
              disabled={!apiKey}
              className="flex h-11 items-center justify-center gap-2 rounded-md border border-[#E8E8E8] bg-white text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B] transition-all hover:bg-[#F5F5F5] hover:text-[#0A0A0A] disabled:opacity-50"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                />
              </svg>
              Preview Receipt
            </button>
          </section>
        )}

        {activeTab === "display" && (
          <section className="flex flex-col gap-5">
            <div className="flex flex-col gap-1">
              <h2 className="text-xs font-medium uppercase tracking-wider text-slate-400">
                Display Preferences
              </h2>
              <p className="text-sm text-slate-500">
                Adjust how currency values appear in the dashboard.
              </p>
            </div>

            <div className="rounded-lg border border-[#E8E8E8] bg-[#F9F9F9] p-6">
              <label className="flex items-start gap-4 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={hideCents}
                  onChange={(event) => setHideCents(event.target.checked)}
                  className="mt-1 h-5 w-5 rounded-md border border-[#E8E8E8] bg-white text-[#0A0A0A] focus:ring-[#0A0A0A] focus:ring-offset-0 transition-all"
                />
                <div className="space-y-1">
                  <p className="text-xs font-bold text-[#0A0A0A] uppercase tracking-widest transition-colors">Hide trailing cents</p>
                  <p className="text-[10px] font-medium text-[#6B6B6B] leading-relaxed">
                    Whole amounts such as 50 will display without the .00 suffix.
                  </p>
                </div>
              </label>
            </div>
          </section>
        )}

        {activeTab === "webhooks" && (
          <div className="flex flex-col gap-8">
            {/* Webhook Endpoint section */}
            <section className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]">
                    Webhook Status
                  </h2>
                  <div className="flex items-center gap-3">
                    {webhookUrl && (
                      <WebhookHealthIndicator webhookUrl={webhookUrl} />
                    )}
                    {webhookUrl && (
                      <span
                        className={`rounded-full border px-3 py-1 text-[9px] font-bold uppercase tracking-widest ${webhookStatusTone === "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-yellow-200 bg-yellow-50 text-yellow-700"}`}
                      >
                        {webhookVerification?.status === "verified"
                          ? "Verified"
                          : "Unverified"}
                      </span>
                    )}
                  </div>
                </div>
                <p className="text-[10px] font-medium text-[#6B6B6B] leading-relaxed mt-1">
                  Must use HTTPS for event delivery.
                </p>
              </div>
            </section>

            <section className="flex flex-col gap-4">
              <h2 className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]">
                Endpoint URL
              </h2>

              {webhookSaveError && (
                <div
                  role="alert"
                  className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400"
                >
                  {webhookSaveError}
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <input
                  type="url"
                  value={webhookUrl}
                  onChange={(e) => handleWebhookUrlChange(e.target.value)}
                  placeholder="https://example.com/hooks/pluto"
                  aria-invalid={!!webhookUrlError}
                  className={`w-full rounded-md border bg-[#F9F9F9] p-4 font-mono text-sm font-bold text-[#0A0A0A] outline-none transition-all focus:bg-white ${
                    webhookUrlError
                      ? "border-red-200 focus:border-red-500"
                      : "border-[#E8E8E8] focus:border-[#0A0A0A]"
                  }`}
                />
                {webhookUrlError && (
                  <p
                    id="webhook-url-error"
                    role="alert"
                    className="flex items-center gap-1.5 text-xs text-red-400"
                  >
                    <svg
                      viewBox="0 0 20 20"
                      className="h-3.5 w-3.5 shrink-0"
                      fill="currentColor"
                    >
                      <path
                        fillRule="evenodd"
                        d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                        clipRule="evenodd"
                      />
                    </svg>
                    {webhookUrlError}
                  </p>
                )}
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={saveWebhookUrl}
                  disabled={
                    savingWebhook || loadingWebhook || !!webhookUrlError
                  }
                  className="h-11 flex-1 rounded-md bg-[#0A0A0A] text-[10px] font-bold uppercase tracking-widest text-white transition-all hover:bg-black disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {savingWebhook ? "Saving…" : "Save URL"}
                </button>
                <button
                  type="button"
                  onClick={testWebhook}
                  disabled={testingWebhook || !webhookUrl}
                  className="h-11 flex-1 rounded-md border border-[#E8E8E8] bg-white text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B] transition-all hover:bg-[#F5F5F5] hover:text-[#0A0A0A] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {testingWebhook ? "Testing…" : "Send Test"}
                </button>
              </div>

              {webhookUrl && webhookVerification && (
                <div className="rounded-lg border border-[#E8E8E8] bg-[#F9F9F9] p-6 mt-4">
                  <div className="flex flex-col gap-2">
                    <p className="text-[10px] font-bold text-[#0A0A0A] uppercase tracking-widest">
                      Domain verification
                    </p>
                    <p className="text-[10px] text-[#6B6B6B] leading-relaxed">
                      Host the token at <code className="text-[#0A0A0A]">{webhookVerification.verification_file_url}</code>
                    </p>
                  </div>

                  <div className="mt-4 flex items-center gap-2 overflow-hidden rounded-md border border-[#E8E8E8] bg-white p-1 pl-4">
                    <code className="flex-1 truncate font-mono text-xs text-[#0A0A0A]">
                      {webhookVerification.verification_token ?? "—"}
                    </code>
                    {webhookVerification.verification_token && (
                      <CopyButton
                        text={webhookVerification.verification_token}
                      />
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={verifyWebhookDomain}
                    disabled={
                      savingWebhook || loadingWebhook || verifyingWebhookDomain
                    }
                    className="mt-6 w-full h-11 rounded-md border border-[#E8E8E8] bg-white text-[10px] font-bold uppercase tracking-widest text-[#0A0A0A] transition hover:bg-[#F5F5F5] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {verifyingWebhookDomain ? "Verifying…" : "Verify Domain"}
                  </button>
                </div>
              )}
            </section>

            {/* Divider */}
            <div className="h-px bg-white/10" />

            {/* Webhook Secret section */}
            <section className="flex flex-col gap-4 mt-4">
              <div className="flex flex-col gap-1">
                <h2 className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]">
                  Signing Secret
                </h2>
                <p className="text-[10px] font-medium text-[#6B6B6B] leading-relaxed">
                  Used to verify webhook payloads. Validate the <code className="text-[#0A0A0A]">Pluto-Signature</code> header.
                </p>
              </div>

              {/* Display current / new secret */}
              <div className="flex items-center gap-2 overflow-hidden rounded-md border border-[#E8E8E8] bg-[#F9F9F9] p-1 pl-4">
                <code className="flex-1 truncate font-mono text-xs font-bold text-[#0A0A0A]">
                  {webhookNewSecret
                    ? webhookRevealedSecret
                      ? webhookNewSecret
                      : "•".repeat(webhookNewSecret.length)
                    : webhookSecretMasked || "—"}
                </code>
                {webhookNewSecret && (
                  <button
                    type="button"
                    onClick={() => setWebhookRevealedSecret((v) => !v)}
                    className="flex items-center gap-1.5 rounded p-1 text-[#6B6B6B] hover:text-[#0A0A0A]"
                  >
                    <EyeIcon open={webhookRevealedSecret} />
                  </button>
                )}
                {webhookNewSecret && webhookRevealedSecret && (
                  <CopyButton text={webhookNewSecret} />
                )}
              </div>

              {webhookNewSecret && (
                <div className="rounded-md border border-yellow-200 bg-yellow-50 p-3">
                  <p className="text-[10px] text-yellow-800 font-bold uppercase tracking-widest text-center">
                    Copy now — shown once.
                  </p>
                </div>
              )}

              {/* Regenerate flow */}
              {!confirmRegenSecret ? (
                <button
                  type="button"
                  onClick={() => {
                    setWebhookSaveError(null);
                    setConfirmRegenSecret(true);
                  }}
                  className="flex h-12 mt-4 items-center justify-center rounded-md border border-red-200 bg-red-50 px-6 text-[10px] font-bold uppercase tracking-widest text-red-600 transition-all hover:bg-red-100"
                >
                  Regenerate Secret…
                </button>
              ) : (
                <div className="flex flex-col gap-3 rounded-md border border-yellow-200 bg-yellow-50 p-4 mt-4">
                  <p className="text-[10px] font-bold text-yellow-800 uppercase tracking-widest">
                    Confirm Action
                  </p>
                  <p className="text-[10px] text-yellow-700 leading-relaxed">
                    The current secret will stop working immediately. Access will be lost until updated.
                  </p>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={regenerateWebhookSecret}
                      disabled={regeneratingSecret}
                      className="flex flex-1 h-10 items-center justify-center rounded-md bg-[#0A0A0A] font-bold text-white text-xs uppercase tracking-widest transition-all hover:bg-black"
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmRegenSecret(false)}
                      disabled={regeneratingSecret}
                      className="flex flex-1 h-10 items-center justify-center rounded-md border border-[#E8E8E8] bg-white text-xs font-bold uppercase tracking-widest text-[#6B6B6B] transition-all hover:bg-[#F5F5F5]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}

        {activeTab === "danger" && <DangerZone apiKey={apiKey} />}
      </div>

      <EmailReceiptPreview
        isOpen={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        branding={branding}
        apiKey={apiKey}
        apiUrl={API_URL}
      />

      {/* Footer nav */}
      <footer className="flex justify-center gap-8 text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]">
        <Link href="/" className="hover:text-[#0A0A0A] transition-colors">
          Dashboard
        </Link>
        <Link
          href="/dashboard/create"
          className="hover:text-[#0A0A0A] transition-colors"
        >
          Create Payment
        </Link>
      </footer>
    </main>
  );
}
