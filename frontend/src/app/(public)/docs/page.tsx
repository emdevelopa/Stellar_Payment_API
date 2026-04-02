import Link from "next/link";
import { docsManifest } from "@/lib/docs-manifest";

const DOC_TAGS: Record<string, { label: string; color: string }> = {
  "api-guide":              { label: "Core API",    color: "bg-[#F0F0F0] text-[#6B6B6B]" },
  "hmac-signatures":        { label: "Security",    color: "bg-[#F0F0F0] text-[#6B6B6B]" },
  "x402-agentic-payments":  { label: "New · x402",  color: "bg-[var(--pluto-100)] text-[var(--pluto-700)]" },
};

export default function DocsIndexPage() {
  return (
    <div className="flex flex-col gap-8">
      {/* Hero */}
      <div className="rounded-2xl border border-[#E8E8E8] bg-[#F9F9F9] px-8 py-10">
        <p className="text-[10px] font-bold uppercase tracking-[0.4em] text-[var(--pluto-500)]">Documentation</p>
        <h1 className="mt-3 text-3xl font-bold text-[#0A0A0A] tracking-tight">PLUTO Developer Guides</h1>
        <p className="mt-3 max-w-2xl text-sm font-medium leading-relaxed text-[#6B6B6B]">
          Everything you need to integrate PLUTO — from creating payment links to verifying webhooks and building autonomous AI agents that pay per API call.
        </p>
      </div>

      {/* Doc cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {docsManifest.map((doc) => {
          const tag = DOC_TAGS[doc.slug];
          return (
            <Link
              key={doc.slug}
              href={`/docs/${doc.slug}`}
              className="group flex flex-col gap-4 rounded-2xl border border-[#E8E8E8] bg-white p-6 transition-all hover:border-[var(--pluto-400)] hover:shadow-[0_8px_32px_rgba(74,111,165,0.1)]"
            >
              {tag && (
                <span className={`self-start rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-widest ${tag.color}`}>
                  {tag.label}
                </span>
              )}
              <div className="flex flex-col gap-2 flex-1">
                <h3 className="text-base font-bold text-[#0A0A0A] tracking-tight group-hover:text-[var(--pluto-700)] transition-colors">
                  {doc.title}
                </h3>
                <p className="text-sm font-medium leading-relaxed text-[#6B6B6B]">{doc.description}</p>
              </div>
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-[var(--pluto-500)] transition-transform group-hover:translate-x-1">
                Read guide
                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </Link>
          );
        })}
      </div>

      {/* Quick links */}
      <div className="rounded-2xl border border-[#E8E8E8] bg-white p-6">
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B] mb-4">Quick Links</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            { label: "x402 Live Demo", href: "/x402-demo", desc: "Watch an agent pay autonomously" },
            { label: "API Docs (Swagger)", href: "/api-docs", desc: "Interactive API explorer" },
            { label: "Register as Merchant", href: "/register", desc: "Get your API key" },
            { label: "Dashboard", href: "/dashboard", desc: "Manage payments" },
          ].map(item => (
            <Link key={item.href} href={item.href}
              className="flex items-center gap-3 rounded-xl border border-[#E8E8E8] bg-[#F9F9F9] px-4 py-3 hover:border-[var(--pluto-300)] hover:bg-[var(--pluto-50)] transition-all group">
              <div className="flex flex-col gap-0.5 flex-1">
                <span className="text-sm font-bold text-[#0A0A0A] group-hover:text-[var(--pluto-700)] transition-colors">{item.label}</span>
                <span className="text-[10px] text-[#6B6B6B]">{item.desc}</span>
              </div>
              <svg className="h-4 w-4 text-[#C0C0C0] group-hover:text-[var(--pluto-500)] transition-colors shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
