"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
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
import toast from "react-hot-toast";
import {
  useHydrateMerchantStore,
  useMerchantApiKey,
  useMerchantHydrated,
} from "@/lib/merchant-store";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { localeToLanguageTag } from "@/i18n/config";
import MetricsSkeleton from "@/components/MetricsSkeleton";
import DensityGrid from "@/components/DensityGrid";

type TimeRange = "7D" | "30D" | "1Y";
type ExportFormat = "png" | "svg";

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
const EXPORT_SCALE = 2;

const ASSET_COLORS: Record<string, string> = {
  USDC: "#2775CA",
  XLM: "#E8B84B",
};

const FALLBACK_COLORS = ["#0ea5e9", "#10b981", "#8b5cf6", "#f43f5e", "#f97316"];
const TIME_RANGES: TimeRange[] = ["7D", "30D", "1Y"];

function colorForAsset(asset: string, index: number): string {
  return ASSET_COLORS[asset] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

function computeMovingAverages(
  data: VolumeDataPoint[],
  assets: string[],
  window = 7
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

function buildSvgMarkup(svg: SVGSVGElement): {
  markup: string;
  width: number;
  height: number;
} {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const bounds = svg.getBoundingClientRect();
  const width = Math.max(Math.round(bounds.width), 1);
  const height = Math.max(Math.round(bounds.height), 1);

  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));

  if (!clone.getAttribute("viewBox")) {
    clone.setAttribute("viewBox", `0 0 ${width} ${height}`);
  }

  const background = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "rect"
  );
  background.setAttribute("width", "100%");
  background.setAttribute("height", "100%");
  background.setAttribute("fill", "#0f172a");
  clone.insertBefore(background, clone.firstChild);

  return {
    markup: new XMLSerializer().serializeToString(clone),
    width,
    height,
  };
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function exportChart(
  containerRef: RefObject<HTMLDivElement>,
  format: ExportFormat,
  filename: string
) {
  const svg =
    containerRef.current?.querySelector("[data-export-chart] svg") ??
    containerRef.current?.querySelector("svg");
  if (!(svg instanceof SVGSVGElement)) {
    throw new Error(
      "Chart export is unavailable until the chart finishes rendering."
    );
  }

  const { markup, width, height } = buildSvgMarkup(svg);
  const svgBlob = new Blob([markup], {
    type: "image/svg+xml;charset=utf-8",
  });

  if (format === "svg") {
    downloadBlob(svgBlob, `${filename}.svg`);
    return;
  }

  const url = URL.createObjectURL(svgBlob);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const nextImage = new Image();
      nextImage.onload = () => resolve(nextImage);
      nextImage.onerror = () =>
        reject(new Error("Failed to load chart for PNG export."));
      nextImage.src = url;
    });

    const canvas = document.createElement("canvas");
    canvas.width = width * EXPORT_SCALE;
    canvas.height = height * EXPORT_SCALE;

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas export is not available in this browser.");
    }

    context.scale(EXPORT_SCALE, EXPORT_SCALE);
    context.drawImage(image, 0, 0, width, height);

    const pngBlob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/png");
    });

    if (!pngBlob) {
      throw new Error("Failed to generate PNG export.");
    }

    downloadBlob(pngBlob, `${filename}.png`);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function ChartExportButton({
  containerRef,
  exporting,
  onExport,
  t,
}: {
  containerRef: RefObject<HTMLDivElement>;
  exporting: boolean;
  onExport: (
    format: ExportFormat,
    containerRef: RefObject<HTMLDivElement>
  ) => Promise<void>;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={exporting}
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-300 transition-all hover:border-mint/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
          >
            <path d="M12 4v10" strokeLinecap="round" strokeLinejoin="round" />
            <path
              d="m8.5 10.5 3.5 3.5 3.5-3.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path d="M5 18.5h14" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {exporting ? t("exporting") : t("downloadImage")}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => void onExport("png", containerRef)}>
          {t("downloadPng")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void onExport("svg", containerRef)}>
          {t("downloadSvg")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function PaymentMetrics({
  showSkeleton = false,
}: {
  showSkeleton?: boolean;
}) {
  const t = useTranslations("paymentMetrics");
  const locale = localeToLanguageTag(useLocale());
  const [summary, setSummary] = useState<MetricsResponse | null>(null);
  const [volumeData, setVolumeData] = useState<VolumeResponse | null>(null);
  const [hiddenAssets, setHiddenAssets] = useState<Set<string>>(new Set());
  const [range, setRange] = useState<TimeRange>("7D");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const apiKey = useMerchantApiKey();
  const hydrated = useMerchantHydrated();
  const chartContainerRef = useRef<HTMLDivElement>(null);

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
          : Promise.reject(new Error(t("fetchMetricsFailed")))
      )
      .then((data: MetricsResponse) => setSummary(data))
      .catch((fetchError) => {
        if (fetchError instanceof Error && fetchError.name === "AbortError")
          return;
        setError(
          fetchError instanceof Error
            ? fetchError.message
            : t("fetchMetricsFailed")
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
          : Promise.reject(new Error(t("fetchVolumeFailed")))
      )
      .then((data: VolumeResponse) => setVolumeData(data))
      .catch((fetchError) => {
        if (fetchError instanceof Error && fetchError.name === "AbortError")
          return;
        setError(
          fetchError instanceof Error
            ? fetchError.message
            : t("fetchVolumeFailed")
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

  const handleExport = async (
    format: ExportFormat,
    containerRef: RefObject<HTMLDivElement>
  ) => {
    setExporting(true);

    try {
      await exportChart(
        containerRef,
        format,
        `multi-asset-volume-${range.toLowerCase()}`
      );
      toast.success(t("exportSuccess", { format: format.toUpperCase() }));
    } catch (exportError) {
      const message =
        exportError instanceof Error ? exportError.message : t("exportFailed");
      toast.error(message);
    } finally {
      setExporting(false);
    }
  };

  // ── Loading / hydration gate — use the extracted skeleton ─────────────────
  if (showSkeleton || loading || !hydrated) {
    return <MetricsSkeleton />;
  }

  if (error) {
    return (
      <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-6 text-center">
        <p className="text-sm text-yellow-400">{error}</p>
        <button
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
      assets.map((asset) => [`${asset}_ma`, maAverages[asset]?.[i] ?? 0])
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

  return (
    <div className="flex flex-col gap-6">
      {summary && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur">
            <p className="font-mono text-xs uppercase tracking-wider text-slate-400">
              {t("sevenDayVolume")}
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
              {t("totalPayments")}
            </p>
            <div className="mt-2 flex items-baseline gap-2">
              <p className="text-3xl font-bold text-mint">
                {summary.total_payments}
              </p>
              <p className="text-sm text-slate-400">
                {t("paymentsCount", { count: summary.total_payments })}
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur">
            <p className="font-mono text-xs uppercase tracking-wider text-slate-400">
              Confirmed
            </p>
            <div className="mt-2 flex items-baseline gap-2">
              <p className="text-3xl font-bold text-green-400">
                {summary.confirmed_count}
              </p>
              <p className="text-sm text-slate-400">
                {summary.confirmed_count === 1 ? "intent" : "intents"}
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur">
            <p className="font-mono text-xs uppercase tracking-wider text-slate-400">
              Success Rate
            </p>
            <div className="mt-2 flex items-baseline gap-2">
              <p className="text-3xl font-bold text-green-400">
                {summary.success_rate}
              </p>
              <p className="text-sm text-slate-400">%</p>
            </div>
          </div>
        </div>
      )}

      <div
        ref={chartContainerRef}
        className="flex flex-col gap-4 rounded-xl border border-white/10 bg-white/5 p-6 backdrop-blur"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-white">{t("chartTitle")}</h3>
            <p className="text-xs text-slate-400">{t("chartSubtitle")}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1 rounded-lg border border-white/10 bg-white/5 p-1">
              {TIME_RANGES.map((nextRange) => (
                <button
                  key={nextRange}
                  onClick={() => setRange(nextRange)}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                    range === nextRange
                      ? "bg-white/10 text-white"
                      : "text-slate-400 hover:text-white"
                  }`}
                  aria-pressed={range === nextRange}
                  aria-label={t("showRange", {
                    range: t(`ranges.${nextRange}`),
                  })}
                >
                  {nextRange}
                </button>
              ))}
            </div>

            {assets.length > 0 && (
              <ChartExportButton
                containerRef={chartContainerRef}
                exporting={exporting}
                onExport={handleExport}
                t={t}
              />
            )}
          </div>
        </div>

        {assets.length > 0 && (
          <div
            className="flex flex-wrap gap-2"
            role="group"
            aria-label={t("toggleAssetVisibility")}
          >
            {assets.map((asset, index) => {
              const color = colorForAsset(asset, index);
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
          <div data-export-chart>
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
                  formatter={(value: number, name: string) => [
                    `${value.toLocaleString()} ${name}`,
                    name,
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
                  )
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
                  )
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
