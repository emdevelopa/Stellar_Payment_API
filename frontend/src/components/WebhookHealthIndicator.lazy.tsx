"use client";

import dynamic from "next/dynamic";

export function WebhookHealthIndicatorSkeleton() {
  return (
    <div
      data-testid="webhook-health-indicator-skeleton"
      className="flex items-center gap-2.5"
      role="status"
      aria-label="Loading webhook health"
    >
      <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-[#1F1F1F]" />
      <span className="text-[10px] font-black uppercase tracking-widest text-[#A0A0A0]">
        Checking...
      </span>
    </div>
  );
}

const WebhookHealthIndicator = dynamic(
  () => import("./WebhookHealthIndicator"),
  {
    ssr: false,
    loading: () => <WebhookHealthIndicatorSkeleton />,
  },
);

export default WebhookHealthIndicator;
