"use client";

import { useEffect, useId, useState } from "react";
import dynamic from "next/dynamic";
import { useMerchantApiKey } from "@/lib/merchant-store";

const WebhookHealthDetails = dynamic(() => import("./WebhookHealthDetails"), {
  ssr: false,
  loading: () => (
    <div
      data-testid="webhook-health-details-skeleton"
      className="mt-1 h-12 w-full animate-pulse rounded-xl border border-white/10 bg-white/5"
      role="status"
      aria-label="Loading webhook health details"
    />
  ),
});

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const REFRESH_INTERVAL_MS = 30000;

export interface HealthStatus {
  successRate: number;
  status: "healthy" | "degraded" | "unhealthy";
  lastDeliveries: number;
  consecutiveFailures?: number;
  sslValid?: boolean;
  sslExpiresAt?: string;
}

function isKnownStatus(value: unknown): value is HealthStatus["status"] {
  return value === "healthy" || value === "degraded" || value === "unhealthy";
}

function normaliseHealth(data: Record<string, unknown>): HealthStatus {
  return {
    successRate: Number(data.successRate) || 0,
    status: isKnownStatus(data.status) ? data.status : "unhealthy",
    lastDeliveries: Number(data.lastDeliveries) || 0,
    consecutiveFailures:
      typeof data.consecutiveFailures === "number"
        ? data.consecutiveFailures
        : undefined,
    sslValid: typeof data.sslValid === "boolean" ? data.sslValid : undefined,
    sslExpiresAt:
      typeof data.sslExpiresAt === "string" ? data.sslExpiresAt : undefined,
  };
}

export default function WebhookHealthIndicator({
  webhookUrl,
}: {
  webhookUrl?: string;
}) {
  const apiKey = useMerchantApiKey();
  const detailsId = useId();
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    if (!apiKey || !webhookUrl) {
      setError(apiKey ? null : "API key unavailable");
      setLoading(false);
      return;
    }

    let cancelled = false;

    const fetchHealth = async () => {
      try {
        const response = await fetch(`${API_URL}/api/webhooks/health`, {
          headers: {
            "x-api-key": apiKey,
          },
        });

        if (!response.ok) {
          throw new Error("Failed to fetch webhook health");
        }

        const data = await response.json();
        if (!cancelled) {
          setHealth(normaliseHealth(data));
          setError(null);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to fetch webhook health");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchHealth();
    const interval = setInterval(fetchHealth, REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [apiKey, webhookUrl]);

  if (!webhookUrl) {
    return null;
  }

  if (loading || (!health && !error)) {
    return (
      <div
        className="flex items-center gap-2"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-busy="true"
        aria-label="Checking webhook health"
      >
        <div
          className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-[#1F1F1F]"
          data-testid="health-loading-dot"
          role="status"
          aria-live="polite"
        />
        <span className="text-[10px] font-black uppercase tracking-widest text-[#A0A0A0]">
          Checking...
        </span>
      </div>
    );
  }

  if (error || !health) {
    return (
      <div
        className="flex items-center gap-2.5 text-xs text-red-400"
        role="alert"
        data-testid="webhook-health-error"
      >
        <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" aria-hidden="true" />
        <span>Health check unavailable{error ? `: ${error}` : ""}</span>
      </div>
    );
  }

  const statusColor =
    health.status === "healthy"
      ? "bg-[#00F5D4]"
      : health.status === "degraded"
        ? "bg-yellow-500"
        : "bg-red-500";

  const statusText =
    health.status === "healthy"
      ? "Healthy"
      : health.status === "degraded"
        ? "Degraded"
        : "Unhealthy";

  return (
    <div
      className="flex flex-col items-start gap-2"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label="Webhook endpoint health"
      data-testid="webhook-health-indicator"
      tabIndex={0}
    >
      <div className="flex w-full flex-wrap items-center gap-2.5">
        <div className="relative flex h-2 w-2 shrink-0">
          <div
            className={`h-full w-full rounded-full ${statusColor}`}
            aria-label={`Webhook status: ${statusText}`}
          />
          <div
            className={`absolute inset-0 h-full w-full animate-ping rounded-full ${statusColor} opacity-50 motion-reduce:animate-none`}
            aria-hidden="true"
          />
        </div>
        <span className="text-[10px] font-black uppercase tracking-widest text-[#A0A0A0]">
          {statusText} <span className="text-white mx-1">/</span> {health.successRate}%{" "}
          <span className="text-white mx-1">/</span> last {health.lastDeliveries}
        </span>
        <button
          type="button"
          className="rounded-md text-[10px] font-bold uppercase tracking-widest text-slate-400 underline decoration-slate-600 underline-offset-2 transition-colors hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-mint"
          onClick={() => setShowDetails((current) => !current)}
          aria-expanded={showDetails}
          aria-controls={showDetails ? detailsId : undefined}
          aria-label={
            showDetails ? "Hide webhook health details" : "Show webhook health details"
          }
        >
          {showDetails ? "Hide details" : "Details"}
        </button>
      </div>

      {showDetails && <WebhookHealthDetails id={detailsId} health={health} />}
    </div>
  );
}
