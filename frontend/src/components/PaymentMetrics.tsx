"use client";

import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
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

const CHART_HEIGHT = 300;

export default function PaymentMetrics() {
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const apiKey = useMerchantApiKey();
  const hydrated = useMerchantHydrated();

  useHydrateMerchantStore();

  useEffect(() => {
    if (!hydrated) return;

    const controller = new AbortController();

    const fetchMetrics = async () => {
      try {
        if (!apiKey) {
          setLoading(false);
          return;
        }

        const apiUrl =
          process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
        const response = await fetch(`${apiUrl}/api/metrics/7day`, {
          headers: {
            "x-api-key": apiKey,
          },
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error("Failed to fetch metrics");
        }

        const data: MetricsResponse = await response.json();
        setMetrics(data);
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Failed to load metrics");
      } finally {
        setLoading(false);
      }
    };

    fetchMetrics();

    return () => controller.abort();
  }, [apiKey, hydrated]);

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
      </div>
    );
  }

  if (!metrics) {
    return null;
  }

  const formattedData = metrics.data.map((d) => ({
    ...d,
    dateShort: new Date(d.date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
  }));

  return (
    <div className="flex flex-col gap-6">
      {/* Metrics Summary */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur">
          <p className="font-mono text-xs uppercase tracking-wider text-slate-400">
            7-Day Volume
          </p>
          <div className="mt-2 flex items-baseline gap-2">
            <p className="text-3xl font-bold text-mint">
              {metrics.total_volume.toLocaleString()}
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
              {metrics.total_payments}
            </p>
            <p className="text-sm text-slate-400">
              {metrics.total_payments === 1 ? "payment" : "payments"}
            </p>
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="flex flex-col gap-3 rounded-xl border border-white/10 bg-white/5 p-6 backdrop-blur">
        <div className="flex flex-col gap-1">
          <h3 className="font-semibold text-white">Payment Volume (7 Days)</h3>
          <p className="text-xs text-slate-400">Daily transaction amount</p>
        </div>

        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <BarChart
            data={formattedData}
            margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
          >
            <defs>
              <linearGradient id="colorVolume" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.8} />
                <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0.1} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#1e293b"
              horizontal={true}
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
              tickFormatter={(value) => value.toLocaleString()}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#0f172a",
                border: "1px solid #334155",
                borderRadius: "8px",
                padding: "8px 12px",
              }}
              labelStyle={{ color: "#e2e8f0", fontSize: "12px" }}
              formatter={(value: number) => [
                `${value.toLocaleString()} XLM`,
                "Volume",
              ]}
              cursor={{ fill: "rgba(14, 165, 233, 0.1)" }}
            />
            <Bar
              dataKey="volume"
              fill="url(#colorVolume)"
              isAnimationActive={true}
              animationDuration={500}
              radius={[8, 8, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Payment Count Chart */}
      <div className="flex flex-col gap-3 rounded-xl border border-white/10 bg-white/5 p-6 backdrop-blur">
        <div className="flex flex-col gap-1">
          <h3 className="font-semibold text-white">Payment Count (7 Days)</h3>
          <p className="text-xs text-slate-400">
            Number of transactions per day
          </p>
        </div>

        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <LineChart
            data={formattedData}
            margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
          >
            <defs>
              <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.8} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0.1} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#1e293b"
              horizontal={true}
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
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#0f172a",
                border: "1px solid #334155",
                borderRadius: "8px",
                padding: "8px 12px",
              }}
              labelStyle={{ color: "#e2e8f0", fontSize: "12px" }}
              formatter={(value: number) => [
                value.toLocaleString(),
                "Payments",
              ]}
              cursor={{ stroke: "#10b981", strokeWidth: 2 }}
            />
            <Line
              type="monotone"
              dataKey="count"
              stroke="#10b981"
              strokeWidth={2}
              dot={{ fill: "#10b981", r: 4 }}
              activeDot={{ r: 6 }}
              isAnimationActive={true}
              animationDuration={500}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
