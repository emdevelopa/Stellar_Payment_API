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
      color: "bg-[#E8E8E8]",
      pulse: "bg-[#E8E8E8]",
      text: "text-[#6B6B6B]",
      label: "Checking Health...",
    },
    healthy: {
      color: "bg-green-500",
      pulse: "bg-green-500/20",
      text: "text-[#6B6B6B]",
      label: "All Systems Operational",
    },
    error: {
      color: "bg-red-500",
      pulse: "bg-red-500/20",
      text: "text-red-500",
      label: "Service Disruption",
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
        {status === "error" ? "Degraded" : "API"}
      </span>

      {/* Tooltip */}
      <div className="pointer-events-none absolute left-1/2 top-full z-50 mt-3 -translate-x-1/2 whitespace-nowrap rounded-xl border border-[#E8E8E8] bg-white px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-[#0A0A0A] opacity-0 shadow-[0_10px_30px_rgb(0,0,0,0.08)] transition-all group-hover:opacity-100 group-hover:translate-y-1">
        <p className="text-center">{config.label}</p>
        {(status === "error" && errorMsg) && (
          <p className="mt-1.5 text-[9px] text-[#6B6B6B] lowercase tracking-normal font-medium text-center">{errorMsg}</p>
        )}
      </div>
    </div>
  );
}
