"use client";

import { useCallback, useEffect, useState } from "react";
import { useDropzone } from "react-dropzone";
import Link from "next/link";
import CopyButton from "@/components/CopyButton";
import toast from "react-hot-toast";
import DangerZone from "@/components/DangerZone";
import {useTranslations} from "next-intl";
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
import EmailReceiptPreview from "@/components/EmailReceiptPreview";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const HEX_COLOR_REGEX = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
const t = useTranslations("Settings");
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
          <span>{t("testWebhookSent")}</span>
          <span className="text-xs text-slate-400 mt-1">Status: <span className={statusClass}>{data.status}</span></span>
        </div>
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
      <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-8 px-6 py-16">
        <header className="flex flex-col gap-3 text-center">
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-mint">
            Settings
          </p>
          <h1 className="text-3xl font-bold text-white">Merchant Settings</h1>
        </header>

        <div className="flex flex-col items-center gap-4 rounded-2xl border border-yellow-500/30 bg-yellow-500/10 p-8 text-center">
          <p className="text-base font-medium text-yellow-200">
            No API key found
          </p>
          <p className="text-sm text-slate-400">
            Register a merchant account first to manage your credentials here.
          </p>
          <Link
            href="/register"
            className="mt-2 rounded-xl bg-mint px-5 py-2.5 text-sm font-bold text-black transition-all hover:bg-glow"
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
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-10 px-6 py-16">
      {/* ── Header ── */}
      <header className="flex flex-col gap-3 text-center">
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-mint">
          Settings
        </p>
        <h1 className="text-3xl font-bold text-white">Merchant Settings</h1>
        <p className="text-sm text-slate-400">
          Manage your API credentials. Keep your key secret — treat it like a
          password.
        </p>
      </header>

      {/* ── Main card ── */}
      <div className="rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl backdrop-blur">
        <div className="mb-6 flex gap-2 rounded-xl border border-white/10 bg-black/30 p-1">
          <button
            type="button"
            onClick={() => setActiveTab("api")}
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium ${
              activeTab === "api"
                ? "bg-white text-black"
                : "text-slate-300 hover:bg-white/10"
            }`}
          >
            API Keys
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("branding")}
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium ${
              activeTab === "branding"
                ? "bg-white text-black"
                : "text-slate-300 hover:bg-white/10"
            }`}
          >
            Branding
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("display")}
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium ${
              activeTab === "display"
                ? "bg-white text-black"
                : "text-slate-300 hover:bg-white/10"
            }`}
          >
            Display
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("webhooks")}
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium ${
              activeTab === "webhooks"
                ? "bg-white text-black"
                : "text-slate-300 hover:bg-white/10"
            }`}
          >
            Webhooks
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("danger")}
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium ${
              activeTab === "danger"
                ? "bg-red-500 text-white shadow-[0_0_15px_rgba(239,68,68,0.4)]"
                : "text-red-400/70 hover:bg-red-500/10"
            }`}
          >
            Danger
          </button>
        </div>

        {activeTab === "api" && (
          <div className="flex flex-col gap-8">
            {/* API Key section */}
            <section className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-medium uppercase tracking-wider text-slate-400">
                  API Key
                </h2>
                <button
                  type="button"
                  onClick={() => setRevealed((v) => !v)}
                  aria-label={revealed ? "Hide API key" : "Reveal API key"}
                  className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
                >
                  <EyeIcon open={revealed} />
                  {revealed ? "Hide" : "Reveal"}
                </button>
              </div>

              <div className="flex items-center gap-2 overflow-hidden rounded-xl border border-white/10 bg-black/40 p-1 pl-4">
                <code
                  className={`flex-1 truncate font-mono text-sm transition-colors ${
                    revealed ? "text-mint" : "text-slate-500"
                  }`}
                >
                  {displayKey}
                </code>
                {/* Only allow copying when revealed to prevent accidental exposure */}
                {revealed && <CopyButton text={apiKey} />}
              </div>

              <p className="text-[11px] text-slate-600">
                Pass this as the{" "}
                <code className="text-slate-500">x-api-key</code> header on
                every API request.
              </p>
            </section>

            {/* Divider */}
            <div className="h-px bg-white/10" />

            {/* Rotate Key section */}
            <section className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <h2 className="text-xs font-medium uppercase tracking-wider text-slate-400">
                  Rotate API Key
                </h2>
                <p className="text-sm text-slate-500">
                  Generates a new key and immediately invalidates the current
                  one. Any integration still using the old key will stop
                  working.
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
                  className="flex h-11 items-center justify-center rounded-xl border border-red-500/40 bg-red-500/10 px-5 text-sm font-semibold text-red-400 transition-all hover:border-red-500/70 hover:bg-red-500/20"
                >
                  Rotate Key…
                </button>
              ) : (
                <div className="flex flex-col gap-3 rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-4">
                  <p className="text-sm font-medium text-yellow-200">
                    Are you sure? This cannot be undone.
                  </p>
                  <p className="text-xs text-slate-400">
                    The old key will stop working immediately. Make sure to
                    update all your integrations with the new key.
                  </p>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={confirmRotate}
                      disabled={rotating}
                      className="group relative flex flex-1 h-10 items-center justify-center rounded-xl bg-mint font-bold text-black text-sm transition-all hover:bg-glow disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {rotating ? (
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
                          Rotating…
                        </span>
                      ) : (
                        "Yes, rotate key"
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={cancelRotate}
                      disabled={rotating}
                      className="flex flex-1 h-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-sm font-medium text-slate-300 transition-all hover:bg-white/10 disabled:opacity-50"
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
                    ? "border-mint bg-mint/5"
                    : "border-white/10 bg-black/20 hover:border-white/20 hover:bg-black/30"
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
                  <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
                    {label}
                  </span>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={branding[field]}
                      onChange={(e) =>
                        updateBrandingField(field, e.target.value)
                      }
                      className="h-10 w-16 rounded border border-white/10 bg-transparent p-1"
                    />
                    <input
                      type="text"
                      value={branding[field]}
                      onChange={(e) =>
                        updateBrandingField(field, e.target.value)
                      }
                      className="flex-1 rounded-xl border border-white/10 bg-black/40 p-2 font-mono text-sm text-white"
                    />
                  </div>
                </label>
              ))}
            </div>

            <div
              className="rounded-2xl border border-white/10 p-5"
              style={{ background: branding.background_color }}
            >
              <p
                className="mb-3 text-xs uppercase tracking-[0.2em]"
                style={{ color: branding.secondary_color }}
              >
                Preview
              </p>
              <div
                className="rounded-xl border p-4"
                style={{ borderColor: `${branding.secondary_color}66` }}
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
              className="h-11 rounded-xl bg-mint font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50"
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
              className="flex h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 font-semibold text-white transition-all hover:bg-white/10 disabled:opacity-50"
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

            <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={hideCents}
                  onChange={(event) => setHideCents(event.target.checked)}
                  className="mt-1 h-4 w-4 rounded border border-white/15 bg-black/40 text-mint focus:ring-mint"
                />
                <div className="space-y-1">
                  <p className="font-semibold text-white">Hide trailing cents</p>
                  <p className="text-sm text-slate-400">
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
                  <h2 className="text-xs font-medium uppercase tracking-wider text-slate-400">
                    Webhook Endpoint
                  </h2>
                  <div className="flex items-center gap-3">
                    {webhookUrl && (
                      <WebhookHealthIndicator webhookUrl={webhookUrl} />
                    )}
                    {webhookUrl && (
                      <span
                        className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] ${webhookStatusTone}`}
                      >
                        {webhookVerification?.status === "verified"
                          ? "Verified"
                          : "Unverified"}
                      </span>
                    )}
                  </div>
                </div>
                <p className="text-sm text-slate-500">
                  Events like payment confirmations will be sent as POST
                  requests to this URL. Must use HTTPS.
                </p>
              </div>

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
                  placeholder="https://example.com/webhooks/stellar"
                  aria-invalid={!!webhookUrlError}
                  aria-describedby={
                    webhookUrlError ? "webhook-url-error" : undefined
                  }
                  className={`w-full rounded-xl border bg-black/40 p-3 font-mono text-sm text-white placeholder-slate-600 outline-none transition-colors focus:ring-1 ${
                    webhookUrlError
                      ? "border-red-500/50 focus:border-red-500 focus:ring-red-500/30"
                      : "border-white/10 focus:border-mint/50 focus:ring-mint/20"
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
                  className="h-11 flex-1 rounded-xl bg-mint font-semibold text-black transition-all hover:bg-glow disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {savingWebhook
                    ? "Saving…"
                    : loadingWebhook
                      ? "Loading…"
                      : "Save Webhook URL"}
                </button>
                <button
                  type="button"
                  onClick={testWebhook}
                  disabled={testingWebhook || !webhookUrl}
                  className="h-11 flex-1 rounded-xl border border-white/10 bg-white/5 font-semibold text-white transition-all hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {testingWebhook ? "Testing…" : "Send Test Webhook"}
                </button>
              </div>

              {webhookUrl && webhookVerification && (
                <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                  <div className="flex flex-col gap-2">
                    <p className="text-sm font-semibold text-white">
                      Domain verification
                    </p>
                    <p className="text-sm text-slate-400">
                      Host the token below at{" "}
                      <code className="text-slate-300">
                        {webhookVerification.verification_file_url}
                      </code>{" "}
                      and then verify the domain.
                    </p>
                  </div>

                  <div className="mt-4 flex items-center gap-2 overflow-hidden rounded-xl border border-white/10 bg-black/40 p-1 pl-4">
                    <code className="flex-1 truncate font-mono text-sm text-slate-300">
                      {webhookVerification.verification_token ?? "—"}
                    </code>
                    {webhookVerification.verification_token && (
                      <CopyButton
                        text={webhookVerification.verification_token}
                      />
                    )}
                  </div>

                  <div className="mt-4 flex flex-col gap-2 text-xs text-slate-500">
                    <p>
                      Domain:{" "}
                      <span className="font-mono text-slate-300">
                        {webhookVerification.domain ?? "—"}
                      </span>
                    </p>
                    {webhookVerification.checked_at && (
                      <p>
                        Last checked:{" "}
                        <span className="text-slate-300">
                          {new Date(
                            webhookVerification.checked_at,
                          ).toLocaleString()}
                        </span>
                      </p>
                    )}
                    {webhookVerification.verified_at && (
                      <p>
                        Verified at:{" "}
                        <span className="text-slate-300">
                          {new Date(
                            webhookVerification.verified_at,
                          ).toLocaleString()}
                        </span>
                      </p>
                    )}
                    {webhookVerification.failure_reason && (
                      <p className="text-red-400">
                        {webhookVerification.failure_reason}
                      </p>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={verifyWebhookDomain}
                    disabled={
                      savingWebhook || loadingWebhook || verifyingWebhookDomain
                    }
                    className="mt-4 h-11 rounded-xl border border-white/15 bg-white/5 px-5 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {verifyingWebhookDomain ? "Verifying…" : "Verify Domain"}
                  </button>
                </div>
              )}
            </section>

            {/* Divider */}
            <div className="h-px bg-white/10" />

            {/* Webhook Secret section */}
            <section className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <h2 className="text-xs font-medium uppercase tracking-wider text-slate-400">
                  Webhook Signing Secret
                </h2>
                <p className="text-sm text-slate-500">
                  Used to verify that webhook payloads are from Stellar Pay.
                  Validate the{" "}
                  <code className="text-slate-400">Stellar-Signature</code>{" "}
                  header against this secret.
                </p>
              </div>

              {/* Display current / new secret */}
              <div className="flex items-center gap-2 overflow-hidden rounded-xl border border-white/10 bg-black/40 p-1 pl-4">
                <code className="flex-1 truncate font-mono text-sm text-slate-500">
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
                    className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
                  >
                    <EyeIcon open={webhookRevealedSecret} />
                    {webhookRevealedSecret ? "Hide" : "Reveal"}
                  </button>
                )}
                {webhookNewSecret && webhookRevealedSecret && (
                  <CopyButton text={webhookNewSecret} />
                )}
              </div>

              {webhookNewSecret && (
                <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-3">
                  <p className="text-xs text-yellow-200">
                    Copy this secret now — it won&apos;t be shown again after
                    you leave this page.
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
                  className="flex h-11 items-center justify-center rounded-xl border border-red-500/40 bg-red-500/10 px-5 text-sm font-semibold text-red-400 transition-all hover:border-red-500/70 hover:bg-red-500/20"
                >
                  Regenerate Secret…
                </button>
              ) : (
                <div className="flex flex-col gap-3 rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-4">
                  <p className="text-sm font-medium text-yellow-200">
                    Are you sure? This cannot be undone.
                  </p>
                  <p className="text-xs text-slate-400">
                    The current secret will stop working immediately. Any
                    integration validating signatures with the old secret will
                    fail.
                  </p>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={regenerateWebhookSecret}
                      disabled={regeneratingSecret}
                      className="group relative flex flex-1 h-10 items-center justify-center rounded-xl bg-mint font-bold text-black text-sm transition-all hover:bg-glow disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {regeneratingSecret ? (
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
                          Regenerating…
                        </span>
                      ) : (
                        "Yes, regenerate secret"
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmRegenSecret(false)}
                      disabled={regeneratingSecret}
                      className="flex flex-1 h-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-sm font-medium text-slate-300 transition-all hover:bg-white/10 disabled:opacity-50"
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
      <footer className="flex justify-center gap-6 text-xs text-slate-500">
        <Link href="/" className="hover:text-slate-300 transition-colors">
          Dashboard
        </Link>
        <Link
          href="/dashboard/create"
          className="hover:text-slate-300 transition-colors"
        >
          Create Payment
        </Link>
      </footer>
    </main>
  );
}
