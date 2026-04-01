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
        <div className="h-2 w-2 animate-pulse rounded-full bg-[#1F1F1F]" />
        <span className="text-[10px] font-black uppercase tracking-widest text-[#A0A0A0]">Checking...</span>
      </div>
    );
  }

  const getStatusColor = () => {
    switch (health.status) {
      case "healthy":
        return "bg-[#00F5D4]";
      case "degraded":
        return "bg-yellow-500";
      case "unhealthy":
        return "bg-red-500";
      default:
        return "bg-[#1F1F1F]";
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
    <div className="flex items-center gap-2.5">
      <div className="relative flex h-2 w-2">
        <div
          className={`h-full w-full rounded-full ${getStatusColor()}`}
          aria-label={`Webhook status: ${getStatusText()}`}
        />
        <div
          className={`absolute inset-0 h-full w-full animate-ping rounded-full ${getStatusColor()} opacity-50`}
        />
      </div>
      <span className="text-[10px] font-black uppercase tracking-widest text-[#A0A0A0]">
        {getStatusText()} <span className="text-white mx-1">/</span> {health.successRate}% <span className="text-white mx-1">/</span> last{" "}
        {health.lastDeliveries}
      </span>
    </div>
  );
}
