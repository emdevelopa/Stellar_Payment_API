"use client";

import { useState, useEffect, useRef, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import confetti from "canvas-confetti";
import CopyButton from "@/components/CopyButton";
import { toast } from "sonner";
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

interface CreatedPayment {
  payment_id: string;
  payment_link: string;
  status: string;
}

function StepBadge({ n, active, done }: { n: number; active: boolean; done: boolean }) {
  return (
    <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-all ${
      done ? "bg-[#0A0A0A] text-white" : active ? "bg-[#0A0A0A] text-white ring-4 ring-[#0A0A0A]/10" : "bg-[#F5F5F5] text-[#6B6B6B]"
    }`}>
      {done ? (
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
        </svg>
      ) : n}
    </div>
  );
}

export default function CreatePaymentPage() {
  const t = useTranslations("createPaymentPage");
  const tf = useTranslations("createPaymentForm");
  const apiKey = useMerchantApiKey();
  const hydrated = useMerchantHydrated();
  const trustedAddresses = useMerchantTrustedAddresses();
  useHydrateMerchantStore();

  const [amount, setAmount] = useLocalStorage("payment_amount", "");
  const [asset, setAsset] = useLocalStorage<"XLM" | "USDC">("payment_asset", "XLM");
  const [recipient, setRecipient] = useLocalStorage("payment_recipient", "");
  const [description, setDescription] = useLocalStorage("payment_description", "");
  const [selectedTrustedAddress, setSelectedTrustedAddress] = useLocalStorage("payment_trusted_address", "");

  const [loading, setLoading] = useState(false);
  const [created, setCreated] = useState<CreatedPayment | null>(null);
  const [amountError, setAmountError] = useState<string | null>(null);
  const [recipientError, setRecipientError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState(0);
  const retryTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (retryAfter <= 0) { if (retryTimerRef.current) clearInterval(retryTimerRef.current); return; }
    retryTimerRef.current = setInterval(() => {
      setRetryAfter((p) => { if (p <= 1) { clearInterval(retryTimerRef.current!); retryTimerRef.current = null; setError(null); return 0; } return p - 1; });
    }, 1000);
    return () => { if (retryTimerRef.current) clearInterval(retryTimerRef.current); };
  }, [retryAfter]);

  const validateAmount = (v: string) => {
    const n = parseFloat(v);
    return isNaN(n) || n <= 0 ? "Must be a positive number" : null;
  };
  const validateRecipient = (v: string) => {
    return !STELLAR_ADDRESS_RE.test(v.trim()) ? "Must be a valid Stellar address (G...)" : null;
  };

  const isValid = !validateAmount(amount) && !validateRecipient(recipient) && amount.trim() && recipient.trim();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const ae = validateAmount(amount); const re = validateRecipient(recipient);
    setAmountError(ae); setRecipientError(re);
    if (ae || re) return;
    setLoading(true); setError(null);
    try {
      const body: Record<string, unknown> = { amount: parseFloat(amount), asset, recipient: recipient.trim() };
      if (asset === "USDC") body.asset_issuer = USDC_ISSUER;
      if (description.trim()) body.description = description.trim();
      const res = await fetch(`${API_URL}/api/create-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey! },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 429) {
          const ra = parseInt(res.headers.get("Retry-After") ?? "60", 10);
          setRetryAfter(ra);
          throw new Error(tf("rateLimitError", { seconds: ra }));
        }
        throw new Error(data.error ?? tf("failedCreate"));
      }
      setCreated(data);
      confetti({ particleCount: 80, spread: 70, origin: { y: 0.6 }, colors: ["#0A0A0A", "#6B6B6B", "#ffffff"] });
      toast.success(tf("createdToast"));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : tf("failedCreate");
      setError(msg); toast.error(msg);
    } finally { setLoading(false); }
  };

  const handleReset = () => {
    setCreated(null); setAmount(""); setRecipient(""); setDescription(""); setAsset("XLM");
    setSelectedTrustedAddress(""); setError(null); setAmountError(null); setRecipientError(null); setRetryAfter(0);
    ["payment_amount","payment_asset","payment_recipient","payment_description","payment_trusted_address"].forEach(k => localStorage.removeItem(k));
  };

  const handleTrustedSelect = (id: string) => {
    setSelectedTrustedAddress(id);
    if (id) { const a = trustedAddresses.find(x => x.id === id); if (a) setRecipient(a.address); }
  };

  if (!hydrated) return null;

  // Step completion
  const step1Done = !validateAmount(amount) && amount.trim().length > 0;
  const step2Done = !validateRecipient(recipient) && recipient.trim().length > 0;
  const step3Active = step1Done && step2Done;

  return (
    <div className="flex flex-col gap-8 animate-in fade-in duration-500">
      {/* Header */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.4em] text-[#6B6B6B] mb-2">{t("eyebrow")}</p>
        <h1 className="text-4xl font-bold text-[#0A0A0A] tracking-tight">{t("title")}</h1>
        <p className="mt-2 text-sm font-medium text-[#6B6B6B] max-w-xl">{t("description")}</p>
      </div>

      <AnimatePresence mode="wait">
        {created ? (
          /* ── Success state ── */
          <motion.div key="success" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="max-w-xl">
            <div className="rounded-2xl border border-[#E8E8E8] bg-white p-8 flex flex-col gap-6">
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#0A0A0A]">
                  <svg className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]">Payment Link Ready</p>
                  <h2 className="text-xl font-bold text-[#0A0A0A]">Link Created Successfully</h2>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]">Payment Link</label>
                <div className="flex items-center gap-2 rounded-xl border border-[#E8E8E8] bg-[#F9F9F9] p-1 pl-4">
                  <code className="flex-1 truncate text-sm font-bold text-[#0A0A0A]">{created.payment_link}</code>
                  <CopyButton text={created.payment_link} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-[#E8E8E8] bg-[#F9F9F9] p-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B] mb-1">Payment ID</p>
                  <code className="text-xs font-bold text-[#0A0A0A] truncate block">{created.payment_id}</code>
                </div>
                <div className="rounded-xl border border-[#E8E8E8] bg-[#F9F9F9] p-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B] mb-1">Status</p>
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#0A0A0A] capitalize">
                    <span className="h-2 w-2 rounded-full bg-yellow-400" />{created.status}
                  </span>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <Link href={created.payment_link} target="_blank" rel="noopener noreferrer" className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-[var(--pluto-500)] py-3 text-[10px] font-bold uppercase tracking-widest text-white hover:bg-[var(--pluto-600)] transition-all">
                  Open Link
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                </Link>
                <button type="button" onClick={handleReset} className="flex-1 rounded-xl border border-[#E8E8E8] bg-white py-3 text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B] hover:bg-[#F5F5F5] hover:text-[#0A0A0A] transition-all">
                  Create Another
                </button>
              </div>
            </div>
          </motion.div>
        ) : (
          /* ── Form ── */
          <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-10">

            {/* Steps sidebar */}
            <div className="hidden lg:flex flex-col gap-1 w-44 shrink-0 pt-1">
              {[
                { n: 1, label: "Amount & Asset", done: step1Done, active: !step1Done },
                { n: 2, label: "Recipient", done: step2Done, active: step1Done && !step2Done },
                { n: 3, label: "Details", done: false, active: step3Active },
              ].map((s) => (
                <div key={s.n} className="flex items-center gap-3 py-2">
                  <StepBadge n={s.n} active={s.active} done={s.done} />
                  <span className={`text-xs font-semibold ${s.done || s.active ? "text-[#0A0A0A]" : "text-[#6B6B6B]"}`}>{s.label}</span>
                </div>
              ))}
            </div>

            {/* Form card */}
            <div className="flex-1 max-w-xl">
              {!apiKey ? (
                <div className="rounded-2xl border border-yellow-200 bg-yellow-50 p-8 flex flex-col gap-4">
                  <p className="font-bold text-yellow-800">{tf("noApiKeyTitle")}</p>
                  <p className="text-sm text-yellow-700">{tf("noApiKeyDescription")}</p>
                  <Link href="/register" className="self-start rounded-xl bg-[#0A0A0A] px-5 py-2.5 text-sm font-bold text-white hover:bg-black transition-all">{tf("registerAsMerchant")}</Link>
                </div>
              ) : (
                <form onSubmit={handleSubmit} noValidate className="rounded-2xl border border-[#E8E8E8] bg-white p-8 flex flex-col gap-7">

                  {error && (
                    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                      {error}
                    </div>
                  )}

                  {/* Step 1 — Amount & Asset */}
                  <div className="flex flex-col gap-4">
                    <div className="flex items-center gap-3">
                      <StepBadge n={1} active={!step1Done} done={step1Done} />
                      <h3 className="text-sm font-bold text-[#0A0A0A]">Amount & Asset</h3>
                    </div>

                    <div className="flex gap-3">
                      {/* Asset toggle */}
                      <div className="flex rounded-xl border border-[#E8E8E8] bg-[#F9F9F9] p-1 shrink-0">
                        {(["XLM", "USDC"] as const).map((a) => (
                          <button key={a} type="button" onClick={() => setAsset(a)}
                            className={`rounded-lg px-4 py-2 text-xs font-bold uppercase tracking-widest transition-all ${asset === a ? "bg-[#0A0A0A] text-white shadow-sm" : "text-[#6B6B6B] hover:text-[#0A0A0A]"}`}>
                            {a}
                          </button>
                        ))}
                      </div>

                      {/* Amount input */}
                      <div className="flex-1 flex flex-col gap-1">
                        <div className="relative">
                          <input
                            id="amount" type="number" min="0.0000001" step="any" required
                            value={amount}
                            onChange={(e) => { setAmount(e.target.value); setAmountError(validateAmount(e.target.value)); }}
                            placeholder={asset === "USDC" ? "50.00" : "15.00"}
                            className={`w-full rounded-xl border bg-white px-4 py-3 pr-16 text-base font-bold text-[#0A0A0A] placeholder-[#C0C0C0] focus:outline-none focus:ring-2 transition-all [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${amountError ? "border-red-300 focus:ring-red-200" : "border-[#E8E8E8] focus:ring-[#0A0A0A]/10 focus:border-[#0A0A0A]"}`}
                          />
                          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-[#6B6B6B]">{asset}</span>
                        </div>
                        {amountError && <p className="text-xs text-red-500 font-medium">{amountError}</p>}
                      </div>
                    </div>

                    {asset === "USDC" && (
                      <p className="text-[10px] text-[#6B6B6B] font-medium">
                        Issuer: <code className="text-[#0A0A0A]">{USDC_ISSUER.slice(0, 8)}…{USDC_ISSUER.slice(-6)}</code>
                      </p>
                    )}
                  </div>

                  <div className="h-px bg-[#F0F0F0]" />

                  {/* Step 2 — Recipient */}
                  <div className="flex flex-col gap-4">
                    <div className="flex items-center gap-3">
                      <StepBadge n={2} active={step1Done && !step2Done} done={step2Done} />
                      <h3 className="text-sm font-bold text-[#0A0A0A]">Recipient Address</h3>
                    </div>

                    {trustedAddresses.length > 0 && (
                      <select value={selectedTrustedAddress} onChange={(e) => handleTrustedSelect(e.target.value)}
                        className="rounded-xl border border-[#E8E8E8] bg-[#F9F9F9] px-4 py-3 text-sm font-medium text-[#0A0A0A] focus:border-[#0A0A0A] focus:outline-none focus:ring-2 focus:ring-[#0A0A0A]/10 transition-all">
                        <option value="">— Select a saved address —</option>
                        {trustedAddresses.map((a) => (
                          <option key={a.id} value={a.id}>{a.label} ({a.address.slice(0, 8)}…{a.address.slice(-6)})</option>
                        ))}
                      </select>
                    )}

                    <div className="flex flex-col gap-1">
                      <input
                        id="recipient" type="text" required
                        value={recipient}
                        onChange={(e) => { setRecipient(e.target.value); setRecipientError(validateRecipient(e.target.value)); }}
                        placeholder="GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN"
                        className={`w-full rounded-xl border bg-white px-4 py-3 font-mono text-sm text-[#0A0A0A] placeholder-[#C0C0C0] focus:outline-none focus:ring-2 transition-all ${recipientError ? "border-red-300 focus:ring-red-200" : "border-[#E8E8E8] focus:ring-[#0A0A0A]/10 focus:border-[#0A0A0A]"}`}
                        autoComplete="off" spellCheck={false}
                      />
                      {recipientError && <p className="text-xs text-red-500 font-medium">{recipientError}</p>}
                      {!recipientError && recipient && <p className="text-[10px] text-[#6B6B6B] font-medium">✓ Valid Stellar address</p>}
                    </div>
                  </div>

                  <div className="h-px bg-[#F0F0F0]" />

                  {/* Step 3 — Details */}
                  <div className="flex flex-col gap-4">
                    <div className="flex items-center gap-3">
                      <StepBadge n={3} active={step3Active} done={false} />
                      <h3 className="text-sm font-bold text-[#0A0A0A]">Details <span className="text-[#6B6B6B] font-medium normal-case">(optional)</span></h3>
                    </div>

                    <input
                      id="description" type="text"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Order #1234, subscription renewal…"
                      className="w-full rounded-xl border border-[#E8E8E8] bg-white px-4 py-3 text-sm text-[#0A0A0A] placeholder-[#C0C0C0] focus:border-[#0A0A0A] focus:outline-none focus:ring-2 focus:ring-[#0A0A0A]/10 transition-all"
                    />
                  </div>

                  {/* Submit */}
                  <button
                    type="submit"
                    disabled={loading || !isValid || retryAfter > 0}
                    className="flex h-14 w-full items-center justify-center gap-3 rounded-xl bg-[var(--pluto-500)] text-sm font-bold uppercase tracking-widest text-white shadow-lg shadow-[var(--pluto-500)]/20 transition-all hover:bg-[var(--pluto-600)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {loading ? (
                      <>
                        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Generating…
                      </>
                    ) : retryAfter > 0 ? (
                      `Wait ${retryAfter}s…`
                    ) : (
                      <>
                        Generate Payment Link
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                        </svg>
                      </>
                    )}
                  </button>
                </form>
              )}
            </div>

            {/* Live preview card */}
            <div className="hidden xl:flex flex-col gap-4 w-64 shrink-0 pt-1">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]">Preview</p>
              <div className="rounded-2xl border border-[#E8E8E8] bg-[#F9F9F9] p-5 flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]">Amount</span>
                  <span className="text-sm font-bold text-[#0A0A0A]">{amount || "—"} {asset}</span>
                </div>
                <div className="h-px bg-[#E8E8E8]" />
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]">Recipient</span>
                  <span className="font-mono text-[10px] text-[#0A0A0A]">{recipient ? `${recipient.slice(0, 6)}…${recipient.slice(-4)}` : "—"}</span>
                </div>
                <div className="h-px bg-[#E8E8E8]" />
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]">Memo</span>
                  <span className="text-xs text-[#0A0A0A] truncate max-w-[100px]">{description || "—"}</span>
                </div>
                <div className="h-px bg-[#E8E8E8]" />
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]">Network</span>
                  <span className="text-[10px] font-bold text-[#0A0A0A]">Stellar</span>
                </div>
                <div className="mt-2 rounded-xl bg-[#0A0A0A] py-3 text-center text-[10px] font-bold uppercase tracking-widest text-white opacity-40">
                  Pay Now
                </div>
              </div>
            </div>

          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
