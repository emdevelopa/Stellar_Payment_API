"use client";

import { useEffect, useId, useRef, useCallback, useMemo, useReducer } from "react";
import { useLocale, useTranslations } from "next-intl";
import { motion, AnimatePresence, type Variants } from "framer-motion";
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
  data: Array<{ date: string; volume: number; count: number }>;
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

// ── State Management (Issue #783: Refactored state logic) ────────────────────

type MetricsState = {
  summary: MetricsResponse | null;
  volumeData: VolumeResponse | null;
  hiddenAssets: Set<string>;
  range: TimeRange;
  loading: boolean;
  isRefreshing: boolean;
  error: string | null;
  nonBlockingError: string | null;
  refreshToken: number;
};

type MetricsAction =
  | { type: "SET_LOADING"; payload: boolean }
  | { type: "SET_REFRESHING"; payload: boolean }
  | { type: "SET_ERROR"; payload: string | null }
  | { type: "SET_NON_BLOCKING_ERROR"; payload: string | null }
  | { type: "SET_SUMMARY"; payload: MetricsResponse }
  | { type: "SET_VOLUME_DATA"; payload: VolumeResponse }
  | { type: "SET_RANGE"; payload: TimeRange }
  | { type: "TOGGLE_ASSET"; payload: string }
  | { type: "SYNC_HIDDEN_ASSETS"; payload: string[] }
  | { type: "REFRESH" }
  | { type: "RESET" };

const initialState: MetricsState = {
  summary: null,
  volumeData: null,
  hiddenAssets: new Set(),
  range: "7D",
  loading: true,
  isRefreshing: false,
  error: null,
  nonBlockingError: null,
  refreshToken: 0,
};

function metricsReducer(state: MetricsState, action: MetricsAction): MetricsState {
  switch (action.type) {
    case "SET_LOADING":
      return { ...state, loading: action.payload };
    case "SET_REFRESHING":
      return { ...state, isRefreshing: action.payload };
    case "SET_ERROR":
      return { ...state, error: action.payload };
    case "SET_NON_BLOCKING_ERROR":
      return { ...state, nonBlockingError: action.payload };
    case "SET_SUMMARY":
      return { ...state, summary: action.payload };
    case "SET_VOLUME_DATA":
      return { ...state, volumeData: action.payload };
    case "SET_RANGE":
      return { ...state, range: action.payload };
    case "TOGGLE_ASSET": {
      const next = new Set(state.hiddenAssets);
      if (next.has(action.payload)) {
        next.delete(action.payload);
      } else {
        next.add(action.payload);
      }
      return { ...state, hiddenAssets: next };
    }
    case "SYNC_HIDDEN_ASSETS": {
      const available = new Set(action.payload);
      const synced = new Set([...state.hiddenAssets].filter((asset) => available.has(asset)));
      return { ...state, hiddenAssets: synced };
    }
    case "REFRESH":
      return { ...state, refreshToken: state.refreshToken + 1 };
    case "RESET":
      return initialState;
    default:
      return state;
  }
}

// ── Animation Variants (Issue #784: Framer Motion animations) ────────────────

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.2,
    },
  },
};

const cardVariants: Variants = {
  hidden: { opacity: 0, y: 20, scale: 0.95 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      type: "spring",
      stiffness: 100,
      damping: 15,
    },
  },
};

const chartVariants: Variants = {
  hidden: { opacity: 0, scale: 0.98 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: {
      type: "spring",
      stiffness: 80,
      damping: 20,
      delay: 0.3,
    },
  },
};

const buttonVariants: Variants = {
  hover: { scale: 1.05, transition: { duration: 0.2 } },
  tap: { scale: 0.95, transition: { duration: 0.1 } },
};

const assetToggleVariants: Variants = {
  hidden: { opacity: 0, scale: 0.8 },
  visible: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.8, transition: { duration: 0.2 } },
};

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
  
  // ── Refactored State Management (Issue #783) ─────────────────────────────
  const [state, dispatch] = useReducer(metricsReducer, initialState);
  
  const apiKey = useMerchantApiKey();
  const hydrated = useMerchantHydrated();
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const hasLoadedDataRef = useRef(false);
  const chartTitleId = useId();
  const chartDescriptionId = useId();
  const chartSummaryId = useId();
  const chartTableId = useId();

  useHydrateMerchantStore();

  // ── Memoized Callbacks ────────────────────────────────────────────────────
  
  const toggleAsset = useCallback((asset: string) => {
    dispatch({ type: "TOGGLE_ASSET", payload: asset });
  }, []);

  const handleRangeChange = useCallback((newRange: TimeRange) => {
    dispatch({ type: "SET_RANGE", payload: newRange });
  }, []);

  const handleRefresh = useCallback(() => {
    dispatch({ type: "REFRESH" });
  }, []);

  useEffect(() => {
    if (!hydrated || !apiKey) {
      dispatch({ type: "SET_LOADING", payload: false });
      return;
    }

    const controller = new AbortController();
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
    let isCancelled = false;
    const hasCachedData = hasLoadedDataRef.current;

    dispatch({ type: "SET_NON_BLOCKING_ERROR", payload: null });
    if (hasCachedData) {
      dispatch({ type: "SET_REFRESHING", payload: true });
    } else {
      dispatch({ type: "SET_LOADING", payload: true });
      dispatch({ type: "SET_ERROR", payload: null });
    }

    async function fetchMetrics() {
      try {
        const [summaryResponse, volumeResponse] = await Promise.all([
          fetch(`${apiUrl}/api/metrics/7day`, {
            headers: { "x-api-key": apiKey },
            signal: controller.signal,
          }),
          fetch(`${apiUrl}/api/metrics/volume?range=${state.range}`, {
            headers: { "x-api-key": apiKey },
            signal: controller.signal,
          }),
        ]);

        if (!summaryResponse.ok) {
          throw new Error(t("fetchMetricsFailed"));
        }

        if (!volumeResponse.ok) {
          throw new Error(t("fetchVolumeFailed"));
        }

        const [summaryData, volumePayload] = await Promise.all([
          summaryResponse.json() as Promise<MetricsResponse>,
          volumeResponse.json() as Promise<VolumeResponse>,
        ]);

        if (isCancelled) {
          return;
        }

        dispatch({ type: "SET_SUMMARY", payload: summaryData });
        dispatch({ type: "SET_VOLUME_DATA", payload: volumePayload });
        hasLoadedDataRef.current = true;
        
        // Keep only hidden assets that still exist in the refreshed payload
        dispatch({ type: "SYNC_HIDDEN_ASSETS", payload: volumePayload.assets ?? [] });
      } catch (fetchError) {
        if (fetchError instanceof Error && fetchError.name === "AbortError") {
          return;
        }
        const nextError =
          fetchError instanceof Error
            ? fetchError.message
            : t("fetchMetricsFailed");
        if (hasCachedData) {
          dispatch({ type: "SET_NON_BLOCKING_ERROR", payload: nextError });
        } else {
          dispatch({ type: "SET_ERROR", payload: nextError });
        }
      } finally {
        if (!isCancelled) {
          dispatch({ type: "SET_LOADING", payload: false });
          dispatch({ type: "SET_REFRESHING", payload: false });
        }
      }
    }

    void fetchMetrics();

    return () => {
      isCancelled = true;
      controller.abort();
    };
  }, [apiKey, hydrated, state.range, state.refreshToken, t]);

  // ── Memoized Computed Values ─────────────────────────────────────────────
  
  const assets = useMemo(() => state.volumeData?.assets ?? [], [state.volumeData]);
  
  const maAverages = useMemo(
    () => computeMovingAverages(state.volumeData?.data ?? [], assets),
    [state.volumeData, assets]
  );
  
  const chartData = useMemo(
    () =>
      (state.volumeData?.data ?? []).map((dataPoint, i) => ({
        ...dataPoint,
        dateShort: new Date(dataPoint.date).toLocaleDateString(locale, {
          month: "short",
          day: "numeric",
        }),
        ...Object.fromEntries(
          assets.map((asset) => [`${asset}_ma`, maAverages[asset]?.[i] ?? 0]),
        ),
      })),
    [state.volumeData, assets, maAverages, locale]
  );
  
  const densityData = useMemo(
    () =>
      state.range === "1Y"
        ? chartData.map((dataPoint) => ({
            date: dataPoint.date,
            count:
              typeof dataPoint.count === "number"
                ? dataPoint.count
                : Number(dataPoint.count) || 0,
          }))
        : [],
    [state.range, chartData]
  );
  
  const visibleAssets = useMemo(
    () => assets.filter((asset) => !state.hiddenAssets.has(asset)),
    [assets, state.hiddenAssets]
  );
  
  const chartSummary = useMemo(
    () =>
      assets.length === 0
        ? `${t("chartTitle")}. ${t("noPayments")}.`
        : `${t("chartTitle")}. ${t("chartSubtitle")}. Range ${state.range}. Showing ${visibleAssets.length} of ${assets.length} assets across ${chartData.length} time periods.`,
    [assets, state.range, visibleAssets, chartData, t]
  );

  if (showSkeleton || state.loading || !hydrated) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="animate-pulse space-y-4"
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="h-24 rounded-xl bg-white/5"
          />
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="h-24 rounded-xl bg-white/5"
          />
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="h-24 rounded-xl bg-white/5"
          />
        </div>
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.4 }}
          className="h-80 w-full rounded-xl bg-white/5"
        />
      </motion.div>
    );
  }

  if (state.error) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-6 text-center"
      >
        <p className="text-sm text-yellow-400">{state.error}</p>
        <motion.button
          type="button"
          onClick={handleRefresh}
          variants={buttonVariants}
          whileHover="hover"
          whileTap="tap"
          className="mt-3 text-xs text-slate-400 underline"
        >
          {t("retry")}
        </motion.button>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={containerVariants}
      className="flex flex-col gap-6"
    >
      {state.summary && (
        <motion.div variants={containerVariants} className="grid gap-4 sm:grid-cols-3">
          <motion.div
            variants={cardVariants}
            whileHover={{ scale: 1.02, transition: { duration: 0.2 } }}
            className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur"
          >
            <p className="font-mono text-[10px] uppercase tracking-wider text-slate-400">
              7-Day Volume
            </p>
            <div className="mt-2 flex items-baseline gap-2">
              <motion.p
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.3 }}
                className="text-2xl font-bold text-mint"
              >
                {state.summary.total_volume.toLocaleString()}
              </motion.p>
              <p className="text-xs text-slate-400 font-mono">XLM</p>
            </div>
          </motion.div>

          <motion.div
            variants={cardVariants}
            whileHover={{ scale: 1.02, transition: { duration: 0.2 } }}
            className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur"
          >
            <p className="font-mono text-[10px] uppercase tracking-wider text-slate-400">
              Confirmed Intents
            </p>
            <div className="mt-2 flex items-baseline gap-2">
              <motion.p
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.4 }}
                className="text-2xl font-bold text-mint"
              >
                {state.summary.confirmed_count}
              </motion.p>
              <p className="text-xs text-slate-400">
                {state.summary.confirmed_count === 1 ? "intent" : "intents"}
              </p>
            </div>
          </motion.div>

          <motion.div
            variants={cardVariants}
            whileHover={{ scale: 1.02, transition: { duration: 0.2 } }}
            className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur"
          >
            <p className="font-mono text-[10px] uppercase tracking-wider text-slate-400">
              Success Rate
            </p>
            <div className="mt-2 flex items-baseline gap-2">
              <motion.p
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.5 }}
                className="text-2xl font-bold text-mint"
              >
                {state.summary.success_rate}%
              </motion.p>
              <div className="flex h-1.5 w-full max-w-[60px] overflow-hidden rounded-full bg-slate-800">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${state.summary.success_rate}%` }}
                  transition={{ delay: 0.6, duration: 0.8, ease: "easeOut" }}
                  className="bg-mint"
                />
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}

      <motion.section
        ref={chartContainerRef}
        variants={chartVariants}
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
            <AnimatePresence>
              {state.isRefreshing && (
                <motion.span
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  className="rounded-full border border-[#E8E8E8] bg-[#F5F5F5] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#6B6B6B]"
                  aria-live="polite"
                >
                  Updating...
                </motion.span>
              )}
            </AnimatePresence>
            <div className="flex gap-0.5 rounded-md border border-[#E8E8E8] bg-[#F5F5F5] p-0.5">
              {TIME_RANGES.map((nextRange) => (
                <motion.button
                  key={nextRange}
                  type="button"
                  onClick={() => handleRangeChange(nextRange)}
                  variants={buttonVariants}
                  whileHover="hover"
                  whileTap="tap"
                  className={`rounded-[4px] px-3 py-1 text-[10px] font-bold tracking-tight transition-all ${
                    state.range === nextRange
                      ? "bg-white text-[#0A0A0A] shadow-sm"
                      : "text-[#6B6B6B] hover:text-[#0A0A0A]"
                  }`}
                  aria-pressed={state.range === nextRange}
                >
                  {nextRange}
                </motion.button>
              ))}
            </div>
          </div>
        </div>
        <AnimatePresence>
          {state.nonBlockingError && (
            <motion.p
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="rounded-md border border-yellow-200 bg-yellow-50 px-3 py-2 text-xs text-yellow-700"
              role="status"
            >
              {state.nonBlockingError}
            </motion.p>
          )}
        </AnimatePresence>

        {/* Asset toggles */}
        {assets.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="flex flex-wrap gap-2"
            aria-label={t("toggleAssetVisibility")}
          >
            <AnimatePresence>
              {assets.map((asset, index) => {
                const color = colorForAsset(asset, index);
                const hidden = state.hiddenAssets.has(asset);

                return (
                  <motion.button
                    key={asset}
                    type="button"
                    onClick={() => toggleAsset(asset)}
                    variants={assetToggleVariants}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
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
                    <motion.span
                      animate={{
                        backgroundColor: hidden ? "transparent" : color,
                      }}
                      transition={{ duration: 0.3 }}
                      className="inline-block h-2 w-2 rounded-full"
                      style={{
                        border: `1px solid ${color}`,
                      }}
                    />
                    {asset}
                  </motion.button>
                );
              })}
            </AnimatePresence>
          </motion.div>
        )}

        {densityData.length > 0 && <DensityGrid data={densityData} />}

        {assets.length === 0 ? (
          <p className="py-12 text-center text-sm text-slate-500">{t("noPayments")}</p>
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

            <motion.div
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.5 }}
              data-export-chart
              aria-hidden="true"
            >
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
                  state.hiddenAssets.has(asset) ? null : (
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
                      animationDuration={800}
                      animationEasing="ease-in-out"
                    />
                  ),
                )}
                {assets.map((asset, index) =>
                  state.hiddenAssets.has(asset) ? null : (
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
                      animationDuration={800}
                      animationEasing="ease-in-out"
                      connectNulls
                    />
                  ),
                )}
              </LineChart>
            </ResponsiveContainer>
            </motion.div>
          </>
        )}
      </motion.section>
    </motion.div>
  );
}