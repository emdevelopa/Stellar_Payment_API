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
    <div 
      className="group relative flex items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-white px-3.5 py-2 transition-all duration-300 hover:border-[var(--pluto-300)] hover:bg-[var(--pluto-50)]/50 cursor-default"
      aria-describedby="api-status-tooltip"
    >
      <div className="relative flex h-2 w-2 items-center justify-center">
        {status !== "loading" && (
          <span
            className={`absolute inline-flex h-full w-full motion-safe:animate-ping rounded-full opacity-75 ${config.pulse}`}
          />
        )}
        <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${config.color}`} />
      </div>
      <span className={`text-[10px] font-bold uppercase tracking-[0.2em] ${config.text}`}>
        {status === "healthy" ? "API Active" : status === "error" ? "API Down" : "Checking"}
      </span>

      {/* Tooltip */}
      <div 
        id="api-status-tooltip"
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-50 mt-4 -translate-x-1/2 whitespace-nowrap rounded-2xl border border-[var(--pluto-100)] bg-white/95 px-5 py-3.5 text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--text-primary)] opacity-0 shadow-[0_20px_50px_rgba(0,0,0,0.12)] backdrop-blur-md transition-all duration-300 group-hover:opacity-100 group-hover:translate-y-1.5"
      >
        <p className="text-center leading-none">{config.label}</p>
        {(errorMsg && status !== "loading") && (
          <p className="mt-2 text-[9px] text-[var(--text-secondary)] lowercase tracking-normal font-medium text-center">{errorMsg}</p>
        )}
        {/* Arrow */}
        <div className="absolute bottom-full left-1/2 h-2.5 w-2.5 -translate-x-1/2 translate-y-1.5 rotate-45 border-l border-t border-[var(--pluto-100)] bg-white/95" />
      </div>
    </div>
  );
}
