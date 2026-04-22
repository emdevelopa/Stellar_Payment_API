"use client";

import { isValidElement, useMemo, useState, type HTMLAttributes, type ReactNode } from "react";

type PreProps = HTMLAttributes<HTMLPreElement> & {
  children?: ReactNode;
};

function extractText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return extractText(node.props.children);
  return "";
}

export default function DocsCodeBlock({ children, className = "", ...rest }: PreProps) {
  const [copied, setCopied] = useState(false);

  const text = useMemo(() => extractText(children).replace(/\n$/, ""), [children]);

  const handleCopy = async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const el = document.createElement("textarea");
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }

    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="group relative my-8 overflow-hidden rounded-2xl border border-[#E8E8E8] bg-[#0A0A0A] shadow-xl shadow-black/5">
      {/* Header/Title bar */}
      <div className="flex items-center justify-between border-b border-white/5 bg-white/5 px-5 py-2.5">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <div className="h-2 w-2 rounded-full bg-white/10" />
            <div className="h-2 w-2 rounded-full bg-white/10" />
            <div className="h-2 w-2 rounded-full bg-white/10" />
          </div>
          <span className="text-[10px] font-bold uppercase tracking-widest text-white/30 ml-2">Terminal / Code</span>
        </div>
        
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-white/60 transition-all hover:bg-white/10 hover:text-white"
        >
          {copied ? (
            <>
              <svg className="h-3 w-3 text-[var(--pluto-400)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-[var(--pluto-400)]">Copied</span>
            </>
          ) : (
            <>
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              <span>Copy</span>
            </>
          )}
        </button>
      </div>

      <div className="relative">
        <pre {...rest} className={`${className} !m-0 !bg-transparent p-6 text-sm font-medium leading-relaxed overflow-x-auto selection:bg-[var(--pluto-500)]/30`}>
          {children}
        </pre>
        
        {/* Subtle accent line */}
        <div className="absolute bottom-0 left-0 h-[2px] w-full bg-gradient-to-r from-[var(--pluto-500)]/0 via-[var(--pluto-500)]/40 to-[var(--pluto-500)]/0" />
      </div>
    </div>
  );
}
