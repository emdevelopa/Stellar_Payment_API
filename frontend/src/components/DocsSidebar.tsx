"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { docsManifest, type DocEntry, type DocSection } from "@/lib/docs-manifest";

const EDGE_SWIPE_ZONE_PX = 32;
const SWIPE_THRESHOLD_PX = 60;

export interface DocsSidebarPreferenceAction {
  type: "bookmark" | "collapse";
  slug: string;
  value: boolean;
}

export interface DocsSidebarToast {
  id: string;
  message: string;
  variant: "error" | "info";
  retryAction?: DocsSidebarPreferenceAction;
}

export interface DocsSidebarProps {
  /** Initial set of bookmarked documentation slugs. */
  initialBookmarks?: string[];
  /** Optional async persistence handler; rejections trigger optimistic rollback + toast feedback. */
  onSyncPreference?: (action: DocsSidebarPreferenceAction) => Promise<void>;
  /** Optional callback invoked whenever a toast notification is emitted. */
  onToast?: (notification: DocsSidebarToast) => void;
}

const DOC_ICONS: Record<string, React.ReactNode> = {
  "api-guide": (
    <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  ),
  "hmac-signatures": (
    <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
    </svg>
  ),
  "x402-agentic-payments": (
    <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  ),
};

export default function DocsSidebar({
  initialBookmarks = [],
  onSyncPreference,
  onToast,
}: DocsSidebarProps = {}) {
  const pathname = usePathname();
  const [search, setSearch] = React.useState('');
  const [activeSlug, setActiveSlug] = React.useState('');
  const listRef = React.useRef<HTMLUListElement>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [activeSectionId, setActiveSectionId] = useState<string>("");
  const [liveAnnouncement, setLiveAnnouncement] = useState("");

  const searchInputRef = useRef<HTMLInputElement>(null);
  const navContainerRef = useRef<HTMLElement>(null);

  // Expanded docs map
  const [expandedDocs, setExpandedDocs] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const doc of docsManifest) {
      // Auto-expand current active doc
      if (pathname === `/docs/${doc.slug}` || pathname.startsWith(`/docs/${doc.slug}/`)) {
        initial[doc.slug] = true;
      }
    }
    return initial;
  });

  // Keep current page expanded when route changes
  useEffect(() => {
    for (const doc of docsManifest) {
      if (pathname === `/docs/${doc.slug}` || pathname.startsWith(`/docs/${doc.slug}/`)) {
        setExpandedDocs((prev) => ({ ...prev, [doc.slug]: true }));
      }
    }
  }, [pathname]);

  // Active section spy using IntersectionObserver (#1814)
  useEffect(() => {
    if (typeof window === "undefined" || typeof IntersectionObserver === "undefined") {
      return;
    }

    const headingElements = Array.from(
      document.querySelectorAll<HTMLElement>("main h2[id], main h3[id], section h2[id], section h3[id]")
    );

    if (headingElements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.target.id) {
            setActiveSectionId(entry.target.id);
            break;
          }
        }
      },
      {
        rootMargin: "-20% 0px -70% 0px",
        threshold: 0,
      }
    );

    for (const el of headingElements) {
      observer.observe(el);
    }

    return () => {
      observer.disconnect();
    };
  }, [pathname]);

  // Filtered docs and sub-sections based on search query (#1814)
  const filteredDocs = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) {
      return docsManifest.map((doc) => ({
        ...doc,
        matchingSections: doc.sections || [],
      }));
    }

    const results: (DocEntry & { matchingSections: DocSection[] })[] = [];

    for (const doc of docsManifest) {
      const titleMatch = doc.title.toLowerCase().includes(q);
      const descMatch = doc.description.toLowerCase().includes(q);
      const matchingSections = (doc.sections || []).filter((s) =>
        s.title.toLowerCase().includes(q)
      );

      if (titleMatch || descMatch || matchingSections.length > 0) {
        results.push({
          ...doc,
          matchingSections: matchingSections.length > 0 ? matchingSections : doc.sections || [],
        });
      }
    }

    return results;
  }, [searchQuery]);

  // Auto-expand search results and update screen reader live region announcement
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setLiveAnnouncement("");
      return;
    }

    const count = filteredDocs.length;
    if (count === 0) {
      setLiveAnnouncement(`No documentation matches found for "${q}"`);
    } else {
      setLiveAnnouncement(
        `${count} documentation ${count === 1 ? "guide" : "guides"} found matching "${q}"`
      );
    }

    // Auto expand all matched docs during search
    const expanded: Record<string, boolean> = {};
    for (const doc of filteredDocs) {
      expanded[doc.slug] = true;
    }
    setExpandedDocs((prev) => ({ ...prev, ...expanded }));
  }, [searchQuery, filteredDocs]);

  // Toggle collapse state
  const toggleDoc = useCallback((slug: string) => {
    setExpandedDocs((prev) => ({
      ...prev,
      [slug]: !prev[slug],
    }));
  }, []);

  // Keyboard focus management: ArrowDown from search box into navigation list (#1814)
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!navContainerRef.current) return;
      const firstInteractive = navContainerRef.current.querySelector<HTMLElement>(
        "a, button"
      );
      firstInteractive?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setSearchQuery("");
    }
  };

  // Keyboard navigation within the sidebar list (Arrow keys, Home, End)
  const handleNavKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    const target = e.target as HTMLElement;
    if (!target) return;

    if (!navContainerRef.current) return;

    const items = Array.from(
      navContainerRef.current.querySelectorAll<HTMLElement>(
        "a:not([tabindex='-1']), button:not([tabindex='-1'])"
      )
    ).filter((el) => !el.hasAttribute("disabled") && el.getAttribute("aria-hidden") !== "true");

    const currentIndex = items.indexOf(target);
    if (currentIndex === -1) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      const nextIndex = (currentIndex + 1) % items.length;
      items[nextIndex]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (currentIndex === 0) {
        searchInputRef.current?.focus();
      } else {
        const prevIndex = (currentIndex - 1 + items.length) % items.length;
        items[prevIndex]?.focus();
      }
    } else if (e.key === "Home") {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      items[items.length - 1]?.focus();
    } else if (e.key === "ArrowRight") {
      // Expand if targeted element has aria-expanded="false"
      const expandBtn = target.closest("[data-doc-slug]")?.querySelector<HTMLButtonElement>("button[aria-expanded]");
      if (expandBtn && expandBtn.getAttribute("aria-expanded") === "false") {
        e.preventDefault();
        expandBtn.click();
      }
    } else if (e.key === "ArrowLeft") {
      // Collapse if targeted element has aria-expanded="true"
      const expandBtn = target.closest("[data-doc-slug]")?.querySelector<HTMLButtonElement>("button[aria-expanded]");
      if (expandBtn && expandBtn.getAttribute("aria-expanded") === "true") {
        e.preventDefault();
        expandBtn.click();
      }
    }
  };

  const isOverviewActive = pathname === "/docs";

  return (
    <nav
      ref={navContainerRef}
      aria-label="Documentation navigation"
      className="flex flex-col gap-3"
      onKeyDown={handleNavKeyDown}
    >
      {/* Screen reader live announcement for search results (WCAG 2.1 AA: #1814) */}
      <div role="status" aria-live="polite" className="sr-only">
        {liveAnnouncement}
      </div>

      {/* Search Anchor Navigation input (#1814) */}
      <div className="relative">
        <label htmlFor="docs-search-input" className="sr-only">
          Search documentation sections
        </label>
        <div className="relative flex items-center">
          <svg
            className="pointer-events-none absolute left-3 h-4 w-4 text-[#9CA3AF]"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            id="docs-search-input"
            ref={searchInputRef}
            type="search"
            role="searchbox"
            aria-label="Search documentation"
            placeholder="Filter documentation..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            className="w-full rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] py-2 pl-9 pr-8 text-xs font-medium text-[#111827] placeholder-[#6B7280] transition-colors focus:border-[var(--pluto-500)] focus:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pluto-500)]"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              aria-label="Clear search query"
              className="absolute right-2.5 flex h-4 w-4 items-center justify-center rounded-full text-[#9CA3AF] hover:text-[#111827] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pluto-500)]"
            >
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Top Overview Link */}
      {(!searchQuery || "overview".includes(searchQuery.toLowerCase())) && (
        <Link
          href="/docs"
          aria-current={isOverviewActive ? "page" : undefined}
          className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pluto-500)] focus-visible:ring-offset-2 ${
            isOverviewActive
              ? "bg-[var(--pluto-500)] text-white shadow-sm"
              : "text-[#4B5563] hover:bg-[var(--pluto-50)] hover:text-[var(--pluto-700)]"
          }`}
        >
          <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
          Overview
        </Link>
      )}

      <div className="my-1 h-px bg-[#F0F0F0]" aria-hidden="true" />

      {/* Collapsible Documentation Hierarchy (#1814) */}
      <div className="flex flex-col gap-1.5" role="list">
        {filteredDocs.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-[#6B7280]">
            No documentation matching "{searchQuery}"
          </p>
        ) : (
          filteredDocs.map((doc) => {
            const href = `/docs/${doc.slug}`;
            const isDocActive = pathname === href;
            const isNew = doc.slug === "x402-agentic-payments";
            const isExpanded = !!expandedDocs[doc.slug];
            const hasSubsections = (doc.matchingSections?.length || 0) > 0;

            return (
              <div
                key={doc.slug}
                data-doc-slug={doc.slug}
                className="flex flex-col rounded-xl"
                role="listitem"
              >
                {/* Doc row: link and collapse/expand trigger */}
                <div
                  className={`group flex items-center justify-between gap-1 rounded-xl px-3 py-2 transition-all ${
                    isDocActive
                      ? "bg-[var(--pluto-500)] text-white shadow-sm"
                      : "text-[#4B5563] hover:bg-[var(--pluto-50)] hover:text-[var(--pluto-700)]"
                  }`}
                >
                  <Link
                    href={href}
                    aria-current={isDocActive ? "page" : undefined}
                    className="flex flex-1 items-center gap-3 py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pluto-500)] focus-visible:ring-offset-2 rounded-lg"
                  >
                    <span className={`shrink-0 ${isDocActive ? "text-white" : "text-[#6B7280] group-hover:text-[var(--pluto-600)]"}`}>
                      {DOC_ICONS[doc.slug] ?? (
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      )}
                    </span>
                    <span className={`flex-1 text-sm font-semibold ${isDocActive ? "text-white" : "text-[#111827] group-hover:text-[var(--pluto-800)]"}`}>
                      {doc.title}
                    </span>
                    {isNew && !isDocActive && (
                      <span className="rounded-full bg-[var(--pluto-100)] px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-[var(--pluto-700)]">
                        <span className="sr-only">New article: </span>
                        New
                      </span>
                    )}
                  </Link>

                  {/* Hierarchy collapse/expand button (#1814) */}
                  {hasSubsections && (
                    <button
                      type="button"
                      aria-expanded={isExpanded}
                      aria-controls={`sections-${doc.slug}`}
                      aria-label={`Toggle ${doc.title} subsections`}
                      onClick={() => toggleDoc(doc.slug)}
                      className={`flex h-7 w-7 items-center justify-center rounded-lg transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pluto-500)] ${
                        isDocActive
                          ? "text-white/80 hover:bg-white/10 hover:text-white"
                          : "text-[#6B7280] hover:bg-black/5 hover:text-[#111827]"
                      }`}
                    >
                      <svg
                        className={`h-3.5 w-3.5 transition-transform duration-200 motion-reduce:transition-none ${
                          isExpanded ? "rotate-90" : ""
                        }`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  )}
                </div>

                {/* Subsections list (Collapsible Hierarchy: #1814) */}
                {hasSubsections && isExpanded && (
                  <div
                    id={`sections-${doc.slug}`}
                    className="ml-6 mt-1 flex flex-col border-l-2 border-[#E5E7EB] pl-3 py-1 space-y-1"
                    role="list"
                  >
                    {doc.matchingSections.map((section) => {
                      const sectionHref = `/docs/${doc.slug}#${section.id}`;
                      const isSectionActive = isDocActive && activeSectionId === section.id;

                      return (
                        <div key={section.id} role="listitem">
                          <Link
                            href={sectionHref}
                            aria-current={isSectionActive ? "location" : undefined}
                            className={`group flex items-center gap-2 rounded-md px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pluto-500)] ${
                              isSectionActive
                                ? "text-[var(--pluto-700)] font-bold bg-[var(--pluto-50)]"
                                : "text-[#4B5563] hover:text-[#111827] hover:bg-[#F3F4F6]"
                            }`}
                          >
                            <span
                              className={`h-1.5 w-1.5 rounded-full transition-colors ${
                                isSectionActive
                                  ? "bg-[var(--pluto-600)] scale-125"
                                  : "bg-[#9CA3AF] group-hover:bg-[#4B5563]"
                              }`}
                              aria-hidden="true"
                            />
                            <span className="truncate">{section.title}</span>
                          </Link>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </nav>
  );
}

export default function DocsSidebar() {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [dragOffsetX, setDragOffsetX] = useState(0);
  const drawerTouchStartXRef = useRef<number | null>(null);
  const edgeTouchStartXRef = useRef<number | null>(null);

  const activeDoc = docsManifest.find((doc) => pathname === `/docs/${doc.slug}`);
  const activeLabel = activeDoc ? activeDoc.title : "Overview";

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    setDragOffsetX(0);
  }, []);

  // Close drawer on Escape key and lock body scroll while open.
  useEffect(() => {
    if (!drawerOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeDrawer();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [drawerOpen, closeDrawer]);

  // Support swipe-right from the left screen edge to open the mobile drawer.
  useEffect(() => {
    const handleWindowTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch || drawerOpen) return;
      if (touch.clientX <= EDGE_SWIPE_ZONE_PX) {
        edgeTouchStartXRef.current = touch.clientX;
      } else {
        edgeTouchStartXRef.current = null;
      }
    };

    const handleWindowTouchEnd = (event: TouchEvent) => {
      if (edgeTouchStartXRef.current === null || drawerOpen) return;
      const touch = event.changedTouches[0];
      if (touch && touch.clientX - edgeTouchStartXRef.current >= SWIPE_THRESHOLD_PX) {
        setDrawerOpen(true);
      }
      edgeTouchStartXRef.current = null;
    };

    window.addEventListener("touchstart", handleWindowTouchStart, { passive: true });
    window.addEventListener("touchend", handleWindowTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", handleWindowTouchStart);
      window.removeEventListener("touchend", handleWindowTouchEnd);
    };
  }, [drawerOpen]);

  const handleDrawerTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    if (!touch) return;
    drawerTouchStartXRef.current = touch.clientX;
    setDragOffsetX(0);
  };

  const handleDrawerTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    if (drawerTouchStartXRef.current === null || !touch) return;
    const deltaX = touch.clientX - drawerTouchStartXRef.current;
    if (deltaX < 0) {
      setDragOffsetX(deltaX);
    }
  };

  const handleDrawerTouchEnd = () => {
    if (dragOffsetX <= -SWIPE_THRESHOLD_PX) {
      closeDrawer();
    } else {
      setDragOffsetX(0);
    }
    drawerTouchStartXRef.current = null;
  };

  return (
    <>
      {/* Mobile drawer trigger */}
      <div className="mb-4 md:hidden">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open documentation menu"
          aria-expanded={drawerOpen}
          aria-controls="docs-mobile-drawer"
          className="flex w-full items-center justify-between rounded-xl border border-[#E5E5E5] bg-white px-4 py-2.5 text-sm font-semibold text-[#0A0A0A] shadow-xs transition-colors hover:bg-[#FAFAFA] focus:outline-none focus:ring-2 focus:ring-[var(--pluto-500)]"
        >
          <span className="flex items-center gap-2.5">
            <svg className="h-4 w-4 text-[#6B6B6B]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
            <span>{activeLabel}</span>
          </span>
          <span className="text-xs font-medium text-[#6B6B6B]">Docs</span>
        </button>
      </div>

      {/* Desktop persistent sidebar */}
      <div className="hidden md:block">
        <SidebarLinks pathname={pathname} />
      </div>

      {/* Mobile slide-over drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden" role="presentation">
          <div
            data-testid="docs-drawer-backdrop"
            onClick={closeDrawer}
            className="fixed inset-0 bg-black/50 backdrop-blur-xs transition-opacity"
            aria-hidden="true"
          />

          <div
            id="docs-mobile-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Documentation navigation drawer"
            onTouchStart={handleDrawerTouchStart}
            onTouchMove={handleDrawerTouchMove}
            onTouchEnd={handleDrawerTouchEnd}
            style={{
              transform: dragOffsetX < 0 ? `translateX(${dragOffsetX}px)` : undefined,
            }}
            className="relative z-10 flex h-full w-72 max-w-[85vw] flex-col bg-white p-4 shadow-2xl transition-transform"
          >
            <div className="mb-4 flex items-center justify-between border-b border-[#F0F0F0] pb-3">
              <span className="text-sm font-bold text-[#0A0A0A]">Documentation</span>
              <button
                type="button"
                onClick={closeDrawer}
                aria-label="Close documentation menu"
                className="rounded-lg p-1.5 text-[#6B6B6B] transition-colors hover:bg-[#F5F5F5] hover:text-[#0A0A0A] focus:outline-none focus:ring-2 focus:ring-[var(--pluto-500)]"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              <SidebarLinks pathname={pathname} onNavigate={closeDrawer} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
