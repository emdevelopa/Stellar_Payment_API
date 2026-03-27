"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/* ------------------------------------------------------------------ */
/*  Command definitions                                                */
/* ------------------------------------------------------------------ */

type Command = {
  id: string;
  label: string;
  description: string;
  href: string;
  icon: React.ReactNode;
  keywords: string[];
};

const SettingsIcon = (
  <svg
    viewBox="0 0 24 24"
    className="h-5 w-5 text-slate-400"
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
    className="h-5 w-5 text-slate-400"
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
    className="h-5 w-5 text-slate-400"
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

const RegisterIcon = (
  <svg
    viewBox="0 0 24 24"
    className="h-5 w-5 text-slate-400"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
  >
    <path
      d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle cx="9" cy="7" r="4" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M19 8v6M22 11h-6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const commands: Command[] = [
  {
    id: "settings",
    label: "Settings",
    description: "API keys, webhook URL & merchant config",
    href: "/settings",
    icon: SettingsIcon,
    keywords: ["settings", "config", "api", "keys", "webhook", "merchant"],
  },
  {
    id: "create-payment",
    label: "Create Payment",
    description: "Generate a new Stellar payment link",
    href: "/dashboard/create",
    icon: CreatePaymentIcon,
    keywords: ["create", "payment", "new", "link", "pay", "generate"],
  },
  {
    id: "home",
    label: "Home",
    description: "Return to the landing page",
    href: "/",
    icon: HomeIcon,
    keywords: ["home", "landing", "dashboard", "main"],
  },
  {
    id: "register",
    label: "Register Merchant",
    description: "Register a new merchant account",
    href: "/register",
    icon: RegisterIcon,
    keywords: ["register", "merchant", "signup", "account", "new"],
  },
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const router = useRouter();

  /* ---------- filtered results ---------- */
  const filtered =
    query.length === 0
      ? commands
      : commands.filter((cmd) => {
          const q = query.toLowerCase();
          return (
            cmd.label.toLowerCase().includes(q) ||
            cmd.description.toLowerCase().includes(q) ||
            cmd.keywords.some((kw) => kw.includes(q))
          );
        });

  /* ---------- global keydown: Cmd/Ctrl+K ---------- */
  useEffect(() => {
    function handleGlobalKeydown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }

    window.addEventListener("keydown", handleGlobalKeydown);
    return () => window.removeEventListener("keydown", handleGlobalKeydown);
  }, []);

  /* ---------- focus input when palette opens ---------- */
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      // Small delay so the DOM renders first
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  /* ---------- keep activeIndex in bounds ---------- */
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  /* ---------- scroll active item into view ---------- */
  useEffect(() => {
    if (!listRef.current) return;
    const active = listRef.current.children[activeIndex] as HTMLElement | undefined;
    active?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  /* ---------- select a command ---------- */
  const select = useCallback(
    (cmd: Command) => {
      setOpen(false);
      router.push(cmd.href);
    },
    [router],
  );

  /* ---------- palette keydown: arrows, enter, escape ---------- */
  function handlePaletteKeydown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % filtered.length);
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + filtered.length) % filtered.length);
      return;
    }

    if (e.key === "Enter" && filtered.length > 0) {
      e.preventDefault();
      select(filtered[activeIndex]);
    }
  }

  if (!open) return null;

  return (
    /* backdrop */
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/60 backdrop-blur-sm pt-[15vh]"
      onClick={() => setOpen(false)}
      aria-hidden="true"
    >
      {/* palette card */}
      <div
        role="dialog"
        aria-label="Command palette"
        className="w-full max-w-lg overflow-hidden rounded-xl border border-white/10 bg-night/95 shadow-2xl shadow-mint/5"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handlePaletteKeydown}
      >
        {/* search input */}
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5 shrink-0 text-slate-500"
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
            placeholder="Type a command…"
            className="flex-1 bg-transparent text-sm text-white placeholder-slate-500 outline-none"
            aria-label="Search commands"
            aria-activedescendant={
              filtered.length > 0 ? `cmd-${filtered[activeIndex].id}` : undefined
            }
            role="combobox"
            aria-expanded="true"
            aria-controls="command-list"
            aria-autocomplete="list"
          />

          <kbd className="hidden rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-slate-500 sm:inline-block">
            ESC
          </kbd>
        </div>

        {/* results list */}
        <ul
          id="command-list"
          ref={listRef}
          role="listbox"
          className="max-h-72 overflow-y-auto p-2"
        >
          {filtered.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-slate-500">
              No matching commands
            </li>
          )}

          {filtered.map((cmd, i) => (
            <li
              key={cmd.id}
              id={`cmd-${cmd.id}`}
              role="option"
              aria-selected={i === activeIndex}
              className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 transition-colors ${
                i === activeIndex
                  ? "bg-mint/10 text-white"
                  : "text-slate-300 hover:bg-white/5"
              }`}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => select(cmd)}
            >
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${
                  i === activeIndex
                    ? "border-mint/30 bg-mint/10"
                    : "border-white/10 bg-white/5"
                }`}
              >
                {cmd.icon}
              </span>

              <span className="flex flex-col">
                <span className="text-sm font-medium">{cmd.label}</span>
                <span className="text-xs text-slate-500">{cmd.description}</span>
              </span>

              {i === activeIndex && (
                <kbd className="ml-auto hidden rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-slate-500 sm:inline-block">
                  ↵
                </kbd>
              )}
            </li>
          ))}
        </ul>

        {/* footer hint */}
        <div className="flex items-center gap-4 border-t border-white/10 px-4 py-2">
          <span className="flex items-center gap-1 text-[11px] text-slate-500">
            <kbd className="rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px]">
              ↑↓
            </kbd>
            navigate
          </span>
          <span className="flex items-center gap-1 text-[11px] text-slate-500">
            <kbd className="rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px]">
              ↵
            </kbd>
            select
          </span>
          <span className="flex items-center gap-1 text-[11px] text-slate-500">
            <kbd className="rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px]">
              esc
            </kbd>
            close
          </span>
        </div>
      </div>
    </div>
  );
}
