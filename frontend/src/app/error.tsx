"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 text-center relative overflow-hidden">
      {/* Animated background effect */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-32 h-32 bg-red-500/5 rounded-full blur-3xl animate-pulse" />
        <div
          className="absolute bottom-1/3 right-1/4 w-40 h-40 bg-red-500/5 rounded-full blur-3xl animate-pulse"
          style={{ animationDelay: "1s" }}
        />
      </div>

      <div className="flex flex-col items-center gap-8 max-w-md relative z-10">
        {/* Solar Flare / Error Illustration */}
        <div className="relative w-64 h-64">
          <svg
            viewBox="0 0 200 200"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="w-full h-full text-red-400"
          >
            <circle
              cx="100"
              cy="100"
              r="50"
              fill="currentColor"
              fillOpacity="0.2"
            />
            <circle cx="100" cy="100" r="30" fill="currentColor" />
            <g className="animate-pulse">
              <path
                d="M100 20L100 50M100 150L100 180M20 100L50 100M150 100L180 100"
                stroke="currentColor"
                strokeWidth="4"
                strokeLinecap="round"
              />
              <path
                d="M43.4 43.4L64.6 64.6M135.4 135.4L156.6 156.6M43.4 156.6L64.6 135.4M135.4 43.4L156.6 64.6"
                stroke="currentColor"
                strokeWidth="4"
                strokeLinecap="round"
              />
            </g>
            <path
              d="M80 80L120 120M120 80L80 120"
              stroke="white"
              strokeWidth="6"
              strokeLinecap="round"
            />
          </svg>
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-40 h-40 bg-red-500/10 blur-3xl rounded-full" />
        </div>

        <div className="flex flex-col gap-3">
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-red-400">
            Error 500
          </p>
          <h1 className="text-3xl font-bold text-white sm:text-4xl">
            Solar Flare Detected
          </h1>
          <p className="text-slate-400">
            Our network encountered a solar flare. Systems are glitching, but
            we&apos;ve logged the anomaly and are deploying a repair shuttle.
          </p>

          {error.digest && (
            <div className="mt-4 p-4 rounded-lg border border-red-500/30 bg-red-500/10">
              <p className="text-xs text-red-400 mb-2">Error Reference:</p>
              <code className="text-sm font-mono text-red-300 break-all">
                {error.digest}
              </code>
            </div>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-4">
          <button
            onClick={reset}
            className="group relative flex items-center justify-center gap-2 rounded-full border border-mint/30 bg-mint/5 px-8 py-3 text-sm font-semibold text-mint backdrop-blur transition-all hover:bg-mint/10"
          >
            Try Again
            <div className="absolute inset-0 -z-10 bg-mint/10 opacity-0 blur-xl transition-opacity group-hover:opacity-100" />
          </button>

          <Link
            href="/dashboard"
            className="flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/5 px-8 py-3 text-sm font-semibold text-white backdrop-blur transition-all hover:bg-white/10"
          >
            Return to Dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
