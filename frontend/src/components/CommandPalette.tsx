"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AssetConverter from "@/components/AssetConverter";
import { useMerchantApiKey } from "@/lib/merchant-store";
import { ThemeMode, useThemeActions, useThemeState } from "@/lib/theme-context";
import { toast } from "sonner";
import { filterPaletteCommands, PaletteCommand } from "@/components/commandPaletteData";
import { useSwipeToDismiss } from "@/hooks/useSwipeToDismiss";

/**
 * Window event that opens the palette. Touch devices have no Cmd/Ctrl+K, so
 * on-screen triggers (e.g. the mobile header search button) dispatch this.
 */
export const OPEN_COMMAND_PALETTE_EVENT = "command-palette:open";

export function openCommandPalette() {
  window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE_EVENT));
}

/**
 * On touch-first devices, focusing the search input on open would pop the
 * on-screen keyboard over the bottom drawer. There the dialog is focused
 * instead and the user taps the input when they want to search.
 */
function prefersTouchInput() {
  return typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches === true;
}

const THEME_CYCLE: ThemeMode[] = ["light", "dark", "system"];

function getNextTheme(currentTheme: ThemeMode | undefined): ThemeMode {
  const currentIndex = currentTheme ? THEME_CYCLE.indexOf(currentTheme) : -1;
  const nextIndex = (currentIndex + 1 + THEME_CYCLE.length) % THEME_CYCLE.length;
  return THEME_CYCLE[nextIndex];
}

function getThemeLabel(themeMode: ThemeMode, resolvedTheme: "light" | "dark" | undefined): string {
  if (themeMode !== "system") return themeMode;
  return resolvedTheme ? `system (${resolvedTheme})` : "system";
}

const SettingsIcon = (
  <svg
    viewBox="0 0 24 24"
    className="h-5 w-5 text-[#A0A0A0]"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
  >
    <path
      d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const CreatePaymentIcon = (
  <svg
    viewBox="0 0 24 24"
    className="h-5 w-5 text-[#A0A0A0]"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
  >
    <path d="M12 5v14M5 12h14" strokeLinecap="round" />
  </svg>
);

const HomeIcon = (
  <svg
    viewBox="0 0 24 24"
    className="h-5 w-5 text-[#A0A0A0]"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
  >
    <path
      d="M3 9.5L12 4l9 5.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9.5z"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path d="M9 22V12h6v10" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const DocsIcon = (
  <svg
    viewBox="0 0 24 24"
    className="h-5 w-5 text-[#A0A0A0]"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
  >
    <path d="M4 4h9a3 3 0 0 1 3 3v13H7a3 3 0 0 0-3 3V4z" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M20 20h-4V7a3 3 0 0 1 3-3h1v16z" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ConverterIcon = (
  <svg
    viewBox="0 0 24 24"
    className="h-5 w-5 text-[#A0A0A0]"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
  >
    <path d="M2 17 12 7l10 10" strokeLinecap="round" strokeLinejoin="round" opacity={0.4} />
    <path d="M2 12 12 2l10 10" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const KeyIcon = (
  <svg
    viewBox="0 0 24 24"
    className="h-5 w-5 text-[#A0A0A0]"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
  >
    <circle cx="8" cy="12" r="3.5" />
    <path d="M11.5 12H21M17 12v3M14 12v2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ThemeIcon = (
  <svg
    viewBox="0 0 24 24"
    className="h-5 w-5 text-[#A0A0A0]"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
  >
    <path
      d="M21.75 15A9.75 9.75 0 1 1 9 2.25a7.5 7.5 0 0 0 12.75 12.75z"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const HelpIcon = (
  <svg
    viewBox="0 0 24 24"
    className="h-5 w-5 text-[#A0A0A0]"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9a2.5 2.5 0 1 1 4.3 1.7C13 11.5 12 12 12 13" strokeLinecap="round" />
    <circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none" />
  </svg>
);

function getCommandIcon(command: PaletteCommand): React.ReactNode {
  if (command.action === "converter") return ConverterIcon;
  if (command.action === "copy-api-key") return KeyIcon;
  if (command.action === "toggle-theme") return ThemeIcon;
  if (command.id.startsWith("help-")) return HelpIcon;
  if (command.id.includes("settings") || command.id.includes("webhook") || command.id.includes("api")) {
    return SettingsIcon;
  }
  if (command.id.includes("docs")) return DocsIcon;
  if (command.id.includes("payment")) return CreatePaymentIcon;
  return HomeIcon;
}

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [view, setView] = useState<"commands" | "converter">("commands");
  const [executingId, setExecutingId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  const router = useRouter();
  const apiKey = useMerchantApiKey();
  const { toggleTheme } = useThemeActions();
  const { theme, resolvedTheme } = useThemeState();

  const filtered = useMemo(() => filterPaletteCommands(query), [query]);

  const close = useCallback(() => setOpen(false), []);

  // Swipe down to dismiss the mobile drawer. Disabled in the converter view,
  // which handles its own swipe-down (back to the command list).
  const swipe = useSwipeToDismiss({
    onDismiss: close,
    enabled: view === "commands",
    scrollRef: listRef,
  });

  useEffect(() => {
    function handleGlobalKeydown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }

    function handleOpenRequest() {
      setOpen(true);
    }

    window.addEventListener("keydown", handleGlobalKeydown);
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, handleOpenRequest);
    return () => {
      window.removeEventListener("keydown", handleGlobalKeydown);
      window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, handleOpenRequest);
    };
  }, []);

  // Lock page scroll behind the palette so swipes don't scroll the page.
  useEffect(() => {
    if (!open) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      setView("commands");
      setExecutingId(null);
      // Store the previously focused element to restore focus on close
      previousActiveElementRef.current = document.activeElement as HTMLElement;
      requestAnimationFrame(() =>
        (prefersTouchInput() ? dialogRef.current : inputRef.current)?.focus(),
      );
    } else {
      // Restore focus to the previously focused element when dialog closes
      if (previousActiveElementRef.current) {
        previousActiveElementRef.current.focus();
      }
    }
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!listRef.current || filtered.length === 0) return;
    const activeItem = listRef.current.children[activeIndex] as HTMLElement | undefined;
    activeItem?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, filtered.length]);

  // WCAG 2.1 AA Focus Trap: Prevent focus from leaving the dialog
  useEffect(() => {
    if (!open || !dialogRef.current) return;

    const handleTabKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;

      const focusableElements = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );

      if (!focusableElements || focusableElements.length === 0) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (e.shiftKey) {
        // Shift+Tab: if focus is on first element, move to last
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        }
      } else {
        // Tab: if focus is on last element, move to first
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    };

    document.addEventListener("keydown", handleTabKey);
    return () => document.removeEventListener("keydown", handleTabKey);
  }, [open]);

  const select = useCallback(
    async (command: PaletteCommand) => {
      // Guard against re-entrancy: ignore new selections while an async
      // command (currently only "copy-api-key") is still in flight.
      if (executingId) return;

      if (command.action === "converter") {
        setView("converter");
        return;
      }

      if (command.action === "copy-api-key") {
        if (!apiKey) {
          toast.error("No API key is available to copy right now.");
          return;
        }

        // The clipboard write is the only network/async-adjacent side effect
        // this component performs. Do not optimistically close the palette
        // before we know the outcome — that left users with a stale, already
        // -dismissed UI and only a toast on failure, with no way to retry
        // from where they were. Instead, keep the palette open and show a
        // pending state; only close on success, otherwise "roll back" to the
        // open command list so the user can try again.
        setExecutingId(command.id);

        try {
          if (typeof navigator === "undefined" || typeof navigator.clipboard?.writeText !== "function") {
            throw new Error("Clipboard API unavailable");
          }
          await navigator.clipboard.writeText(apiKey);
          toast.success("API key copied to clipboard.");
          setOpen(false);
        } catch {
          toast.error("Unable to copy API key from this browser context.");
        } finally {
          setExecutingId(null);
        }
        return;
      }

      setOpen(false);

      if (command.action === "toggle-theme") {
        const nextTheme = getNextTheme(theme);
        toggleTheme();
        toast.success(`Switched theme to ${getThemeLabel(nextTheme, resolvedTheme)}.`);
        return;
      }

      if (command.href) {
        router.push(command.href);
      }
    },
    [apiKey, executingId, resolvedTheme, router, theme, toggleTheme],
  );

  function handlePaletteKeydown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      if (view === "converter") {
        setView("commands");
      } else {
        setOpen(false);
      }
      return;
    }

    if (view === "converter") return;

    // Focus trap: this dialog has no other focusable descendants besides the
    // search input, so Tab/Shift+Tab should cycle within the palette (moving
    // through the result list) instead of letting focus escape to the page
    // behind the backdrop. This mirrors the arrow-key wrapping behavior and
    // gives Tab/Shift+Tab parity with ArrowDown/ArrowUp, a standard
    // command-palette convention.
    if (e.key === "Tab") {
      if (filtered.length === 0) return;
      e.preventDefault();
      setActiveIndex((i) =>
        e.shiftKey ? (i - 1 + filtered.length) % filtered.length : (i + 1) % filtered.length,
      );
      return;
    }

    if (e.key === "ArrowDown") {
      if (filtered.length === 0) return;
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % filtered.length);
      return;
    }

    if (e.key === "ArrowUp") {
      if (filtered.length === 0) return;
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + filtered.length) % filtered.length);
      return;
    }

    // Home/End jump to the first/last result. The search input is always
    // focused while the palette is open, so these are only intercepted when
    // there is no query text to avoid hijacking native cursor-to-start/end
    // text editing behavior while a query is being typed.
    if (e.key === "Home" && !query) {
      if (filtered.length === 0) return;
      e.preventDefault();
      setActiveIndex(0);
      return;
    }

    if (e.key === "End" && !query) {
      if (filtered.length === 0) return;
      e.preventDefault();
      setActiveIndex(filtered.length - 1);
      return;
    }

    if (e.key === "Enter" && filtered.length > 0 && !executingId) {
      e.preventDefault();
      void select(filtered[activeIndex]);
      return;
    }

    // Number-key quick-select (1-9): jump straight to and run the Nth
    // visible result without needing to navigate there first. Ignored while
    // typing a query so digits still work as normal search input.
    if (!query && !executingId && /^[1-9]$/.test(e.key)) {
      const index = Number(e.key) - 1;
      if (index < filtered.length) {
        e.preventDefault();
        void select(filtered[index]);
      }
    }
  }

  if (!open) return null;

  return (
    // Mobile: bottom drawer. sm and up: centered palette near the top.
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-start sm:pt-[15vh]"
      style={{ backgroundColor: swipe.offset > 0 ? `rgba(0,0,0,${Math.max(0.2, 0.6 - swipe.offset / 600)})` : undefined }}
      onClick={close}
      data-testid="command-palette-backdrop"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-label="Command palette"
        aria-modal="true"
        aria-describedby="command-description"
        tabIndex={-1}
        data-dragging={swipe.dragging || undefined}
        style={{ transform: swipe.offset > 0 ? `translate3d(0, ${swipe.offset}px, 0)` : undefined }}
        className={`flex max-h-[85dvh] w-full flex-col rounded-t-[2rem] border-t border-[#1F1F1F] bg-black pb-[env(safe-area-inset-bottom)] shadow-[0_30px_60px_rgba(0,0,0,0.8)] focus:outline-none motion-safe:animate-palette-drawer-in sm:max-h-none sm:max-w-lg sm:overflow-hidden sm:rounded-[2rem] sm:border sm:pb-0 sm:backdrop-blur-xl sm:motion-safe:animate-none ${
          // AssetConverter is its own fixed bottom drawer on mobile; a clipping or
          // backdrop-filtered parent would trap it, so the shell steps aside there.
          view === "converter"
            ? "max-sm:border-0 max-sm:bg-transparent max-sm:shadow-none"
            : "overflow-hidden backdrop-blur-xl"
        } ${swipe.dragging ? "" : "transition-transform duration-200 ease-out motion-reduce:transition-none"}`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handlePaletteKeydown}
        {...swipe.handlers}
      >
        {view === "converter" ? (
          <AssetConverter onBack={() => setView("commands")} />
        ) : (
          <>
            {/* Hidden description for screen readers */}
            <span id="command-description" className="sr-only">
              Command palette dialog. Use arrow keys to navigate, Enter to select, Escape to close. Tab cycles through focusable elements.
            </span>

            {/* Mobile drag handle: swipe down to close */}
            <div
              className="flex shrink-0 touch-none justify-center pb-1 pt-3 sm:hidden"
              data-testid="command-palette-drawer-handle"
              aria-hidden="true"
            >
              <div
                className={`h-1.5 w-12 rounded-full transition-colors ${
                  swipe.dragging ? "bg-[#00F5D4]/70" : "bg-white/20"
                }`}
              />
            </div>

            <div className="flex shrink-0 items-center gap-3 border-b border-white/10 px-4 py-3">
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5 shrink-0 text-[#A0A0A0]"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m21 21-4.3-4.3" strokeLinecap="round" />
              </svg>

              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                disabled={executingId !== null}
                placeholder="Type a command..."
                className="min-w-0 flex-1 bg-transparent font-heading text-base font-black tracking-widest text-white outline-none placeholder:text-white/10 disabled:opacity-60 sm:text-sm"
                aria-label="Search commands"
                aria-activedescendant={filtered.length > 0 ? `cmd-${filtered[activeIndex].id}` : undefined}
                role="combobox"
                aria-expanded="true"
                aria-controls="command-list"
                aria-autocomplete="list"
                aria-busy={executingId !== null}
              />

              <kbd className="hidden rounded-lg border border-[#1F1F1F] bg-white/[0.03] px-2 py-1 font-heading text-[10px] font-black text-[#A0A0A0] sm:inline-block">
                ESC
              </kbd>

              {/* Touch users have no Escape key: give them an explicit close target */}
              <button
                type="button"
                onClick={close}
                className="inline-flex h-11 shrink-0 items-center rounded-xl px-3 font-heading text-[11px] font-black uppercase tracking-widest text-[#A0A0A0] transition-colors hover:text-white active:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00F5D4] sm:hidden"
              >
                Cancel
              </button>
            </div>

            <ul
              id="command-list"
              ref={listRef}
              role="listbox"
              className="min-h-0 flex-1 touch-manipulation overflow-y-auto overscroll-contain p-2 sm:max-h-72 sm:flex-none"
            >
              {filtered.length === 0 && (
                <li className="px-3 py-6 text-center text-sm text-slate-500">No matching commands</li>
              )}

              {filtered.map((command, index) => {
                const isExecuting = executingId === command.id;

                return (
                  <li
                    key={command.id}
                    id={`cmd-${command.id}`}
                    role="option"
                    aria-selected={index === activeIndex}
                    aria-busy={isExecuting}
                    aria-disabled={executingId !== null && !isExecuting}
                    className={`flex select-none items-center gap-3 rounded-lg px-3 py-2.5 transition-colors ${
                      executingId !== null && !isExecuting
                        ? "cursor-not-allowed opacity-40"
                        : "cursor-pointer active:scale-[0.99] active:bg-white/10"
                    } ${index === activeIndex ? "bg-accent/10 text-white" : "text-slate-300 hover:bg-white/5"}`}
                    onMouseEnter={() => {
                      if (!executingId) setActiveIndex(index);
                    }}
                    onClick={() => {
                      void select(command);
                    }}
                  >
                    <span
                      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition-all ${
                        index === activeIndex
                          ? "border-[#00F5D4]/30 bg-[#00F5D4]/10 shadow-[0_0_15px_rgba(0,245,212,0.1)]"
                          : "border-[#1F1F1F] bg-white/[0.03]"
                      }`}
                    >
                      {isExecuting ? (
                        <span
                          className="h-4 w-4 animate-spin rounded-full border-2 border-[#00F5D4]/30 border-t-[#00F5D4]"
                          aria-hidden="true"
                        />
                      ) : (
                        getCommandIcon(command)
                      )}
                    </span>

                    <span className="flex flex-col gap-0.5">
                      <span className="font-heading text-sm font-black uppercase tracking-widest">{command.label}</span>
                      <span className="text-[10px] font-medium uppercase tracking-wider text-[#A0A0A0]">
                        {isExecuting ? "Working…" : command.description}
                      </span>
                    </span>

                    {index === activeIndex && !isExecuting && (
                      <kbd className="ml-auto hidden rounded-lg border border-white/10 bg-white/10 px-2 py-1 font-heading text-[10px] font-black text-[#A0A0A0] sm:inline-block">
                        ENTER
                      </kbd>
                    )}
                  </li>
                );
              })}
            </ul>

            <p className="shrink-0 border-t border-white/10 px-4 py-3 text-center text-[11px] text-slate-500 sm:hidden">
              Tap a command to run it · swipe down to close
            </p>

            <div className="hidden items-center gap-4 border-t border-white/10 px-4 py-2 sm:flex">
              <span className="flex items-center gap-1 text-[11px] text-slate-500">
                <kbd className="rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px]">UP/DOWN</kbd>
                navigate
              </span>
              <span className="flex items-center gap-1 text-[11px] text-slate-500">
                <kbd className="rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px]">ENTER</kbd>
                select
              </span>
              <span className="flex items-center gap-1 text-[11px] text-slate-500">
                <kbd className="rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px]">ESC</kbd>
                close
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * On-screen button that opens the palette. Shown in the dashboard header
 * below `lg`, where a hardware keyboard (and Cmd/Ctrl+K) is unlikely.
 */
export function CommandPaletteTrigger({ className = "" }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={openCommandPalette}
      aria-haspopup="dialog"
      aria-label="Open command palette"
      className={`inline-flex h-10 w-10 touch-manipulation items-center justify-center rounded-xl border border-[#E8E8E8] bg-white text-[#6B6B6B] transition-all hover:border-[#0A0A0A] hover:bg-[#F9F9F9] hover:text-[#0A0A0A] active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0A0A0A] ${className}`}
    >
      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="m21 21-4.3-4.3" strokeLinecap="round" />
      </svg>
    </button>
  );
}
