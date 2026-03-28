"use client";
/// <reference types="react" />
import React, { useState } from "react";
import toast from "react-hot-toast";

interface CopyButtonProps {
  text: string;
  className?: string;
}

const CheckIcon: React.FC = () => (
  <svg
    viewBox="0 0 24 24"
    className="h-4 w-4 text-mint"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const ClipboardIcon: React.FC = () => (
  <svg
    viewBox="0 0 24 24"
    className="h-4 w-4 text-slate-400 transition-colors"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const CopyButton: React.FC<CopyButtonProps> = ({ text, className = "" }) => {
  const [copied, setCopied] = useState<boolean>(false);

  const handleCopy = async (): Promise<void> => {
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("Copied to clipboard!");
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy text: ", err);
      toast.error("Failed to copy to clipboard");
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all hover:bg-white/10 active:scale-90 ${className}`}
      title="Copy to clipboard"
    >
      {copied ? <CheckIcon /> : <ClipboardIcon />}
    </button>
  );
};

export default CopyButton;
