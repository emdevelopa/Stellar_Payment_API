"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import confetti from "canvas-confetti";
import { useMerchantApiKey } from "@/lib/merchant-store";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const DEFAULT_STORAGE_KEY = "hasSeenFirstPaymentCelebration";

function getCelebrationStorageKey(apiKey: string) {
  return `${DEFAULT_STORAGE_KEY}:${apiKey}`;
}

function readPaymentsCount(data: unknown) {
  if (!data || typeof data !== "object") return 0;

  const metrics = "metrics" in data && data.metrics && typeof data.metrics === "object" ? data.metrics : null;
  const nestedCount =
    metrics &&
    "total_volume" in metrics &&
    metrics.total_volume &&
    typeof metrics.total_volume === "object" &&
    "count" in metrics.total_volume &&
    typeof metrics.total_volume.count === "number"
      ? metrics.total_volume.count
      : null;

  if (nestedCount !== null) return nestedCount;

  return "total_payments" in data && typeof data.total_payments === "number" ? data.total_payments : 0;
}

export default function FirstPaymentCelebration() {
  const apiKey = useMerchantApiKey();
  const [showModal, setShowModal] = useState(false);
  const triggeredRef = useRef(false);
  const storageKey = useMemo(
    () => (apiKey ? getCelebrationStorageKey(apiKey) : DEFAULT_STORAGE_KEY),
    [apiKey],
  );

  useEffect(() => {
    if (!apiKey || triggeredRef.current) return;

    const controller = new AbortController();

    const checkPaymentCount = async () => {
      try {
        if (localStorage.getItem(storageKey)) return;

        const res = await fetch(`${API_URL}/api/metrics`, {
          headers: { "x-api-key": apiKey },
          signal: controller.signal,
        });
        if (!res.ok) return;

        const data = await res.json();
        if (readPaymentsCount(data) !== 1) return;

        triggeredRef.current = true;
        setShowModal(true);

        const prefersReducedMotion =
          typeof window !== "undefined" &&
          window.matchMedia("(prefers-reduced-motion: reduce)").matches;

        if (!prefersReducedMotion) {
          const burstConfig = {
            particleCount: 36,
            spread: 70,
            startVelocity: 28,
            ticks: 220,
            colors: ["#5EF2C0", "#B8FFE2", "#F8FFAE", "#FFFFFF"],
          };

          confetti({
            ...burstConfig,
            angle: 60,
            origin: { x: 0.12, y: 0.55 },
          });
          confetti({
            ...burstConfig,
            angle: 120,
            origin: { x: 0.88, y: 0.55 },
          });
        }
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          triggeredRef.current = false;
        }
      }
    };

    void checkPaymentCount();

    return () => controller.abort();
  }, [apiKey, storageKey]);

  const dismissCelebration = () => {
    localStorage.setItem(storageKey, "true");
    setShowModal(false);
  };

  if (!showModal) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-[#04110d]/82 p-4 backdrop-blur-md"
      role="presentation"
    >
      <div
        className="relative w-full max-w-xl overflow-hidden rounded-[32px] border border-mint/25 bg-[#071411] p-8 text-white shadow-[0_32px_120px_rgba(6,35,28,0.48)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="first-payment-celebration-title"
        aria-describedby="first-payment-celebration-description"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(94,242,192,0.2),transparent_48%),linear-gradient(135deg,rgba(255,255,255,0.04),transparent_55%)]"
        />

        <button
          type="button"
          onClick={dismissCelebration}
          className="absolute right-4 top-4 inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-300 transition-colors hover:border-mint/40 hover:text-white"
          aria-label="Close celebration"
        >
          <span aria-hidden="true" className="text-lg leading-none">
            ×
          </span>
        </button>

        <div className="relative flex flex-col gap-8">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full border border-mint/30 bg-mint/15 text-3xl shadow-[0_0_30px_rgba(94,242,192,0.18)]">
              <span aria-hidden="true">🎉</span>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.34em] text-mint/80">
                Payment milestone reached
              </p>
              <h2 id="first-payment-celebration-title" className="text-3xl font-bold tracking-tight text-white">
                First payment received
              </h2>
            </div>
          </div>

          <p id="first-payment-celebration-description" className="max-w-lg text-base leading-7 text-slate-300">
            Your integration just processed its first successful payment. Keep the momentum going by wiring up
            webhooks so every confirmation reaches your backend in real time.
          </p>

          <div className="grid gap-3 rounded-[28px] border border-white/8 bg-white/[0.03] p-5 text-sm text-slate-300 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">Why now</p>
              <p className="mt-2 leading-6 text-slate-200">
                The first live payment is the safest moment to verify delivery events before volume increases.
              </p>
            </div>
            <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">
                Recommended next step
              </p>
              <p className="mt-2 leading-6 text-slate-200">
                Configure webhook notifications and confirm your app reacts correctly to payment status updates.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <a
              href="/settings"
              className="inline-flex min-h-12 flex-1 items-center justify-center rounded-2xl bg-mint px-6 py-3 text-sm font-semibold text-black transition-colors hover:bg-glow"
            >
              Configure Webhooks
            </a>
            <button
              type="button"
              onClick={dismissCelebration}
              className="inline-flex min-h-12 flex-1 items-center justify-center rounded-2xl border border-white/10 px-6 py-3 text-sm font-semibold text-slate-200 transition-colors hover:border-white/20 hover:bg-white/5"
            >
              I&apos;ll do it later
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
