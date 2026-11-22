"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { docsManifest } from "@/lib/docs-manifest";

const EDGE_SWIPE_ZONE_PX = 32;
const SWIPE_THRESHOLD_PX = 60;

const DOC_ICONS: Record<string, React.ReactNode> = {
  "api-guide": (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  ),
  "hmac-signatures": (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
    </svg>
  ),
  "x402-agentic-payments": (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  ),
};

function SidebarLinks({
  pathname,
  onNavigate,
}: {
  pathname: string | null;
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="Documentation navigation" className="flex flex-col gap-1">
      <Link
        href="/docs"
        onClick={onNavigate}
        aria-current={pathname === "/docs" ? "page" : undefined}
        className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all ${
          pathname === "/docs"
            ? "bg-[var(--pluto-500)] text-white"
            : "text-[#6B6B6B] hover:bg-[var(--pluto-50)] hover:text-[var(--pluto-700)]"
        }`}
      >
        <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
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
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all ${
              active
                ? "bg-[var(--pluto-500)] text-white"
                : "text-[#6B6B6B] hover:bg-[var(--pluto-50)] hover:text-[var(--pluto-700)]"
            }`}
          >
            <span className={`shrink-0 ${active ? "text-white" : "text-[#6B6B6B]"}`}>
              {DOC_ICONS[doc.slug] ?? (
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
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
