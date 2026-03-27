"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import CopyButton from "@/components/CopyButton";
import toast from "react-hot-toast";
import {
  useHydrateMerchantStore,
  useMerchantApiKey,
  useMerchantHydrated,
  useSetMerchantApiKey,
  useSetMerchantMetadata,
  useMerchantTrustedAddresses,
  useAddTrustedAddress,
  useRemoveTrustedAddress,
} from "@/lib/merchant-store";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const HEX_COLOR_REGEX = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
const DEFAULT_BRANDING = {
  primary_color: "#5ef2c0",
  secondary_color: "#b8ffe2",
  background_color: "#050608",
};
const DEFAULT_MERCHANT_SETTINGS = {
  send_success_emails: true,
};

type SettingsTab = "api" | "branding" | "notifications" | "addresses";

function normalizeHexInput(value: string) {
  const trimmed = value.trim();
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

function hexToRgb(hex: string) {
  const clean = hex.replace("#", "");
  const full = clean.length === 3
    ? clean.split("").map((c) => `${c}${c}`).join("")
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
  const setMerchant = useSetMerchantMetadata();
  const trustedAddresses = useMerchantTrustedAddresses();
  const addTrustedAddress = useAddTrustedAddress();
  const removeTrustedAddress = useRemoveTrustedAddress();

  const [revealed, setRevealed] = useState(false);

  // Rotation flow state
  const [confirming, setConfirming] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [rotateError, setRotateError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SettingsTab>("api");
  const [branding, setBranding] = useState(DEFAULT_BRANDING);
  const [brandingError, setBrandingError] = useState<string | null>(null);
  const [loadingBranding, setLoadingBranding] = useState(false);
  const [savingBranding, setSavingBranding] = useState(false);
  const [merchantSettings, setMerchantSettings] = useState(
    DEFAULT_MERCHANT_SETTINGS,
  );
  const [profileError, setProfileError] = useState<string | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  // Trusted addresses state
  const [addressLabel, setAddressLabel] = useState("");
  const [addressValue, setAddressValue] = useState("");
  const [addressError, setAddressError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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
        const msg = err instanceof Error ? err.message : "Failed to load branding";
        setBrandingError(msg);
      } finally {
        setLoadingBranding(false);
      }
    };

    loadBranding();
  }, [apiKey]);

  useEffect(() => {
    if (!apiKey) return;

    const loadProfile = async () => {
      setLoadingProfile(true);
      setProfileError(null);

      try {
        const res = await fetch(`${API_URL}/api/merchant-profile`, {
          headers: { "x-api-key": apiKey },
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to load profile");
        setMerchantSettings({
          send_success_emails:
            data.merchant?.merchant_settings?.send_success_emails ?? true,
        });
        if (data.merchant) {
          setMerchant(data.merchant);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to load profile";
        setProfileError(msg);
      } finally {
        setLoadingProfile(false);
      }
    };

    loadProfile();
  }, [apiKey, setMerchant]);

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
    value: string,
  ) => {
    setBranding((current) => ({
      ...current,
      [key]: normalizeHexInput(value),
    }));
  };

  const saveBranding = async () => {
    if (!apiKey) return;
    setBrandingError(null);

    for (const [key, color] of Object.entries(branding)) {
      if (!HEX_COLOR_REGEX.test(color)) {
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
      const msg = err instanceof Error ? err.message : "Failed to save branding";
      setBrandingError(msg);
      toast.error(msg);
    } finally {
      setSavingBranding(false);
    }
  };

  const saveNotificationSettings = async () => {
    if (!apiKey) return;

    setSavingProfile(true);
    setProfileError(null);

    try {
      const res = await fetch(`${API_URL}/api/merchant-profile`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify({
          merchant_settings: merchantSettings,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save settings");

      setMerchantSettings({
        send_success_emails:
          data.merchant?.merchant_settings?.send_success_emails ?? true,
      });

      if (data.merchant) {
        setMerchant(data.merchant);
      }

      toast.success("Notification settings saved");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save settings";
      setProfileError(msg);
      toast.error(msg);
    } finally {
      setSavingProfile(false);
    }
  };
  const STELLAR_ADDRESS_RE = /^G[A-Z2-7]{55}$/;

  const addAddress = () => {
    setAddressError(null);

    if (!addressLabel.trim()) {
      setAddressError("Label is required");
      return;
    }

    if (!STELLAR_ADDRESS_RE.test(addressValue.trim())) {
      setAddressError(
        "Address must be a valid Stellar public key (56 characters, starts with G).",
      );
      return;
    }

    const newAddress = {
      id: `addr_${Date.now()}`,
      label: addressLabel.trim(),
      address: addressValue.trim(),
      created_at: new Date().toISOString(),
    };

    addTrustedAddress(newAddress);
    setAddressLabel("");
    setAddressValue("");
    toast.success("Address added to trusted addresses");
  };

  const removeAddress = (id: string) => {
    setDeletingId(id);
    removeTrustedAddress(id);
    setDeletingId(null);
    toast.success("Address removed");
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
            onClick={() => setActiveTab("notifications")}
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium ${
              activeTab === "notifications"
                ? "bg-white text-black"
                : "text-slate-300 hover:bg-white/10"
            }`}
          >
            Notifications
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("addresses")}
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium ${
              activeTab === "addresses"
                ? "bg-white text-black"
                : "text-slate-300 hover:bg-white/10"
            }`}
          >
            Trusted Addresses
          </button>
        </div>

        {activeTab === "api" ? <div className="flex flex-col gap-8">
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
              Pass this as the <code className="text-slate-500">x-api-key</code>{" "}
              header on every API request.
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
                Generates a new key and immediately invalidates the current one.
                Any integration still using the old key will stop working.
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
                  The old key will stop working immediately. Make sure to update
                  all your integrations with the new key.
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
        </div> : activeTab === "branding" ? (
          <section className="flex flex-col gap-5">
            <div className="flex flex-col gap-1">
              <h2 className="text-xs font-medium uppercase tracking-wider text-slate-400">
                Checkout Branding
              </h2>
              <p className="text-sm text-slate-500">
                Set default checkout colors. These values are exposed as CSS variables and can be overridden per session.
              </p>
            </div>

            {brandingError && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
                {brandingError}
              </div>
            )}
            {lowContrastWarning && (
              <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-4 text-sm text-yellow-100">
                Selected colors may not meet WCAG contrast targets (4.5:1 for body text). Consider adjusting primary or background colors.
              </div>
            )}

            <div className="grid gap-4">
              {([
                ["primary_color", "Primary Color"],
                ["secondary_color", "Secondary Color"],
                ["background_color", "Background Color"],
              ] as const).map(([field, label]) => (
                <label key={field} className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
                    {label}
                  </span>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={branding[field]}
                      onChange={(e) => updateBrandingField(field, e.target.value)}
                      className="h-10 w-16 rounded border border-white/10 bg-transparent p-1"
                    />
                    <input
                      type="text"
                      value={branding[field]}
                      onChange={(e) => updateBrandingField(field, e.target.value)}
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
              <p className="mb-3 text-xs uppercase tracking-[0.2em]" style={{ color: branding.secondary_color }}>
                Preview
              </p>
              <div className="rounded-xl border p-4" style={{ borderColor: `${branding.secondary_color}66` }}>
                <p style={{ color: branding.secondary_color }}>Sample checkout card</p>
                <button
                  type="button"
                  className="mt-3 rounded-lg px-4 py-2 font-semibold"
                  style={{
                    background: branding.primary_color,
                    color: contrastRatio(branding.primary_color, "#000000") > 5 ? "#000000" : "#ffffff",
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
              {savingBranding ? "Saving..." : loadingBranding ? "Loading..." : "Save Branding"}
            </button>
          </section>
        ) : (
          <section className="flex flex-col gap-5">
            <div className="flex flex-col gap-1">
              <h2 className="text-xs font-medium uppercase tracking-wider text-slate-400">
                Email Notifications
              </h2>
              <p className="text-sm text-slate-500">
                Control whether successful payment emails are sent to your
                notification inbox.
              </p>
            </div>

            {profileError && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
                {profileError}
              </div>
            )}

            <label className="flex items-center justify-between rounded-xl border border-white/10 bg-black/30 p-4">
              <div className="flex flex-col">
                <span className="text-sm font-medium text-white">
                  Success emails
                </span>
                <span className="text-xs text-slate-400">
                  Send an email when a payment is confirmed.
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={merchantSettings.send_success_emails}
                onClick={() =>
                  setMerchantSettings((current) => ({
                    ...current,
                    send_success_emails: !current.send_success_emails,
                  }))
                }
                className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
                  merchantSettings.send_success_emails
                    ? "bg-mint"
                    : "bg-slate-700"
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 rounded-full bg-black transition-transform ${
                    merchantSettings.send_success_emails
                      ? "translate-x-6"
                      : "translate-x-1"
                  }`}
                />
              </button>
            </label>

            <button
              type="button"
              onClick={saveNotificationSettings}
              disabled={loadingProfile || savingProfile}
              className="h-11 rounded-xl bg-mint font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50"
            >
              {savingProfile
                ? "Saving..."
                : loadingProfile
                  ? "Loading..."
                  : "Save Notification Settings"}
            </button>
          </section>
        )}

        {activeTab === "addresses" && (
          <section className="flex flex-col gap-5">
            <div className="flex flex-col gap-1">
              <h2 className="text-xs font-medium uppercase tracking-wider text-slate-400">
                Trusted Addresses
              </h2>
              <p className="text-sm text-slate-500">
                Save frequently used Stellar addresses for quick access when creating payments.
              </p>
            </div>

            {addressError && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
                {addressError}
              </div>
            )}

            {/* Add new address form */}
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <p className="mb-3 text-xs font-medium uppercase tracking-wider text-slate-400">
                Add New Address
              </p>
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="address-label" className="text-xs text-slate-400">
                    Label
                  </label>
                  <input
                    id="address-label"
                    type="text"
                    value={addressLabel}
                    onChange={(e) => setAddressLabel(e.target.value)}
                    className="rounded-xl border border-white/10 bg-black/40 p-2.5 text-sm text-white placeholder:text-slate-600 focus:border-mint/50 focus:outline-none focus:ring-1 focus:ring-mint/50"
                    placeholder="e.g. Main Wallet, Supplier ABC"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="address-value" className="text-xs text-slate-400">
                    Stellar Address
                  </label>
                  <input
                    id="address-value"
                    type="text"
                    value={addressValue}
                    onChange={(e) => setAddressValue(e.target.value)}
                    className="rounded-xl border border-white/10 bg-black/40 p-2.5 font-mono text-sm text-white placeholder:font-sans placeholder:text-slate-600 focus:border-mint/50 focus:outline-none focus:ring-1 focus:ring-mint/50"
                    placeholder="GABC...XYZ (56 characters)"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
                <button
                  type="button"
                  onClick={addAddress}
                  className="mt-1 flex h-10 items-center justify-center rounded-xl bg-mint font-semibold text-black transition-all hover:bg-glow"
                >
                  Add Address
                </button>
              </div>
            </div>

            {/* Saved addresses list */}
            <div className="flex flex-col gap-3">
              <h3 className="text-xs font-medium uppercase tracking-wider text-slate-400">
                Saved Addresses ({trustedAddresses.length})
              </h3>
              
              {trustedAddresses.length === 0 ? (
                <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-center">
                  <p className="text-sm text-slate-400">
                    No trusted addresses saved yet. Add your first address above.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {trustedAddresses.map((addr) => (
                    <div
                      key={addr.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-white">
                          {addr.label}
                        </p>
                        <p className="truncate font-mono text-xs text-slate-500">
                          {addr.address.slice(0, 12)}...{addr.address.slice(-8)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(addr.address);
                            toast.success("Address copied to clipboard");
                          }}
                          className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300 transition-all hover:bg-white/10 hover:text-white"
                        >
                          Copy
                        </button>
                        <button
                          type="button"
                          onClick={() => removeAddress(addr.id)}
                          disabled={deletingId === addr.id}
                          className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 transition-all hover:border-red-500/50 hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {deletingId === addr.id ? "Removing..." : "Delete"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}
      </div>

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
