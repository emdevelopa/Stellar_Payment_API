"use client";

import { useState } from "react";
import Link from "next/link";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

type Step = {
  id: string;
  label: string;
  status: "idle" | "running" | "done" | "error";
  detail?: string;
};

const INITIAL_STEPS: Step[] = [
  { id: "hit",    label: "Hit protected endpoint",         status: "idle" },
  { id: "402",    label: "Receive 402 Payment Required",   status: "idle" },
  { id: "pay",    label: "Send USDC on Stellar testnet",   status: "idle" },
  { id: "verify", label: "Verify payment with PLUTO",      status: "idle" },
  { id: "retry",  label: "Retry with access token",        status: "idle" },
  { id: "done",   label: "Receive protected data",         status: "idle" },
];

function StepRow({ step }: { step: Step }) {
  const icon = {
    idle:    <span className="h-5 w-5 rounded-full border-2 border-[#E8E8E8] bg-white" />,
    running: <span className="h-5 w-5 rounded-full border-2 border-[var(--pluto-400)] bg-[var(--pluto-50)] flex items-center justify-center"><span className="h-2 w-2 rounded-full bg-[var(--pluto-500)] animate-ping" /></span>,
    done:    <span className="h-5 w-5 rounded-full bg-[var(--pluto-500)] flex items-center justify-center"><svg className="h-3 w-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg></span>,
    error:   <span className="h-5 w-5 rounded-full bg-red-500 flex items-center justify-center"><svg className="h-3 w-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg></span>,
  }[step.status];

  return (
    <div className={`flex items-start gap-4 py-3 transition-all ${step.status === "running" ? "opacity-100" : step.status === "idle" ? "opacity-40" : "opacity-100"}`}>
      <div className="mt-0.5 shrink-0">{icon}</div>
      <div className="flex flex-col gap-0.5 flex-1">
        <p className={`text-sm font-bold ${step.status === "done" ? "text-[#0A0A0A]" : step.status === "running" ? "text-[var(--pluto-700)]" : step.status === "error" ? "text-red-600" : "text-[#6B6B6B]"}`}>
          {step.label}
        </p>
        {step.detail && (
          <p className="font-mono text-[10px] text-[#6B6B6B] break-all">{step.detail}</p>
        )}
      </div>
    </div>
  );
}

export default function X402DemoPage() {
  const [steps, setSteps] = useState<Step[]>(INITIAL_STEPS);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paymentDetails, setPaymentDetails] = useState<Record<string, string> | null>(null);

  function updateStep(id: string, patch: Partial<Step>) {
    setSteps(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
  }

  async function runDemo() {
    setRunning(true);
    setResult(null);
    setError(null);
    setPaymentDetails(null);
    setSteps(INITIAL_STEPS);

    try {
      // Step 1: Hit endpoint
      updateStep("hit", { status: "running", detail: `GET ${API_URL}/api/demo/protected` });
      await new Promise(r => setTimeout(r, 600));

      const res1 = await fetch(`${API_URL}/api/demo/protected`);
      const body1 = await res1.json();

      if (res1.status !== 402) {
        updateStep("hit", { status: "error", detail: `Expected 402, got ${res1.status}` });
        setError("Server did not return 402. Make sure X402_PROVIDER_PUBLIC_KEY is set in backend .env and the server is restarted.");
        setRunning(false);
        return;
      }

      updateStep("hit", { status: "done", detail: `GET /api/demo/protected → ${res1.status}` });

      // Step 2: Show 402 details
      updateStep("402", { status: "running" });
      await new Promise(r => setTimeout(r, 400));
      setPaymentDetails(body1);
      updateStep("402", {
        status: "done",
        detail: `${body1.amount} ${body1.asset} → ${body1.recipient?.slice(0, 12)}...  memo: ${body1.memo}`,
      });

      // Step 3: Simulate payment (in browser demo we can't sign a real tx without a wallet)
      // We show what would happen and use a pre-funded demo tx if available
      updateStep("pay", { status: "running", detail: "Submitting USDC payment on Stellar testnet..." });
      await new Promise(r => setTimeout(r, 1200));

      // For the browser demo, we call a demo endpoint that simulates the agent paying
      const payRes = await fetch(`${API_URL}/api/demo/agent-pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body1),
      });

      if (!payRes.ok) {
        const payErr = await payRes.json();
        updateStep("pay", { status: "error", detail: payErr.error || "Payment failed" });
        setError(`Payment step failed: ${payErr.error || "Run node scripts/demoAgent.js in the terminal for the full autonomous demo"}`);
        setRunning(false);
        return;
      }

      const payData = await payRes.json();
      updateStep("pay", { status: "done", detail: `tx_hash: ${payData.tx_hash?.slice(0, 16)}...` });

      // Step 4: Verify
      updateStep("verify", { status: "running", detail: "POST /api/verify-x402..." });
      await new Promise(r => setTimeout(r, 800));

      const verifyRes = await fetch(`${API_URL}/api/verify-x402`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tx_hash: payData.tx_hash,
          expected_amount: body1.amount,
          expected_recipient: body1.recipient,
          memo: body1.memo,
        }),
      });

      const verifyData = await verifyRes.json();
      if (!verifyRes.ok) {
        updateStep("verify", { status: "error", detail: verifyData.error });
        setError(verifyData.error);
        setRunning(false);
        return;
      }

      updateStep("verify", { status: "done", detail: `JWT issued (expires in ${verifyData.expires_in}s)` });

      // Step 5: Retry
      updateStep("retry", { status: "running", detail: "GET /api/demo/protected + X-Payment-Token: ..." });
      await new Promise(r => setTimeout(r, 600));

      const retryRes = await fetch(`${API_URL}/api/demo/protected`, {
        headers: { "X-Payment-Token": verifyData.access_token },
      });
      const retryData = await retryRes.json();

      if (retryRes.status !== 200) {
        updateStep("retry", { status: "error", detail: `Status ${retryRes.status}` });
        setError("Retry failed");
        setRunning(false);
        return;
      }

      updateStep("retry", { status: "done", detail: `200 OK` });

      // Step 6: Done
      updateStep("done", { status: "done", detail: retryData.secret_data });
      setResult(retryData);

    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setRunning(false);
    }
  }

  return (
    <main className="min-h-screen bg-white px-4 py-16">
      <div className="mx-auto max-w-2xl flex flex-col gap-10">

        {/* Header */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B] hover:text-[#0A0A0A] transition-colors">← Back</Link>
          </div>
          <p className="text-[10px] font-bold uppercase tracking-[0.4em] text-[var(--pluto-500)]">x402 Protocol</p>
          <h1 className="text-4xl font-bold text-[#0A0A0A] tracking-tight">Agentic Payments Demo</h1>
          <p className="text-sm font-medium text-[#6B6B6B] max-w-lg leading-relaxed">
            Watch an AI agent autonomously pay for API access using USDC micropayments on Stellar testnet.
            No subscriptions. No API keys. Just crypto.
          </p>
        </div>

        {/* How it works */}
        <div className="rounded-2xl border border-[#E8E8E8] bg-[#F9F9F9] p-6 flex flex-col gap-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]">How x402 works</p>
          <div className="flex flex-col gap-2 font-mono text-xs text-[#0A0A0A]">
            <div className="flex items-center gap-3">
              <span className="text-[var(--pluto-500)] font-bold">→</span>
              <span>Agent hits <code className="bg-white border border-[#E8E8E8] px-1.5 py-0.5 rounded">/api/demo/protected</code></span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-yellow-500 font-bold">←</span>
              <span>Server returns <code className="bg-yellow-50 border border-yellow-200 px-1.5 py-0.5 rounded text-yellow-700">402 Payment Required</code> + payment details</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[var(--pluto-500)] font-bold">→</span>
              <span>Agent sends <code className="bg-white border border-[#E8E8E8] px-1.5 py-0.5 rounded">0.10 USDC</code> on Stellar with memo</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[var(--pluto-500)] font-bold">→</span>
              <span>Agent calls <code className="bg-white border border-[#E8E8E8] px-1.5 py-0.5 rounded">/api/verify-x402</code> → gets JWT</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-emerald-500 font-bold">←</span>
              <span>Agent retries with token → <code className="bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded text-emerald-700">200 OK</code> + data</span>
            </div>
          </div>
        </div>

        {/* Demo runner */}
        <div className="rounded-2xl border border-[#E8E8E8] bg-white overflow-hidden">
          <div className="flex items-center justify-between border-b border-[#E8E8E8] px-6 py-4">
            <div>
              <p className="text-sm font-bold text-[#0A0A0A]">Live Demo</p>
              <p className="text-[10px] text-[#6B6B6B] font-medium">Runs against your local PLUTO backend</p>
            </div>
            <button
              onClick={runDemo}
              disabled={running}
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--pluto-500)] px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest text-white hover:bg-[var(--pluto-600)] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {running ? (
                <><svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>Running…</>
              ) : "Run Agent Demo"}
            </button>
          </div>

          <div className="px-6 py-4 divide-y divide-[#F5F5F5]">
            {steps.map(step => <StepRow key={step.id} step={step} />)}
          </div>

          {/* Payment details box */}
          {paymentDetails && (
            <div className="mx-6 mb-4 rounded-xl border border-[var(--pluto-100)] bg-[var(--pluto-50)] p-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--pluto-600)] mb-3">402 Payment Details</p>
              <div className="grid grid-cols-2 gap-2 font-mono text-xs">
                {[
                  ["Amount", `${paymentDetails.amount} ${paymentDetails.asset}`],
                  ["Network", paymentDetails.network],
                  ["Recipient", `${paymentDetails.recipient?.slice(0,12)}...`],
                  ["Memo", paymentDetails.memo],
                ].map(([k, v]) => (
                  <div key={k} className="flex flex-col gap-0.5">
                    <span className="text-[9px] font-bold uppercase tracking-widest text-[var(--pluto-500)]">{k}</span>
                    <span className="text-[#0A0A0A] font-medium">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Result */}
          {result && (
            <div className="mx-6 mb-6 rounded-xl border border-emerald-200 bg-emerald-50 p-5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 mb-2">Protected Data Received ✓</p>
              <pre className="font-mono text-xs text-emerald-800 whitespace-pre-wrap">{JSON.stringify(result, null, 2)}</pre>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="mx-6 mb-6 rounded-xl border border-red-200 bg-red-50 p-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-red-600 mb-1">Error</p>
              <p className="text-sm text-red-700">{error}</p>
              <p className="text-xs text-red-500 mt-2">For the full autonomous demo, run: <code className="bg-red-100 px-1.5 py-0.5 rounded">node scripts/demoAgent.js</code> in the backend directory.</p>
            </div>
          )}
        </div>

        {/* Terminal demo note */}
        <div className="rounded-2xl border border-[#E8E8E8] bg-[#0A0A0A] p-6">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B] mb-3">Full Autonomous Agent (Terminal)</p>
          <p className="text-xs text-[#6B6B6B] mb-4">The terminal demo runs a fully autonomous agent that generates its own Stellar wallet, funds it, and completes the entire x402 flow without any human interaction.</p>
          <code className="block font-mono text-sm text-emerald-400">$ node scripts/demoAgent.js</code>
        </div>

        {/* Footer */}
        <p className="text-center text-[10px] text-[#C0C0C0] font-medium">
          Built on Stellar testnet · USDC issuer: GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5
        </p>
      </div>
    </main>
  );
}
