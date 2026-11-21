"use client";

import React from 'react';
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
  const [search, setSearch] = React.useState('');
  const [activeSlug, setActiveSlug] = React.useState('');
  const listRef = React.useRef<HTMLUListElement>(null);

  // Filter docs based on search
  const filteredDocs = React.useMemo(() => {
    if (!search) return docsManifest;
    return docsManifest.filter((doc) =>
      doc.title.toLowerCase().includes(search.toLowerCase()) ||
      doc.slug.toLowerCase().includes(search.toLowerCase())
    );
  }, [search]);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    const items = listRef.current?.querySelectorAll('a[data-slug]');
    if (!items?.length) return;
    const currentIndex = Array.from(items).findIndex((el) => el.getAttribute('aria-current') === 'page');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = items[(currentIndex + 1) % items.length];
      (next as HTMLElement).focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = items[(currentIndex - 1 + items.length) % items.length];
      (prev as HTMLElement).focus();
    } else if (e.key === 'Escape') {
      (e.target as HTMLElement).blur();
    }
  };

  // Scroll spy via IntersectionObserver
  React.useEffect(() => {
    const callback: IntersectionObserverCallback = (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const slug = entry.target.getAttribute('data-slug');
          if (slug) setActiveSlug(slug);
        }
      });
    };
    const observer = new IntersectionObserver(callback, { rootMargin: '0px 0px -80% 0px' });
    const sections = document.querySelectorAll('section[data-slug]');
    sections.forEach((sec) => observer.observe(sec));
    return () => observer.disconnect();
  }, []);

  return (
    <nav aria-label="Documentation sidebar" className="flex flex-col gap-1" onKeyDown={handleKeyDown}>
      <input
        type="search"
        placeholder="Search…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label="Search documentation"
        className="mb-2 rounded border px-2 py-1 text-sm"
      />
      <ul ref={listRef} className="flex flex-col gap-1" role="list">
        <li>
          <Link
            href="/docs"
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all ${
              pathname === '/docs' ? 'bg-[var(--pluto-500)] text-white' : 'text-[#6B6B6B] hover:bg-[var(--pluto-50)] hover:text-[var(--pluto-700)]'
            }`}
            aria-current={pathname === '/docs' ? 'page' : undefined}
            data-slug="overview"
          >
            <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg>
            Overview
          </Link>
        </li>
        {filteredDocs.map((doc) => {
          const href = `/docs/${doc.slug}`;
          const active = pathname === href;
          const isNew = doc.slug === 'x402-agentic-payments';
          return (
            <li key={doc.slug}>
              <Link
                href={href}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all ${
                  active
                    ? 'bg-[var(--pluto-500)] text-white'
                    : 'text-[#6B6B6B] hover:bg-[var(--pluto-50)] hover:text-[var(--pluto-700)]'
                }`}
                aria-current={active ? 'page' : undefined}
                aria-expanded="false"
                data-slug={doc.slug}
              >
                <span className={`shrink-0 ${active ? 'text-white' : 'text-[#6B6B6B]'}`}>
                  {DOC_ICONS[doc.slug] ?? (
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                  )}
                </span>
                <span className={`flex-1 text-sm font-semibold ${active ? 'text-white' : 'text-[#0A0A0A]'}`}> {doc.title} </span>
                {isNew && !active && (
                  <span className="rounded-full bg-[var(--pluto-100)] px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-[var(--pluto-600)]">
                    New
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
