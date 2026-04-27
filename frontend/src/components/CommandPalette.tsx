"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AssetConverter from "@/components/AssetConverter";
import { useMerchantApiKey } from "@/lib/merchant-store";
import { ThemeMode, useThemeActions, useThemeState } from "@/lib/theme-context";
import { toast } from "sonner";
import { filterPaletteCommands, PaletteCommand } from "@/components/commandPaletteData";

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
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const router = useRouter();
  const apiKey = useMerchantApiKey();
  const { toggleTheme } = useThemeActions();
  const { theme, resolvedTheme } = useThemeState();

  const filtered = useMemo(() => filterPaletteCommands(query), [query]);

  useEffect(() => {
    function handleGlobalKeydown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }

    window.addEventListener("keydown", handleGlobalKeydown);
    return () => window.removeEventListener("keydown", handleGlobalKeydown);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      setView("commands");
      requestAnimationFrame(() => inputRef.current?.focus());
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

  const select = useCallback(
    async (command: PaletteCommand) => {
      if (command.action === "converter") {
        setView("converter");
        return;
      }

      setOpen(false);

      if (command.action === "copy-api-key") {
        if (!apiKey) {
          toast.error("No API key is available to copy right now.");
          return;
        }

        try {
          if (typeof navigator === "undefined" || typeof navigator.clipboard?.writeText !== "function") {
            throw new Error("Clipboard API unavailable");
          }
          await navigator.clipboard.writeText(apiKey);
          toast.success("API key copied to clipboard.");
        } catch {
          toast.error("Unable to copy API key from this browser context.");
        }
        return;
      }

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
    [apiKey, resolvedTheme, router, theme, toggleTheme],
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

    if (e.key === "Enter" && filtered.length > 0) {
      e.preventDefault();
      void select(filtered[activeIndex]);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/60 pt-[15vh] backdrop-blur-sm"
      onClick={() => setOpen(false)}
      aria-hidden="true"
    >
      <div
        role="dialog"
        aria-label="Command palette"
        className="w-full max-w-lg overflow-hidden rounded-[2rem] border border-[#1F1F1F] bg-black shadow-[0_30px_60px_rgba(0,0,0,0.8)] backdrop-blur-xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handlePaletteKeydown}
      >
        {view === "converter" ? (
          <AssetConverter onBack={() => setView("commands")} />
        ) : (
          <>
            <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
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
                placeholder="Type a command..."
                className="flex-1 bg-transparent font-heading text-sm font-black tracking-widest text-white outline-none placeholder:text-white/10"
                aria-label="Search commands"
                aria-activedescendant={filtered.length > 0 ? `cmd-${filtered[activeIndex].id}` : undefined}
                role="combobox"
                aria-expanded="true"
                aria-controls="command-list"
                aria-autocomplete="list"
              />

              <kbd className="hidden rounded-lg border border-[#1F1F1F] bg-white/[0.03] px-2 py-1 font-heading text-[10px] font-black text-[#A0A0A0] sm:inline-block">
                ESC
              </kbd>
            </div>

            <ul id="command-list" ref={listRef} role="listbox" className="max-h-72 overflow-y-auto p-2">
              {filtered.length === 0 && (
                <li className="px-3 py-6 text-center text-sm text-slate-500">No matching commands</li>
              )}

              {filtered.map((command, index) => (
                <li
                  key={command.id}
                  id={`cmd-${command.id}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 transition-colors ${
                    index === activeIndex ? "bg-accent/10 text-white" : "text-slate-300 hover:bg-white/5"
                  }`}
                  onMouseEnter={() => setActiveIndex(index)}
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
                    {getCommandIcon(command)}
                  </span>

                  <span className="flex flex-col gap-0.5">
                    <span className="font-heading text-sm font-black uppercase tracking-widest">{command.label}</span>
                    <span className="text-[10px] font-medium uppercase tracking-wider text-[#A0A0A0]">
                      {command.description}
                    </span>
                  </span>

                  {index === activeIndex && (
                    <kbd className="ml-auto hidden rounded-lg border border-white/10 bg-white/10 px-2 py-1 font-heading text-[10px] font-black text-[#A0A0A0] sm:inline-block">
                      ENTER
                    </kbd>
                  )}
                </li>
              ))}
            </ul>

            <div className="flex items-center gap-4 border-t border-white/10 px-4 py-2">
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
