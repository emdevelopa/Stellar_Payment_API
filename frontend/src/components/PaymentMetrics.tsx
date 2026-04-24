"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import * as Recharts from "recharts";
const {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} = Recharts;
import {
  useHydrateMerchantStore,
  useMerchantApiKey,
  useMerchantHydrated,
} from "@/lib/merchant-store";
import { localeToLanguageTag } from "@/i18n/config";
import DensityGrid from "@/components/DensityGrid";

type TimeRange = "7D" | "30D" | "1Y";

interface VolumeDataPoint {
  date: string;
  count: number;
  [asset: string]: number | string;
}

interface VolumeResponse {
  range: TimeRange;
  assets: string[];
  data: VolumeDataPoint[];
}

interface MetricsResponse {
  data: Array<{
    date: string;
    volume: number;
    count: number;
  }>;
  total_volume: number;
  total_payments: number;
  confirmed_count: number;
  success_rate: number;
}

const CHART_HEIGHT = 300;

const ASSET_COLORS: Record<string, string> = {
  USDC: "#0A0A0A",
  XLM: "#6B6B6B",
};

const FALLBACK_COLORS = ["#0A0A0A", "#444444", "#6B6B6B", "#888888", "#AAAAAA"];
const TIME_RANGES: TimeRange[] = ["7D", "30D", "1Y"];

function colorForAsset(asset: string, index: number): string {
  return ASSET_COLORS[asset] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

function computeMovingAverages(
  data: VolumeDataPoint[],
  assets: string[],
  window = 7,
): Record<string, number[]> {
  const result: Record<string, number[]> = {};
  for (const asset of assets) {
    result[asset] = data.map((_, i) => {
      const start = Math.max(0, i - window + 1);
      const slice = data.slice(start, i + 1);
      const sum = slice.reduce((acc, pt) => {
        const v = pt[asset];
        return acc + (typeof v === "number" ? v : 0);
      }, 0);
      return slice.length > 0 ? sum / slice.length : 0;
    });
  }
  return result;
}

export default function PaymentMetrics({
  showSkeleton = false,
}: Readonly<{
  showSkeleton?: boolean;
}>) {
  const t = useTranslations("paymentMetrics");
  const locale = localeToLanguageTag(useLocale());
  const [summary, setSummary] = useState<MetricsResponse | null>(null);
  const [volumeData, setVolumeData] = useState<VolumeResponse | null>(null);
  const [hiddenAssets, setHiddenAssets] = useState<Set<string>>(new Set());
  const [range, setRange] = useState<TimeRange>("7D");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const apiKey = useMerchantApiKey();
  const hydrated = useMerchantHydrated();
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartTitleId = useId();
  const chartDescriptionId = useId();
  const chartSummaryId = useId();
  const chartTableId = useId();

  useHydrateMerchantStore();

  useEffect(() => {
    if (!hydrated || !apiKey) return;

    const controller = new AbortController();
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

    fetch(`${apiUrl}/api/metrics/7day`, {
      headers: { "x-api-key": apiKey },
      signal: controller.signal,
    })
      .then((response) =>
        response.ok
          ? response.json()
          : Promise.reject(new Error(t("fetchMetricsFailed"))),
      )
      .then((data: MetricsResponse) => setSummary(data))
      .catch((fetchError) => {
        if (fetchError instanceof Error && fetchError.name === "AbortError")
          return;
        setError(
          fetchError instanceof Error
            ? fetchError.message
            : t("fetchMetricsFailed"),
        );
      });

    return () => controller.abort();
  }, [apiKey, hydrated, t]);

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
      .then((response) =>
        response.ok
          ? response.json()
          : Promise.reject(new Error(t("fetchVolumeFailed"))),
      )
      .then((data: VolumeResponse) => setVolumeData(data))
      .catch((fetchError) => {
        if (fetchError instanceof Error && fetchError.name === "AbortError")
          return;
        setError((prev) =>
          prev ??
          (fetchError instanceof Error ? fetchError.message : t("fetchVolumeFailed")),
        );
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [apiKey, hydrated, range, t]);

  const toggleAsset = (asset: string) => {
    setHiddenAssets((prev) => {
      const next = new Set(prev);
      if (next.has(asset)) next.delete(asset);
      else next.add(asset);
      return next;
    });
  };

  if (showSkeleton || loading || !hydrated) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="h-24 rounded-xl bg-white/5" />
          <div className="h-24 rounded-xl bg-white/5" />
          <div className="h-24 rounded-xl bg-white/5" />
        </div>
        <div className="h-80 w-full rounded-xl bg-white/5" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-6 text-center">
        <p className="text-sm text-yellow-400">{error}</p>
        <button
          type="button"
          onClick={() => setError(null)}
          className="mt-3 text-xs text-slate-400 underline"
        >
          {t("retry")}
        </button>
      </div>
    );
  }

  const assets = volumeData?.assets ?? [];
  const maAverages = computeMovingAverages(volumeData?.data ?? [], assets);
  const chartData = (volumeData?.data ?? []).map((dataPoint, i) => ({
    ...dataPoint,
    dateShort: new Date(dataPoint.date).toLocaleDateString(locale, {
      month: "short",
      day: "numeric",
    }),
    ...Object.fromEntries(
      assets.map((asset) => [`${asset}_ma`, maAverages[asset]?.[i] ?? 0]),
    ),
  }));
  const densityData =
    range === "1Y"
      ? chartData.map((dataPoint) => ({
          date: dataPoint.date,
          count:
            typeof dataPoint.count === "number"
              ? dataPoint.count
              : Number(dataPoint.count) || 0,
        }))
      : [];
  const visibleAssets = assets.filter((asset) => !hiddenAssets.has(asset));
  const chartSummary =
    assets.length === 0
      ? `${t("chartTitle")}. ${t("noPayments")}.`
      : `${t("chartTitle")}. ${t("chartSubtitle")}. Range ${range}. Showing ${visibleAssets.length} of ${assets.length} assets across ${chartData.length} time periods.`;

  return (
    <div className="flex flex-col gap-6">
      {summary && (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur">
            <p className="font-mono text-[10px] uppercase tracking-wider text-slate-400">
              7-Day Volume
            </p>
            <div className="mt-2 flex items-baseline gap-2">
              <p className="text-2xl font-bold text-mint">
                {summary.total_volume.toLocaleString()}
              </p>
              <p className="text-xs text-slate-400 font-mono">XLM</p>
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur">
            <p className="font-mono text-[10px] uppercase tracking-wider text-slate-400">
              Confirmed Intents
            </p>
            <div className="mt-2 flex items-baseline gap-2">
              <p className="text-2xl font-bold text-mint">
                {summary.confirmed_count}
              </p>
              <p className="text-xs text-slate-400">
                {summary.confirmed_count === 1 ? "intent" : "intents"}
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur">
            <p className="font-mono text-[10px] uppercase tracking-wider text-slate-400">
              Success Rate
            </p>
            <div className="mt-2 flex items-baseline gap-2">
              <p className="text-2xl font-bold text-mint">
                {summary.success_rate}%
              </p>
              <div className="flex h-1.5 w-full max-w-[60px] overflow-hidden rounded-full bg-slate-800">
                <div
                  className="bg-mint"
                  style={{ width: `${summary.success_rate}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      <section
        ref={chartContainerRef}
        aria-labelledby={chartTitleId}
        aria-describedby={`${chartDescriptionId} ${chartSummaryId} ${chartTableId}`}
        className="flex flex-col gap-8 rounded-lg border border-[#E8E8E8] bg-white p-8"
      >
        <div id={chartSummaryId} className="sr-only" aria-live="polite">
          {chartSummary}
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3
              id={chartTitleId}
              className="text-sm font-bold text-[#0A0A0A] uppercase tracking-wider"
            >
              {t("chartTitle")}
            </h3>
            <p
              id={chartDescriptionId}
              className="text-[10px] font-medium text-[#6B6B6B] uppercase tracking-widest mt-1"
            >
              {t("chartSubtitle")}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-0.5 rounded-md border border-[#E8E8E8] bg-[#F5F5F5] p-0.5">
              {TIME_RANGES.map((nextRange) => (
                <button
                  key={nextRange}
                  type="button"
                  onClick={() => setRange(nextRange)}
                  className={`rounded-[4px] px-3 py-1 text-[10px] font-bold tracking-tight transition-all ${
                    range === nextRange
                      ? "bg-white text-[#0A0A0A] shadow-sm"
                      : "text-[#6B6B6B] hover:text-[#0A0A0A]"
                  }`}
                  aria-pressed={range === nextRange}
                >
                  {nextRange}
                </button>
              ))}
            </div>
          </div>
        </div>

        {assets.length > 0 && (
          <div
            className="flex flex-wrap gap-2"
            aria-label={t("toggleAssetVisibility")}
          >
            {assets.map((asset, index) => {
              const color = colorForAsset(asset, index);
              const hidden = hiddenAssets.has(asset);

              return (
                <button
                  key={asset}
                  type="button"
                  onClick={() => toggleAsset(asset)}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-opacity focus-visible:opacity-100 ${
                    hidden ? "opacity-40" : "opacity-100"
                  }`}
                  style={{ borderColor: color, color }}
                  aria-pressed={!hidden}
                  aria-label={
                    hidden
                      ? t("showAsset", { asset })
                      : t("hideAsset", { asset })
                  }
                >
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{
                      backgroundColor: hidden ? "transparent" : color,
                      border: `1px solid ${color}`,
                    }}
                  />
                  {asset}
                </button>
              );
            })}
          </div>
        )}

        {densityData.length > 0 && <DensityGrid data={densityData} />}

        {assets.length === 0 ? (
          <p className="py-12 text-center text-sm text-slate-500">
            {t("noPayments")}
          </p>
        ) : (
          <>
            <table id={chartTableId} className="sr-only">
              <caption>{`${t("chartTitle")} data table`}</caption>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  {visibleAssets.map((asset) => (
                    <th key={asset} scope="col">{asset}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {chartData.map((dataPoint) => (
                  <tr key={dataPoint.date}>
                    <th scope="row">{dataPoint.dateShort}</th>
                    {visibleAssets.map((asset) => (
                      <td key={`${dataPoint.date}-${asset}`}>
                        {typeof dataPoint[asset] === "number"
                          ? dataPoint[asset].toLocaleString()
                          : Number(dataPoint[asset] || 0).toLocaleString()}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>

            <div data-export-chart aria-hidden="true">
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <LineChart
                data={chartData}
                margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="4 4"
                  stroke="#F0F0F0"
                  horizontal
                  vertical={false}
                />
                <XAxis
                  dataKey="dateShort"
                  stroke="#6B6B6B"
                  style={{ fontSize: "10px", fontWeight: "600" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  stroke="#6B6B6B"
                  style={{ fontSize: "10px", fontWeight: "600" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(value) => value.toLocaleString()}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "rgba(255, 255, 255, 0.95)",
                    border: "1px solid var(--pluto-100)",
                    borderRadius: "16px",
                    padding: "16px",
                    boxShadow: "0 20px 50px rgba(0, 0, 0, 0.12)",
                    backdropFilter: "blur(8px)",
                  }}
                  labelStyle={{
                    color: "var(--pluto-600)",
                    fontSize: "10px",
                    fontWeight: "700",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    marginBottom: "8px",
                  }}
                  formatter={(value: number, name: string) => [
                    <span key={name} className="flex items-center gap-2">
                      <span className="text-[12px] font-bold text-[var(--text-primary)]">
                        {value.toLocaleString()}
                      </span>
                      <span className="text-[10px] font-medium text-[var(--text-secondary)] uppercase tracking-widest">
                        {name}
                      </span>
                    </span>,
                    null,
                  ]}
                />
                <Legend wrapperStyle={{ display: "none" }} />
                {assets.map((asset, index) =>
                  hiddenAssets.has(asset) ? null : (
                    <Line
                      key={asset}
                      type="monotone"
                      dataKey={asset}
                      name={asset}
                      stroke={colorForAsset(asset, index)}
                      strokeWidth={2}
                      dot={{ fill: colorForAsset(asset, index), r: 3 }}
                      activeDot={{ r: 5 }}
                      isAnimationActive
                      animationDuration={400}
                    />
                  ),
                )}
                {assets.map((asset, index) =>
                  hiddenAssets.has(asset) ? null : (
                    <Line
                      key={`${asset}_ma`}
                      type="monotone"
                      dataKey={`${asset}_ma`}
                      name={`${asset} ${t("weeklyAvgLabel")}`}
                      stroke={colorForAsset(asset, index)}
                      strokeWidth={1.5}
                      strokeDasharray="4 4"
                      dot={false}
                      activeDot={false}
                      isAnimationActive
                      animationDuration={400}
                      connectNulls
                    />
                  ),
                )}
              </LineChart>
            </ResponsiveContainer>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
