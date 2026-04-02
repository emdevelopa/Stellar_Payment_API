"use client";

import { useMerchantApiKey, useMerchantMetadata } from "@/lib/merchant-store";
import { useState } from "react";
import CopyButton from "@/components/CopyButton";
import { toast } from "sonner";
import Link from "next/link";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export default function ApiKeysPage() {
  const storedApiKey = useMerchantApiKey();
  const merchant = useMerchantMetadata();
  const [isRotating, setIsRotating] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [activeTab, setActiveTab] = useState<"api" | "x402">("api");

  const displayKey = storedApiKey
    ? revealed
      ? storedApiKey
      : storedApiKey.slice(0, 7) + "•".repeat(storedApiKey.length - 13) + storedApiKey.slice(-6)
    : "sk_••••••••••••••••••••••••";

  const handleRotate = async () => {
    if (!confirm("Rotate your API key? The old one will be invalidated immediately.")) return;
    setIsRotating(true);
    try {
      const res = await fetch(`${API_URL}/api/rotate-key`, {
        method: "POST",
        headers: { "x-api-key": storedApiKey || "" },
      });
      if (!res.ok) throw new Error("Rotation failed");
      toast.success("API key rotated. Update your integrations.");
    } catch {
      toast.error("Failed to rotate API key");
    } finally {
      setIsRotating(false);
    }
  };

  // The merchant's recipient address is their Stellar wallet for receiving payments
  const providerAddress = merchant?.id ? `[your-stellar-address]` : null;

  const middlewareSnippet = `import { x402Middleware } from 'pluto-x402';

// Protect any Express route — agents pay 0.10 USDC per request
app.get('/api/my-premium-data',
  x402Middleware({
    amount: '0.10',
    recipient: '${providerAddress || "G...YOUR_STELLAR_ADDRESS"}',
    plutoVerifyUrl: '${API_URL}/api/verify-x402',
  }),
  (req, res) => {
    res.json({ data: 'premium content', paid_by: req.x402.memo });
  }
);`;

  const curlSnippet = `# 1. Hit the endpoint — get 402
curl ${API_URL}/api/demo/protected

# 2. Send USDC on Stellar (use your wallet or the demo agent)
# memo must match the one in the 402 response

# 3. Verify payment → get access token
curl -X POST ${API_URL}/api/verify-x402 \\
  -H "Content-Type: application/json" \\
  -d '{"tx_hash":"<hash>","expected_amount":"0.10","expected_recipient":"<G...>","memo":"<memo>"}'

# 4. Use the token
curl ${API_URL}/api/demo/protected \\
  -H "X-Payment-Token: <token>"`;

  return (
    <div className="flex flex-col gap-8 animate-in fade-in duration-500">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.4em] text-[#6B6B6B] mb-2">Developer</p>
        <h1 className="text-4xl font-bold text-[#0A0A0A] tracking-tight">API & x402</h1>
        <p className="mt-2 text-sm font-medium text-[#6B6B6B]">
          Manage your API key and set up x402 pay-per-request for your own endpoints.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl border border-[#E8E8E8] bg-[#F5F5F5] p-1 w-fit">
        {(["api", "x402"] as const).map(tab => (
          <button key={tab} type="button" onClick={() => setActiveTab(tab)}
            className={`rounded-lg px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest transition-all ${activeTab === tab ? "bg-white text-[#0A0A0A] shadow-sm" : "text-[#6B6B6B] hover:text-[#0A0A0A]"}`}>
            {tab === "x402" ? "x402 Agentic" : "API Keys"}
          </button>
        ))}
      </div>

      {activeTab === "api" && (
        <div className="max-w-xl rounded-2xl border border-[#E8E8E8] bg-white p-8 flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]">Live API Key</label>
              <button type="button" onClick={() => setRevealed(v => !v)}
                className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B] hover:text-[#0A0A0A] transition-colors">
                {revealed ? "Hide" : "Reveal"}
              </button>
            </div>
            <div className="flex items-center gap-2 overflow-hidden rounded-xl border border-[#E8E8E8] bg-[#F9F9F9] p-1 pl-4">
              <code className={`flex-1 truncate text-sm font-bold tracking-widest ${revealed ? "text-[#0A0A0A]" : "text-[#E8E8E8]"}`}>
                {displayKey}
              </code>
              {revealed && storedApiKey && <CopyButton text={storedApiKey} />}
            </div>
            <p className="text-[10px] font-medium text-[#6B6B6B]">
              Pass as <code className="text-[#0A0A0A]">x-api-key</code> header on every request.
            </p>
          </div>

          <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-800">
            <p className="font-bold mb-1">Security Warning</p>
            <p className="text-yellow-700 text-xs leading-relaxed">
              Never share your secret API keys in publicly accessible areas like GitHub, client-side code, or public forums.
            </p>
          </div>

          <div className="flex justify-end">
            <button onClick={handleRotate} disabled={isRotating}
              className="rounded-xl border border-red-200 bg-red-50 px-6 py-2.5 text-sm font-bold text-red-600 transition hover:bg-red-100 disabled:opacity-50">
              {isRotating ? "Rotating..." : "Rotate API Key"}
            </button>
          </div>
        </div>
      )}

      {activeTab === "x402" && (
        <div className="flex flex-col gap-6 max-w-2xl">

          {/* What is x402 */}
          <div className="rounded-2xl border border-[var(--pluto-100)] bg-[var(--pluto-50)] p-6 flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--pluto-500)]">
                <svg className="h-4 w-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <p className="text-sm font-bold text-[var(--pluto-800)]">x402 Pay-Per-Request</p>
            </div>
            <p className="text-sm text-[var(--pluto-700)] leading-relaxed">
              Protect any of your API endpoints so AI agents pay USDC per request — no subscriptions, no API keys.
              PLUTO verifies the on-chain payment and issues a short-lived access token.
            </p>
            <Link href="/x402-demo" target="_blank"
              className="self-start text-[10px] font-bold uppercase tracking-widest text-[var(--pluto-600)] hover:text-[var(--pluto-800)] transition-colors">
              See live demo →
            </Link>
          </div>

          {/* Flow diagram */}
          <div className="rounded-2xl border border-[#E8E8E8] bg-white p-6 flex flex-col gap-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]">How it works</p>
            <div className="flex flex-col gap-2">
              {[
                { arrow: "→", color: "text-[#6B6B6B]", text: "Agent hits your endpoint" },
                { arrow: "←", color: "text-yellow-600", text: "402 Payment Required + payment details" },
                { arrow: "→", color: "text-[#6B6B6B]", text: "Agent sends USDC on Stellar with memo" },
                { arrow: "→", color: "text-[#6B6B6B]", text: "Agent calls PLUTO /api/verify-x402 → gets JWT" },
                { arrow: "←", color: "text-emerald-600", text: "200 OK — agent gets your data" },
              ].map((row, i) => (
                <div key={i} className="flex items-center gap-3 font-mono text-xs">
                  <span className={`font-bold w-4 ${row.color}`}>{row.arrow}</span>
                  <span className="text-[#0A0A0A]">{row.text}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Middleware snippet */}
          <div className="rounded-2xl border border-[#E8E8E8] bg-white overflow-hidden">
            <div className="flex items-center justify-between border-b border-[#E8E8E8] bg-[#F9F9F9] px-5 py-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]">Middleware (Express)</p>
              <CopyButton text={middlewareSnippet} />
            </div>
            <pre className="overflow-x-auto p-5 font-mono text-xs text-[#0A0A0A] leading-relaxed bg-[#0A0A0A]">
              <code className="text-emerald-400">{middlewareSnippet}</code>
            </pre>
          </div>

          {/* cURL test */}
          <div className="rounded-2xl border border-[#E8E8E8] bg-white overflow-hidden">
            <div className="flex items-center justify-between border-b border-[#E8E8E8] bg-[#F9F9F9] px-5 py-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]">Test with cURL</p>
              <CopyButton text={curlSnippet} />
            </div>
            <pre className="overflow-x-auto p-5 font-mono text-xs leading-relaxed bg-[#0A0A0A]">
              <code className="text-slate-300">{curlSnippet}</code>
            </pre>
          </div>

          {/* Run demo */}
          <div className="rounded-2xl border border-[#E8E8E8] bg-[#F9F9F9] p-5 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-bold text-[#0A0A0A]">Run the autonomous agent demo</p>
              <code className="text-xs font-mono text-[var(--pluto-600)]">node scripts/demoAgent.js</code>
            </div>
            <Link href="/x402-demo" target="_blank"
              className="shrink-0 rounded-xl bg-[var(--pluto-500)] px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest text-white hover:bg-[var(--pluto-600)] transition-all">
              Browser Demo
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
