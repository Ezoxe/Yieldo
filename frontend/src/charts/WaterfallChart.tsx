import type { EChartsOption } from "echarts";

import { useTheme } from "../app/ThemeProvider";
import { formatCents } from "../design/theme";
import type { CategoryBreakdown, Summary } from "../lib/types";
import { Chart, type ChartExportRow } from "./Chart";
import { type ChartTokens, type Resolved, chartTokens, seriesColors } from "./theme";

interface WaterfallChartProps {
  summary: Summary;
  categories: CategoryBreakdown[];
}

export interface WaterfallStep {
  name: string;
  /** Signed cents: positive for income, negative for an expense step. */
  delta: number;
  color: string;
}

export interface WaterfallOptionResult {
  option: EChartsOption;
  steps: WaterfallStep[];
  ariaLabel: string;
}

const MAX_CATEGORY_STEPS = 5;

// Cascade: income first (positive), then the largest expense categories each
// as their own negative step in THEIR category's color -- never red by
// default, per the app's color rule (red is reserved for anomalies /
// over-budget, not for "this is an expense"). Any remaining categories fold
// into one "Autres dépenses" step rather than crowding the chart past the
// categorical series cap. The final "Épargne" step is the authoritative
// summary.net_cents, not a value re-derived by summing the steps above --
// /summary and /categories are not guaranteed to reconcile to the cent
// (transfers, timing), and the resting point of a cascade must never show a
// number the backend didn't actually report.
export function buildWaterfallOption(
  summary: Summary,
  categories: CategoryBreakdown[],
  tokens: ChartTokens,
  resolved: Resolved = "dark",
): WaterfallOptionResult {
  const sorted = [...categories].sort((a, b) => Math.abs(b.total_cents) - Math.abs(a.total_cents));
  const shown = sorted.slice(0, MAX_CATEGORY_STEPS);
  const rest = sorted.slice(MAX_CATEGORY_STEPS);
  const restTotal = rest.reduce((sum, category) => sum + category.total_cents, 0);

  // Matches the theme actually rendering -- CategoryTreemap threads the same
  // `resolved` through for its own categorical fallback; a hardcoded "dark"
  // here meant the light theme's fallback segments (an uncolored category)
  // came out in dark-theme hues.
  const palette = seriesColors(resolved);
  const steps: WaterfallStep[] = [
    { name: "Revenus", delta: summary.inflow_cents, color: tokens.positive },
    ...shown.map((category, index) => ({
      name: category.name,
      delta: category.total_cents,
      color: category.color || palette[index % palette.length],
    })),
  ];
  if (rest.length > 0) {
    steps.push({ name: "Autres dépenses", delta: restTotal, color: tokens.muted });
  }
  steps.push({
    name: "Épargne",
    delta: summary.net_cents,
    color: summary.net_cents >= 0 ? tokens.positive : tokens.negative,
  });

  // Standard two-series waterfall technique: a transparent "support" series
  // carries each bar up to its starting height, a visible series draws only
  // the delta on top of it. The final (total) step spans from the zero
  // baseline instead of chaining off the running total.
  //
  // That technique is only correct with `stackStrategy: "all"` on the stack --
  // see the series below. ECharts' default refuses to chain a positive height
  // onto a negative floor, which re-anchors every bar below zero at the
  // baseline and draws a deficit as though it were a gain.
  let cumulative = 0;
  const base: number[] = [];
  const visible: number[] = [];

  steps.forEach((step, index) => {
    const last = index === steps.length - 1;
    if (last) {
      base.push(Math.min(0, step.delta));
      visible.push(Math.abs(step.delta));
      return;
    }
    const start = cumulative;
    const end = cumulative + step.delta;
    base.push(Math.min(start, end));
    visible.push(Math.abs(step.delta));
    cumulative = end;
  });

  const option: EChartsOption = {
    grid: { left: 8, right: 8, top: 24, bottom: 72, containLabel: true },
    xAxis: { type: "category", data: steps.map((step) => step.name) },
    yAxis: { type: "value", axisLabel: { formatter: (value: number) => formatCents(value, { decimals: 0 }) } },
    tooltip: {
      trigger: "item",
      formatter: (params) => {
        const point = params as { dataIndex?: number };
        const step = steps[point.dataIndex ?? 0];
        return `${step.name} : <strong>${formatCents(step.delta, { signed: true })}</strong>`;
      },
    },
    series: [
      {
        name: "support",
        type: "bar",
        stack: "waterfall",
        // The zero baseline, drawn once, on the invisible support series so it
        // sits under everything. A cascade whose steps float between gridlines
        // has no anchor: the reader cannot see which side of nothing a bar is
        // on. Solid where the grid is dashed, and in the muted text colour
        // rather than an accent — it is a reference, not a reading.
        markLine: {
          silent: true,
          symbol: "none",
          animation: false,
          label: { show: false },
          lineStyle: { color: tokens.muted, width: 1, type: "solid", opacity: 0.7 },
          data: [{ yAxis: 0 }],
        },
        // Inert on the first series of a stack (nothing below it to chain
        // onto) but declared here so the whole stack group states one
        // strategy -- see the visible series below for why it matters.
        stackStrategy: "all",
        itemStyle: { color: "transparent" },
        emphasis: { itemStyle: { color: "transparent" } },
        silent: true,
        data: base,
        barMaxWidth: 40,
      },
      {
        name: "montant",
        type: "bar",
        stack: "waterfall",
        // Load-bearing. ECharts' default is `stackStrategy: "samesign"`
        // (processor/dataStack.js:84,115-118), which only chains a stacked
        // value onto the one below it when both share a sign. This series
        // carries a HEIGHT (always >= 0) sitting on a FLOOR that goes negative
        // the moment the cascade crosses zero -- opposite signs, so "samesign"
        // refuses to chain, the stack result is left equal to the raw height,
        // and `layout/barGrid.js:398-399` computes `stackStartValue =
        // stackResult - rawValue` = 0. The bar is then drawn UPWARD from the
        // zero baseline: the right height, the wrong anchor, and a month
        // ending in the red rendered as one ending in the black. "all" stacks
        // unconditionally. Same defect the fan chart's band carried.
        stackStrategy: "all",
        data: visible.map((value, index) => ({ value, itemStyle: { color: steps[index].color } })),
        barMaxWidth: 40,
        // Two consecutive steps share a top level whenever a rise is followed
        // by a fall from that same level -- on the operator's ledger "Revenus"
        // (+10 220 €) and "Logement" (-3 900 €) both anchor at 10 220, so at
        // 375 their two labels rendered on top of each other as
        // "+10 2209 00 €": two figures printed, neither readable.
        //
        // Printing all of them is not available at that width. The plotting
        // area is ~235px for eight bands and each label is ~55px, and a
        // cascade offers no free level to move one to: bar i's BOTTOM is bar
        // i+1's TOP by construction, so "put falls at the bottom instead" only
        // moves the collision one step along. `hideOverlap` is ECharts' own
        // answer -- it measures the laid-out label boxes and drops the ones
        // that would collide. At 1440 nothing collides and every amount still
        // prints; at 375 what prints is legible and what does not print is
        // absent rather than garbled. The dropped figures remain in the
        // tooltip and in the CSV export.
        labelLayout: { hideOverlap: true },
        label: {
          show: true,
          position: "top",
          formatter: (params: { dataIndex?: number }) => {
            const step = steps[params.dataIndex ?? 0];
            return formatCents(step.delta, { signed: true, decimals: 0 });
          },
          color: tokens.text,
        },
      },
    ],
  };

  const ariaLabel = `Cascade des revenus, des principales dépenses et de l'épargne, du ${summary.date_from} au ${summary.date_to}.`;

  return { option, steps, ariaLabel };
}

function stepsToExportRows(steps: WaterfallStep[]): ChartExportRow[] {
  return steps.map((step) => ({ Poste: step.name, Montant: formatCents(step.delta, { signed: true }) }));
}

export function WaterfallChart({ summary, categories }: WaterfallChartProps) {
  const { resolved } = useTheme();

  if (summary.inflow_cents === 0 && summary.outflow_cents === 0) {
    return <p className="yd-chart-empty">Aucune activité sur cette période.</p>;
  }

  const { option, steps, ariaLabel } = buildWaterfallOption(summary, categories, chartTokens(resolved), resolved);

  return (
    <Chart
      option={option}
      height={360}
      ariaLabel={ariaLabel}
      dataForExport={{
        filename: "cascade-revenus-depenses-epargne",
        headers: ["Poste", "Montant"],
        rows: stepsToExportRows(steps),
      }}
    />
  );
}
