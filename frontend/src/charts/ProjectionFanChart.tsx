import type { EChartsOption } from "echarts";

import { useTheme } from "../app/ThemeProvider";
import { formatCents, formatCompactCents } from "../design/theme";
import type { MonteCarloProjection } from "../lib/types";
import { Chart, type ChartExportRow } from "./Chart";
import { ChartKey, type ChartKeyEntry } from "./ChartKey";
import { LINE_SMOOTHING, chartTokens, type ChartTokens } from "./theme";

/** "2046-09-30" → "sept. 2046". */
export function monthLabel(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("fr-FR", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function monthLongLabel(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** The three percentiles this fan is drawn from, as the string keys JSON gave
 *  them. Derived from the run's OWN `assumptions.percentiles` rather than
 *  hard-coded to 10/50/90: the API states which centiles it computed, and a
 *  chart that ignored that would silently mislabel a run asked for others. */
export interface FanBands {
  low: string;
  median: string;
  high: string;
}

export function bandsFor(percentiles: number[]): FanBands | null {
  if (percentiles.length < 3) return null;
  const low = percentiles[0];
  const high = percentiles[percentiles.length - 1];
  // The one nearest the middle of the requested set, which is 50 for the
  // default (10, 50, 90) and still the sensible centre for any other triple.
  const middle = percentiles[Math.floor(percentiles.length / 2)];
  return { low: String(low), median: String(middle), high: String(high) };
}

export interface ProjectionFanResult {
  option: EChartsOption;
  ariaLabel: string;
  exportRows: ChartExportRow[];
  keyEntries: ChartKeyEntry[];
}

/**
 * The Monte Carlo band: P10 / P50 / P90, never a single line and never a
 * single number.
 *
 * **The band is allowed to go negative, and nothing here clamps it.** Phase 2A
 * shipped a forecast band anchored at zero that erased the overdraft risk it
 * existed to show; `engines/montecarlo.py` deliberately lets a percentile go
 * below zero (no `max(0, …)` on a trial, on a percentile, or on the growth
 * applied to a negative balance), and this chart carries that honesty to the
 * pixel. Two mechanisms are load-bearing:
 *
 * 1. `stackStrategy: "all"` on BOTH series of the stack. The band is drawn the
 *    standard ECharts way — an invisible series carrying P10, and a second
 *    stacked on it carrying the band's HEIGHT (P90 − P10), not P90 itself.
 *    ECharts' default is `"samesign"`, which only chains a stacked value onto
 *    the one below when both share a sign. A height (always ≥ 0) sitting on a
 *    floor that has gone negative is the opposite-sign case: "samesign"
 *    refuses to chain, leaves the stacked value NaN, and ECharts falls back to
 *    the axis' value start — 0 whenever the axis spans both signs. The band
 *    would then be drawn from zero upward: the right width, anchored in the
 *    wrong place, hiding exactly the months the reader most needs.
 * 2. `yAxis.min` is left to ECharts. Setting it to 0 "to keep the chart tidy"
 *    is the same defect by another route.
 *
 * A zero line is drawn only when the low band actually crosses it, so it reads
 * as a real event rather than as decoration: below it the household has spent
 * more than the portfolio holds.
 *
 * **No `legend`.** Since phase 2B every chart in this app puts its key in HTML
 * above the canvas: an ECharts legend wraps onto as many rows as it needs
 * while `grid.top` is fixed pixels, and at 375 px the extra rows paint over
 * the plot. `ProjectionFanChart.test.tsx` asserts `option.legend` is undefined.
 *
 * The median is dashed: `charts/theme.ts` reserves solid strokes for measured
 * reference lines and dashes for anything projected, and every value here is
 * projected.
 */
export function buildProjectionFanOption(
  projection: MonteCarloProjection,
  bands: FanBands,
  tokens: ChartTokens,
): ProjectionFanResult {
  const { points } = projection;
  const labels = points.map((point) => monthLabel(point.on));
  const low = points.map((point) => point.percentiles_cents[bands.low] ?? 0);
  const median = points.map((point) => point.percentiles_cents[bands.median] ?? 0);
  const high = points.map((point) => point.percentiles_cents[bands.high] ?? 0);
  const crossesZero = low.some((value) => value < 0);

  const keyEntries: ChartKeyEntry[] = [
    {
      key: "band",
      name: `Intervalle P${bands.low}–P${bands.high} (${projection.assumptions.trials.toLocaleString("fr-FR")} trajectoires)`,
      color: tokens.accent,
    },
    { key: "median", name: `Médiane P${bands.median} (projetée, en tirets)`, color: tokens.accentStrong },
  ];
  if (crossesZero) {
    keyEntries.push({ key: "zero", name: "Zéro — le capital est épuisé sous cette ligne", color: tokens.negative });
  }

  const option: EChartsOption = {
    // No `legend` key at all -- see the doc comment. The key lives in HTML.
    grid: { left: 8, right: 8, top: 16, bottom: 32, containLabel: true },
    xAxis: { type: "category", data: labels },
    yAxis: {
      type: "value",
      // `min` deliberately unset: see the doc comment's point 2.
      axisLabel: { formatter: (value: number) => formatCompactCents(value) },
    },
    tooltip: {
      trigger: "axis",
      formatter: (params) => {
        const rows = (Array.isArray(params) ? params : [params]) as Array<{
          dataIndex?: number;
        }>;
        const index = rows[0]?.dataIndex ?? 0;
        const point = points[index];
        if (!point) return "";
        return [
          `<strong>${monthLongLabel(point.on)}</strong>`,
          `Médiane (P${bands.median}) : ${formatCents(median[index])}`,
          `Fourchette P${bands.low}–P${bands.high} : ${formatCents(low[index])} à ${formatCents(high[index])}`,
          low[index] < 0 ? "Dans le pire dixième des trajectoires, le capital est épuisé." : "",
        ]
          .filter(Boolean)
          .join("<br/>");
      },
    },
    series: [
      {
        // Invisible floor of the band. Carries P10 so the stack starts there.
        name: "floor",
        type: "line",
        ...LINE_SMOOTHING,
        stack: "fan",
        // Inert on the first series of a stack (nothing below it to chain
        // onto) but declared so the whole stack group states one strategy.
        stackStrategy: "all",
        symbol: "none",
        lineStyle: { opacity: 0 },
        areaStyle: { opacity: 0 },
        silent: true,
        data: low,
      },
      {
        name: "band",
        type: "line",
        ...LINE_SMOOTHING,
        stack: "fan",
        // Load-bearing -- see the doc comment's point 1.
        stackStrategy: "all",
        symbol: "none",
        lineStyle: { opacity: 0 },
        areaStyle: { color: tokens.accent, opacity: 0.18 },
        silent: true,
        // The band's HEIGHT, not its top edge.
        data: points.map((_point, index) => high[index] - low[index]),
      },
      {
        name: "median",
        type: "line",
        ...LINE_SMOOTHING,
        symbol: "none",
        lineStyle: { width: 2, type: "dashed", color: tokens.accentStrong },
        itemStyle: { color: tokens.accentStrong },
        z: 3,
        data: median,
        markLine: crossesZero
          ? {
              silent: true,
              symbol: "none",
              lineStyle: { color: tokens.negative, type: "solid", width: 1 },
              label: {
                formatter: "Zéro",
                color: tokens.muted,
                position: "insideEndTop",
              },
              data: [{ yAxis: 0 }],
            }
          : undefined,
      },
    ],
  };

  const last = points.length - 1;
  const ariaLabel = points.length
    ? `Projection Monte Carlo du capital sur ${points.length} mois, de ${monthLongLabel(points[0].on)} à ${monthLongLabel(points[last].on)}, ` +
      `sur ${projection.assumptions.trials} trajectoires tirées avec la graine ${projection.assumptions.seed}. ` +
      `Médiane de ${formatCents(median[0])} à ${formatCents(median[last])} ; ` +
      `fourchette P${bands.low} à P${bands.high} de ${formatCents(low[last])} à ${formatCents(high[last])} en fin de période.` +
      (crossesZero
        ? " Dans le pire dixième des trajectoires, le capital passe sous zéro avant la fin."
        : " Aucune trajectoire du dixième centile ne passe sous zéro.")
    : "Projection Monte Carlo du capital.";

  const exportRows: ChartExportRow[] = points.map((point, index) => ({
    Mois: monthLabel(point.on),
    [`P${bands.low}`]: formatCents(low[index]),
    [`P${bands.median}`]: formatCents(median[index]),
    [`P${bands.high}`]: formatCents(high[index]),
  }));

  return { option, ariaLabel, exportRows, keyEntries };
}

export function ProjectionFanChart({ projection }: { projection: MonteCarloProjection }) {
  const { resolved } = useTheme();
  const bands = bandsFor(projection.assumptions.percentiles);

  if (bands === null || projection.points.length === 0) {
    // Never an empty plot with axes and no data: an axis with nothing on it
    // reads as "the capital is flat at zero", which is a claim nobody made.
    return <p className="yd-chart-empty">Aucune bande de centiles à tracer.</p>;
  }

  const { option, ariaLabel, exportRows, keyEntries } = buildProjectionFanOption(
    projection,
    bands,
    chartTokens(resolved),
  );

  return (
    <>
      <ChartKey entries={keyEntries} />
      <Chart
        option={option}
        height={320}
        ariaLabel={ariaLabel}
        dataForExport={{
          filename: `projection-monte-carlo-graine-${projection.assumptions.seed}`,
          headers: ["Mois", `P${bands.low}`, `P${bands.median}`, `P${bands.high}`],
          rows: exportRows,
        }}
      />
    </>
  );
}
