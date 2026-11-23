interface WebhookHealthDetailsProps {
  id?: string;
  health: {
    successRate: number;
    status: "healthy" | "degraded" | "unhealthy";
    lastDeliveries: number;
    consecutiveFailures?: number;
    sslValid?: boolean;
    sslExpiresAt?: string;
  };
}

export default function WebhookHealthDetails({
  id,
  health,
}: WebhookHealthDetailsProps) {
  const hasFailures = (health.consecutiveFailures ?? 0) > 0;
  const sslKnown = typeof health.sslValid === "boolean";

  return (
    <div
      id={id}
      data-testid="webhook-health-details"
      className="mt-1 grid w-full grid-cols-1 gap-2 rounded-xl border border-white/10 bg-slate-900/80 p-3 text-xs text-slate-300 sm:grid-cols-2"
    >
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
          Endpoint uptime
        </span>
        <span className="font-semibold text-white" aria-label={`Uptime ${health.successRate}%`}>
          {health.successRate}% over {health.lastDeliveries} deliveries
        </span>
      </div>

      <div className="flex flex-col gap-1" role={hasFailures ? "alert" : undefined}>
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
          Consecutive failures
        </span>
        <span
          className={`font-semibold ${hasFailures ? "text-red-400" : "text-mint"}`}
          aria-label={`Consecutive failures ${health.consecutiveFailures ?? 0}`}
        >
          {health.consecutiveFailures ?? 0}
        </span>
      </div>

      <div className="flex flex-col gap-1 sm:col-span-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
          SSL validity
        </span>
        <span
          className={`font-semibold ${
            sslKnown && !health.sslValid ? "text-red-400" : "text-white"
          }`}
          aria-label={
            sslKnown
              ? health.sslValid
                ? "SSL certificate valid"
                : "SSL certificate invalid"
              : "SSL certificate status unavailable"
          }
        >
          {sslKnown
            ? health.sslValid
              ? health.sslExpiresAt
                ? `Valid until ${new Date(health.sslExpiresAt).toLocaleDateString()}`
                : "Valid"
              : "Invalid"
            : "Not reported"}
        </span>
      </div>
    </div>
  );
}
