"use client";

import { useState, useEffect, useRef, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence, type Variants } from "framer-motion";
import confetti from "canvas-confetti";
import CopyButton from "./CopyButton";
import toast from "react-hot-toast";
import Link from "next/link";
import {
  useHydrateMerchantStore,
  useMerchantApiKey,
  useMerchantHydrated,
  useMerchantTrustedAddresses,
} from "@/lib/merchant-store";
import { useLocalStorage } from "@/hooks/useLocalStorage";


const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const USDC_ISSUER =
  process.env.NEXT_PUBLIC_USDC_ISSUER ??
  "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

const STELLAR_ADDRESS_RE = /^G[A-Z2-7]{55}$/;
const HEX_COLOR_REGEX = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
const DEFAULT_BRANDING = {
  primary_color: "#5ef2c0",
  secondary_color: "#b8ffe2",
  background_color: "#050608",
};

function normalizeHexInput(value: string) {
  const trimmed = value.trim();
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

interface CreatedPayment {
  payment_id: string;
  payment_link: string;
  status: string;
}

// ─── Animation variants ───────────────────────────────────────────────────────

/** The form slides out upward and fades as the success card comes in. */
const formVariants: Variants = {
  visible: { opacity: 1, y: 0, scale: 1, filter: "blur(0px)" },
  exit: {
    opacity: 0,
    y: -24,
    scale: 0.97,
    filter: "blur(4px)",
    transition: {
      duration: 0.35,
      ease: [0.4, 0, 0.2, 1] as [number, number, number, number],
    },
  },
};

/** Success card enters from below with a spring bounce. */
const successVariants: Variants = {
  hidden: { opacity: 0, y: 40, scale: 0.95 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      type: "spring",
      stiffness: 260,
      damping: 22,
      staggerChildren: 0.07,
      delayChildren: 0.1,
    },
  },
  exit: {
    opacity: 0,
    y: -16,
    transition: { duration: 0.25, ease: "easeIn" },
  },
};

/** Each child inside the success card staggers in. */
const childVariants: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.4,
      ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
    },
  },
};

// ─── Confetti helper ──────────────────────────────────────────────────────────

/**
 * Two-burst confetti: a centered burst followed by a wider spray 200 ms later.
 * Colors are tuned to match the mint design system.
 */
function fireConfetti() {
  const mint = "#5ef2c0";
  const glow = "#b8ffe2";
  const white = "#ffffff";
  const sky = "#60a5fa";

  const shared = {
    particleCount: 70,
    spread: 80,
    startVelocity: 38,
    ticks: 200,
    colors: [mint, glow, white, sky],
    scalar: 0.9,
  };

  // Centred burst
  confetti({ ...shared, origin: { x: 0.5, y: 0.55 } });

  // Flanking spray 200 ms later
  setTimeout(() => {
    confetti({
      ...shared,
      particleCount: 40,
      spread: 120,
      origin: { x: 0.3, y: 0.6 },
    });
    confetti({
      ...shared,
      particleCount: 40,
      spread: 120,
      origin: { x: 0.7, y: 0.6 },
    });
  }, 200);
}

// ─── Animated check icon ──────────────────────────────────────────────────────

function AnimatedCheck() {
  return (
    <motion.div
      initial={{ scale: 0, rotate: -30 }}
      animate={{ scale: 1, rotate: 0 }}
      transition={{ type: "spring", stiffness: 320, damping: 18, delay: 0.05 }}
      className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-mint/15 ring-1 ring-mint/30"
    >
      <motion.svg
        viewBox="0 0 24 24"
        className="h-7 w-7 text-mint"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <motion.path
          d="M5 13l4 4L19 7"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.45, ease: "easeOut", delay: 0.15 }}
        />
      </motion.svg>
    </motion.div>
  );
}

// ─── Success card ─────────────────────────────────────────────────────────────

interface SuccessCardProps {
  created: CreatedPayment;
  onReset: () => void;
  t: ReturnType<typeof useTranslations>;
}

function SuccessCard({ created, onReset, t }: SuccessCardProps) {
  const [canShare, setCanShare] = useState(false);

  // Fire confetti once on mount
  useEffect(() => {
    fireConfetti();
    setCanShare(
      typeof navigator !== "undefined" &&
        typeof navigator.share === "function",
    );
  }, []);

  const handleShare = async () => {
    if (!canShare) return;

    try {
      await navigator.share({
        title: t("shareTitle"),
        text: t("shareText"),
        url: created.payment_link,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }

      toast.error(t("shareFailed"));
    }
  };

  return (
    <motion.div
      key="success"
      variants={successVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      className="flex flex-col gap-6"
    >
      {/* Main card */}
      <motion.div
        variants={childVariants}
        className="relative overflow-hidden rounded-2xl border border-mint/25 bg-mint/5 p-6 backdrop-blur"
      >
        {/* Subtle radial glow in the corner */}
        <div
          aria-hidden
          className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-mint/10 blur-3xl"
        />

        {/* Check + heading */}
        <div className="flex flex-col items-center text-center">
          <AnimatedCheck />
          <motion.p
            variants={childVariants}
            className="font-mono text-xs uppercase tracking-[0.2em] text-mint"
          >
            {t("readyEyebrow")}
          </motion.p>
          <motion.h2
            variants={childVariants}
            className="mt-1 text-xl font-semibold text-white"
          >
            {t("readyTitle")}
          </motion.h2>
          <motion.p
            variants={childVariants}
            className="mt-1 text-sm text-slate-400"
          >
            {t("readyDescription")}
          </motion.p>
        </div>

        {/* Payment link row */}
        <motion.div
          variants={childVariants}
          className="mt-6 flex flex-col gap-2"
        >
          <label className="text-xs font-medium text-slate-300">
            {t("paymentLink")}
          </label>
          <div className="flex items-center gap-2 overflow-hidden rounded-xl border border-white/10 bg-black/40 p-1 pl-4 transition-colors hover:border-mint/25">
            <code className="flex-1 truncate font-mono text-sm text-mint">
              {created.payment_link}
            </code>
            <CopyButton text={created.payment_link} />
          </div>
        </motion.div>

        {/* Meta grid */}
        <motion.div
          variants={childVariants}
          className="mt-4 grid grid-cols-2 gap-3"
        >
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <p className="mb-1 text-xs uppercase tracking-wider text-slate-500">
              {t("paymentId")}
            </p>
            <p className="truncate font-mono text-xs text-slate-300">
              {created.payment_id}
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <p className="mb-1 text-xs uppercase tracking-wider text-slate-500">
              {t("status")}
            </p>
            <p className="font-mono text-xs capitalize text-slate-300">
              {created.status}
            </p>
          </div>
        </motion.div>

        <motion.div variants={childVariants} className="mt-4 flex flex-wrap gap-2">
          {canShare && (
            <button
              type="button"
              onClick={() => void handleShare()}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-mint/30 bg-mint/10 px-4 py-2 text-sm font-semibold text-mint transition-colors hover:bg-mint/15"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
              >
                <path
                  d="M7 12v7a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M12 16V4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="m8.5 7.5 3.5-3.5 3.5 3.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {t("shareLink")}
            </button>
          )}
        </motion.div>
      </motion.div>

      {/* Reset link */}
      <motion.button
        variants={childVariants}
        type="button"
        onClick={onReset}
        className="text-center text-sm font-medium text-slate-400 underline underline-offset-4 transition-colors hover:text-white"
      >
        {t("createAnother")}
      </motion.button>
    </motion.div>
  );
}

// ─── Main form ────────────────────────────────────────────────────────────────

export default function CreatePaymentForm() {
  const t = useTranslations("createPaymentForm");
  const [amount, setAmount] = useLocalStorage("payment_amount", "");
  const [asset, setAsset] = useLocalStorage<"XLM" | "USDC">(
    "payment_asset",
    "XLM",
  );
  const [recipient, setRecipient] = useLocalStorage("payment_recipient", "");
  const [description, setDescription] = useLocalStorage(
    "payment_description",
    "",
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedPayment | null>(null);
  const apiKey = useMerchantApiKey();
  const hydrated = useMerchantHydrated();
  const trustedAddresses = useMerchantTrustedAddresses();
  const [useSessionBranding, setUseSessionBranding] = useLocalStorage(
    "payment_use_branding",
    false,
  );
  const [branding, setBranding] = useLocalStorage(
    "payment_branding",
    DEFAULT_BRANDING,
  );
  const [selectedTrustedAddress, setSelectedTrustedAddress] = useLocalStorage(
    "payment_trusted_address",
    "",
  );
  useHydrateMerchantStore();
  const selectedTrustedAddressLabel =
    trustedAddresses.find((address) => address.id === selectedTrustedAddress)
      ?.label ?? null;
  const amountPlaceholder = t("amountPlaceholder", {
    asset,
    exampleAmount: asset === "USDC" ? "50.00" : "15.00",
  });
  const recipientPlaceholder = selectedTrustedAddressLabel
    ? t("recipientPlaceholderSelected", {
        asset,
        label: selectedTrustedAddressLabel,
      })
    : t("recipientPlaceholder", { asset });
  const descriptionPlaceholder = t("descriptionPlaceholder", { asset });

  // ── Rate-limit countdown ──────────────────────────────────
  const [retryAfter, setRetryAfter] = useState(0);
  const retryTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (retryAfter <= 0) {
      if (retryTimerRef.current) clearInterval(retryTimerRef.current);
      return;
    }

    retryTimerRef.current = setInterval(() => {
      setRetryAfter((prev) => {
        if (prev <= 1) {
          clearInterval(retryTimerRef.current!);
          retryTimerRef.current = null;
          setError(null);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (retryTimerRef.current) clearInterval(retryTimerRef.current);
    };
  }, [retryAfter]);
  // ──────────────────────────────────────────────────────────

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      setError(t("invalidAmount"));
      return;
    }
    if (!STELLAR_ADDRESS_RE.test(recipient.trim())) {
      setError(t("invalidRecipient"));
      return;
    }

    setLoading(true);
    try {
      const body: Record<string, unknown> = {
        amount: numAmount,
        asset,
        recipient: recipient.trim(),
      };
      if (asset === "USDC") body.asset_issuer = USDC_ISSUER;
      if (description.trim()) body.description = description.trim();
      if (useSessionBranding) {
        for (const [key, color] of Object.entries(branding)) {
          if (!HEX_COLOR_REGEX.test(color as string)) {
            setError(t("invalidHexColor", { field: key }));
            setLoading(false);
            return;
          }
        }
        body.branding_overrides = branding;
      }

      const res = await fetch(`${API_URL}/api/create-payment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey!,
        },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? t("failedCreate"));

      setCreated(data);
      toast.success(t("createdToast"));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t("failedCreate");
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setCreated(null);
    setAmount("");
    setRecipient("");
    setDescription("");
    setAsset("XLM");
    setUseSessionBranding(false);
    setBranding(DEFAULT_BRANDING);
    setSelectedTrustedAddress("");
    localStorage.removeItem("payment_amount");
    localStorage.removeItem("payment_asset");
    localStorage.removeItem("payment_recipient");
    localStorage.removeItem("payment_description");
    localStorage.removeItem("payment_use_branding");
    localStorage.removeItem("payment_branding");
    localStorage.removeItem("payment_trusted_address");
    setError(null);
    setRetryAfter(0);
  };

  const handleTrustedAddressSelect = (addressId: string) => {
    setSelectedTrustedAddress(addressId);
    if (addressId) {
      const selected = trustedAddresses.find((addr) => addr.id === addressId);
      if (selected) setRecipient(selected.address);
    }
  };

  const updateBrandingField = (
    key: keyof typeof DEFAULT_BRANDING,
    value: string
  ) => {
    setBranding((current) => ({ ...current, [key]: normalizeHexInput(value) }));
  };

  if (!hydrated) return null;

  if (!apiKey) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-yellow-500/30 bg-yellow-500/10 p-8 text-center">
        <p className="text-base font-medium text-yellow-200">
          {t("noApiKeyTitle")}
        </p>
        <p className="text-sm text-slate-400">{t("noApiKeyDescription")}</p>
        <Link
          href="/register"
          className="mt-2 rounded-xl bg-mint px-5 py-2.5 text-sm font-bold text-black transition-all hover:bg-glow"
        >
          {t("registerAsMerchant")}
        </Link>
      </div>
    );
  }

  return (
    /**
     * AnimatePresence watches for children mounting/unmounting and runs their
     * exit animations before removing them from the DOM.  `mode="wait"` ensures
     * the form finishes exiting before the success card enters.
     */
    <AnimatePresence mode="wait">
      {created ? (
        <SuccessCard
          key="success"
          created={created}
          onReset={handleReset}
          t={t}
        />
      ) : (
        <motion.form
          key="form"
          variants={formVariants}
          initial="visible"
          exit="exit"
          onSubmit={handleSubmit}
          className="flex flex-col gap-6"
          noValidate
        >
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              role="alert"
              className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400"
            >
              {error}
            </motion.div>
          )}

          <div className="flex flex-col gap-4">
            {/* Amount */}
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="amount"
                className="text-xs font-medium uppercase tracking-wider text-slate-400"
              >
                {t("amount")}
              </label>
              <input
                id="amount"
                type="number"
                min="0.0000001"
                step="any"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="rounded-xl border border-white/10 bg-white/5 p-3 text-white placeholder:text-slate-600 focus:border-mint/50 focus:outline-none focus:ring-1 focus:ring-mint/50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                placeholder={amountPlaceholder}
              />
            </div>

            {/* Asset */}
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
                {t("asset")}
              </span>
              <div
                className="flex gap-2"
                role="group"
                aria-label={t("selectAsset")}
              >
                {(["XLM", "USDC"] as const).map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => setAsset(a)}
                    aria-pressed={asset === a}
                    className={`flex-1 rounded-xl border py-2.5 text-sm font-medium transition-all ${asset === a
                      ? "border-mint/50 bg-mint/10 text-mint"
                      : "border-white/10 bg-white/5 text-slate-400 hover:border-white/20 hover:text-white"
                      }`}
                  >
                    {a}
                  </button>
                ))}
              </div>
              {asset === "USDC" && (
                <p className="text-[11px] text-slate-500">
                  {t("issuer")}:{" "}
                  <span className="font-mono">
                    {USDC_ISSUER.slice(0, 8)}…{USDC_ISSUER.slice(-6)}
                  </span>
                </p>
              )}
            </div>

            {/* Trusted Addresses */}
            {trustedAddresses.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="trusted-address"
                  className="text-xs font-medium uppercase tracking-wider text-slate-400"
                >
                  {t("trustedAddresses")}
                </label>
                <select
                  id="trusted-address"
                  value={selectedTrustedAddress}
                  onChange={(e) => handleTrustedAddressSelect(e.target.value)}
                  className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white focus:border-mint/50 focus:outline-none focus:ring-1 focus:ring-mint/50"
                >
                  <option value="">{t("selectSavedAddress")}</option>
                  {trustedAddresses.map((addr) => (
                    <option key={addr.id} value={addr.id}>
                      {addr.label} ({addr.address.slice(0, 8)}...
                      {addr.address.slice(-6)})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Recipient */}
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="recipient"
                className="text-xs font-medium uppercase tracking-wider text-slate-400"
              >
                {t("recipientAddress")}
              </label>
              <input
                id="recipient"
                type="text"
                required
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                className="rounded-xl border border-white/10 bg-white/5 p-3 font-mono text-sm text-white placeholder:font-sans placeholder:text-slate-600 focus:border-mint/50 focus:outline-none focus:ring-1 focus:ring-mint/50"
                placeholder={recipientPlaceholder}
                autoComplete="off"
                spellCheck={false}
              />
            </div>

            {/* Description */}
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="description"
                className="text-xs font-medium uppercase tracking-wider text-slate-400"
              >
                {t("descriptionLabel")}{" "}
                <span className="normal-case text-slate-600">
                  ({t("optional")})
                </span>
              </label>
              <input
                id="description"
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="rounded-xl border border-white/10 bg-white/5 p-3 text-white placeholder:text-slate-600 focus:border-mint/50 focus:outline-none focus:ring-1 focus:ring-mint/50"
                placeholder={descriptionPlaceholder}
              />
            </div>

            {/* Branding panel */}
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-slate-300">
                    {t("brandingTitle")}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {t("brandingDescription")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setUseSessionBranding((v) => !v)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${useSessionBranding
                    ? "bg-mint text-black"
                    : "border border-white/20 text-slate-300"
                    }`}
                >
                  {useSessionBranding ? t("enabled") : t("disabled")}
                </button>
              </div>

              {useSessionBranding && (
                <div className="mt-4 grid gap-3">
                  {(
                    [
                      ["primary_color", t("primary")],
                      ["secondary_color", t("secondary")],
                      ["background_color", t("background")],
                    ] as const
                  ).map(([field, label]) => (
                    <label key={field} className="flex flex-col gap-1.5">
                      <span className="text-xs text-slate-400">{label}</span>
                      <div className="flex items-center gap-3">
                        <input
                          type="color"
                          value={branding[field]}
                          onChange={(e) =>
                            updateBrandingField(field, e.target.value)
                          }
                          className="h-9 w-14 rounded border border-white/10 bg-transparent p-1"
                        />
                        <input
                          type="text"
                          value={branding[field]}
                          onChange={(e) =>
                            updateBrandingField(field, e.target.value)
                          }
                          className="flex-1 rounded-lg border border-white/10 bg-black/40 p-2 font-mono text-xs text-white"
                        />
                      </div>
                    </label>
                  ))}

                  <div
                    className="rounded-lg border border-white/10 p-3"
                    style={{ background: branding.background_color }}
                  >
                    <p
                      className="text-xs"
                      style={{ color: branding.secondary_color }}
                    >
                      {t("checkoutPreview")}
                    </p>
                    <button
                      type="button"
                      className="mt-2 rounded-md px-3 py-1.5 text-xs font-semibold"
                      style={{
                        background: branding.primary_color,
                        color: "#000",
                      }}
                    >
                      {t("payNow")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="group relative flex h-12 items-center justify-center rounded-xl bg-mint px-6 font-bold text-black transition-all hover:bg-glow disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24">
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
                {t("generating")}
              </span>
            ) : (
              t("generate")
            )}
            <div className="absolute inset-0 -z-10 bg-mint/20 opacity-0 blur-xl transition-opacity group-hover:opacity-100" />
          </button>
        </motion.form>
      )}
    </AnimatePresence>
  );
}
