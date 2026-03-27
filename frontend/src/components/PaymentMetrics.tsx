"use client";

import { useEffect, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  useHydrateMerchantStore,
  useMerchantApiKey,
  useMerchantHydrated,
} from "@/lib/merchant-store";

// ── Types ────────────────────────────────────────────────────────────────────

type TimeRange = "7D" | "30D" | "1Y";

interface VolumeDataPoint {
  date: string;
  [asset: string]: number | string;
}

interface VolumeResponse {
  range: TimeRange;
  assets: string[];
  data: VolumeDataPoint[];
}

interface MetricData {
  date: string;
  volume: number;
  count: number;
}

interface MetricsResponse {
  data: MetricData[];
  total_volume: number;
  total_payments: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const CHART_HEIGHT = 300;

/** Asset-specific brand colors — Blue for USDC, Gold for XLM */
const ASSET_COLORS: Record<string, string> = {
  USDC: "#2775CA",
  XLM:  "#E8B84B",
};
const FALLBACK_COLORS = ["#0ea5e9", "#10b981", "#8b5cf6", "#f43f5e", "#f97316"];

function colorForAsset(asset: string, index: number): string {
  return ASSET_COLORS[asset] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

const TIME_RANGES: TimeRange[] = ["7D", "30D", "1Y"];

const RANGE_LABELS: Record<TimeRange, string> = {
  "7D":  "7 Days",
  "30D": "30 Days",
  "1Y":  "1 Year",
};

// ── Component ────────────────────────────────────────────────────────────────

export default function PaymentMetrics() {
  const [summary, setSummary] = useState<MetricsResponse | null>(null);
  const [volumeData, setVolumeData] = useState<VolumeResponse | null>(null);
  const [hiddenAssets, setHiddenAssets] = useState<Set<string>>(new Set());
  const [range, setRange] = useState<TimeRange>("7D");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const apiKey = useMerchantApiKey();
  const hydrated = useMerchantHydrated();

  useHydrateMerchantStore();

  // Fetch 7-day summary (total volume + payment count cards)
  useEffect(() => {
    if (!hydrated || !apiKey) return;
    const controller = new AbortController();
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

    fetch(`${apiUrl}/api/metrics/7day`, {
      headers: { "x-api-key": apiKey },
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Failed to fetch metrics"))))
      .then((data: MetricsResponse) => setSummary(data))
      .catch((err) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setError(err.message);
      });

    return () => controller.abort();
  }, [apiKey, hydrated]);

  // Fetch per-asset volume whenever range changes
  useEffect(() => {
    if (!hydrated || !apiKey) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);

    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

    fetch(`${apiUrl}/api/metrics/volume?range=${range}`, {
      headers: { "x-api-key": apiKey },
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Failed to fetch volume data"))))
      .then((data: VolumeResponse) => setVolumeData(data))
      .catch((err) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setError(err.message);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [apiKey, hydrated, range]);

  const toggleAsset = (asset: string) => {
    setHiddenAssets((prev) => {
      const next = new Set(prev);
      if (next.has(asset)) next.delete(asset);
      else next.add(asset);
      return next;
    });
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading || !hydrated) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-10 w-48 rounded-lg bg-white/5" />
        <div className="h-80 w-full rounded-xl bg-white/5" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-6 text-center">
        <p className="text-sm text-yellow-400">{error}</p>
        <button
          onClick={() => setError(null)}
          className="mt-3 text-xs text-slate-400 underline"
        >
          Retry
        </button>
      </div>
    );
  }

  const assets = volumeData?.assets ?? [];
  const chartData = (volumeData?.data ?? []).map((d) => ({
    ...d,
    dateShort: new Date(d.date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
  }));

  return (
    <div className="flex flex-col gap-6">
      {/* Summary cards */}
      {summary && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur">
            <p className="font-mono text-xs uppercase tracking-wider text-slate-400">
              7-Day Volume
            </p>
            <div className="mt-2 flex items-baseline gap-2">
              <p className="text-3xl font-bold text-mint">
                {summary.total_volume.toLocaleString()}
              </p>
              <p className="text-sm text-slate-400">XLM</p>
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur">
            <p className="font-mono text-xs uppercase tracking-wider text-slate-400">
              Total Payments
            </p>
            <div className="mt-2 flex items-baseline gap-2">
              <p className="text-3xl font-bold text-mint">
                {summary.total_payments}
              </p>
              <p className="text-sm text-slate-400">
                {summary.total_payments === 1 ? "payment" : "payments"}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Multi-asset volume comparison chart */}
      <div className="flex flex-col gap-4 rounded-xl border border-white/10 bg-white/5 p-6 backdrop-blur">
        {/* Header row */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-white">
              Multi-Asset Volume Comparison
            </h3>
            <p className="text-xs text-slate-400">
              Daily transaction volume broken down by asset
            </p>
          </div>

          {/* Time-range selector */}
          <div className="flex gap-1 rounded-lg border border-white/10 bg-white/5 p-1">
            {TIME_RANGES.map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                  range === r
                    ? "bg-white/10 text-white"
                    : "text-slate-400 hover:text-white"
                }`}
                aria-pressed={range === r}
                aria-label={`Show ${RANGE_LABELS[r]}`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        {/* Asset toggle legend */}
        {assets.length > 0 && (
          <div
            className="flex flex-wrap gap-2"
            role="group"
            aria-label="Toggle asset visibility"
          >
            {assets.map((asset, i) => {
              const color = colorForAsset(asset, i);
              const hidden = hiddenAssets.has(asset);
              return (
                <button
                  key={asset}
                  onClick={() => toggleAsset(asset)}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-opacity ${
                    hidden ? "opacity-40" : "opacity-100"
                  }`}
                  style={{ borderColor: color, color }}
                  aria-pressed={!hidden}
                  aria-label={`${hidden ? "Show" : "Hide"} ${asset}`}
                >
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: hidden ? "transparent" : color, border: `1px solid ${color}` }}
                  />
                  {asset}
                </button>
              );
            })}
          </div>
        )}

        {assets.length === 0 ? (
          <p className="py-12 text-center text-sm text-slate-500">
            No completed payments in this period.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
            <LineChart
              data={chartData}
              margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="#1e293b"
                horizontal
                vertical={false}
              />
              <XAxis
                dataKey="dateShort"
                stroke="#64748b"
                style={{ fontSize: "12px" }}
              />
              <YAxis
                stroke="#64748b"
                style={{ fontSize: "12px" }}
                tickFormatter={(v) => v.toLocaleString()}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#0f172a",
                  border: "1px solid #334155",
                  borderRadius: "8px",
                  padding: "8px 12px",
                }}
                labelStyle={{ color: "#e2e8f0", fontSize: "12px" }}
                formatter={(value: number, name: string) => [
                  `${value.toLocaleString()} ${name}`,
                  name,
                ]}
              />
              <Legend wrapperStyle={{ display: "none" }} />
              {assets.map((asset, i) =>
                hiddenAssets.has(asset) ? null : (
                  <Line
                    key={asset}
                    type="monotone"
                    dataKey={asset}
                    name={asset}
                    stroke={colorForAsset(asset, i)}
                    strokeWidth={2}
                    dot={{ fill: colorForAsset(asset, i), r: 3 }}
                    activeDot={{ r: 5 }}
                    isAnimationActive
                    animationDuration={400}
                  />
                ),
              )}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
