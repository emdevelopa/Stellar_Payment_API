"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface BrandingConfig {
  primary_color?: string;
  secondary_color?: string;
  background_color?: string;
  logo_url?: string | null;
}

interface EmailReceiptPreviewProps {
  isOpen: boolean;
  onClose: () => void;
  branding: BrandingConfig;
  apiKey: string | null;
  apiUrl: string;
}

export function EmailReceiptPreview({
  isOpen,
  onClose,
  branding,
  apiKey,
  apiUrl,
}: EmailReceiptPreviewProps) {
  const [html, setHtml] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && apiKey) {
      const fetchPreview = async () => {
        setLoading(true);
        setError(null);
        try {
          const res = await fetch(`${apiUrl}/api/preview-receipt`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": apiKey,
            },
            body: JSON.stringify(branding),
          });

          if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || "Failed to fetch preview");
          }

          const htmlText = await res.text();
          setHtml(htmlText);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Failed to load preview");
        } finally {
          setLoading(false);
        }
      };

      fetchPreview();
    }
  }, [isOpen, apiKey, branding, apiUrl]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed inset-4 z-50 flex flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#0A0A0B] shadow-2xl md:inset-auto md:left-1/2 md:top-1/2 md:h-[85vh] md:w-full md:max-w-2xl md:-translate-x-1/2 md:-translate-y-1/2"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/10 p-6 px-8">
              <div>
                <h3 className="text-xl font-bold text-white">Email Receipt Preview</h3>
                <p className="text-sm text-slate-400">
                  This is exactly what your customers will see in their inbox.
                </p>
              </div>
              <button
                onClick={onClose}
                className="rounded-full p-2 text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
              >
                <svg
                  className="h-6 w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            {/* Content */}
            <div className="relative flex-1 bg-white p-4 overflow-hidden">
              {loading && (
                <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-10">
                  <div className="flex flex-col items-center gap-3">
                    <svg
                      className="h-8 w-8 animate-spin text-mint"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                        fill="none"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    <p className="text-sm font-medium text-slate-600">Generating preview...</p>
                  </div>
                </div>
              )}

              {error && (
                <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
                  <div className="rounded-full bg-red-500/10 p-3 text-red-500">
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 14c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  </div>
                  <p className="max-w-xs text-sm text-slate-600 font-medium">{error}</p>
                  <button
                    onClick={() => {
                        // Re-trigger useEffect by toggling something if needed, but here simple retry logic
                        setHtml(""); 
                        setError(null);
                    }}
                    className="text-sm font-bold text-mint hover:underline"
                  >
                    Try again
                  </button>
                </div>
              )}

              {html && !loading && !error && (
                <iframe
                  title="Receipt Preview"
                  srcDoc={html}
                  className="h-full w-full border-none"
                />
              )}
            </div>

            {/* Footer */}
            <div className="border-t border-white/10 bg-black/20 p-6 px-8 flex justify-end">
              <button
                onClick={onClose}
                className="rounded-xl border border-white/10 bg-white/5 px-6 py-2.5 text-sm font-semibold text-white transition-all hover:bg-white/10"
              >
                Close Preview
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
