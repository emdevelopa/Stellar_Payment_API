"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { localeToLanguageTag } from "@/i18n/config";

interface DensityPoint {
  date: string;
  count: number;
}

function intensityForCount(count: number, maxCount: number) {
  if (count <= 0 || maxCount <= 0) return 0;
  const ratio = count / maxCount;
  if (ratio >= 0.75) return 4;
  if (ratio >= 0.5) return 3;
  if (ratio >= 0.25) return 2;
  return 1;
}

const CELL_COLORS = [
  "#0f172a",
  "#123b35",
  "#17685c",
  "#22a18a",
  "#5ef2c0",
];

export default function DensityGrid({ data }: { data: DensityPoint[] }) {
  const t = useTranslations("paymentMetrics");
  const locale = localeToLanguageTag(useLocale());

  const { weeks, monthLabels, totalCount, maxCount } = useMemo(() => {
    const values = data.slice(-364);
    const normalized = values.length === 364 ? values : data;
    const padded = [...normalized];

    while (padded.length < 364) {
      padded.unshift({ date: "", count: 0 });
    }

    const weekColumns: DensityPoint[][] = [];
    for (let index = 0; index < padded.length; index += 7) {
      weekColumns.push(padded.slice(index, index + 7));
    }

    const labels: Array<{ label: string; column: number }> = [];
    let lastMonth = "";
    weekColumns.forEach((week, column) => {
      const firstDatedCell = week.find((entry) => entry.date);
      if (!firstDatedCell) return;
      const monthLabel = new Date(firstDatedCell.date).toLocaleDateString(
        locale,
        { month: "short" },
      );
      if (monthLabel !== lastMonth) {
        labels.push({ label: monthLabel, column });
        lastMonth = monthLabel;
      }
    });

    return {
      weeks: weekColumns,
      monthLabels: labels,
      totalCount: data.reduce((sum, entry) => sum + entry.count, 0),
      maxCount: data.reduce((max, entry) => Math.max(max, entry.count), 0),
    };
  }, [data, locale]);

  const weekdayLabels = [
    t("heatmapWeekdays.sun"),
    t("heatmapWeekdays.mon"),
    t("heatmapWeekdays.tue"),
    t("heatmapWeekdays.wed"),
    t("heatmapWeekdays.thu"),
    t("heatmapWeekdays.fri"),
    t("heatmapWeekdays.sat"),
  ];

  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-white">
            {t("heatmapTitle")}
          </h4>
          <p className="text-xs text-slate-400">{t("heatmapSubtitle")}</p>
        </div>
        <p className="text-xs text-slate-400">
          {t("heatmapTotal", { count: totalCount })}
        </p>
      </div>

      <div className="mt-4 overflow-x-auto">
        <div className="min-w-[760px]">
          <div className="mb-2 ml-12 grid grid-flow-col auto-cols-[12px] gap-1 text-[10px] text-slate-500">
            {weeks.map((_, column) => {
              const label = monthLabels.find((entry) => entry.column === column);
              return <span key={column}>{label?.label ?? ""}</span>;
            })}
          </div>

          <div className="flex gap-2">
            <div className="mt-[2px] grid grid-rows-7 gap-1 text-[10px] text-slate-500">
              {weekdayLabels.map((label) => (
                <span
                  key={label}
                  className="flex h-3 items-center justify-end pr-1"
                >
                  {label}
                </span>
              ))}
            </div>

            <svg
              width={weeks.length * 13}
              height={7 * 13}
              role="img"
              aria-label={t("heatmapAriaLabel")}
            >
              {weeks.map((week, column) =>
                week.map((entry, row) => {
                  const intensity = intensityForCount(entry.count, maxCount);
                  const formattedDate = entry.date
                    ? new Date(entry.date).toLocaleDateString(locale, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })
                    : t("heatmapEmptyDay");

                  return (
                    <rect
                      key={`${column}-${row}-${entry.date || "empty"}`}
                      x={column * 13}
                      y={row * 13}
                      width="11"
                      height="11"
                      rx="2"
                      fill={CELL_COLORS[intensity]}
                    >
                      <title>
                        {entry.date
                          ? t("heatmapTooltip", {
                              count: entry.count,
                              date: formattedDate,
                            })
                          : t("heatmapEmptyDay")}
                      </title>
                    </rect>
                  );
                }),
              )}
            </svg>
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-end gap-2 text-[10px] text-slate-500">
        <span>{t("heatmapLegendLess")}</span>
        {CELL_COLORS.map((color, index) => (
          <span
            key={color}
            className="h-3 w-3 rounded-[3px] border border-white/5"
            style={{
              backgroundColor: color,
              boxShadow: index === CELL_COLORS.length - 1 ? "0 0 12px rgba(94, 242, 192, 0.2)" : undefined,
            }}
          />
        ))}
        <span>{t("heatmapLegendMore")}</span>
      </div>
    </div>
  );
}
