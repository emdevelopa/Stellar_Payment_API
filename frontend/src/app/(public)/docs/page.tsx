import Link from "next/link";
import { docsManifest } from "@/lib/docs-manifest";

const DOC_TAGS: Record<string, { label: string; color: string }> = {
  "api-guide":              { label: "Path 01 · Subscription",    color: "bg-[#F0F0F0] text-[#6B6B6B]" },
  "hmac-signatures":        { label: "Security",    color: "bg-[#F0F0F0] text-[#6B6B6B]" },
  "x402-agentic-payments":  { label: "Path 02 · x402",  color: "bg-[var(--pluto-100)] text-[var(--pluto-700)]" },
};

export default function DocsIndexPage() {
  return (
    <div className="flex flex-col gap-10">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl border border-[#E8E8E8] bg-[#F9F9F9] px-8 py-12 sm:px-12 sm:py-16">
        <div className="relative z-10 flex flex-col gap-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.4em] text-[var(--pluto-500)]">Developer Portal</p>
          <h1 className="text-4xl font-bold text-[#0A0A0A] tracking-tight sm:text-5xl">
            Build with <span className="text-[var(--pluto-600)]">PLUTO</span>
          </h1>
          <p className="max-w-xl text-base font-medium leading-relaxed text-[#6B6B6B]">
            Integrate global Stellar payments into your application with ease. Choose between standard subscription-based flows or the agentic x402 pay-per-request protocol.
          </p>
          
          <div className="mt-4 flex max-w-md items-center gap-3 rounded-2xl border border-[#E8E8E8] bg-white p-1 shadow-sm focus-within:border-[var(--pluto-400)] focus-within:ring-4 focus-within:ring-[var(--pluto-100)] transition-all">
            <div className="pl-4 text-[#C0C0C0]">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <input 
              type="text" 
              placeholder="Search documentation..." 
              className="flex-1 bg-transparent py-3 pr-4 text-sm font-medium text-[#0A0A0A] outline-none placeholder:text-[#C0C0C0]"
              disabled
            />
          </div>
        </div>
        
        {/* Subtle decorative background element */}
        <div className="absolute -right-20 -top-20 h-80 w-80 rounded-full bg-[var(--pluto-50)] opacity-50 blur-3xl" />
      </div>

      {/* Integration Paths */}
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-bold text-[#0A0A0A] tracking-tight">Integration Paths</h2>
          <p className="text-sm font-medium text-[#6B6B6B]">Select the architecture that fits your project&apos;s needs.</p>
        </div>
        
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {docsManifest.map((doc) => {
            const tag = DOC_TAGS[doc.slug];
            return (
              <Link
                key={doc.slug}
                href={`/docs/${doc.slug}`}
                className="group relative flex flex-col gap-6 rounded-2xl border border-[#E8E8E8] bg-white p-8 transition-all hover:border-[var(--pluto-400)] hover:shadow-[0_20px_40px_rgba(0,0,0,0.04)]"
              >
                <div className="flex items-center justify-between">
                  {tag ? (
                    <span className={`rounded-lg px-2.5 py-1 text-[9px] font-bold uppercase tracking-widest ${tag.color}`}>
                      {tag.label}
                    </span>
                  ) : <div></div>}
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#F9F9F9] text-[#C0C0C0] transition-all group-hover:bg-[var(--pluto-50)] group-hover:text-[var(--pluto-600)]">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                    </svg>
                  </div>
                </div>
                
                <div className="flex flex-col gap-3">
                  <h3 className="text-lg font-bold text-[#0A0A0A] tracking-tight group-hover:text-[var(--pluto-700)] transition-colors">
                    {doc.title}
                  </h3>
                  <p className="text-sm font-medium leading-relaxed text-[#6B6B6B]">
                    {doc.description}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Resources Grid */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "API Reference", href: "/api-docs", icon: "M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" },
          { label: "Dashboard", href: "/dashboard", icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" },
          { label: "Merchant Portal", href: "/register", icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" },
          { label: "Network Status", href: "https://stellarbeat.io", icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" },
        ].map((item) => (
          <Link key={item.label} href={item.href} target={item.href.startsWith("http") ? "_blank" : undefined}
            className="flex items-center gap-4 rounded-2xl border border-[#E8E8E8] bg-white p-5 hover:border-[var(--pluto-300)] hover:bg-[var(--pluto-50)] transition-all group">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#F9F9F9] text-[#6B6B6B] group-hover:bg-white group-hover:text-[var(--pluto-600)] transition-colors">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={item.icon} />
              </svg>
            </div>
            <span className="text-sm font-bold text-[#0A0A0A] group-hover:text-[var(--pluto-700)] transition-colors">{item.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
