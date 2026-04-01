"use client";

import { useEffect, useState } from "react";
import confetti from "canvas-confetti";
import { useMerchantApiKey } from "@/lib/merchant-store";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export default function FirstPaymentCelebration() {
  const apiKey = useMerchantApiKey();
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    if (!apiKey) return;

    // Check payment metrics to see if they just hit 1 payment
    const checkPaymentCount = async () => {
      try {
        const hasSeenCelebration = localStorage.getItem("hasSeenFirstPaymentCelebration");
        if (hasSeenCelebration) return;

        const res = await fetch(`${API_URL}/api/metrics`, {
          headers: { "x-api-key": apiKey }
        });
        if (!res.ok) return;

        const data = await res.json();
        // Assume data.total_payments or data.metrics.total_payments exists
        // Adjust depending on actual API structure. Usually it's in metrics.total_volume/count
        const paymentsCount = data.metrics?.total_volume?.count ?? data.total_payments ?? 0;
        
        if (paymentsCount === 1) {
          triggerCelebration();
        }
      } catch {
        // silent fail
      }
    };

    checkPaymentCount();
    
    // Optional: could poll, but usually they'll see this on refresh/dashboard visit after payment.
  }, [apiKey]);

  const triggerCelebration = () => {
    localStorage.setItem("hasSeenFirstPaymentCelebration", "true");
    
    const duration = 3000;
    const end = Date.now() + duration;

    (function frame() {
      confetti({
        particleCount: 5,
        angle: 60,
        spread: 55,
        origin: { x: 0 },
        colors: ["#00F5D4", "#6C5CE7"]
      });
      confetti({
        particleCount: 5,
        angle: 120,
        spread: 55,
        origin: { x: 1 },
        colors: ["#00F5D4", "#6C5CE7"]
      });

      if (Date.now() < end) {
        requestAnimationFrame(frame);
      } else {
        setShowModal(true);
      }
    }());
  };

  if (!showModal) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-md overflow-hidden rounded-3xl border border-accent/30 bg-black p-8 text-center shadow-2xl flex flex-col items-center">
        <div className="absolute top-0 right-0 p-4">
          <button 
            onClick={() => setShowModal(false)}
            className="text-slate-500 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>
        
        <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-accent/20 text-accent text-3xl">
          🎉
        </div>
        
        <h2 className="mb-2 text-2xl font-bold tracking-tight text-white">
          Congratulations!
        </h2>
        
        <p className="mb-8 text-slate-400">
          You just received your first successful payment. This is a huge milestone. 
          Ready to supercharge your integration?
        </p>

        <div className="flex w-full flex-col gap-3">
          <a
            href="/settings"
            className="flex items-center justify-center rounded-xl bg-accent px-6 py-3 font-semibold text-black transition-all hover:bg-secondary"
          >
            Configure Webhooks
          </a>
          <button
            onClick={() => setShowModal(false)}
            className="flex items-center justify-center rounded-xl border border-white/10 px-6 py-3 font-semibold text-slate-300 transition-all hover:bg-white/5"
          >
            I&apos;ll do it later
          </button>
        </div>
      </div>
    </div>
  );
}
