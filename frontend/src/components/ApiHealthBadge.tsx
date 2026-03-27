"use client";

import { useEffect, useState } from "react";

type HealthStatus = "loading" | "healthy" | "error";

export default function ApiHealthBadge() {
  const [status, setStatus] = useState<HealthStatus>("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const checkHealth = async () => {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
        const res = await fetch(`${apiUrl}/health`);
        const data = await res.json();
        
        if (mounted) {
          if (res.ok && data.ok && data.horizon_reachable) {
            setStatus("healthy");
            setErrorMsg("Dashboard & Stellar Network Online");
          } else {
            setStatus("error");
            setErrorMsg(data.error || "Service Disruption Detected");
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
      color: "bg-slate-500",
      pulse: "bg-slate-500/40",
      text: "text-slate-400",
      label: "Checking Health...",
    },
    healthy: {
      color: "bg-green-500",
      pulse: "bg-green-500/40",
      text: "text-green-400",
      label: "All Systems Operational",
    },
    error: {
      color: "bg-red-500",
      pulse: "bg-red-500/40",
      text: "text-red-400",
      label: "Service Disruption",
    },
  }[status];

  return (
    <div className="group relative flex items-center gap-2 rounded-full border border-white/10 bg-black/40 px-3 py-1.5 transition-colors hover:bg-white/5 cursor-default mt-1 md:mt-0">
      <div className="relative flex h-2.5 w-2.5 items-center justify-center">
        {status !== "loading" && (
          <span
            className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${config.pulse}`}
          />
        )}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${config.color}`} />
      </div>
      <span className={`text-[10px] font-medium uppercase tracking-wider ${config.text}`}>
        {status === "error" ? "Degraded" : "API"}
      </span>

      {/* Tooltip */}
      <div className="pointer-events-none absolute left-1/2 top-full z-50 mt-2 -translate-x-1/2 whitespace-nowrap rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-xs text-white opacity-0 shadow-xl transition-opacity group-hover:opacity-100">
        <p className="font-semibold text-center">{config.label}</p>
        {(status === "error" && errorMsg) && (
          <p className="mt-0.5 text-[10px] text-slate-400 text-center">{errorMsg}</p>
        )}
      </div>
    </div>
  );
}
