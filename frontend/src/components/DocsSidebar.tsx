"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { docsManifest } from "@/lib/docs-manifest";

const DOC_ICONS: Record<string, React.ReactNode> = {
  "api-guide": (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  ),
  "hmac-signatures": (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
    </svg>
  ),
  "x402-agentic-payments": (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  ),
};

export default function DocsSidebar() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1">
      <Link
        href="/docs"
        className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all ${
          pathname === "/docs"
            ? "bg-[var(--pluto-500)] text-white"
            : "text-[#6B6B6B] hover:bg-[var(--pluto-50)] hover:text-[var(--pluto-700)]"
        }`}
      >
        <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
        </svg>
        Overview
      </Link>

      <div className="my-2 h-px bg-[#F0F0F0]" />

      {docsManifest.map((doc) => {
        const href = `/docs/${doc.slug}`;
        const active = pathname === href;
        const isNew = doc.slug === "x402-agentic-payments";

        return (
          <Link
            key={doc.slug}
            href={href}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all ${
              active
                ? "bg-[var(--pluto-500)] text-white"
                : "text-[#6B6B6B] hover:bg-[var(--pluto-50)] hover:text-[var(--pluto-700)]"
            }`}
          >
            <span className={`shrink-0 ${active ? "text-white" : "text-[#6B6B6B]"}`}>
              {DOC_ICONS[doc.slug] ?? (
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              )}
            </span>
            <span className={`flex-1 text-sm font-semibold ${active ? "text-white" : "text-[#0A0A0A]"}`}>
              {doc.title}
            </span>
            {isNew && !active && (
              <span className="rounded-full bg-[var(--pluto-100)] px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-[var(--pluto-600)]">
                New
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
