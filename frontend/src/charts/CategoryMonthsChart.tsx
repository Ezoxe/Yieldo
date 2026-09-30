import type { EChartsOption } from "echarts";

import { useTheme } from "../app/ThemeProvider";
import { formatCents, formatCompactCents } from "../design/theme";
import { plural } from "../lib/plural";
import type { BudgetDetailMonth } from "../lib/types";
import { Chart, type ChartExportRow } from "./Chart";
import { escapeHtml } from "./escapeHtml";
import { chartTokens, type ChartTokens } from "./theme";

interface CategoryMonthsChartProps {
  series: BudgetDetailMonth[];
  /** The month on screen, "AAAA-MM". */
  current: string;
  /** The monthly mean over complete months, negative; null when there is none. */
  averageCents: number | null;
}

function monthDate(key: string): Date {
  const [year, month] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1));
}

function longMonth(key: string): string {
  return monthDate(key).toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
}

function shortMonth(key: string): string {
  return monthDate(key).toLocaleDateString("fr-FR", { month: "short", year: "2-digit", timeZone: "UTC" });
}

/**
 * One category's spend, month by month over the whole ledger, with its mean.
 *
 * Bars are MAGNITUDES — this chart only ever draws what went out, and an
 * axis of negative euros reads as a loss rather than as a cost. The month on
 * screen is the one solid bar; a month the statements only half cover is
 * drawn in the muted tone and says so in its tooltip, because it is the bar a
 * reader would otherwise compare with the mean and wrongly call cheap.
 *
 * The mean line is the backend's figure, over complete months only, and is
 * absent — not zero — when there are fewer than three of them.
 */
export function buildCategoryMonthsOption(
  series: BudgetDetailMonth[],
  current: string,
  averageCents: number | null,
  tokens: ChartTokens,
): { option: EChartsOption; exportRows: ChartExportRow[] } {
  const data = series.map((month) => {
    const onScreen = month.month === current;
    return {
      value: Math.abs(month.spent_cents),
      itemStyle: {
        color: onScreen ? tokens.accentStrong : month.complete ? tokens.accent : tokens.muted,
        opacity: onScreen ? 1 : 0.55,
        borderRadius: [4, 4, 0, 0],
      },
    };
  });

  const option: EChartsOption = {
    grid: { left: 8, right: 16, top: 28, bottom: 8, containLabel: true },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (params) => {
        const rows = (Array.isArray(params) ? params : [params]) as Array<{ dataIndex?: number }>;
        const month = series[rows[0]?.dataIndex ?? 0];
        if (!month) return "";
        const lines = [
          `<strong>${escapeHtml(longMonth(month.month))}</strong>`,
          `${formatCents(Math.abs(month.spent_cents))} · ${month.count} ${plural(month.count, "opération", "opérations")}`,
        ];
        if (!month.complete) lines.push("mois incomplet");
        return lines.join("<br/>");
      },
    },
    xAxis: {
      type: "category",
      data: series.map((month) => shortMonth(month.month)),
      axisTick: { show: false },
    },
    yAxis: {
      type: "value",
      axisLabel: { formatter: (value: number) => formatCompactCents(value) },
    },
    series: [
      {
        type: "bar",
        name: "Dépense",
        barMaxWidth: 28,
        data,
        markLine:
          averageCents === null
            ? undefined
            : {
                symbol: "none",
                silent: true,
                lineStyle: { type: "dashed", color: tokens.text, opacity: 0.55 },
                label: {
                  formatter: `Moyenne ${formatCents(Math.abs(averageCents))}`,
                  position: "insideEndTop",
                  color: tokens.muted,
                },
                data: [{ yAxis: Math.abs(averageCents) }],
              },
      },
    ],
  };

  const exportRows = series.map((month) => ({
    Mois: longMonth(month.month),
    Dépense: formatCents(Math.abs(month.spent_cents)),
  }));
  return { option, exportRows };
}

export function CategoryMonthsChart({ series, current, averageCents }: CategoryMonthsChartProps) {
  const { resolved } = useTheme();

  if (series.length === 0) {
    return <p className="yd-chart-empty">Aucun relevé : rien à tracer pour l'instant.</p>;
  }

  const { option, exportRows } = buildCategoryMonthsOption(series, current, averageCents, chartTokens(resolved));
  return (
    <Chart
      option={option}
      height={260}
      ariaLabel="Dépense de la catégorie, mois par mois"
      dataForExport={{ filename: "categorie-mois-par-mois", headers: ["Mois", "Dépense"], rows: exportRows }}
    />
  );
}
