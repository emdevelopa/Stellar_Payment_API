"use client";

import { useEffect, useState } from "react";
import { useMerchantApiKey } from "@/lib/merchant-store";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

interface HealthStatus {
  successRate: number;
  status: "healthy" | "degraded" | "unhealthy";
  lastDeliveries: number;
}

export default function WebhookHealthIndicator({
  webhookUrl,
}: {
  webhookUrl?: string;
}) {
  const apiKey = useMerchantApiKey();
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!apiKey || !webhookUrl) {
      setLoading(false);
      return;
    }

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
        setHealth(data);
      } catch (err) {
        console.error("Failed to fetch webhook health:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchHealth();
    const interval = setInterval(fetchHealth, 30000); // Refresh every 30s

    return () => clearInterval(interval);
  }, [apiKey, webhookUrl]);

  if (!webhookUrl) {
    return null;
  }

  if (loading || !health) {
    return (
      <div className="flex items-center gap-2">
        <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-slate-500" />
        <span className="text-xs text-slate-500">Checking...</span>
      </div>
    );
  }

  const getStatusColor = () => {
    switch (health.status) {
      case "healthy":
        return "bg-green-500";
      case "degraded":
        return "bg-yellow-500";
      case "unhealthy":
        return "bg-red-500";
      default:
        return "bg-slate-500";
    }
  };

  const getStatusText = () => {
    switch (health.status) {
      case "healthy":
        return "Healthy";
      case "degraded":
        return "Degraded";
      case "unhealthy":
        return "Unhealthy";
      default:
        return "Unknown";
    }
  };

  return (
    <div className="flex items-center gap-2">
      <div className="relative">
        <div
          className={`h-2.5 w-2.5 rounded-full ${getStatusColor()}`}
          aria-label={`Webhook status: ${getStatusText()}`}
        />
        <div
          className={`absolute inset-0 h-2.5 w-2.5 animate-ping rounded-full ${getStatusColor()} opacity-75`}
        />
      </div>
      <span className="text-xs text-slate-400">
        {getStatusText()} ({health.successRate}% success rate, last{" "}
        {health.lastDeliveries} deliveries)
      </span>
    </div>
  );
}
