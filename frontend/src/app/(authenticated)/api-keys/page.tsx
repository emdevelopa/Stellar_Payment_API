"use client";

import { useMerchantApiKey } from "@/lib/merchant-store";
import { useState } from "react";
import CopyButton from "@/components/CopyButton";
import toast from "react-hot-toast";

export default function ApiKeysPage() {
  const storedApiKey = useMerchantApiKey();
  const [isRotating, setIsRotating] = useState(false);

  const handleRotate = async () => {
    if (!confirm("Are you sure you want to rotate your API key? The old one will be invalidated immediately.")) {
      return;
    }

    setIsRotating(true);
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
      const res = await fetch(`${apiUrl}/api/rotate-key`, {
        method: "POST",
        headers: { "x-api-key": storedApiKey || "" },
      });

      if (!res.ok) throw new Error("Rotation failed");

      toast.success("API key rotated successfully. Please update your env files.");
      // Note: The store will handle the update if it's wired with cookies or session
      // For now, we tell the user to refresh or rely on the store's hydration.
    } catch {
      toast.error("Failed to rotate API key");
    } finally {
      setIsRotating(false);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-bold text-white">API Keys</h1>
        <p className="mt-2 text-slate-400">
          Manage your secret keys to authenticate server-side requests.
        </p>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-8">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <label className="text-xs font-medium uppercase tracking-wider text-slate-500">
              Live API Key
            </label>
            <div className="flex items-center gap-3">
              <code className="flex-1 rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-mint">
                {storedApiKey || "sk_test_••••••••••••••••••••••••"}
              </code>
              <CopyButton text={storedApiKey || ""} />
            </div>
          </div>

          <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-4 text-sm text-yellow-200/80">
            <p className="font-semibold">Security Warning</p>
            <p className="mt-1">
              Never share your secret API keys in publicly accessible areas
              like GitHub, client-side code, or public forums. 
            </p>
          </div>

          <div className="flex justify-end">
            <button
              onClick={handleRotate}
              disabled={isRotating}
              className="rounded-xl border border-red-500/30 bg-red-500/10 px-6 py-2.5 text-sm font-semibold text-red-400 transition hover:bg-red-500/20 disabled:opacity-50"
            >
              {isRotating ? "Rotating..." : "Rotate API Key"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
