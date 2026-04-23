"use client";

import { useEffect, useState } from "react";
import { useLocale } from "next-intl";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { localeToLanguageTag } from "@/i18n/config";
import { useMerchantApiKey } from "@/lib/merchant-store";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

interface DailyUsage {
  date: string;
  requests: number;
}

export default function ApiUsageChart() {
  const apiKey = useMerchantApiKey();
  const locale = localeToLanguageTag(useLocale());
  const [data, setData] = useState<DailyUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCompact, setIsCompact] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 640px)");
    const syncCompactState = (event?: MediaQueryList | MediaQueryListEvent) => {
      setIsCompact(event?.matches ?? mediaQuery.matches);
    };

    syncCompactState(mediaQuery);

    const listener = (event: MediaQueryListEvent) => syncCompactState(event);
    mediaQuery.addEventListener("change", listener);
    return () => mediaQuery.removeEventListener("change", listener);
  }, []);

  useEffect(() => {
    if (!apiKey) {
      setLoading(false);
      return;
    }

    const fetchUsageData = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await fetch(`${API_URL}/api/metrics/api-usage`, {
          headers: {
            "x-api-key": apiKey,
          },
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch usage data: ${response.status}`);
        }

        const result = await response.json();
        setData(result.daily || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        setLoading(false);
      }
    };

    fetchUsageData();
  }, [apiKey]);

  if (!apiKey) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-6">
        <p className="text-sm text-slate-400">
          Register or log in to view API usage statistics.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-6">
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-mint border-t-transparent" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6">
        <p className="text-sm text-red-300">{error}</p>
      </div>
    );
  }

  const totalRequests = data.reduce((sum, day) => sum + day.requests, 0);
  const formatTickLabel = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      month: "short",
      day: isCompact ? undefined : "numeric",
    }).format(new Date(value));
  const formatTooltipLabel = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(value));

  return (
    <div className="min-w-0 rounded-xl border border-white/10 bg-white/5 p-4 sm:p-6">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-white">
            API Usage - Last 7 Days
          </h3>
          <p className="text-sm text-slate-400">
            Total requests: {totalRequests.toLocaleString()}
          </p>
        </div>
      </div>

      {data.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <p className="text-sm text-slate-400">No API usage data available</p>
        </div>
      ) : (
        <div className="-mx-2 sm:mx-0">
          <ResponsiveContainer width="100%" height={isCompact ? 240 : 300}>
            <BarChart
              data={data}
              margin={{
                top: 8,
                right: isCompact ? 8 : 16,
                left: isCompact ? -20 : -8,
                bottom: isCompact ? 0 : 8,
              }}
            >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="rgba(255,255,255,0.1)"
            />
            <XAxis
              dataKey="date"
              stroke="#94a3b8"
              axisLine={false}
              tickLine={false}
              tickMargin={10}
              interval="preserveStartEnd"
              minTickGap={isCompact ? 28 : 16}
              tickFormatter={formatTickLabel}
              style={{ fontSize: isCompact ? "10px" : "12px" }}
            />
            <YAxis
              stroke="#94a3b8"
              axisLine={false}
              tickLine={false}
              width={isCompact ? 32 : 44}
              allowDecimals={false}
              tickFormatter={(value: number) => value.toLocaleString(locale, { notation: "compact" })}
              style={{ fontSize: isCompact ? "10px" : "12px" }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "rgba(0, 0, 0, 0.9)",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                borderRadius: "8px",
                color: "#fff",
              }}
              formatter={(value: number) => [value.toLocaleString(locale), "Requests"]}
              labelFormatter={formatTooltipLabel}
              labelStyle={{ color: "#94a3b8" }}
            />
              <Bar dataKey="requests" fill="#5ef2c0" radius={[4, 4, 0, 0]} maxBarSize={isCompact ? 22 : 32} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
