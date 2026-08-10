import type { EChartsOption } from "echarts";

import { useTheme } from "../app/ThemeProvider";
import { formatCents } from "../design/theme";
import type { CategoryBreakdown, Summary } from "../lib/types";
import { Chart, type ChartExportRow } from "./Chart";
import { type ChartTokens, chartTokens, seriesColors } from "./theme";

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
): WaterfallOptionResult {
  const sorted = [...categories].sort((a, b) => Math.abs(b.total_cents) - Math.abs(a.total_cents));
  const shown = sorted.slice(0, MAX_CATEGORY_STEPS);
  const rest = sorted.slice(MAX_CATEGORY_STEPS);
  const restTotal = rest.reduce((sum, category) => sum + category.total_cents, 0);

  const palette = seriesColors("dark");
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
        data: visible.map((value, index) => ({ value, itemStyle: { color: steps[index].color } })),
        barMaxWidth: 40,
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

  const { option, steps, ariaLabel } = buildWaterfallOption(summary, categories, chartTokens(resolved));

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
