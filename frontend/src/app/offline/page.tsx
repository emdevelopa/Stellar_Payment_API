"use client";

import React from "react";

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-8 px-6 py-16 bg-[#050608]">
      <div className="rounded-3xl border border-white/10 bg-white/5 shadow-2xl backdrop-blur p-10 text-center">
        <div className="mb-6 flex justify-center">
          <div className="relative">
            <div className="absolute inset-0 animate-ping rounded-full bg-red-500/20" />
            <div className="relative flex h-20 w-20 items-center justify-center rounded-full border border-red-500/30 bg-red-500/10 text-red-400">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="h-10 w-10"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"
                />
              </svg>
            </div>
          </div>
        </div>

        <h1 className="text-2xl font-bold text-white mb-3">Connection Lost</h1>
        <p className="text-slate-400 mb-8">
          It looks like you&apos;re offline. Please check your internet connection to continue with your payment.
        </p>

        <button
          onClick={() => window.location.reload()}
          className="w-full rounded-xl bg-[#5ef2c0] py-3 font-bold text-black transition-all hover:bg-[#5ef2c0]/90 active:scale-95"
        >
          Try Reconnecting
        </button>
      </div>
    </main>
  );
}
