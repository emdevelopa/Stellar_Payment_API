"use client";

import { useEffect, useState } from "react";

type ExtendedHealthStatus = "loading" | "healthy" | "error";

export default function ApiHealthBadge() {
  const [status, setStatus] = useState<ExtendedHealthStatus>("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const checkHealth = async () => {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
        const res = await fetch(`${apiUrl}/health`, { cache: "no-store" });
        const data = await res.json().catch(() => ({}));

        if (mounted) {
          const services = data?.services ?? {};
          const dbOk = services.database === "ok";
          const horizonOk = services.horizon === "ok";
          const apiReachable = true; // If we got an HTTP response, backend is reachable.
          const healthy = apiReachable;

          if (healthy) {
            setStatus("healthy");
            const missing: string[] = [];
            if (!dbOk) missing.push("database");
            if (!horizonOk) missing.push("horizon");
            setErrorMsg(
              missing.length > 0
                ? `Degraded dependency: ${missing.join(" + ")} unavailable`
                : null,
            );
          } else {
            setStatus("error");
            setErrorMsg(data?.error || "Backend unavailable");
          }
        }
      } catch {
        if (mounted) {
          setStatus("error");
          setErrorMsg("API Unreachable");
        }
      }
    };

    checkHealth();
    // Re-check every 60 seconds
    const interval = setInterval(checkHealth, 60000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const config = {
    loading: {
      color: "bg-[#E8E8E8]",
      pulse: "bg-[#E8E8E8]",
      text: "text-[#6B6B6B]",
      label: "Checking Health...",
    },
    healthy: {
      color: "bg-green-500",
      pulse: "bg-green-500/20",
      text: "text-[#6B6B6B]",
      label: "Pluto API Online",
    },
    error: {
      color: "bg-red-500",
      pulse: "bg-red-500/20",
      text: "text-red-500",
      label: "Pluto API Offline",
    },
  }[status];

  return (
    <div className="group relative flex items-center gap-2 rounded-full border border-[#E8E8E8] bg-white px-3 py-1.5 transition-all hover:border-[#0A0A0A] hover:bg-[#F9F9F9] cursor-default">
      <div className="relative flex h-2 w-2 items-center justify-center">
        {status !== "loading" && (
          <span
            className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${config.pulse}`}
          />
        )}
        <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${config.color}`} />
      </div>
      <span className={`text-[10px] font-bold uppercase tracking-widest ${config.text}`}>
        {status === "healthy" ? "API Active" : status === "error" ? "API Down" : "Checking"}
      </span>

      {/* Tooltip */}
      <div className="pointer-events-none absolute left-1/2 top-full z-50 mt-3 -translate-x-1/2 whitespace-nowrap rounded-xl border border-[#E8E8E8] bg-white px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-[#0A0A0A] opacity-0 shadow-[0_10px_30px_rgb(0,0,0,0.08)] transition-all group-hover:opacity-100 group-hover:translate-y-1">
        <p className="text-center">{config.label}</p>
        {(errorMsg && status !== "loading") && (
          <p className="mt-1.5 text-[9px] text-[#6B6B6B] lowercase tracking-normal font-medium text-center">{errorMsg}</p>
        )}
      </div>
    </div>
  );
}
