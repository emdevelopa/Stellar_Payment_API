"use client";

import GuestGuard from "@/components/GuestGuard";
import SystemStatus from "@/components/SystemStatus";
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
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1], delay }}
      className={className}
    >
      {children}
    </motion.div>
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
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
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
    <svg className="h-4 w-4 shrink-0 text-[#00F5D4]" viewBox="0 0 16 16" fill="none">
      <path d="M3.5 8.5L6.5 11.5L12.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}


const FEATURES = [
  {
    icon: <IconXLM />,
    title: "Native Assets",
    description:
      "Accept XLM and USDC with zero friction. Built-in routing and real-time settlement on the Stellar network.",
    tag: "Multi-Asset",
  },
  {
    icon: <IconWebhook />,
    title: "Precision Webhooks",
    description:
      "Signed payloads and automatic retries. Reliability engineered into every transaction event.",
    tag: "Reliability",
  },
  {
    icon: <IconFees />,
    title: "Extreme Efficiency",
    description:
      "Capitalize on Stellar's sub-cent fees. No monthly minimums—only pay for what you use.",
    tag: "Cost",
  },
];

const CODE_REQUEST = `curl -X POST https://api.pluto.io/v1/create-payment \\
  -H "Authorization: Bearer sk_live_4eC39HqLyjWDarjtT1z..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount": "25.00",
    "asset": "USDC",
    "memo": "order-8842",
    "webhook_url": "https://shop.example/hooks/pluto",
    "redirect_url": "https://shop.example/thanks"
  }'`;

const CODE_RESPONSE = `{
  "id": "pay_9xKp2mVbQw",
  "status": "pending",
  "amount": "25.00",
  "asset": "USDC",
  "payment_url": "https://pluto.io/pay/pay_9xKp2mVbQw",
  "expires_at": "2025-08-15T12:30:00Z"
}`;

function HeroSection() {
  return (
    <Section className="relative flex flex-col items-center px-6 pb-24 pt-32 text-center lg:pt-48">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 flex flex-col items-center gap-6"
      >
        <span className="inline-flex items-center gap-2 rounded-full border border-[#E8E8E8] bg-[#F9F9F9] px-5 py-2 font-bold text-[10px] uppercase tracking-[0.2em] text-[#6B6B6B]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#0A0A0A]" />
          Surgical Precision Payments
        </span>

        <h1 className="max-w-5xl text-7xl font-bold leading-[0.9] tracking-tighter text-[#0A0A0A] sm:text-9xl lg:text-[12rem]">
          PLUTO
        </h1>
        
        <h2 className="max-w-4xl text-4xl font-bold leading-tight tracking-tight text-[#0A0A0A] sm:text-6xl lg:text-7xl">
          The Infrastructure for{" "}
          <span className="text-[#6B6B6B]">
             Modern Commerce
          </span>
        </h2>

        <p className="max-w-xl font-sans text-base font-medium leading-relaxed text-[#6B6B6B] sm:text-lg">
          Build high-performance payment experiences on Stellar. 
          Unmatched speed. Near-zero fees. Global scale.
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.15 }}
        className="relative z-10 mt-12 flex flex-col items-center gap-6 sm:flex-row"
      >
        <Link
          href="/register"
          className="group relative inline-flex items-center gap-2 rounded-lg bg-[#0A0A0A] px-12 py-5 text-sm font-bold uppercase tracking-widest text-white transition-all hover:bg-black active:scale-[0.98]"
        >
          Get Started
          <IconArrow />
        </Link>

        <Link
          href="/login"
          className="inline-flex items-center gap-2 rounded-lg border border-[#E8E8E8] bg-white px-12 py-5 text-sm font-bold uppercase tracking-widest text-[#0A0A0A] transition-all hover:bg-[#F5F5F5]"
        >
          Sign In
        </Link>
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1, delay: 0.5 }}
        className="relative z-10 mt-28 flex flex-wrap items-center justify-center gap-x-12 gap-y-4 text-[10px] font-bold uppercase tracking-[0.2em] text-[#6B6B6B]"
      >
        {["Non-custodial", "5-minute integration", "Sandbox included"].map(
          (t) => (
            <span key={t} className="flex items-center gap-3">
              <div className="h-1 w-1 rounded-full bg-[#0A0A0A]" />
              {t}
            </span>
          )
        )}
      </motion.div>
    </Section>
  );
}

function FeaturesSection() {
  return (
    <div className="mx-auto max-w-7xl px-6 py-32 lg:py-48">
      <Section className="mb-24 text-center">
        <p className="mb-4 font-bold text-[10px] uppercase tracking-[0.4em] text-[#6B6B6B]">
          Engineered for Performance
        </p>
        <h2 className="mx-auto max-w-3xl text-5xl font-bold leading-[1.1] text-[#0A0A0A] sm:text-7xl">
          Everything you need to scale
        </h2>
      </Section>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f, i) => (
          <FadeUp key={f.title} delay={i * 0.1}>
            <div className="group relative flex h-full flex-col gap-8 overflow-hidden rounded-lg border border-[#E8E8E8] bg-white p-10 transition-all duration-500 hover:border-[#0A0A0A]">
              <div className="flex items-center justify-between">
                <div className="text-[#0A0A0A]">{f.icon}</div>
                <span className="rounded-full border border-[#E8E8E8] px-4 py-1.5 font-bold text-[10px] uppercase tracking-widest text-[#6B6B6B]">
                  {f.tag}
                </span>
              </div>

              <h3 className="text-2xl font-bold text-[#0A0A0A]">{f.title}</h3>
              <p className="font-sans text-sm font-medium leading-relaxed text-[#6B6B6B]">
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
    <div className="mx-auto max-w-7xl px-6 py-32 lg:py-48">
      <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-20">
        <Section>
          <p className="mb-4 font-bold text-[10px] uppercase tracking-[0.4em] text-[#6B6B6B]">
            Developer First
          </p>
          <h2 className="mb-8 text-5xl font-bold leading-[1.1] text-[#0A0A0A] sm:text-7xl">
            One endpoint.
            <br />
            Total control.
          </h2>
          <p className="mb-12 max-w-md font-sans text-base font-medium leading-relaxed text-[#6B6B6B]">
            Create a payment link with a single request. We manage the
            Stellar lifecycle, memo matching, and webhook delivery.
          </p>
          <ul className="flex flex-col gap-6">
            {[
              "Atomic transactions",
              "HMAC-SHA256 signed webhooks",
              "Customizable metadata",
              "Scalable architecture",
            ].map((item) => (
              <li
                key={item}
                className="flex items-start gap-4 font-bold text-[10px] uppercase tracking-widest text-[#6B6B6B]"
              >
                <div className="mt-1 h-1 w-1 rounded-full bg-[#0A0A0A]" />
                {item}
              </li>
            ))}
          </ul>
        </Section>

        {/* code block */}
        <Section delay={0.1}>
          <div className="overflow-hidden rounded-lg border border-[#E8E8E8] bg-[#FAFAFA]">
            {/* tabs */}
            <div className="flex items-center border-b border-[#E8E8E8] bg-[#F5F5F5]">
              {(["request", "response"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`relative px-8 py-5 font-bold text-[10px] uppercase tracking-widest transition-colors ${
                    tab === t
                      ? "bg-white text-[#0A0A0A]"
                      : "text-[#6B6B6B] hover:text-[#0A0A0A]"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            {/* code */}
            <div className="overflow-x-auto p-10">
              <pre className="font-mono text-[13px] leading-relaxed text-[#0A0A0A]">
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
    <div className="mx-auto max-w-6xl px-6 py-32 lg:py-48">
      <Section className="mb-24 text-center">
        <p className="mb-4 font-bold text-[10px] uppercase tracking-[0.4em] text-[#6B6B6B]">
          User Experience
        </p>
        <h2 className="mx-auto max-w-3xl text-5xl font-bold leading-[1.1] text-[#0A0A0A] sm:text-7xl">
          Precision Checkout
        </h2>
        <p className="mx-auto mt-8 max-w-lg font-sans text-base font-medium text-[#6B6B6B]">
          A sleek, branded checkout experience generated instantly through the PLUTO API.
        </p>
      </Section>

      <FadeUp className="flex justify-center">
        <div className="relative w-full max-w-md px-4">
          <div className="relative overflow-hidden rounded-[3rem] border border-[#E8E8E8] bg-white p-12 shadow-[0_20px_80px_rgb(0,0,0,0.06)]">
            <div className="absolute top-0 left-0 right-0 h-1 bg-[#0A0A0A]/5" />
            
            {/* Header */}
            <div className="mb-10 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#F9F9F9] border border-[#E8E8E8] text-[#0A0A0A]">
                   <IconXLM />
                </div>
                <div>
                  <p className="text-sm font-bold text-[#0A0A0A]">Acme Store</p>
                  <p className="text-[10px] font-bold text-[#6B6B6B] uppercase tracking-widest">Order #8842</p>
                </div>
              </div>
            </div>

            {/* Amount */}
            <div className="mb-12 text-center">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#6B6B6B]">
                Amount Due
              </p>
              <p className="mt-2 text-6xl font-bold tracking-tight text-[#0A0A0A]">
                25.00{" "}
                <span className="text-xl font-medium text-[#6B6B6B]">
                  USDC
                </span>
              </p>
            </div>

            {/* Details Table */}
            <div className="mb-12 space-y-3 rounded-2xl border border-[#E8E8E8] bg-[#F9F9F9] p-6 focus-within:border-[#0A0A0A] transition-colors">
              <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest">
                <span className="text-[#6B6B6B]">Network</span>
                <span className="text-[#0A0A0A]">Stellar Mainnet</span>
              </div>
              <div className="h-px bg-[#E8E8E8]" />
              <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest">
                <span className="text-[#6B6B6B]">Expires In</span>
                <span className="text-[#0A0A0A]">29:42</span>
              </div>
            </div>

            {/* Action */}
            {!paid ? (
              <button
                onClick={() => setPaid(true)}
                className="w-full rounded-2xl bg-[#0A0A0A] py-6 text-[10px] font-bold uppercase tracking-[0.3em] text-white shadow-xl shadow-black/10 transition-all hover:bg-black active:scale-[0.98]"
              >
                Complete Payment
              </button>
            ) : (
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="flex flex-col items-center gap-4 py-4"
              >
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#F9F9F9] border border-[#E8E8E8] text-green-500">
                  <IconCheck />
                </div>
                <p className="text-sm font-bold uppercase tracking-widest text-[#0A0A0A]">
                  Transaction Confirmed
                </p>
              </motion.div>
            )}
          </div>
        </div>
      </FadeUp>
    </div>
  );
}

function HowItWorksSection() {
  const steps = [
    { title: "Connect", description: "Authenticate your platform with secure API keys." },
    { title: "Configure", description: "Set up webhooks to receive real-time payment events." },
    { title: "Integrate", description: "Use our single endpoint to generate payment links." },
    { title: "Settle", description: "Funds settle instantly to your Stellar wallet." },
  ];

  return (
    <div className="mx-auto max-w-7xl px-6 py-32 lg:py-48 border-y border-[#E8E8E8] bg-[#F9F9F9]">
      <Section className="mb-24 text-center">
        <p className="mb-4 font-bold text-[10px] uppercase tracking-[0.4em] text-[#6B6B6B]">
          Simple Workflow
        </p>
        <h2 className="mx-auto max-w-3xl text-5xl font-bold leading-[1.1] text-[#0A0A0A] sm:text-7xl">
          Four steps to scale
        </h2>
      </Section>

      <div className="grid gap-16 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((step, i) => (
          <FadeUp key={step.title} delay={i * 0.1}>
            <div className="relative flex flex-col items-center text-center">
              <div className="mb-8 flex h-20 w-20 items-center justify-center rounded-[2.5rem] bg-white border border-[#E8E8E8] shadow-[0_10px_40px_rgb(0,0,0,0.03)] text-2xl font-bold text-[#0A0A0A]">
                {i + 1}
              </div>
              <h3 className="mb-4 text-xl font-bold text-[#0A0A0A] uppercase tracking-widest">{step.title}</h3>
              <p className="font-sans text-sm font-medium leading-relaxed text-[#6B6B6B]">
                {step.description}
              </p>
            </div>
          </FadeUp>
        ))}
      </div>
    </div>
  );
}

function CTASection() {
  return (
    <div className="relative mx-auto max-w-7xl px-6 py-48">
      <Section className="relative z-10 flex flex-col items-center text-center">
        <h2 className="mx-auto max-w-5xl text-6xl font-bold leading-[0.9] text-[#0A0A0A] sm:text-8xl lg:text-9xl uppercase tracking-tighter">
          Deploy <br /> Today.
        </h2>
        <p className="mx-auto mt-10 max-w-lg font-sans text-lg font-medium text-[#6B6B6B]">
          Join the next generation of modern commerce. No contracts, no minimums, pure speed.
        </p>
        <div className="mt-16 flex flex-col items-center gap-8 sm:flex-row">
          <Link
            href="/register"
            className="group relative inline-flex items-center gap-2 rounded-lg bg-[#0A0A0A] px-12 py-6 text-[10px] font-bold uppercase tracking-widest text-white transition-all hover:bg-black active:scale-[0.98] shadow-2xl shadow-black/10"
          >
            Create Free Account
            <IconArrow />
          </Link>
          <Link
            href="/login"
            className="font-bold text-[10px] uppercase tracking-widest text-[#6B6B6B] transition-colors hover:text-[#0A0A0A]"
          >
            Sign in &rarr;
          </Link>
        </div>
      </Section>
    </div>
  );
}

function Footer() {
  return (
    <footer className="border-t border-[#E8E8E8] bg-white py-24">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-12 px-6 sm:flex-row">
        <div className="flex items-center gap-12">
          <span className="font-serif text-xl font-bold tracking-tight text-[#0A0A0A]">
            PLUTO
          </span>
          <SystemStatus />
        </div>
        <div className="flex gap-12 font-bold text-[10px] uppercase tracking-widest text-[#6B6B6B]">
          <Link href="/login" className="transition-colors hover:text-[#0A0A0A]">Login</Link>
          <Link href="/register" className="transition-colors hover:text-[#0A0A0A]">Register</Link>
          <Link href="/dashboard" className="transition-colors hover:text-[#0A0A0A]">Dashboard</Link>
          <Link href="/docs" className="transition-colors hover:text-[#0A0A0A]">Docs</Link>
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
