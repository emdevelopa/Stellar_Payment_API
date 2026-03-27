"use client";

import { useState } from "react";
import CopyButton from "@/components/CopyButton";

type MaskedValueProps = {
  value: string;
  label?: string;
  helperText?: React.ReactNode;
  copyText?: string;
  revealed?: boolean;
  defaultRevealed?: boolean;
  onRevealedChange?: (revealed: boolean) => void;
  showLabel?: string;
  hideLabel?: string;
  mask?: (value: string) => string;
  className?: string;
};

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
    >
      <path
        d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx="12"
        cy="12"
        r="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ) : (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
    >
      <path
        d="M17.94 17.94A10.1 10.1 0 0 1 12 19c-6.4 0-10-7-10-7a18.1 18.1 0 0 1 5.06-5.94M9.9 4.24A9.1 9.1 0 0 1 12 4c6.4 0 10 7 10 7a18.1 18.1 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line x1="1" y1="1" x2="23" y2="23" strokeLinecap="round" />
    </svg>
  );
}

function defaultMask(value: string) {
  if (value.length <= 12) return "•".repeat(value.length);
  return value.slice(0, 7) + "•".repeat(value.length - 13) + value.slice(-6);
}

export default function MaskedValue({
  value,
  label,
  helperText,
  copyText,
  revealed,
  defaultRevealed = false,
  onRevealedChange,
  showLabel = "Show",
  hideLabel = "Hide",
  mask = defaultMask,
  className = "",
}: MaskedValueProps) {
  const [internalRevealed, setInternalRevealed] = useState(defaultRevealed);
  const isControlled = typeof revealed === "boolean";
  const isRevealed = isControlled ? revealed : internalRevealed;
  const displayValue = isRevealed ? value : mask(value);

  const toggle = () => {
    const next = !isRevealed;
    if (!isControlled) setInternalRevealed(next);
    onRevealedChange?.(next);
  };

  const ariaLabel = isRevealed
    ? `Hide ${label ?? "value"}`
    : `Show ${label ?? "value"}`;

  return (
    <section className={`flex flex-col gap-3 ${className}`.trim()}>
      <div className="flex items-center justify-between">
        {label ? (
          <h2 className="text-xs font-medium uppercase tracking-wider text-slate-400">
            {label}
          </h2>
        ) : (
          <div />
        )}
        <button
          type="button"
          onClick={toggle}
          aria-label={ariaLabel}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
        >
          <EyeIcon open={isRevealed} />
          {isRevealed ? hideLabel : showLabel}
        </button>
      </div>

      <div className="flex items-center gap-2 overflow-hidden rounded-xl border border-white/10 bg-black/40 p-1 pl-4">
        <code
          className={`flex-1 truncate font-mono text-sm transition-colors ${
            isRevealed ? "text-mint" : "text-slate-500"
          }`}
        >
          {displayValue}
        </code>
        {isRevealed && copyText ? <CopyButton text={copyText} /> : null}
      </div>

      {helperText ? (
        <p className="text-[11px] text-slate-600">{helperText}</p>
      ) : null}
    </section>
  );
}
