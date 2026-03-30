"use client";

import { useEffect, useState } from "react";

export default function CancelledPage() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-6 px-6 py-16">
      <div className="rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur shadow-2xl text-center">
        <h1 className="text-2xl font-bold text-white mb-2">Payment Cancelled</h1>
        <p className="text-sm text-slate-400 mb-6">
          You have successfully cancelled this payment. You may now safely close this tab.
        </p>
        <button
          onClick={() => window.close()}
          className="inline-flex h-11 items-center justify-center rounded-xl border border-white/15 bg-white/5 px-6 text-sm font-semibold text-white transition hover:bg-white/10"
        >
          Close Tab
        </button>
      </div>
    </main>
  );
}
