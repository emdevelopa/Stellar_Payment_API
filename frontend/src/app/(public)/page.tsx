"use client";

import GuestGuard from "@/components/GuestGuard";
import Link from "next/link";
import { motion } from "framer-motion";
import { useState } from "react";

function Section({
  children,
  className = "",
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay }}
      className={className}
    >
      {children}
    </motion.section>
  );
}

function FadeUp({
  children,
  delay = 0,
  className = "",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1], delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

function IconXLM() {
  return (
    <svg viewBox="0 0 32 32" className="h-8 w-8" fill="none">
      <circle cx="16" cy="16" r="15" stroke="currentColor" strokeWidth="1.2" opacity="0.25" />
      <path
        d="M10 13l6-4 6 4M10 19l6 4 6-4M10 16h12"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconWebhook() {
  return (
    <svg viewBox="0 0 32 32" className="h-8 w-8" fill="none">
      <circle cx="16" cy="16" r="15" stroke="currentColor" strokeWidth="1.2" opacity="0.25" />
      <path
        d="M12 20a4 4 0 1 1 3-6.5M20 20a4 4 0 1 0-3-6.5M11 14h10"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconFees() {
  return (
    <svg viewBox="0 0 32 32" className="h-8 w-8" fill="none">
      <circle cx="16" cy="16" r="15" stroke="currentColor" strokeWidth="1.2" opacity="0.25" />
      <path
        d="M16 10v12M12 14l4-4 4 4M20 18l-4 4-4-4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconArrow() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none">
      <path
        d="M3 8h10M9 4l4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg className="h-4 w-4 shrink-0 text-emerald-400" viewBox="0 0 16 16" fill="none">
      <path d="M3.5 8.5L6.5 11.5L12.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}


const FEATURES = [
  {
    icon: <IconXLM />,
    title: "XLM & USDC Native",
    description:
      "Accept both tokens out of the box. Automatic asset routing, real-time exchange rates, and multi-currency settlement in a single integration.",
    tag: "Multi-Asset",
  },
  {
    icon: <IconWebhook />,
    title: "Bulletproof Webhooks",
    description:
      "Signed payloads, automatic retries with exponential back-off, and a full event log. Never miss a payment confirmation again.",
    tag: "Reliability",
  },
  {
    icon: <IconFees />,
    title: "Near-Zero Fees",
    description:
      "Stellar\u2019s base fee is a fraction of a cent. No monthly minimums, no gateway surcharges\u00a0\u2014 keep more of every transaction.",
    tag: "Cost",
  },
];

const CODE_REQUEST = `curl -X POST https://api.stellarpay.io/v1/create-payment \\
  -H "Authorization: Bearer sk_live_4eC39HqLyjWDarjtT1z..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount": "25.00",
    "asset": "USDC",
    "memo": "order-8842",
    "webhook_url": "https://shop.example/hooks/stellar",
    "redirect_url": "https://shop.example/thanks"
  }'`;

const CODE_RESPONSE = `{
  "id": "pay_9xKp2mVbQw",
  "status": "pending",
  "amount": "25.00",
  "asset": "USDC",
  "payment_url": "https://stellarpay.io/pay/pay_9xKp2mVbQw",
  "expires_at": "2025-08-15T12:30:00Z"
}`;

function HeroSection() {
  return (
    <div className="relative flex flex-col items-center px-6 pb-24 pt-28 text-center sm:pt-36 lg:pt-44">
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[600px] w-[900px] -translate-x-1/2 rounded-full bg-mint/[0.06] blur-[120px]" />

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 flex flex-col items-center gap-6"
      >
        <span className="inline-flex items-center gap-2 rounded-full border border-mint/20 bg-mint/[0.06] px-4 py-1.5 font-mono text-xs uppercase tracking-widest text-mint">
          <span className="h-1.5 w-1.5 rounded-full bg-mint animate-pulse" />
          Live on Stellar Testnet
        </span>

        <h1 className="max-w-4xl text-4xl font-bold leading-[1.08] tracking-tight text-white sm:text-6xl lg:text-7xl">
          Seamless Stellar{" "}
          <span className="bg-gradient-to-r from-mint via-emerald-300 to-cyan-400 bg-clip-text text-transparent">
            Payments
          </span>
        </h1>

        <p className="max-w-2xl text-base leading-relaxed text-slate-400 sm:text-lg">
          Ship a complete crypto checkout in minutes, not months. Generate
          payment links, collect XLM &amp; USDC, and get instant webhook
          confirmations&nbsp;&mdash; all through one clean API.
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
        className="relative z-10 mt-10 flex flex-col items-center gap-4 sm:flex-row"
      >
        <Link
          href="/register"
          className="group relative inline-flex items-center gap-2 rounded-full bg-mint px-8 py-4 text-base font-bold text-black transition-all hover:scale-[1.03] hover:bg-glow active:scale-[0.98]"
        >
          Get Started
          <IconArrow />
          <div className="absolute inset-0 -z-10 rounded-full bg-mint/40 opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-100" />
        </Link>

        <Link
          href="/login"
          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-8 py-4 text-base font-medium text-white backdrop-blur transition-all hover:border-white/20 hover:bg-white/[0.08]"
        >
          Sign In to Dashboard
        </Link>
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, delay: 0.4 }}
        className="relative z-10 mt-14 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-slate-500"
      >
        {["No credit card required", "5-minute integration", "Testnet sandbox included"].map(
          (t) => (
            <span key={t} className="flex items-center gap-1.5">
              <IconCheck />
              {t}
            </span>
          )
        )}
      </motion.div>
    </div>
  );
}

function FeaturesSection() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-24 lg:py-32">
      <Section className="mb-16 text-center">
        <p className="mb-3 font-mono text-xs uppercase tracking-widest text-mint">
          Why Stellar Pay
        </p>
        <h2 className="mx-auto max-w-2xl text-3xl font-bold leading-tight text-white sm:text-4xl">
          Everything you need to accept crypto&nbsp;&mdash; nothing you don&apos;t
        </h2>
      </Section>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f, i) => (
          <FadeUp key={f.title} delay={i * 0.1}>
            <div className="group relative flex h-full flex-col gap-5 overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02] p-8 transition-colors duration-300 hover:border-mint/20 hover:bg-white/[0.04]">
              {/* accent line */}
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-mint/40 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

              <div className="flex items-center justify-between">
                <div className="text-mint">{f.icon}</div>
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-0.5 font-mono text-[10px] uppercase tracking-wider text-slate-400">
                  {f.tag}
                </span>
              </div>

              <h3 className="text-xl font-bold text-white">{f.title}</h3>
              <p className="text-sm leading-relaxed text-slate-400">
                {f.description}
              </p>
            </div>
          </FadeUp>
        ))}
      </div>
    </div>
  );
}

function CodeSnippetSection() {
  const [tab, setTab] = useState<"request" | "response">("request");

  return (
    <div className="mx-auto max-w-6xl px-6 py-24 lg:py-32">
      <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-20">
        <Section>
          <p className="mb-3 font-mono text-xs uppercase tracking-widest text-mint">
            Developer Experience
          </p>
          <h2 className="mb-5 text-3xl font-bold leading-tight text-white sm:text-4xl">
            One endpoint.
            <br />
            Five lines of config.
          </h2>
          <p className="mb-8 max-w-md text-sm leading-relaxed text-slate-400">
            Create a payment link with a single POST request. We handle the
            Stellar transaction lifecycle, memo matching, and webhook delivery
            so you can focus on your product.
          </p>
          <ul className="flex flex-col gap-3">
            {[
              "Idempotent requests \u2014 safe to retry",
              "Signed webhook payloads (HMAC-SHA256)",
              "Auto-expiring links with configurable TTL",
              "Full Horizon explorer links in every response",
            ].map((item) => (
              <li
                key={item}
                className="flex items-start gap-2.5 text-sm text-slate-300"
              >
                <IconCheck />
                {item}
              </li>
            ))}
          </ul>
        </Section>

        {/* code block */}
        <Section delay={0.1}>
          <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0a0e17] shadow-2xl shadow-black/40">
            {/* tabs */}
            <div className="flex items-center border-b border-white/[0.06] bg-white/[0.02]">
              {(["request", "response"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`relative px-5 py-3 font-mono text-xs uppercase tracking-wider transition-colors ${
                    tab === t
                      ? "text-mint"
                      : "text-slate-500 hover:text-slate-300"
                  }`}
                >
                  {t}
                  {tab === t && (
                    <motion.div
                      layoutId="code-tab"
                      className="absolute inset-x-0 bottom-0 h-px bg-mint"
                      transition={{ type: "spring", stiffness: 380, damping: 30 }}
                    />
                  )}
                </button>
              ))}
              <div className="ml-auto flex items-center gap-1.5 pr-4">
                <div className="h-2.5 w-2.5 rounded-full bg-white/10" />
                <div className="h-2.5 w-2.5 rounded-full bg-white/10" />
                <div className="h-2.5 w-2.5 rounded-full bg-white/10" />
              </div>
            </div>

            {/* code */}
            <div className="overflow-x-auto p-5">
              <pre className="font-mono text-[13px] leading-relaxed text-slate-300">
                <code>{tab === "request" ? CODE_REQUEST : CODE_RESPONSE}</code>
              </pre>
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}

function PayWithLinkDemo() {
  const [paid, setPaid] = useState(false);

  return (
    <div className="mx-auto max-w-6xl px-6 py-24 lg:py-32">
      <Section className="mb-16 text-center">
        <p className="mb-3 font-mono text-xs uppercase tracking-widest text-mint">
          Interactive Demo
        </p>
        <h2 className="mx-auto max-w-2xl text-3xl font-bold leading-tight text-white sm:text-4xl">
          See what your customers experience
        </h2>
        <p className="mx-auto mt-4 max-w-lg text-sm text-slate-400">
          A branded checkout card generated from a single API call. Try clicking
          the button below.
        </p>
      </Section>

      <FadeUp className="flex justify-center">
        <div className="relative w-full max-w-sm">
          {/* glow behind card */}
          <div className="absolute -inset-4 rounded-3xl bg-mint/[0.05] blur-2xl" />

          <div className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-gradient-to-b from-[#0e1525] to-[#0a0e17] p-8 shadow-2xl shadow-black/40">
            {/* header */}
            <div className="mb-6 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-mint/10">
                  <svg className="h-4 w-4 text-mint" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M10 2a4 4 0 00-4 4v1H5a1 1 0 00-.994.884l-1 9A1 1 0 004 18h12a1 1 0 00.994-1.116l-1-9A1 1 0 0015 7h-1V6a4 4 0 00-4-4zm-2 5V6a2 2 0 114 0v1H8z" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">Acme Store</p>
                  <p className="text-[11px] text-slate-500">Order #8842</p>
                </div>
              </div>
              <span className="font-mono text-xs text-slate-600">
                stellarpay.io
              </span>
            </div>

            {/* amount */}
            <div className="mb-8 text-center">
              <p className="text-xs uppercase tracking-wider text-slate-500">
                Amount Due
              </p>
              <p className="mt-1 font-mono text-4xl font-bold text-white">
                25.00{" "}
                <span className="text-lg font-normal text-slate-400">
                  USDC
                </span>
              </p>
            </div>

            {/* payment details */}
            <div className="mb-8 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">Network</span>
                <span className="flex items-center gap-1.5 text-slate-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  Stellar Testnet
                </span>
              </div>
              <div className="my-3 h-px bg-white/[0.04]" />
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">Expires</span>
                <span className="text-slate-300">29 min 42 sec</span>
              </div>
              <div className="my-3 h-px bg-white/[0.04]" />
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">Fee</span>
                <span className="text-emerald-400">0.00001 XLM</span>
              </div>
            </div>

            {/* pay button */}
            {!paid ? (
              <button
                onClick={() => setPaid(true)}
                className="group relative w-full rounded-xl bg-mint py-4 text-sm font-bold text-black transition-all hover:bg-glow active:scale-[0.98]"
              >
                Pay 25.00 USDC
                <div className="absolute inset-0 -z-10 rounded-xl bg-mint/30 opacity-0 blur-xl transition-opacity group-hover:opacity-100" />
              </button>
            ) : (
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 300, damping: 20 }}
                className="flex flex-col items-center gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] py-5"
              >
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 400, damping: 15, delay: 0.15 }}
                >
                  <svg className="h-10 w-10 text-emerald-400" viewBox="0 0 40 40" fill="none">
                    <circle cx="20" cy="20" r="19" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M13 20.5l5 5 9.5-10" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </motion.div>
                <p className="text-sm font-semibold text-emerald-400">
                  Payment Confirmed
                </p>
                <button
                  onClick={() => setPaid(false)}
                  className="mt-1 text-xs text-slate-500 underline decoration-slate-700 underline-offset-2 transition-colors hover:text-slate-300"
                >
                  Reset demo
                </button>
              </motion.div>
            )}

            {/* footer */}
            <p className="mt-5 text-center text-[10px] text-slate-600">
              Secured by Stellar &middot; Powered by Stellar Pay API
            </p>
          </div>
        </div>
      </FadeUp>
    </div>
  );
}

function CTASection() {
  return (
    <div className="relative mx-auto max-w-6xl px-6 py-24 lg:py-32">
      {/* glow */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-[400px] w-[600px] rounded-full bg-mint/[0.04] blur-[100px]" />
      </div>

      <Section className="relative z-10 flex flex-col items-center text-center">
        <h2 className="mx-auto max-w-3xl text-3xl font-bold leading-tight text-white sm:text-5xl">
          Start accepting Stellar payments today
        </h2>
        <p className="mx-auto mt-5 max-w-lg text-base text-slate-400">
          Create a free account, grab your API key, and go live in under five
          minutes. No contracts, no minimums.
        </p>
        <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row">
          <Link
            href="/register"
            className="group relative inline-flex items-center gap-2 rounded-full bg-mint px-8 py-4 text-base font-bold text-black transition-all hover:scale-[1.03] hover:bg-glow active:scale-[0.98]"
          >
            Create Free Account
            <IconArrow />
            <div className="absolute inset-0 -z-10 rounded-full bg-mint/40 opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-100" />
          </Link>
          <Link
            href="/login"
            className="text-sm font-medium text-slate-400 transition-colors hover:text-white"
          >
            Already have an account? Sign in &rarr;
          </Link>
        </div>
      </Section>
    </div>
  );
}

function Footer() {
  return (
    <footer className="border-t border-white/[0.06] py-10">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 sm:flex-row">
        <span className="font-mono text-xs uppercase tracking-[0.25em] text-slate-600">
          Stellar Pay
        </span>
        <div className="flex gap-6 text-xs text-slate-600">
          <Link href="/login" className="transition-colors hover:text-slate-300">
            Login
          </Link>
          <Link href="/register" className="transition-colors hover:text-slate-300">
            Register
          </Link>
          <Link href="/dashboard" className="transition-colors hover:text-slate-300">
            Dashboard
          </Link>
        </div>
      </div>
    </footer>
  );
}


export default function Home() {
  return (
    <GuestGuard>
    <main className="relative min-h-screen overflow-x-hidden">
      {/* subtle grid texture */}
      <div
        className="pointer-events-none absolute inset-0 z-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,.15) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.15) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
        }}
      />

      <div className="relative z-10">
        <HeroSection />
        <FeaturesSection />
        <CodeSnippetSection />
        <PayWithLinkDemo />
        <CTASection />
        <Footer />
      </div>
    </main>
    </GuestGuard>
  );
}
