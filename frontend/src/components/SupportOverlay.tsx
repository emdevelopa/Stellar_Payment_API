"use client";

import { useState } from "react";

const SUPPORT_EMAIL = "support@stellarpayment.app";

export default function SupportOverlay() {
  const [open, setOpen] = useState(false);

  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-50 flex items-end justify-end">
      <div className="pointer-events-auto flex flex-col items-end gap-3">
        {open && (
          <section
            id="support-overlay-panel"
            aria-label="Help and support panel"
            className="w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-white/10 bg-slate-950/95 p-4 shadow-2xl backdrop-blur"
            data-testid="support-overlay-panel"
          >
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-mint">
              Help &amp; Support
            </p>
            <h2 className="mt-2 text-base font-semibold text-white">
              Need help with payments?
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-300">
              This is a placeholder support widget for future Intercom/Crisp integration.
              Reach our team directly for now.
            </p>
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="mt-4 inline-flex rounded-xl border border-mint/35 bg-mint/10 px-4 py-2 text-sm font-semibold text-mint transition-colors hover:bg-mint/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-mint/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
            >
              Contact support
            </a>
          </section>
        )}

        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className="inline-flex h-14 w-14 items-center justify-center rounded-full border border-mint/35 bg-mint/15 text-mint shadow-[0_10px_30px_rgba(94,242,192,0.28)] transition-all hover:scale-[1.03] hover:bg-mint/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-mint/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          aria-label={open ? "Close support chat" : "Open support chat"}
          aria-expanded={open}
          aria-controls="support-overlay-panel"
          data-testid="support-overlay-toggle"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-6 w-6"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            aria-hidden="true"
          >
            <path
              d="M7 10h10M7 14h6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M5 20v-3.5A8.5 8.5 0 1 1 13.5 25H9l-4 3z"
              transform="translate(0 -3)"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
