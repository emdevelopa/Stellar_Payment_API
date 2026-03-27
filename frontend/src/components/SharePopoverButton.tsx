"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import toast from "react-hot-toast";
import { QRCodeSVG } from "qrcode.react";

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const el = document.createElement("textarea");
      el.value = text;
      el.setAttribute("readonly", "");
      el.style.position = "absolute";
      el.style.left = "-9999px";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      return true;
    } catch {
      return false;
    }
  }
}

interface SharePopoverButtonProps {
  url: string;
  className?: string;
}

export default function SharePopoverButton({
  url,
  className = "",
}: SharePopoverButtonProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyState, setCopyState] = useState<
    "idle" | "copying" | "copied" | "failed"
  >("idle");
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    closeButtonRef.current?.focus();

    const onPointerDown = (e: PointerEvent) => {
      const root = rootRef.current;
      if (!root) return;
      if (e.target instanceof Node && !root.contains(e.target)) {
        setOpen(false);
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const handleToggle = async () => {
    if (open) {
      setOpen(false);
      return;
    }

    setOpen(true);
    setCopyState("copying");
    const ok = await copyToClipboard(url);
    if (ok) {
      setCopyState("copied");
      setCopied(true);
      toast.success("Link copied. Scan the QR to open it.");
      window.setTimeout(() => setCopied(false), 2000);
    } else {
      setCopyState("failed");
      toast.error("Couldn't copy the link. You can still scan the QR.");
    }
  };

  return (
    <div ref={rootRef} className={`relative inline-flex items-center ${className}`}>
      <motion.button
        type="button"
        onClick={handleToggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs font-semibold text-slate-200 transition-colors hover:border-mint/40 hover:text-white active:scale-95"
        whileTap={{ scale: 0.97 }}
      >
        <svg
          aria-hidden="true"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className="h-4 w-4 text-mint"
        >
          <path
            d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M16 6l-4-4-4 4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M12 2v14" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>Share</span>
        {copied && (
          <span className="rounded-full bg-mint/15 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-mint">
            Copied
          </span>
        )}
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            id={panelId}
            role="dialog"
            aria-label="Share payment link"
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            className="absolute right-0 top-full z-50 mt-2 w-[20rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-white/10 bg-[#070a10]/95 shadow-2xl backdrop-blur"
          >
            <div className="flex items-start justify-between gap-3 border-b border-white/10 p-4">
              <div className="flex flex-col gap-1">
                <p className="text-sm font-semibold text-white">Share link</p>
                <p className="text-xs text-slate-400">
                  {copyState === "copying"
                    ? "Copying link…"
                    : copyState === "failed"
                      ? "Scan to open — select the link if copy is blocked."
                      : "Copied to clipboard — scan to open."}
                </p>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg border border-white/10 bg-black/30 p-2 text-slate-400 transition-colors hover:border-white/20 hover:text-white"
                aria-label="Close share panel"
              >
                <svg
                  aria-hidden="true"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  className="h-4 w-4"
                >
                  <path d="M18 6L6 18" strokeLinecap="round" />
                  <path d="M6 6l12 12" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <div className="grid gap-4 p-4">
              <div className="rounded-xl border border-white/10 bg-black/40 p-3">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Link
                </p>
                <code className="block select-all break-all font-mono text-xs text-mint">
                  {url}
                </code>
              </div>

              <div className="flex items-center justify-center rounded-xl border border-white/10 bg-white p-3">
                <QRCodeSVG value={url} size={160} includeMargin />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
