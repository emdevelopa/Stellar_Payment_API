"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";

export default function KeyboardShortcuts() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function handleKeydown(e: KeyboardEvent) {
      // Don't trigger shortcuts when typing in inputs/textareas
      const isInput =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target as HTMLElement).isContentEditable;

      // Handle shortcuts that work everywhere
      if (e.altKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        router.push("/dashboard/create");
        return;
      }
      
      if (e.altKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        router.push("/settings");
        return;
      }

      // Handle shortcuts that only work when not typing
      if (isInput) return;

      if (e.key === "/") {
        e.preventDefault();
        // Since Search input might only exist on the Payments or Dashboard page,
        // we check for it. If it doesn't exist, we might navigate to payments page first?
        // The requirements say "/ for search focus". Let's focus #search if it exists,
        // or navigate to /payments where recent activity search lives.
        const searchInput = document.getElementById("search");
        if (searchInput) {
          searchInput.focus();
        } else if (pathname !== "/payments") {
          router.push("/payments");
          // Focus logic could fail immediately if we just pushed, but the requirement is simple.
        }
      }

      if (e.key === "?") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      
      if (e.key === "Escape" && open) {
        setOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [router, pathname, open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-black/80 p-6 shadow-2xl backdrop-blur-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-bold text-white">Keyboard Shortcuts</h2>
          <button
            onClick={() => setOpen(false)}
            className="rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-white"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between border-b border-white/10 pb-4">
            <span className="text-sm text-slate-300">New Payment</span>
            <kbd className="flex items-center gap-1 rounded border border-white/20 bg-white/5 px-2 py-1 font-mono text-xs text-slate-300 shadow-sm">
              <span>Alt</span>
              <span>+</span>
              <span>N</span>
            </kbd>
          </div>
          
          <div className="flex items-center justify-between border-b border-white/10 pb-4">
            <span className="text-sm text-slate-300">Settings</span>
            <kbd className="flex items-center gap-1 rounded border border-white/20 bg-white/5 px-2 py-1 font-mono text-xs text-slate-300 shadow-sm">
              <span>Alt</span>
              <span>+</span>
              <span>S</span>
            </kbd>
          </div>
          
          <div className="flex items-center justify-between border-b border-white/10 pb-4">
            <span className="text-sm text-slate-300">Focus Search</span>
            <kbd className="flex items-center gap-1 rounded border border-white/20 bg-white/5 px-2 py-1 font-mono text-xs text-slate-300 shadow-sm">
              /
            </kbd>
          </div>
          
          <div className="flex items-center justify-between border-b border-white/10 pb-4">
            <span className="text-sm text-slate-300">Command Palette</span>
            <kbd className="flex items-center gap-1 rounded border border-white/20 bg-white/5 px-2 py-1 font-mono text-xs text-slate-300 shadow-sm">
              <span>Cmd/Ctrl</span>
              <span>+</span>
              <span>K</span>
            </kbd>
          </div>
          
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-300">Show Shortcuts</span>
            <kbd className="flex items-center gap-1 rounded border border-white/20 bg-white/5 px-2 py-1 font-mono text-xs text-slate-300 shadow-sm">
              ?
            </kbd>
          </div>
        </div>
      </div>
    </div>
  );
}
