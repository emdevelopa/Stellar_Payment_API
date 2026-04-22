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
  background.setAttribute("fill", "#FFFFFF");
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
          className="inline-flex items-center gap-2 rounded-[6px] border border-[#E8E8E8] bg-white px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-[#0A0A0A] transition-all hover:bg-[#F5F5F5] disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={exporting ? t("exporting") : t("downloadImage")}
        >
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            aria-hidden="true"
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
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-[#E8E8E8] bg-white p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]">
              {t("sevenDayVolume")}
            </p>
            <div className="mt-2 flex items-baseline gap-1">
              <p className="text-3xl font-bold tracking-tight text-[#0A0A0A]">
                {summary.total_volume.toLocaleString()}
              </p>
              <p className="text-[10px] font-bold text-[#6B6B6B] uppercase">XLM</p>
            </div>
          </div>

          <div className="rounded-lg border border-[#E8E8E8] bg-white p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]">
              {t("totalPayments")}
            </p>
            <div className="mt-2 flex items-baseline gap-1">
              <p className="text-3xl font-bold tracking-tight text-[#0A0A0A]">
                {summary.total_payments}
              </p>
              <p className="text-[10px] font-bold text-[#6B6B6B] uppercase">Intents</p>
            </div>
          </div>

          <div className="rounded-lg border border-[#E8E8E8] bg-white p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]">
              Success Rate
            </p>
            <div className="mt-2 flex items-baseline gap-1">
              <p className="text-3xl font-bold tracking-tight text-[#0A0A0A]">
                {summary.success_rate}%
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-[#E8E8E8] bg-white p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]">
              Confirmed
            </p>
            <div className="mt-2 flex items-baseline gap-1">
              <p className="text-3xl font-bold tracking-tight text-[#0A0A0A]">
                {summary.confirmed_count}
              </p>
            </div>
          </div>
        </div>
      )}

      <div
        ref={chartContainerRef}
        className="flex flex-col gap-8 rounded-lg border border-[#E8E8E8] bg-white p-8"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-[#0A0A0A] uppercase tracking-wider">{t("chartTitle")}</h3>
            <p className="text-[10px] font-medium text-[#6B6B6B] uppercase tracking-widest mt-1">{t("chartSubtitle")}</p>
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
          <div data-export-chart>
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
                    backgroundColor: "#FFFFFF",
                    border: "1px solid #E8E8E8",
                    borderRadius: "4px",
                    padding: "12px",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.05)"
                  }}
                  labelStyle={{ color: "#0A0A0A", fontSize: "10px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "4px" }}
                  formatter={(value: number, name: string) => [
                    <span key={name} className="flex items-center gap-2">
                       <span className="text-[11px] font-bold text-[#0A0A0A]">{value.toLocaleString()}</span>
                       <span className="text-[9px] font-medium text-[#6B6B6B] uppercase">{name}</span>
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
