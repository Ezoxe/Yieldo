import type { EChartsOption } from "echarts";

import { useTheme } from "../app/ThemeProvider";
import { frenchDate } from "../design/EmptyState";
import type { HealthSnapshot } from "../lib/types";
import { Chart, type ChartExportRow } from "./Chart";
import { ChartKey, type ChartKeyEntry } from "./ChartKey";
import { LINE_SMOOTHING, chartTokens, type Resolved } from "./theme";

/**
 * A trend needs two points. Below that there is a reading, not a history, and
 * the screen says so in words instead — see `HealthPanel`.
 *
 * The chart guidance this project follows would rather see four points before
 * a line chart at all; the compromise is `showSymbol: true`, so each stored
 * reading is a mark of its own and the segment between two of them never
 * pretends to be a continuous measurement. The score is written at most once a
 * day, on a day the household opened Yieldo (`api/engagement.py`), so the gaps
 * between marks are real and uneven, and the marks are the only honest part.
 */
export const MIN_HISTORY_POINTS = 2;

/** "2026-09-01" → "1 sept. 2026". The axis is narrow; `frenchDate`'s long month
 *  is for the tooltip and the CSV, where there is room for it. */
function axisLabel(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  return date.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * The stored score, day by day.
 *
 * **The axis is pinned to 0-100 and never fitted to the data.** The score is
 * defined on that scale, and an axis fitted to a run of 0, 0, 12, 31 would
 * fill the plot with a rise of twelve points and read as a surge. It also
 * keeps the operator's own state readable: a measured score of 0 sits ON the
 * floor of a full-height axis, which is what a measured zero looks like —
 * rather than being the whole axis, which is what a fitted one would make it.
 */
export function buildHealthHistoryOption(
  history: HealthSnapshot[],
  theme: Resolved,
): EChartsOption {
  const tokens = chartTokens(theme);

  return {
    // `top: 32` clears the Exporter button. `right: 28` is the last x-axis
    // label's overhang: `boundaryGap: false` puts the final tick ON the grid's
    // right edge, and `containLabel` subtracts a horizontal label's height,
    // never its width (coord/cartesian/Grid.js:150).
    grid: { left: 8, right: 28, top: 32, bottom: 8, containLabel: true },
    tooltip: {
      trigger: "axis",
      formatter: (params) => {
        const rows = (Array.isArray(params) ? params : [params]) as Array<{ dataIndex?: number }>;
        const point = history[rows[0]?.dataIndex ?? 0];
        if (!point) return "";
        return `<strong>${frenchDate(point.taken_on)}</strong><br/>Score : ${point.score} sur 100`;
      },
    },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: history.map((point) => axisLabel(point.taken_on)),
    },
    yAxis: {
      type: "value",
      min: 0,
      max: 100,
      axisLabel: { formatter: (value: number) => String(value) },
    },
    series: [
      {
        type: "line",
        ...LINE_SMOOTHING,
        name: "Score de santé financière",
        // One mark per stored reading — see MIN_HISTORY_POINTS.
        showSymbol: true,
        symbolSize: 7,
        lineStyle: { width: 1.8 },
        areaStyle: { opacity: 0.22 },
        color: tokens.accent,
        data: history.map((point) => point.score),
      },
    ],
    backgroundColor: tokens.surfaceStrong,
  };
}

/** One band, one entry. In HTML above the canvas, never an ECharts `legend`. */
export function healthHistoryKey(theme: Resolved): ChartKeyEntry[] {
  return [
    { key: "score", name: "Score de santé financière", color: chartTokens(theme).accent },
  ];
}

export function buildHealthHistoryRows(history: HealthSnapshot[]): ChartExportRow[] {
  return history.map((point) => ({ Date: frenchDate(point.taken_on), Score: point.score }));
}

export function HealthHistoryChart({ history }: { history: HealthSnapshot[] }) {
  const { resolved } = useTheme();

  // Nothing at all rather than an axis carrying a single dot. What to say
  // instead is the calling panel's sentence to write, because only it knows
  // that the reason is "the score has only been stored once".
  if (history.length < MIN_HISTORY_POINTS) return null;

  const first = history[0];
  const last = history[history.length - 1];

  return (
    <>
      <ChartKey entries={healthHistoryKey(resolved)} />
      <Chart
        option={buildHealthHistoryOption(history, resolved)}
        height={260}
        ariaLabel={
          `${history.length} relevés du score, du ${frenchDate(first.taken_on)} au ` +
          `${frenchDate(last.taken_on)}. Dernier score : ${last.score} sur 100.`
        }
        dataForExport={{
          filename: "sante-financiere",
          headers: ["Date", "Score"],
          rows: buildHealthHistoryRows(history),
        }}
      />
    </>
  );
}
