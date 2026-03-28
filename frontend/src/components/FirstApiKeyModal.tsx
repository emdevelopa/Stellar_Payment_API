"use client";

import React, { useState } from "react";
import { Modal } from "./ui/Modal";
import CopyButton from "./CopyButton";
import { generateFirstApiKey } from "@/lib/auth";
import { useSetMerchantApiKey } from "@/lib/merchant-store";
import toast from "react-hot-toast";

interface FirstApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function FirstApiKeyModal({ isOpen, onClose }: FirstApiKeyModalProps) {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const setStoreApiKey = useSetMerchantApiKey();

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const newKey = await generateFirstApiKey();
      setApiKey(newKey);
      setStoreApiKey(newKey);
      toast.success("API Key generated successfully!");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to generate API Key";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Welcome to Vaultix">
      <div className="flex flex-col gap-6">
        {!apiKey ? (
          <>
            <div className="flex flex-col gap-2">
              <h3 className="text-xl font-bold text-white">Generate your first API key</h3>
              <p className="text-slate-400 text-sm">
                To start accepting payments, you&apos;ll need an API key to authenticate your server-side requests.
              </p>
            </div>
            
            <button
              onClick={handleGenerate}
              disabled={loading}
              className="w-full rounded-xl bg-mint py-3 font-bold text-black transition-all hover:bg-glow disabled:opacity-50"
            >
              {loading ? "Generating..." : "Generate API Key"}
            </button>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <h3 className="text-xl font-bold text-mint">Your API Key is ready!</h3>
              <p className="text-slate-400 text-sm">
                Copy this key and save it somewhere secure. You won&apos;t be able to see it again after closing this window.
              </p>
            </div>

            <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/40 px-4 py-3">
              <code className="flex-1 truncate text-sm text-mint">{apiKey}</code>
              <CopyButton text={apiKey} />
            </div>

            <div className="flex flex-col gap-3 pt-2">
              <a
                href="/api-docs"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 py-3 text-sm font-medium text-white transition-all hover:bg-white/10"
              >
                View API Documentation
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
              <button
                onClick={onClose}
                className="w-full text-center text-sm text-slate-500 hover:text-white transition-colors"
              >
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
