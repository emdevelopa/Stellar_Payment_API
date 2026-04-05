"use client";

import GuestGuard from "@/components/GuestGuard";
import SystemStatus from "@/components/SystemStatus";
import Link from "next/link";
import { useState } from "react";
import Prism from "prismjs";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-json";

const FEATURES = [
  {
    icon: "⬡",
    title: "Native Assets",
    description: "Accept XLM and USDC with zero friction. Built-in routing and real-time settlement on the Stellar network.",
    tag: "Multi-Asset",
  },
  {
    icon: "⟳",
    title: "Precision Webhooks",
    description: "Signed payloads and automatic retries. Reliability engineered into every transaction event.",
    tag: "Reliability",
  },
  {
    icon: "◈",
    title: "Extreme Efficiency",
    description: "Capitalize on Stellar's sub-cent fees. No monthly minimums—only pay for what you use.",
    tag: "Cost",
  },
];

const CODE_REQUEST = `curl -X POST https://api.pluto.io/v1/create-payment \\
  -H "x-api-key: sk_live_4eC39..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount": "25.00",
    "asset": "USDC",
    "memo": "order-8842",
    "webhook_url": "https://shop.example/hooks/pluto"
  }'`;

const CODE_RESPONSE = `{
  "payment_id": "6aa64d44-faf1-41f0-a7e7-c8f9cce62f2f",
  "status": "pending",
  "amount": "25.00",
  "asset": "USDC",
  "payment_link": "https://pluto.io/pay/6aa64d44-faf1-41f0-a7e7-c8f9cce62f2f"
}`;

function HighlightedCode({
  code,
  language,
}: {
  code: string;
  language: "bash" | "json";
}) {
  const highlighted = Prism.highlight(
    code,
    Prism.languages[language] || Prism.languages.markup,
    language
  );

  return (
    <pre className="ide-code overflow-x-auto p-8">
      <code
        className={`language-${language}`}
        dangerouslySetInnerHTML={{ __html: highlighted }}
      />
    </pre>
  );
}

function HeroSection() {
  return (
    <section className="relative flex flex-col items-center overflow-hidden px-6 pb-24 pt-32 text-center lg:pt-48">
      <div
        className="pointer-events-none absolute inset-0 z-0 opacity-30"
        style={{ backgroundImage: "radial-gradient(circle, #D0D0D0 1px, transparent 1px)", backgroundSize: "40px 40px" }}
      />
      <div className="pointer-events-none absolute inset-0 z-0 bg-gradient-to-b from-transparent via-transparent to-white" />

      <div className="relative z-10 flex flex-col items-center gap-6">
        <span className="inline-flex items-center gap-2 rounded-full border border-[#E8E8E8] bg-white/80 px-5 py-2 font-bold text-[10px] uppercase tracking-[0.2em] text-[#6B6B6B] shadow-sm">
          <span className="h-1.5 w-1.5 rounded-full bg-[#0A0A0A]" />
          Surgical Precision Payments
        </span>

        <h1 className="max-w-5xl text-5xl font-bold leading-[0.9] tracking-tighter text-[#0A0A0A] sm:text-7xl lg:text-[10rem] font-display uppercase">
          PLUTO
        </h1>

        <h2 className="max-w-4xl text-3xl font-bold leading-tight tracking-tight text-[#0A0A0A] sm:text-5xl lg:text-6xl font-display uppercase">
          The Infrastructure for{" "}
          <span className="text-[#6B6B6B]">Modern Commerce</span>
        </h2>

        <p className="max-w-xl font-sans text-base font-medium leading-relaxed text-[#6B6B6B] sm:text-lg">
          Build high-performance payment experiences on Stellar.
          Unmatched speed. Near-zero fees. Global scale.
        </p>

        <div className="mt-6 flex flex-col items-center gap-4 sm:flex-row">
          <Link
            href="/register"
            className="inline-flex items-center gap-2 rounded-xl bg-[var(--pluto-500)] px-10 py-5 text-sm font-bold uppercase tracking-widest text-white shadow-2xl shadow-[var(--pluto-500)]/20 transition-all hover:bg-[var(--pluto-600)] active:scale-[0.97]"
          >
            Get Started →
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center gap-2 rounded-xl border border-[#E8E8E8] bg-white px-10 py-5 text-sm font-bold uppercase tracking-widest text-[#0A0A0A] transition-all hover:bg-[#F5F5F5] active:scale-[0.97]"
          >
            Sign In
          </Link>
        </div>

        <div className="mt-20 flex flex-wrap items-center justify-center gap-x-10 gap-y-3 text-[10px] font-bold uppercase tracking-[0.2em] text-[#6B6B6B]">
          {["Non-custodial", "5-minute integration", "Sandbox included"].map((t) => (
            <span key={t} className="flex items-center gap-2">
              <span className="h-1 w-1 rounded-full bg-[#0A0A0A]" />
              {t}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function FeaturesSection() {
  return (
    <div className="mx-auto max-w-7xl px-6 py-32 lg:py-48">
      <div className="mb-20 text-center">
        <p className="mb-4 font-bold text-[10px] uppercase tracking-[0.4em] text-[#6B6B6B]">Engineered for Performance</p>
        <h2 className="mx-auto max-w-3xl text-5xl font-bold leading-[1.1] text-[#0A0A0A] sm:text-7xl">
          Everything you need to scale
        </h2>
      </div>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => (
          <div
            key={f.title}
            className="group flex flex-col gap-6 rounded-[2rem] border border-[#E8E8E8] bg-white p-10 transition-all duration-300 hover:-translate-y-2 hover:border-[#0A0A0A] hover:shadow-[0_24px_64px_rgba(0,0,0,0.08)]"
          >
            <div className="flex items-center justify-between">
              <span className="text-3xl text-[#0A0A0A] transition-transform duration-300 group-hover:scale-110">{f.icon}</span>
              <span className="rounded-full border border-[#E8E8E8] px-4 py-1.5 font-bold text-[10px] uppercase tracking-widest text-[#6B6B6B]">
                {f.tag}
              </span>
            </div>
            <div>
              <h3 className="text-2xl font-bold text-[#0A0A0A] tracking-tight mb-2">{f.title}</h3>
              <p className="text-sm font-medium leading-relaxed text-[#6B6B6B]">{f.description}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function HowItWorksSection() {
  const steps = [
    { n: "01", title: "Connect", description: "Authenticate your platform with secure API keys." },
    { n: "02", title: "Configure", description: "Set up webhooks to receive real-time payment events." },
    { n: "03", title: "Integrate", description: "Use our single endpoint to generate payment links." },
    { n: "04", title: "Settle", description: "Funds settle instantly to your Stellar wallet." },
  ];

  return (
    <div className="border-y border-[#E8E8E8] bg-[#F9F9F9]">
      <div className="mx-auto max-w-7xl px-6 py-32 lg:py-48">
        <div className="mb-20 text-center">
          <p className="mb-4 font-bold text-[10px] uppercase tracking-[0.4em] text-[#6B6B6B]">Simple Workflow</p>
          <h2 className="mx-auto max-w-3xl text-5xl font-bold leading-[1.1] text-[#0A0A0A] sm:text-7xl">Four steps to scale</h2>
        </div>

        <div className="grid gap-12 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step, i) => (
            <div key={step.title} className="group flex flex-col items-center text-center">
              <div className="mb-8 relative flex h-20 w-20 items-center justify-center rounded-[2rem] bg-white border border-[#E8E8E8] shadow-sm transition-all duration-300 group-hover:border-[#0A0A0A] group-hover:scale-105">
                <span className="text-xl font-bold text-[#0A0A0A] font-display">{step.n}</span>
                {i < steps.length - 1 && (
                  <div className="absolute left-full top-1/2 hidden h-px w-[calc(100%+3rem)] -translate-y-1/2 bg-[#E8E8E8] lg:block" />
                )}
              </div>
              <h3 className="mb-3 text-[10px] font-bold text-[#0A0A0A] uppercase tracking-[0.4em]">{step.title}</h3>
              <p className="text-sm font-medium leading-relaxed text-[#6B6B6B]">{step.description}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function IntegrationModesSection() {
  return (
    <div className="mx-auto max-w-7xl px-6 py-24 lg:py-32">
      <div className="mb-12 text-center">
        <p className="mb-4 font-bold text-[10px] uppercase tracking-[0.4em] text-[#6B6B6B]">Choose Your Mode</p>
        <h2 className="mx-auto max-w-4xl text-4xl font-bold leading-[1.1] text-[#0A0A0A] sm:text-6xl">
          Two ways to integrate PLUTO
        </h2>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-[2rem] border border-[#E8E8E8] bg-white p-8 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#6B6B6B]">Path 01</p>
          <h3 className="mt-3 text-3xl font-bold tracking-tight text-[#0A0A0A]">Subscription + API Key</h3>
          <p className="mt-4 text-sm text-[#6B6B6B]">
            Standard merchant flow. Register, get API key, manage webhooks, analytics, and dashboard operations.
          </p>
          <ul className="mt-6 flex flex-col gap-2 text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]">
            <li>Register merchant</li>
            <li>Create payment links</li>
            <li>Use full merchant feature set</li>
          </ul>
          <Link
            href="/docs/api-guide"
            className="mt-8 inline-flex items-center gap-2 rounded-xl border border-[#E8E8E8] px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-[#0A0A0A] transition-colors hover:bg-[#F5F5F5]"
          >
            View Subscription Guide →
          </Link>
        </div>

        <div className="rounded-[2rem] border border-[var(--pluto-200)] bg-[var(--pluto-50)] p-8 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[var(--pluto-600)]">Path 02</p>
          <h3 className="mt-3 text-3xl font-bold tracking-tight text-[var(--pluto-800)]">x402 Pay-per-request</h3>
          <p className="mt-4 text-sm text-[var(--pluto-700)]">
            No registration required for paid create-payment calls. Your backend pays USDC per request and retries with x402 token.
          </p>
          <ul className="mt-6 flex flex-col gap-2 text-[10px] font-bold uppercase tracking-widest text-[var(--pluto-700)]">
            <li>Handle 402 challenge</li>
            <li>Pay on Stellar</li>
            <li>Retry with payment token</li>
          </ul>
          <Link
            href="/docs/x402-agentic-payments"
            className="mt-8 inline-flex items-center gap-2 rounded-xl bg-[var(--pluto-500)] px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-white transition-colors hover:bg-[var(--pluto-600)]"
          >
            View x402 Guide →
          </Link>
        </div>
      </div>
    </div>
  );
}

function ComparePlansSection() {
  const plans = [
    {
      name: "Free Test Mode",
      badge: "Sandbox",
      description: "Best for development and QA before launch.",
      includes: [
        "Sandbox/test payments only",
        "Up to 50 create-payment calls/day",
        "No production settlement guarantees",
      ],
      cta: { label: "Start Testing", href: "/docs/api-guide" },
    },
    {
      name: "Subscription",
      badge: "Path 01",
      description: "Traditional merchant account with dashboard operations.",
      includes: [
        "Merchant registration + API key",
        "Dashboard + key rotation + merchant settings",
        "Webhook and analytics management",
      ],
      cta: { label: "Use Subscription", href: "/register" },
    },
    {
      name: "x402 Pay-per-request",
      badge: "Path 02",
      description: "No upfront plan required for x402-protected create endpoints.",
      includes: [
        "Pay per protected API request",
        "No merchant registration required to start",
        "Best for agents and automated workloads",
      ],
      cta: { label: "Use x402", href: "/docs/x402-agentic-payments" },
    },
  ];

  return (
    <div className="border-y border-[#E8E8E8] bg-white">
      <div className="mx-auto max-w-7xl px-6 py-24 lg:py-32">
        <div className="mb-12 text-center">
          <p className="mb-4 font-bold text-[10px] uppercase tracking-[0.4em] text-[#6B6B6B]">Compare Plans</p>
          <h2 className="mx-auto max-w-4xl text-4xl font-bold leading-[1.1] text-[#0A0A0A] sm:text-6xl">
            Pick the model that matches your business stage
          </h2>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {plans.map((plan) => (
            <div key={plan.name} className="flex flex-col rounded-[2rem] border border-[#E8E8E8] bg-[#F9F9F9] p-8">
              <span className="self-start rounded-full border border-[#E8E8E8] bg-white px-3 py-1 text-[9px] font-bold uppercase tracking-widest text-[#6B6B6B]">
                {plan.badge}
              </span>
              <h3 className="mt-4 text-2xl font-bold tracking-tight text-[#0A0A0A]">{plan.name}</h3>
              <p className="mt-3 text-sm text-[#6B6B6B]">{plan.description}</p>
              <ul className="mt-6 flex flex-1 flex-col gap-2 text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]">
                {plan.includes.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <Link
                href={plan.cta.href}
                className="mt-8 inline-flex items-center justify-center rounded-xl bg-[#0A0A0A] px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-white transition-colors hover:bg-black"
              >
                {plan.cta.label}
              </Link>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CodeSnippetSection() {
  const [tab, setTab] = useState<"request" | "response">("request");

  return (
    <div className="mx-auto max-w-7xl px-6 py-32 lg:py-48">
      <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-20">
        <div>
          <p className="mb-4 font-bold text-[10px] uppercase tracking-[0.4em] text-[#6B6B6B]">Developer First</p>
          <h2 className="mb-8 text-5xl font-bold leading-[1.1] text-[#0A0A0A] sm:text-7xl">
            One endpoint.<br />Total control.
          </h2>
          <p className="mb-10 max-w-md text-base font-medium leading-relaxed text-[#6B6B6B]">
            Create a payment link with a single request. We manage the Stellar lifecycle, memo matching, and webhook delivery.
          </p>
          <ul className="flex flex-col gap-4">
            {["Atomic transactions", "HMAC-SHA256 signed webhooks", "Customizable metadata", "Scalable architecture"].map((item) => (
              <li key={item} className="flex items-center gap-3 text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#0A0A0A] shrink-0" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="overflow-hidden rounded-2xl border border-[#E8E8E8] bg-[#FAFAFA] shadow-lg">
          <div className="flex items-center border-b border-[#E8E8E8] bg-[#F5F5F5]">
            {(["request", "response"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`relative px-8 py-4 font-bold text-[10px] uppercase tracking-widest transition-colors ${tab === t ? "bg-white text-[#0A0A0A]" : "text-[#6B6B6B] hover:text-[#0A0A0A]"}`}
              >
                {t}
                {tab === t && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#0A0A0A]" />}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-1.5 pr-5">
              {["bg-red-400", "bg-yellow-400", "bg-green-400"].map((c, i) => (
                <span key={i} className={`h-2.5 w-2.5 rounded-full ${c}`} />
              ))}
            </div>
          </div>
          <HighlightedCode
            code={tab === "request" ? CODE_REQUEST : CODE_RESPONSE}
            language={tab === "request" ? "bash" : "json"}
          />
        </div>
      </div>
    </div>
  );
}

function PayWithLinkDemo() {
  const [paid, setPaid] = useState(false);

  return (
    <div className="mx-auto max-w-6xl px-6 py-32 lg:py-48">
      <div className="mb-20 text-center">
        <p className="mb-4 font-bold text-[10px] uppercase tracking-[0.4em] text-[#6B6B6B]">User Experience</p>
        <h2 className="mx-auto max-w-3xl text-5xl font-bold leading-[1.1] text-[#0A0A0A] sm:text-7xl">Precision Checkout</h2>
        <p className="mx-auto mt-6 max-w-lg text-base font-medium text-[#6B6B6B]">
          A sleek, branded checkout experience generated instantly through the PLUTO API.
        </p>
      </div>

      <div className="flex justify-center">
        <div className="relative w-full max-w-sm overflow-hidden rounded-[3rem] border border-[#E8E8E8] bg-white p-10 shadow-[0_20px_60px_rgba(0,0,0,0.06)] transition-all duration-300 hover:-translate-y-2 hover:shadow-[0_32px_80px_rgba(0,0,0,0.1)]">
          <div className="absolute top-0 left-0 right-0 h-1 bg-[#0A0A0A]/5" />

          <div className="mb-8 flex items-center gap-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#F9F9F9] border border-[#E8E8E8] text-lg">⬡</div>
            <div>
              <p className="text-sm font-bold text-[#0A0A0A]">Acme Store</p>
              <p className="text-[10px] font-bold text-[#6B6B6B] uppercase tracking-widest">Order #8842</p>
            </div>
          </div>

          <div className="mb-8 text-center">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#6B6B6B]">Amount Due</p>
            <p className="mt-1 text-5xl font-bold tracking-tight text-[#0A0A0A]">
              25.00 <span className="text-lg font-medium text-[#6B6B6B]">USDC</span>
            </p>
          </div>

          <div className="mb-8 space-y-3 rounded-2xl border border-[#E8E8E8] bg-[#F9F9F9] p-5">
            {[["Network", "Stellar Mainnet"], ["Expires In", "29:42"]].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest">
                <span className="text-[#6B6B6B]">{k}</span>
                <span className="text-[#0A0A0A]">{v}</span>
              </div>
            ))}
          </div>

          {!paid ? (
            <button
              onClick={() => setPaid(true)}
              className="w-full rounded-2xl bg-[var(--pluto-500)] py-5 text-[10px] font-bold uppercase tracking-[0.3em] text-white shadow-xl shadow-[var(--pluto-500)]/10 transition-all hover:bg-[var(--pluto-600)] active:scale-[0.97]"
            >
              Complete Payment
            </button>
          ) : (
            <div className="flex flex-col items-center gap-3 py-2">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 border border-emerald-200">
                <svg className="h-5 w-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-sm font-bold uppercase tracking-widest text-[#0A0A0A]">Transaction Confirmed</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CTASection() {
  return (
    <div className="relative overflow-hidden border-t border-[#E8E8E8]">
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{ backgroundImage: "radial-gradient(circle, #000 1px, transparent 1px)", backgroundSize: "30px 30px" }}
      />
      <div className="relative mx-auto max-w-7xl px-6 py-48 flex flex-col items-center text-center">
        <h2 className="mx-auto max-w-5xl text-6xl font-bold leading-[0.9] text-[#0A0A0A] sm:text-8xl lg:text-9xl uppercase tracking-tighter">
          Deploy  Today.
        </h2>
        <p className="mx-auto mt-10 max-w-lg text-lg font-medium text-[#6B6B6B]">
          Join the next generation of modern commerce. No contracts, no minimums, pure speed.
        </p>
        <div className="mt-14 flex flex-col items-center gap-6 sm:flex-row">
          <Link
            href="/register"
            className="inline-flex items-center gap-2 rounded-xl bg-[var(--pluto-500)] px-12 py-6 text-[10px] font-bold uppercase tracking-widest text-white shadow-2xl shadow-[var(--pluto-500)]/10 transition-all hover:bg-[var(--pluto-600)] active:scale-[0.97]"
          >
            Create Free Account →
          </Link>
          <Link href="/login" className="font-bold text-[10px] uppercase tracking-widest text-[#6B6B6B] transition-colors hover:text-[#0A0A0A]">
            Sign in →
          </Link>
        </div>
      </div>
    </div>
  );
}

function Footer() {
  return (
    <footer className="border-t border-[#E8E8E8] bg-white py-16">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-8 px-6 sm:flex-row">
        <div className="flex items-center gap-8">
          <span className="font-serif text-xl font-bold tracking-tight text-[#0A0A0A]">PLUTO</span>
          <SystemStatus />
        </div>
        <div className="flex gap-10 font-bold text-[10px] uppercase tracking-widest text-[#6B6B6B]">
          {[["Login", "/login"], ["Register", "/register"], ["Dashboard", "/dashboard"], ["Docs", "/docs"], ["x402 Demo", "/x402-demo"]].map(([label, href]) => (
            <Link key={label} href={href} className="transition-colors hover:text-[#0A0A0A]">{label}</Link>
          ))}
        </div>
      </div>
    </footer>
  );
}

export default function Home() {
  return (
    <GuestGuard>
      <main className="relative min-h-screen bg-white overflow-x-hidden">
        <HeroSection />
        <IntegrationModesSection />
        <ComparePlansSection />
        <FeaturesSection />
        <HowItWorksSection />
        <CodeSnippetSection />
        <PayWithLinkDemo />
        <CTASection />
        <Footer />
      </main>
    </GuestGuard>
  );
}
