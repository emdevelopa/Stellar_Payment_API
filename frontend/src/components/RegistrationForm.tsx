"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { registerMerchant } from "../lib/auth";
import toast from "react-hot-toast";
import {
  useSetMerchantApiKey,
  useSetMerchantMetadata,
} from "@/lib/merchant-store";

export default function RegistrationForm() {
  const router = useRouter();
  const setApiKey = useSetMerchantApiKey();
  const setMerchant = useSetMerchantMetadata();
  const [email, setEmail] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [notificationEmail, setNotificationEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const data = await registerMerchant(
        email,
        businessName,
        notificationEmail,
      );
      setApiKey(data.merchant.api_key);
      setMerchant(data.merchant);
      toast.success(
        `Welcome to Stellar Pay, ${data.merchant.business_name}! Create your first payment to get started.`,
      );
      router.push("/dashboard");
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to register merchant";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="businessName"
            className="text-xs font-medium text-slate-400 uppercase tracking-wider"
          >
            Business Name
          </label>
          <input
            id="businessName"
            type="text"
            required
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            className="rounded-xl border border-white/10 bg-white/5 p-3 text-white placeholder:text-slate-600 focus:border-mint/50 focus:outline-none focus:ring-1 focus:ring-mint/50"
            placeholder="Stellar Shop"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="email"
            className="text-xs font-medium text-slate-400 uppercase tracking-wider"
          >
            Primary Email
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-xl border border-white/10 bg-white/5 p-3 text-white placeholder:text-slate-600 focus:border-mint/50 focus:outline-none focus:ring-1 focus:ring-mint/50"
            placeholder="owner@business.com"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="notificationEmail"
            className="text-xs font-medium text-slate-400 uppercase tracking-wider"
          >
            Notification Email
          </label>
          <input
            id="notificationEmail"
            type="email"
            required
            value={notificationEmail}
            onChange={(e) => setNotificationEmail(e.target.value)}
            className="rounded-xl border border-white/10 bg-white/5 p-3 text-white placeholder:text-slate-600 focus:border-mint/50 focus:outline-none focus:ring-1 focus:ring-mint/50"
            placeholder="alerts@business.com"
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="group relative flex h-12 items-center justify-center rounded-xl bg-mint px-6 font-bold text-black transition-all hover:bg-glow disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? (
          <span className="flex items-center gap-2">
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24">
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
            Processing...
          </span>
        ) : (
          "Register Merchant"
        )}
        <div className="absolute inset-0 -z-10 bg-mint/20 opacity-0 blur-xl transition-opacity group-hover:opacity-100" />
      </button>
    </form>
  );
}
