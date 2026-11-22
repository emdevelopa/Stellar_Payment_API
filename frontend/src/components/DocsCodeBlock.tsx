"use client";

import React, {
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useSwipeToDismiss } from "@/hooks/useSwipeToDismiss";
import {
  escapeHtml,
  normalizeLanguage,
  useDynamicSyntaxHighlighter,
} from "@/lib/dynamic-syntax-highlighter";

export interface CodeSnippet {
  id?: string;
  label: string;
  code: string;
  language?: string;
}

export type DocsCodeBlockProps = HTMLAttributes<HTMLPreElement> & {
  children?: ReactNode;
  snippets?: CodeSnippet[];
  tabs?: CodeSnippet[];
  code?: string;
  language?: string;
  title?: string;
  defaultExpanded?: boolean;
};

function extractText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return extractText(node.props.children);
  }
  return "";
}

function detectLanguage(className?: string, node?: ReactNode): string {
  if (className) {
    const match = className.match(/language-([a-zA-Z0-9_-]+)/);
    if (match?.[1]) return match[1];
  }
  if (isValidElement<{ className?: string }>(node) && node.props.className) {
    const match = node.props.className.match(/language-([a-zA-Z0-9_-]+)/);
    if (match?.[1]) return match[1];
  }
  return "bash";
}

export default function DocsCodeBlock({
  children,
  className = "",
  snippets,
  tabs,
  code: directCode,
  language: directLanguage,
  title: directTitle,
  defaultExpanded = false,
  ...rest
}: DocsCodeBlockProps) {
  const generatedId = useId();
  const rawId = rest.id || generatedId;
  const blockId = rawId.replace(/:/g, "_");

  // Determine active snippets / tabs
  const items: CodeSnippet[] = useMemo(() => {
    const list = snippets || tabs;
    if (list && list.length > 0) {
      return list;
    }

    const rawText = directCode ?? extractText(children).replace(/\n$/, "");
    const detected = directLanguage || detectLanguage(className, children);

    return [
      {
        id: "default",
        label: detected.toUpperCase(),
        code: rawText,
        language: detected,
      },
    ];
  }, [snippets, tabs, directCode, directLanguage, children, className]);

  const [activeTab, setActiveTab] = useState(0);
  const [copied, setCopied] = useState(false);
  const [copyAnnouncement, setCopyAnnouncement] = useState("");
  const [isDrawerOpen, setIsDrawerOpen] = useState(defaultExpanded);
  const [mounted, setMounted] = useState(false);

  const expandTriggerRef = useRef<HTMLButtonElement>(null);
  const drawerDialogRef = useRef<HTMLDivElement>(null);
  const drawerScrollRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    setMounted(true);
  }, []);

  const activeSnippet = items[activeTab] || items[0] || { code: "", label: "CODE", language: "bash" };
  const currentLanguage = normalizeLanguage(activeSnippet.language);

  // Dynamic syntax highlighting (code splitting & bundle optimization: #1812)
  const { highlightedHtml, isLoading } = useDynamicSyntaxHighlighter(
    activeSnippet.code,
    currentLanguage
  );

  // Touch gesture swipe-to-dismiss hook for bottom drawer (#1810)
  const closeDrawer = useCallback(() => {
    setIsDrawerOpen(false);
  }, []);

  const swipe = useSwipeToDismiss({
    onDismiss: closeDrawer,
    enabled: isDrawerOpen,
    scrollRef: drawerScrollRef,
  });

  // Copy to clipboard with screen reader announcement (#1809)
  const handleCopy = async () => {
    const textToCopy = activeSnippet.code;
    if (!textToCopy) return;

    try {
      await navigator.clipboard.writeText(textToCopy);
    } catch {
      const el = document.createElement("textarea");
      el.value = textToCopy;
      el.setAttribute("readonly", "");
      el.style.position = "absolute";
      el.style.left = "-9999px";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }

    setCopied(true);
    setCopyAnnouncement("Code snippet copied to clipboard");
    window.setTimeout(() => {
      setCopied(false);
      setCopyAnnouncement("");
    }, 2000);
  };

  // Keyboard navigation for multi-language tabs (WCAG 2.1 AA: #1809)
  const handleTabKeyDown = (e: React.KeyboardEvent, index: number) => {
    const count = items.length;
    if (count <= 1) return;

    let targetIndex = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      targetIndex = (index + 1) % count;
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      targetIndex = (index - 1 + count) % count;
    } else if (e.key === "Home") {
      e.preventDefault();
      targetIndex = 0;
    } else if (e.key === "End") {
      e.preventDefault();
      targetIndex = count - 1;
    }

    if (targetIndex >= 0) {
      setActiveTab(targetIndex);
      tabRefs.current[targetIndex]?.focus();
    }
  };

  // Focus trap and keyboard management for responsive drawer (WCAG 2.1 AA: #1809, #1810)
  useEffect(() => {
    if (!isDrawerOpen) return;

    // Save previous active element to restore focus when drawer closes
    const prevElement = document.activeElement as HTMLElement | null;

    // Lock body scroll
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Set focus to the drawer container or first focusable element
    const timer = setTimeout(() => {
      if (drawerDialogRef.current) {
        const focusable = drawerDialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length > 0) {
          focusable[0].focus();
        } else {
          drawerDialogRef.current.focus();
        }
      }
    }, 20);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeDrawer();
        return;
      }

      if (e.key === "Tab" && drawerDialogRef.current) {
        const focusables = Array.from(
          drawerDialogRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        ).filter((el) => !el.hasAttribute("disabled") && el.getAttribute("aria-hidden") !== "true");

        if (focusables.length === 0) return;

        const first = focusables[0];
        const last = focusables[focusables.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      clearTimeout(timer);
      document.body.style.overflow = originalOverflow;
      document.removeEventListener("keydown", handleKeyDown);

      // Return focus to trigger button
      if (prevElement && typeof prevElement.focus === "function") {
        prevElement.focus();
      } else if (expandTriggerRef.current) {
        expandTriggerRef.current.focus();
      }
    };
  }, [isDrawerOpen, closeDrawer]);

  const hasTabs = items.length > 1;
  const displayTitle = directTitle || (hasTabs ? "Code Examples" : activeSnippet.label || "Terminal / Code");

  // Render code block content
  const renderCodeContent = (isDrawer = false) => {
    return (
      <div
        ref={isDrawer ? drawerScrollRef : undefined}
        tabIndex={0}
        role="region"
        aria-label={`${activeSnippet.label || "Code"} snippet content`}
        className={`relative overflow-x-auto selection:bg-[var(--pluto-500)]/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pluto-400)] ${
          isDrawer ? "max-h-[60vh] p-6 text-sm" : "p-6 text-sm"
        }`}
      >
        <pre
          {...(!isDrawer ? rest : {})}
          className={`${className} !m-0 !bg-transparent font-mono font-medium leading-relaxed overflow-visible text-[#E6EDF3]`}
        >
          {highlightedHtml ? (
            <code
              className={`language-${currentLanguage} docs-prose ide-code !bg-transparent !p-0`}
              dangerouslySetInnerHTML={{ __html: highlightedHtml }}
            />
          ) : (
            <code className={`language-${currentLanguage} !bg-transparent !p-0`}>
              {activeSnippet.code}
            </code>
          )}
        </pre>
      </div>
    );
  };

  return (
    <div
      className="group relative my-8 overflow-hidden rounded-2xl border border-[#E8E8E8] bg-[#0A0A0A] shadow-xl shadow-black/5"
      data-testid="interactive-code-block"
    >
      {/* Accessible live region for copy feedback (WCAG 2.1 AA: #1809) */}
      <div role="status" aria-live="polite" className="sr-only">
        {copyAnnouncement}
      </div>

      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 bg-white/5 px-4 py-2.5 sm:px-5">
        <div className="flex flex-wrap items-center gap-2">
          {/* Decorative terminal dots */}
          <div className="flex gap-1.5" aria-hidden="true">
            <div className="h-2.5 w-2.5 rounded-full bg-white/10" />
            <div className="h-2.5 w-2.5 rounded-full bg-white/10" />
            <div className="h-2.5 w-2.5 rounded-full bg-white/10" />
          </div>

          {!hasTabs ? (
            <span className="ml-2 text-[10px] font-bold uppercase tracking-widest text-white/40">
              {displayTitle}
            </span>
          ) : null}

          {/* Multi-language snippet tab switcher (WCAG 2.1 AA: #1809, #1810) */}
          {hasTabs && (
            <div
              role="tablist"
              aria-label="Code snippet languages"
              className="ml-1 flex flex-wrap gap-1 rounded-lg bg-black/40 p-1 border border-white/5"
            >
              {items.map((item, index) => {
                const isActive = index === activeTab;
                return (
                  <button
                    key={`${item.label}-${index}`}
                    ref={(el) => {
                      tabRefs.current[index] = el;
                    }}
                    type="button"
                    role="tab"
                    id={`code-tab-${blockId}-${index}`}
                    aria-controls={`code-panel-${blockId}-${index}`}
                    aria-selected={isActive}
                    tabIndex={isActive ? 0 : -1}
                    onClick={() => setActiveTab(index)}
                    onKeyDown={(e) => handleTabKeyDown(e, index)}
                    className={`rounded-md px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pluto-400)] ${
                      isActive
                        ? "bg-[var(--pluto-500)] text-white shadow-sm"
                        : "text-white/60 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Action buttons: Drawer expand & Copy */}
        <div className="flex items-center gap-2">
          {/* Responsive Drawer View toggle button (#1810) */}
          <button
            ref={expandTriggerRef}
            type="button"
            onClick={() => setIsDrawerOpen(true)}
            aria-label="Open code in responsive drawer"
            aria-expanded={isDrawerOpen}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-white/60 transition-all hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pluto-400)] active:scale-95"
          >
            <svg
              className="h-3 w-3"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
              />
            </svg>
            <span className="hidden sm:inline">Drawer</span>
          </button>

          {/* One-click copy button (WCAG 2.1 AA: #1809) */}
          <button
            type="button"
            onClick={handleCopy}
            aria-label={copied ? "Code copied to clipboard" : "Copy code snippet"}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-white/60 transition-all hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pluto-400)] active:scale-95"
          >
            {copied ? (
              <>
                <svg
                  className="h-3 w-3 text-[var(--pluto-400)]"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={3}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                <span className="text-[var(--pluto-400)]">Copied</span>
              </>
            ) : (
              <>
                <svg
                  className="h-3 w-3"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                <span>Copy</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Code body (tabpanel if tabs are present) */}
      <div
        id={hasTabs ? `code-panel-${blockId}-${activeTab}` : undefined}
        role={hasTabs ? "tabpanel" : undefined}
        aria-labelledby={hasTabs ? `code-tab-${blockId}-${activeTab}` : undefined}
        className="relative"
      >
        {renderCodeContent(false)}

        {/* Pluto accent bottom line */}
        <div
          className="absolute bottom-0 left-0 h-[2px] w-full bg-gradient-to-r from-[var(--pluto-500)]/0 via-[var(--pluto-500)]/40 to-[var(--pluto-500)]/0"
          aria-hidden="true"
        />
      </div>

      {/* Responsive Drawer View Modal with Touch Gesture Support (#1810) */}
      {isDrawerOpen &&
        mounted &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-end justify-center bg-black/70 backdrop-blur-sm transition-opacity"
            style={{
              backgroundColor:
                swipe.offset > 0
                  ? `rgba(0,0,0,${Math.max(0.25, 0.7 - swipe.offset / 500)})`
                  : undefined,
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget) closeDrawer();
            }}
            data-testid="code-block-drawer-backdrop"
          >
            <div
              ref={drawerDialogRef}
              role="dialog"
              aria-modal="true"
              aria-label={`${displayTitle} - Code Drawer View`}
              tabIndex={-1}
              data-dragging={swipe.dragging || undefined}
              {...swipe.handlers}
              style={{
                transform:
                  swipe.offset > 0 ? `translate3d(0, ${swipe.offset}px, 0)` : undefined,
              }}
              className="flex max-h-[88vh] w-full flex-col rounded-t-3xl border-t border-white/15 bg-[#0A0A0A] pb-[env(safe-area-inset-bottom)] shadow-[0_-15px_40px_rgba(0,0,0,0.8)] motion-safe:animate-drawer-in sm:max-w-3xl sm:rounded-t-3xl sm:border focus-visible:outline-none"
            >
              {/* Drag handle pill affordance (#1810) */}
              <div
                className="flex cursor-grab justify-center pt-3 pb-2 active:cursor-grabbing select-none"
                aria-hidden="true"
              >
                <div className="h-1.5 w-12 rounded-full bg-white/25 hover:bg-white/40 transition-colors" />
              </div>

              {/* Drawer header */}
              <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold uppercase tracking-widest text-white/70">
                    {displayTitle}
                  </span>
                  {hasTabs && (
                    <div
                      role="tablist"
                      aria-label="Code drawer languages"
                      className="flex gap-1 rounded-lg bg-black/50 p-1 border border-white/10"
                    >
                      {items.map((item, idx) => (
                        <button
                          key={`drawer-${item.label}-${idx}`}
                          type="button"
                          role="tab"
                          aria-selected={idx === activeTab}
                          onClick={() => setActiveTab(idx)}
                          className={`rounded px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider transition-colors ${
                            idx === activeTab
                              ? "bg-[var(--pluto-500)] text-white"
                              : "text-white/60 hover:text-white"
                          }`}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopy}
                    aria-label={copied ? "Code copied to clipboard" : "Copy code snippet"}
                    className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-white/70 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pluto-400)] active:scale-95"
                  >
                    {copied ? (
                      <>
                        <svg
                          className="h-3 w-3 text-[var(--pluto-400)]"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                          aria-hidden="true"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={3}
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                        <span className="text-[var(--pluto-400)]">Copied</span>
                      </>
                    ) : (
                      <>
                        <svg
                          className="h-3 w-3"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                          aria-hidden="true"
                        >
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                        <span>Copy</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={closeDrawer}
                    aria-label="Close code drawer"
                    className="flex items-center justify-center rounded-lg border border-white/10 bg-white/5 p-1.5 text-white/60 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pluto-400)] active:scale-95"
                  >
                    <svg
                      className="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Drawer Code Scroll View */}
              {renderCodeContent(true)}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
