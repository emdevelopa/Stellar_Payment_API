"use client";

import { useCallback, useEffect, useState } from "react";
import { useDropzone } from "react-dropzone";
import Link from "next/link";
import Image from "next/image";
import CopyButton from "@/components/CopyButton";
import { toast } from "sonner";
import DangerZone from "@/components/DangerZone";
import { useTranslations } from "next-intl";
import {
  useHydrateMerchantStore,
  useMerchantApiKey,
  useMerchantHydrated,
  useSetMerchantApiKey,
} from "@/lib/merchant-store";
import { useDisplayPreferences } from "@/lib/display-preferences";
import WebhookHealthIndicator from "@/components/WebhookHealthIndicator";
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

function normalizeHexInput(v: string) {
  const t = v.trim();
  return t.startsWith("#") ? t : `#${t}`;
}

function hexToRgb(hex: string) {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => `${c}${c}`).join("") : clean;
  const int = Number.parseInt(full, 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

function luminance(hex: string) {
  const { r, g, b } = hexToRgb(hex);
  const t = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * t(r) + 0.7152 * t(g) + 0.0722 * t(b);
}

function contrastRatio(fg: string, bg: string) {
  const l1 = luminance(fg), l2 = luminance(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function mask(key: string) {
  if (key.length <= 12) return "•".repeat(key.length);
  return key.slice(0, 7) + "•".repeat(key.length - 13) + key.slice(-6);
}

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path d="M17.94 17.94A10.1 10.1 0 0 1 12 19c-6.4 0-10-7-10-7a18.1 18.1 0 0 1 5.06-5.94M9.9 4.24A9.1 9.1 0 0 1 12 4c6.4 0 10 7 10 7a18.1 18.1 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="1" y1="1" x2="23" y2="23" strokeLinecap="round" />
    </svg>
  );
}

const NAV_ITEMS: {
  id: SettingsTab;
  icon: React.ReactNode;
  danger?: boolean;
}[] = [
  {
    id: "api",
    icon: <span>🔑</span>,
  },
  {
    id: "branding",
    icon: <span>🎨</span>,
  },
  {
    id: "display",
    icon: <span>🖥️</span>,
  },
  {
    id: "webhooks",
    icon: <span>🔗</span>,
  },
  {
    id: "danger",
    icon: <span>⚠️</span>,
    danger: true,
  },
];

export default function SettingsPage() {
  const t = useTranslations("Settings");

  const navItems = [
    { ...NAV_ITEMS[0], label: t("apiKeys") },
    { ...NAV_ITEMS[1], label: t("branding") },
    { ...NAV_ITEMS[2], label: t("display") },
    { ...NAV_ITEMS[3], label: t("webhooks") },
    { ...NAV_ITEMS[4], label: t("dangerZone") },
  ];
  const apiKey = useMerchantApiKey();
  const hydrated = useMerchantHydrated();
  const setApiKey = useSetMerchantApiKey();
  const [revealed, setRevealed] = useState(false);
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
  const [webhookVerification, setWebhookVerification] = useState<WebhookDomainVerification | null>(null);
  const [verifyingWebhookDomain, setVerifyingWebhookDomain] = useState(false);

  useHydrateMerchantStore();

  useEffect(() => {
    if (!apiKey) return;
    const load = async () => {
      setLoadingBranding(true);
      try {
        const res = await fetch(`${API_URL}/api/merchant-branding`, { headers: { "x-api-key": apiKey } });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to load branding");
        setBranding(data.branding_config ?? DEFAULT_BRANDING);
      } catch (err: unknown) {
        setBrandingError(err instanceof Error ? err.message : "Failed to load branding");
      } finally { setLoadingBranding(false); }
    };
    load();
  }, [apiKey]);

  useEffect(() => {
    if (!apiKey) return;
    const load = async () => {
      setLoadingWebhook(true);
      try {
        const res = await fetch(`${API_URL}/api/webhook-settings`, { headers: { "x-api-key": apiKey } });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to load webhook settings");
        setWebhookUrl(data.webhook_url ?? "");
        setWebhookSecretMasked(data.webhook_secret_masked ?? "");
        setWebhookVerification(data.webhook_domain_verification ?? null);
      } catch (err: unknown) {
        setWebhookSaveError(err instanceof Error ? err.message : "Failed to load webhook settings");
      } finally { setLoadingWebhook(false); }
    };
    load();
  }, [apiKey]);

  const confirmRotate = async () => {
    if (!apiKey) return;
    setRotating(true); setRotateError(null);
    try {
      const res = await fetch(`${API_URL}/api/rotate-key`, { method: "POST", headers: { "x-api-key": apiKey } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to rotate key");
      setApiKey(data.api_key); setRevealed(true); setConfirming(false);
      toast.success("API key rotated — update any integrations using the old key.");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to rotate key";
      setRotateError(msg); toast.error(msg);
    } finally { setRotating(false); }
  };

  const updateBrandingField = (key: keyof typeof DEFAULT_BRANDING, value: string | null) => {
    setBranding((c) => ({ ...c, [key]: key === "logo_url" ? value : normalizeHexInput(value as string) }));
  };

  const onDrop = useCallback((files: File[]) => {
    const file = files[0]; if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast.error("Image must be under 2MB"); return; }
    const reader = new FileReader();
    reader.onload = () => { updateBrandingField("logo_url", reader.result as string); toast.success("Logo uploaded!"); };
    reader.readAsDataURL(file);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, accept: { "image/png": [".png"], "image/jpeg": [".jpg", ".jpeg"], "image/svg+xml": [".svg"] }, multiple: false });

  const saveBranding = async () => {
    if (!apiKey) return; setBrandingError(null);
    for (const [k, v] of Object.entries(branding)) {
      if (k === "logo_url") continue;
      if (!HEX_COLOR_REGEX.test(v as string)) { setBrandingError(`${k} must be a valid hex color`); return; }
    }
    setSavingBranding(true);
    try {
      const res = await fetch(`${API_URL}/api/merchant-branding`, { method: "PUT", headers: { "Content-Type": "application/json", "x-api-key": apiKey }, body: JSON.stringify(branding) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save branding");
      setBranding(data.branding_config ?? branding); toast.success("Branding saved");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save branding";
      setBrandingError(msg); toast.error(msg);
    } finally { setSavingBranding(false); }
  };

  const validateWebhookUrl = (url: string) => {
    if (!url.trim()) return null;
    try { const p = new URL(url); if (p.protocol !== "https:") return "Webhook URL must use HTTPS"; return null; }
    catch { return "Invalid URL (e.g. https://example.com/webhook)"; }
  };

  const saveWebhookUrl = async () => {
    if (!apiKey) return;
    const err = validateWebhookUrl(webhookUrl); if (err) { setWebhookUrlError(err); return; }
    setSavingWebhook(true); setWebhookSaveError(null);
    try {
      const res = await fetch(`${API_URL}/api/webhook-settings`, { method: "PUT", headers: { "Content-Type": "application/json", "x-api-key": apiKey }, body: JSON.stringify({ webhook_url: webhookUrl.trim() || undefined }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save webhook URL");
      setWebhookUrl(data.webhook_url ?? ""); setWebhookVerification(data.webhook_domain_verification ?? null);
      toast.success(data.webhook_url ? "Webhook URL saved" : "Webhook URL cleared");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save webhook URL";
      setWebhookSaveError(msg); toast.error(msg);
    } finally { setSavingWebhook(false); }
  };

  const verifyWebhookDomain = async () => {
    if (!apiKey) return; setVerifyingWebhookDomain(true); setWebhookSaveError(null);
    try {
      const res = await fetch(`${API_URL}/api/webhook-settings/verify`, { method: "POST", headers: { "x-api-key": apiKey } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to verify webhook domain");
      setWebhookVerification(data.webhook_domain_verification ?? null);
      toast.success(data.webhook_domain_verification?.status === "verified" ? "Domain verified" : "Domain still unverified");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to verify domain";
      setWebhookSaveError(msg); toast.error(msg);
    } finally { setVerifyingWebhookDomain(false); }
  };

  const regenerateWebhookSecret = async () => {
    if (!apiKey) return; setRegeneratingSecret(true); setWebhookSaveError(null);
    try {
      const res = await fetch(`${API_URL}/api/regenerate-webhook-secret`, { method: "POST", headers: { "x-api-key": apiKey } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to regenerate secret");
      setWebhookNewSecret(data.webhook_secret); setWebhookRevealedSecret(true); setConfirmRegenSecret(false);
      toast.success("Webhook secret regenerated — update your integrations.");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to regenerate secret";
      setWebhookSaveError(msg); toast.error(msg);
    } finally { setRegeneratingSecret(false); }
  };

  const testWebhook = async () => {
    if (!apiKey) return; setTestingWebhook(true); setWebhookSaveError(null);
    try {
      const res = await fetch(`${API_URL}/api/webhooks/test`, { method: "POST", headers: { "x-api-key": apiKey } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Test webhook request failed");

      const statusClass = data.status >= 200 && data.status < 300 ? "text-green-400" : "text-red-400";
      toast.success(
        <div className="flex flex-col">
          <span>{t("testWebhookSent")}</span>
          <span className="text-xs text-slate-400 mt-1">Status: <span className={statusClass}>{data.status}</span></span>
        </div>
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to test webhook";
      toast.error(msg); setWebhookSaveError(msg);
    } finally { setTestingWebhook(false); }
  };

  if (!hydrated) return null;

  if (!apiKey) {
    return (
      <div className="flex flex-col gap-8 animate-in fade-in duration-500">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.4em] text-[#6B6B6B] mb-2">Settings</p>
          <h1 className="text-4xl font-bold text-[#0A0A0A] tracking-tight">{t("merchantSettings")}</h1>
        </div>
        <div className="max-w-md rounded-2xl border border-yellow-200 bg-yellow-50 p-8 flex flex-col gap-4">
          <p className="font-bold text-yellow-800">{t("noApiKey")}</p>
          <p className="text-sm text-yellow-700">Register a merchant account first to manage your credentials here.</p>
          <Link href="/register" className="self-start rounded-xl bg-[#0A0A0A] px-5 py-2.5 text-sm font-bold text-white hover:bg-black transition-all">{t("registerMerchant")}</Link>
        </div>
      </div>
    );
  }

  const displayKey = revealed ? apiKey : mask(apiKey);
  const lowContrastWarning = contrastRatio(branding.primary_color, branding.background_color) < 4.5 || contrastRatio(branding.secondary_color, branding.background_color) < 3;
  const isVerified = webhookVerification?.status === "verified";

  return (
    <div className="flex flex-col gap-8 animate-in fade-in duration-500">
      {/* Page header */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.4em] text-[#6B6B6B] mb-2">Account</p>
        <h1 className="text-4xl font-bold text-[#0A0A0A] tracking-tight">{t("title")}</h1>
        <p className="mt-2 text-sm font-medium text-[#6B6B6B]">{t("description")}</p>
      </div>

      {/* Two-column layout */}
      <div className="flex gap-8 items-start">
        {/* Left nav */}
        <nav className="hidden lg:flex w-52 shrink-0 flex-col gap-1">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold text-left transition-all ${
                activeTab === item.id
                  ? item.danger ? "bg-red-50 text-red-600 border border-red-200" : "bg-[var(--pluto-500)] text-white"
                  : item.danger ? "text-red-500 hover:bg-red-50" : "text-[#6B6B6B] hover:bg-[var(--pluto-50)] hover:text-[var(--pluto-700)]"
              }`}
            >
              <span className="shrink-0">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        {/* Mobile tab bar */}
        <div className="lg:hidden flex gap-1 overflow-x-auto rounded-xl border border-[#E8E8E8] bg-[#F5F5F5] p-1 w-full">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`shrink-0 rounded-lg px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest transition-all ${
                activeTab === item.id
                  ? item.danger ? "bg-red-500 text-white" : "bg-white text-[#0A0A0A] shadow-sm"
                  : item.danger ? "text-red-500" : "text-[#6B6B6B]"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* Right content panel */}
        <div className="flex-1 min-w-0">

          {/* API Keys Tab */}
          {activeTab === "api" && (
            <div className="rounded-2xl border border-[#E8E8E8] bg-white p-8 flex flex-col gap-8">
              <div>
                <h2 className="text-lg font-bold text-[#0A0A0A] mb-1">API Authentication</h2>
                <p className="text-sm text-[#6B6B6B]">Your secret key for server-side API requests.</p>
              </div>

              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]">Live API Key</label>
                  <button type="button" onClick={() => setRevealed(v => !v)} className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B] hover:text-[#0A0A0A] transition-colors">
                    <EyeIcon open={revealed} /> {revealed ? "Hide" : "Reveal"}
                  </button>
                </div>
                <div className="flex items-center gap-2 rounded-xl border border-[#E8E8E8] bg-[#F9F9F9] p-1 pl-4">
                  <code className={`flex-1 truncate text-sm font-bold tracking-widest ${revealed ? "text-[#0A0A0A]" : "text-[#E8E8E8]"}`}>{displayKey}</code>
                  {revealed && <CopyButton text={apiKey} />}
                </div>
                <p className="text-xs text-[#6B6B6B]">Pass as <code className="text-[#0A0A0A]">x-api-key</code> header on every request.</p>
              </div>

              <div className="h-px bg-[#E8E8E8]" />

              <div className="flex flex-col gap-4">
                <div>
                  <h3 className="text-sm font-bold text-[#0A0A0A] mb-1">Rotate API Key</h3>
                  <p className="text-xs text-[#6B6B6B]">Generates a new key and immediately invalidates the current one.</p>
                </div>
                {rotateError && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-600">{rotateError}</div>}
                {!confirming ? (
                  <button type="button" onClick={() => { setRotateError(null); setConfirming(true); }} className="self-start rounded-xl border border-red-200 bg-red-50 px-5 py-2.5 text-xs font-bold uppercase tracking-widest text-red-600 hover:bg-red-100 transition-all">Rotate Key…</button>
                ) : (
                  <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-5 flex flex-col gap-3">
                    <p className="text-xs font-bold text-yellow-800 uppercase tracking-widest">Confirm Action</p>
                    <p className="text-xs text-yellow-700">The old key will stop working immediately.</p>
                    <div className="flex gap-3">
                      <button type="button" onClick={confirmRotate} disabled={rotating} className="flex-1 rounded-xl bg-[var(--pluto-500)] py-2.5 text-xs font-bold uppercase tracking-widest text-white hover:bg-[var(--pluto-600)] disabled:opacity-50 transition-all">Confirm</button>
                      <button type="button" onClick={() => setConfirming(false)} disabled={rotating} className="flex-1 rounded-xl border border-[#E8E8E8] bg-white py-2.5 text-xs font-bold uppercase tracking-widest text-[#6B6B6B] hover:bg-[#F5F5F5] disabled:opacity-50 transition-all">Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Branding Tab */}
          {activeTab === "branding" && (
            <div className="rounded-2xl border border-[#E8E8E8] bg-white p-8 flex flex-col gap-8">
              <div>
                <h2 className="text-lg font-bold text-[#0A0A0A] mb-1">Checkout Branding</h2>
                <p className="text-sm text-[#6B6B6B]">Customize the look of your payment checkout page.</p>
              </div>

              {/* Logo upload */}
              <div className="flex flex-col gap-3">
                <label className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]">Store Logo</label>
                <div {...getRootProps()} className={`relative flex min-h-[120px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed transition-all ${isDragActive ? "border-[#0A0A0A] bg-[#F9F9F9]" : "border-[#E8E8E8] bg-[#F9F9F9] hover:border-[#0A0A0A]"}`}>
                  <input {...getInputProps()} />
                  {branding.logo_url ? (
                    <div className="flex flex-col items-center gap-2 p-4">
                      <Image src={branding.logo_url} alt="Logo" width={64} height={64} className="object-contain" unoptimized />
                      <span className="text-xs text-[#6B6B6B]">Click or drag to replace</span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2 p-6 text-center">
                      <div className="rounded-full bg-white border border-[#E8E8E8] p-3 text-[#6B6B6B]">
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                      </div>
                      <p className="text-sm font-medium text-[#0A0A0A]">{isDragActive ? "Drop here" : "Upload logo"}</p>
                      <p className="text-xs text-[#6B6B6B]">PNG, JPG or SVG · max 2MB</p>
                    </div>
                  )}
                </div>
                {branding.logo_url && <button type="button" onClick={() => updateBrandingField("logo_url", null)} className="self-start text-xs text-red-500 hover:text-red-600 transition-colors">Remove logo</button>}
              </div>

              {/* Color pickers */}
              <div className="flex flex-col gap-4">
                <label className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]">Colors</label>
                {([["primary_color", "Primary"], ["secondary_color", "Secondary"], ["background_color", "Background"]] as const).map(([field, label]) => (
                  <div key={field} className="flex items-center gap-4">
                    <input type="color" value={branding[field]} onChange={(e) => updateBrandingField(field, e.target.value)} className="h-10 w-12 shrink-0 rounded-lg border border-[#E8E8E8] bg-white p-1 cursor-pointer" />
                    <div className="flex flex-col gap-1 flex-1">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]">{label}</span>
                      <input type="text" value={branding[field]} onChange={(e) => updateBrandingField(field, e.target.value)} className="rounded-lg border border-[#E8E8E8] bg-[#F9F9F9] px-3 py-2 font-mono text-sm text-[#0A0A0A] focus:border-[#0A0A0A] focus:outline-none" />
                    </div>
                  </div>
                ))}
              </div>

              {/* Preview */}
              <div className="rounded-xl border border-[#E8E8E8] overflow-hidden">
                <div className="px-4 py-2.5 border-b border-[#E8E8E8] bg-[#F9F9F9]">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]">Preview</p>
                </div>
                <div className="p-6" style={{ background: branding.background_color }}>
                  <div className="rounded-xl border p-4" style={{ borderColor: `${branding.secondary_color}44` }}>
                    <p className="text-sm font-medium mb-3" style={{ color: branding.secondary_color }}>Sample checkout</p>
                    <button type="button" className="rounded-lg px-4 py-2 text-sm font-bold" style={{ background: branding.primary_color, color: contrastRatio(branding.primary_color, "#000") > 5 ? "#000" : "#fff" }}>Pay Now</button>
                  </div>
                </div>
              </div>

              {brandingError && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-600">{brandingError}</div>}
              {lowContrastWarning && <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-700">Colors may not meet WCAG contrast targets. Consider adjusting.</div>}

              <div className="flex gap-3">
                <button type="button" onClick={saveBranding} disabled={loadingBranding || savingBranding} className="flex-1 rounded-xl bg-[var(--pluto-500)] py-3 text-[10px] font-bold uppercase tracking-widest text-white hover:bg-[var(--pluto-600)] disabled:opacity-50 transition-all">{savingBranding ? "Saving…" : "Save Branding"}</button>
                <button type="button" onClick={() => setIsPreviewOpen(true)} disabled={!apiKey} className="rounded-xl border border-[#E8E8E8] bg-white px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B] hover:bg-[#F5F5F5] hover:text-[#0A0A0A] disabled:opacity-50 transition-all">Preview Receipt</button>
              </div>
            </div>
          )}

          {/* Display Tab */}
          {activeTab === "display" && (
            <div className="rounded-2xl border border-[#E8E8E8] bg-white p-8 flex flex-col gap-8">
              <div>
                <h2 className="text-lg font-bold text-[#0A0A0A] mb-1">Display Preferences</h2>
                <p className="text-sm text-[#6B6B6B]">Adjust how values appear across the dashboard.</p>
              </div>
              <div className="rounded-xl border border-[#E8E8E8] bg-[#F9F9F9] p-5">
                <label className="flex items-start gap-4 cursor-pointer">
                  <input type="checkbox" checked={hideCents} onChange={(e) => setHideCents(e.target.checked)} className="mt-0.5 h-5 w-5 rounded border-[#E8E8E8] text-[#0A0A0A] focus:ring-[#0A0A0A]" />
                  <div>
                    <p className="text-sm font-bold text-[#0A0A0A]">Hide trailing cents</p>
                    <p className="text-xs text-[#6B6B6B] mt-1">Whole amounts like 50 will display without the .00 suffix.</p>
                  </div>
                </label>
              </div>
            </div>
          )}

          {/* Webhooks Tab */}
          {activeTab === "webhooks" && (
            <div className="rounded-2xl border border-[#E8E8E8] bg-white p-8 flex flex-col gap-8">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-bold text-[#0A0A0A] mb-1">Webhook Endpoint</h2>
                  <p className="text-sm text-[#6B6B6B]">Receive real-time payment events at your server.</p>
                </div>
                {webhookUrl && (
                  <div className="flex items-center gap-2 shrink-0">
                    <WebhookHealthIndicator webhookUrl={webhookUrl} />
                    <span className={`rounded-full border px-3 py-1 text-[9px] font-bold uppercase tracking-widest ${isVerified ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-yellow-200 bg-yellow-50 text-yellow-700"}`}>
                      {isVerified ? "Verified" : "Unverified"}
                    </span>
                  </div>
                )}
              </div>

              {webhookSaveError && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-600">{webhookSaveError}</div>}

              <div className="flex flex-col gap-3">
                <label className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]">Endpoint URL</label>
                <input type="url" value={webhookUrl} onChange={(e) => { setWebhookUrl(e.target.value); setWebhookUrlError(validateWebhookUrl(e.target.value)); }} placeholder="https://example.com/hooks/pluto" className={`rounded-xl border bg-[#F9F9F9] px-4 py-3 font-mono text-sm text-[#0A0A0A] focus:outline-none focus:bg-white transition-all ${webhookUrlError ? "border-red-300 focus:border-red-500" : "border-[#E8E8E8] focus:border-[#0A0A0A]"}`} />
                {webhookUrlError && <p className="text-xs text-red-500">{webhookUrlError}</p>}
                <div className="flex gap-3">
                  <button type="button" onClick={saveWebhookUrl} disabled={savingWebhook || loadingWebhook || !!webhookUrlError} className="flex-1 rounded-xl bg-[var(--pluto-500)] py-2.5 text-[10px] font-bold uppercase tracking-widest text-white hover:bg-[var(--pluto-600)] disabled:opacity-50 transition-all">{savingWebhook ? "Saving…" : "Save URL"}</button>
                  <button type="button" onClick={testWebhook} disabled={testingWebhook || !webhookUrl} className="flex-1 rounded-xl border border-[#E8E8E8] bg-white py-2.5 text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B] hover:bg-[#F5F5F5] hover:text-[#0A0A0A] disabled:opacity-50 transition-all">{testingWebhook ? "Testing…" : "Send Test"}</button>
                </div>
              </div>

              {webhookUrl && webhookVerification && (
                <div className="rounded-xl border border-[#E8E8E8] bg-[#F9F9F9] p-5 flex flex-col gap-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]">Domain Verification</p>
                  <p className="text-xs text-[#6B6B6B]">Host this token at <code className="text-[#0A0A0A]">{webhookVerification.verification_file_url}</code></p>
                  <div className="flex items-center gap-2 rounded-lg border border-[#E8E8E8] bg-white p-1 pl-4">
                    <code className="flex-1 truncate font-mono text-xs text-[#0A0A0A]">{webhookVerification.verification_token ?? "—"}</code>
                    {webhookVerification.verification_token && <CopyButton text={webhookVerification.verification_token} />}
                  </div>
                  <button type="button" onClick={verifyWebhookDomain} disabled={verifyingWebhookDomain} className="rounded-xl border border-[#E8E8E8] bg-white py-2.5 text-[10px] font-bold uppercase tracking-widest text-[#0A0A0A] hover:bg-[#F5F5F5] disabled:opacity-50 transition-all">{verifyingWebhookDomain ? "Verifying…" : "Verify Domain"}</button>
                </div>
              )}

              <div className="h-px bg-[#E8E8E8]" />

              <div className="flex flex-col gap-4">
                <div>
                  <h3 className="text-sm font-bold text-[#0A0A0A] mb-1">Signing Secret</h3>
                  <p className="text-xs text-[#6B6B6B]">Validate the <code className="text-[#0A0A0A]">Pluto-Signature</code> header on incoming webhooks.</p>
                </div>
                <div className="flex items-center gap-2 rounded-xl border border-[#E8E8E8] bg-[#F9F9F9] p-1 pl-4">
                  <code className="flex-1 truncate font-mono text-xs text-[#0A0A0A]">
                    {webhookNewSecret ? (webhookRevealedSecret ? webhookNewSecret : "•".repeat(webhookNewSecret.length)) : webhookSecretMasked || "—"}
                  </code>
                  {webhookNewSecret && (
                    <button type="button" onClick={() => setWebhookRevealedSecret(v => !v)} className="p-1 text-[#6B6B6B] hover:text-[#0A0A0A]"><EyeIcon open={webhookRevealedSecret} /></button>
                  )}
                  {webhookNewSecret && webhookRevealedSecret && <CopyButton text={webhookNewSecret} />}
                </div>
                {webhookNewSecret && <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-3 text-center text-[10px] font-bold uppercase tracking-widest text-yellow-800">Copy now — shown once</div>}
                {!confirmRegenSecret ? (
                  <button type="button" onClick={() => { setWebhookSaveError(null); setConfirmRegenSecret(true); }} className="self-start rounded-xl border border-red-200 bg-red-50 px-5 py-2.5 text-xs font-bold uppercase tracking-widest text-red-600 hover:bg-red-100 transition-all">Regenerate Secret…</button>
                ) : (
                  <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-5 flex flex-col gap-3">
                    <p className="text-xs font-bold text-yellow-800 uppercase tracking-widest">Confirm Action</p>
                    <p className="text-xs text-yellow-700">The current secret will stop working immediately.</p>
                    <div className="flex gap-3">
                      <button type="button" onClick={regenerateWebhookSecret} disabled={regeneratingSecret} className="flex-1 rounded-xl bg-[var(--pluto-500)] py-2.5 text-xs font-bold uppercase tracking-widest text-white hover:bg-[var(--pluto-600)] disabled:opacity-50 transition-all">Confirm</button>
                      <button type="button" onClick={() => setConfirmRegenSecret(false)} disabled={regeneratingSecret} className="flex-1 rounded-xl border border-[#E8E8E8] bg-white py-2.5 text-xs font-bold uppercase tracking-widest text-[#6B6B6B] hover:bg-[#F5F5F5] disabled:opacity-50 transition-all">Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Danger Tab */}
          {activeTab === "danger" && (
            <div className="rounded-2xl border border-red-200 bg-white p-8 flex flex-col gap-6">
              <div>
                <h2 className="text-lg font-bold text-red-600 mb-1">Danger Zone</h2>
                <p className="text-sm text-[#6B6B6B]">Irreversible actions. Proceed with caution.</p>
              </div>
              <DangerZone apiKey={apiKey} />
            </div>
          )}

        </div>{/* end right panel */}
      </div>{/* end two-column */}

      <EmailReceiptPreview isOpen={isPreviewOpen} onClose={() => setIsPreviewOpen(false)} branding={branding} apiKey={apiKey} apiUrl={API_URL} />
    </div>
  );
}
