"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import { docsManifest } from "@/lib/docs-manifest";

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

export default function DocsSidebar({
  initialBookmarks = [],
  onSyncPreference,
  onToast,
}: DocsSidebarProps = {}) {
  const pathname = usePathname();
  const [searchQuery, setSearchQuery] = useState("");
  const [isGuidesCollapsed, setIsGuidesCollapsed] = useState(false);
  const [bookmarks, setBookmarks] = useState<string[]>(initialBookmarks);
  const [pendingSlugs, setPendingSlugs] = useState<Record<string, boolean>>({});
  const [activeToast, setActiveToast] = useState<DocsSidebarToast | null>(null);
  const toastSeqRef = useRef(0);

  const filteredDocs = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return docsManifest;
    return docsManifest.filter(
      (doc) =>
        doc.title.toLowerCase().includes(query) ||
        doc.description.toLowerCase().includes(query) ||
        doc.slug.toLowerCase().includes(query),
    );
  }, [searchQuery]);

  const emitRollbackToast = useCallback(
    (message: string, retryAction: DocsSidebarPreferenceAction) => {
      toastSeqRef.current += 1;
      const notification: DocsSidebarToast = {
        id: `docs-sidebar-toast-${toastSeqRef.current}`,
        message,
        variant: "error",
        retryAction,
      };
      setActiveToast(notification);
      onToast?.(notification);
      try {
        toast.error(message);
      } catch {
        // Ignore if toaster provider is not mounted in isolated tests
      }
    },
    [onToast],
  );

  const executeBookmarkToggle = useCallback(
    async (slug: string, nextBookmarked: boolean) => {
      const previousWasBookmarked = !nextBookmarked;

      // Optimistic update
      setBookmarks((prev) =>
        nextBookmarked
          ? prev.includes(slug)
            ? prev
            : [...prev, slug]
          : prev.filter((item) => item !== slug),
      );
      setPendingSlugs((prev) => ({ ...prev, [slug]: true }));
      setActiveToast(null);

      if (!onSyncPreference) {
        setPendingSlugs((prev) => {
          const next = { ...prev };
          delete next[slug];
          return next;
        });
        return;
      }

      const action: DocsSidebarPreferenceAction = {
        type: "bookmark",
        slug,
        value: nextBookmarked,
      };

      try {
        await onSyncPreference(action);
      } catch {
        // Rollback optimistic state on network failure
        setBookmarks((prev) =>
          previousWasBookmarked
            ? prev.includes(slug)
              ? prev
              : [...prev, slug]
            : prev.filter((item) => item !== slug),
        );
        emitRollbackToast(
          `Network error: could not ${nextBookmarked ? "save" : "remove"} bookmark. Changes reverted.`,
          action,
        );
      } finally {
        setPendingSlugs((prev) => {
          const next = { ...prev };
          delete next[slug];
          return next;
        });
      }
    },
    [emitRollbackToast, onSyncPreference],
  );

  const executeCollapseToggle = useCallback(
    async (nextCollapsed: boolean) => {
      const previousCollapsed = !nextCollapsed;

      // Optimistic update
      setIsGuidesCollapsed(nextCollapsed);
      setActiveToast(null);

      if (!onSyncPreference) return;

      const action: DocsSidebarPreferenceAction = {
        type: "collapse",
        slug: "guides-section",
        value: nextCollapsed,
      };

      try {
        await onSyncPreference(action);
      } catch {
        // Rollback optimistic state on network failure
        setIsGuidesCollapsed(previousCollapsed);
        emitRollbackToast(
          "Network error: could not save sidebar layout preference. Changes reverted.",
          action,
        );
      }
    },
    [emitRollbackToast, onSyncPreference],
  );

  const handleRetry = useCallback(() => {
    const retry = activeToast?.retryAction;
    if (!retry) return;
    if (retry.type === "bookmark") {
      void executeBookmarkToggle(retry.slug, retry.value);
    } else if (retry.type === "collapse") {
      void executeCollapseToggle(retry.value);
    }
  }, [activeToast, executeBookmarkToggle, executeCollapseToggle]);

  return (
    <nav aria-label="Developer documentation" className="flex flex-col gap-1">
      {/* Search anchor filter */}
      <div className="mb-2">
        <label htmlFor="docs-sidebar-search" className="sr-only">
          Filter documentation
        </label>
        <input
          id="docs-sidebar-search"
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Filter docs..."
          className="w-full rounded-xl border border-[#E5E5E5] bg-white px-3 py-2 text-sm text-[#0A0A0A] placeholder:text-[#6B6B6B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pluto-500)]"
        />
      </div>

      {/* Inline accessible toast feedback on network rollback */}
      {activeToast && (
        <div
          role="alert"
          aria-live="assertive"
          className="mb-2 flex items-start justify-between gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-800 shadow-sm"
        >
          <span className="flex-1 leading-relaxed">{activeToast.message}</span>
          <div className="flex shrink-0 items-center gap-1.5">
            {activeToast.retryAction && (
              <button
                type="button"
                onClick={handleRetry}
                className="rounded-md bg-red-600 px-2 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
              >
                Retry
              </button>
            )}
            <button
              type="button"
              onClick={() => setActiveToast(null)}
              aria-label="Dismiss notification"
              className="rounded-md px-1.5 py-1 text-[11px] font-medium text-red-700 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <Link
        href="/docs"
        aria-current={pathname === "/docs" ? "page" : undefined}
        className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pluto-500)] ${
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

      {/* Collapsible guides section header */}
      <button
        type="button"
        onClick={() => void executeCollapseToggle(!isGuidesCollapsed)}
        aria-expanded={!isGuidesCollapsed}
        aria-controls="docs-sidebar-guides-list"
        className="flex items-center justify-between rounded-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-[#6B6B6B] transition-colors hover:bg-[var(--pluto-50)] hover:text-[var(--pluto-700)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pluto-500)]"
      >
        <span>Guides</span>
        <span aria-hidden="true">{isGuidesCollapsed ? "+" : "-"}</span>
      </button>

      {!isGuidesCollapsed && (
        <div id="docs-sidebar-guides-list" className="flex flex-col gap-1">
          {filteredDocs.length === 0 ? (
            <p className="px-3 py-2 text-xs text-[#6B6B6B]">
              No matching documentation found.
            </p>
          ) : (
            filteredDocs.map((doc) => {
              const href = `/docs/${doc.slug}`;
              const active = pathname === href;
              const isNew = doc.slug === "x402-agentic-payments";
              const isBookmarked = bookmarks.includes(doc.slug);
              const isPending = Boolean(pendingSlugs[doc.slug]);

              return (
                <div
                  key={doc.slug}
                  className={`group flex items-center gap-1 rounded-xl pr-1 transition-all ${
                    active
                      ? "bg-[var(--pluto-500)] text-white"
                      : "text-[#6B6B6B] hover:bg-[var(--pluto-50)] hover:text-[var(--pluto-700)]"
                  }`}
                >
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className="flex flex-1 items-center gap-3 rounded-xl px-3 py-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pluto-500)]"
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

                  <button
                    type="button"
                    disabled={isPending}
                    aria-pressed={isBookmarked}
                    aria-label={`${isBookmarked ? "Remove bookmark for" : "Bookmark"} ${doc.title}`}
                    onClick={() => void executeBookmarkToggle(doc.slug, !isBookmarked)}
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pluto-500)] disabled:opacity-50 ${
                      active
                        ? "text-white hover:bg-white/20"
                        : isBookmarked
                          ? "text-[var(--pluto-600)] hover:bg-[var(--pluto-100)]"
                          : "text-[#6B6B6B] hover:bg-black/5"
                    }`}
                  >
                    <svg
                      className="h-4 w-4"
                      fill={isBookmarked ? "currentColor" : "none"}
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"
                      />
                    </svg>
                  </button>
                </div>
              );
            })
          )}
        </div>
      )}
    </nav>
  );
}
