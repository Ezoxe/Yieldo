import type { EChartsOption } from "echarts";

import { useTheme } from "../../app/ThemeProvider";
import { Chart } from "../../charts/Chart";
import { LINE_SMOOTHING, areaFade, chartTokens, type Resolved } from "../../charts/theme";
import type { InvestSessionDecision, InvestSessionDetail } from "../../lib/types";
import { formatCents, formatProbability } from "./format";

/**
 * The three charts of a simulated day, as pure option builders plus thin
 * components around `charts/Chart`.
 *
 * Every figure the builders draw is converted from cents or basis points at
 * the very edge — `cents / 100`, `bps / 100` — and only for the chart
 * library, which cannot plot an integer number of cents on a euro axis. The
 * tooltips format from the original integers through `format.ts`.
 *
 * The x axis is the day's own clock: the session opens at 09:00 and step k
 * is (k − 1) intervals later, printed as « 09:05 », so a session read back
 * reads like one whatever the hour it was launched at.
 */

/** A session opens at 09:00; step k is (k − 1) intervals later. The same
 *  clock the runner stamps on the decisions. */
export const SESSION_OPEN_MINUTES = 9 * 60;

function clock(intervalMinutes: number, step: number): string {
  const minutes = SESSION_OPEN_MINUTES + (step - 1) * intervalMinutes;
  const hours = Math.floor(minutes / 60) % 24;
  const rest = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function stepLabels(day: InvestSessionDetail, count: number): string[] {
  return Array.from({ length: count }, (_, index) => clock(day.interval_minutes, index + 1));
}

const GRID = { left: 8, right: 20, top: 32, bottom: 8, containLabel: true };

/* A euro axis hugging its data: a flat day at 10 000 € must not be drawn on
   a 4 000–16 000 € scale, and a 3 % move must still look like one. Half a
   percent of the value on either side, at least a fifth of the range. */
const EURO_AXIS = {
  type: "value" as const,
  min: ({ min, max }: { min: number; max: number }) =>
    Math.floor(min - Math.max((max - min) * 0.2, min * 0.005)),
  max: ({ min, max }: { min: number; max: number }) =>
    Math.ceil(max + Math.max((max - min) * 0.2, max * 0.005)),
  axisLabel: { formatter: (v: number) => `${v} €` },
};

export function capitalOption(day: InvestSessionDetail, theme: Resolved): EChartsOption {
  const tokens = chartTokens(theme);
  const points = day.points;
  return {
    grid: GRID,
    tooltip: {
      trigger: "axis",
      formatter: (params) => {
        const rows = (Array.isArray(params) ? params : [params]) as Array<{ dataIndex?: number }>;
        const point = points[rows[0]?.dataIndex ?? 0];
        if (!point) return "";
        return `<strong>${clock(day.interval_minutes, point.step)}</strong>`
          + `<br/>Capital : ${formatCents(point.equity_cents)}`
          + `<br/>Liquidités : ${formatCents(point.cash_cents)}`
          + `<br/>Exposition : ${formatCents(point.exposure_cents)}`
          + (point.orders ? `<br/>${point.orders} ordre${point.orders > 1 ? "s" : ""}` : "");
      },
    },
    xAxis: { type: "category", boundaryGap: false, data: stepLabels(day, points.length) },
    yAxis: EURO_AXIS,
    series: [
      {
        name: "Capital", type: "line", ...LINE_SMOOTHING, showSymbol: false,
        data: points.map((p) => p.equity_cents / 100),
        lineStyle: { color: tokens.accent, width: 2 },
        itemStyle: { color: tokens.accent },
        areaStyle: areaFade(tokens.accent),
      },
      {
        name: "Liquidités", type: "line", ...LINE_SMOOTHING, showSymbol: false,
        data: points.map((p) => p.cash_cents / 100),
        lineStyle: { color: tokens.muted, width: 1.5, type: "dashed" },
        itemStyle: { color: tokens.muted },
      },
    ],
  };
}

export function marketOption(
  day: InvestSessionDetail, symbol: string, theme: Resolved,
): EChartsOption {
  const tokens = chartTokens(theme);
  const closes = day.closes[symbol] ?? [];
  const decisionsAt = new Map<number, InvestSessionDecision>();
  for (const decision of day.decisions) {
    if (decision.symbol === symbol) decisionsAt.set(decision.step, decision);
  }
  const marks = day.orders
    .filter((order) => order.symbol === symbol && order.step !== null && order.status === "filled")
    .map((order) => ({
      name: order.side === "buy" ? "Achat" : "Vente",
      coord: [(order.step as number) - 1, (order.average_price_cents ?? 0) / 100],
      value: order.side === "buy" ? "A" : "V",
      itemStyle: { color: order.side === "buy" ? tokens.positive : tokens.negative },
    }));

  return {
    grid: GRID,
    tooltip: {
      trigger: "axis",
      formatter: (params) => {
        const rows = (Array.isArray(params) ? params : [params]) as Array<{ dataIndex?: number }>;
        const index = rows[0]?.dataIndex ?? 0;
        const step = index + 1;
        const decision = decisionsAt.get(step);
        let text = `<strong>${clock(day.interval_minutes, step)}</strong>`
          + `<br/>Cours : ${formatCents(closes[index] ?? 0)}`;
        if (decision) {
          text += `<br/>Le modèle : ${decision.choice ?? "—"}`;
          if (decision.mass_bps) {
            text += ` (${Object.entries(decision.mass_bps)
              .map(([k, v]) => `${k} ${formatProbability(v)}`).join(" · ")})`;
          }
          if (decision.score_value !== null) text += `<br/>Conviction : ${decision.score_value}/10`;
          if (decision.rules_choice) text += `<br/>Les règles : ${decision.rules_choice}`;
          if (decision.message) text += `<br/>${decision.message}`;
        }
        return text;
      },
    },
    xAxis: { type: "category", boundaryGap: false, data: stepLabels(day, closes.length) },
    yAxis: EURO_AXIS,
    series: [
      {
        name: symbol, type: "line", ...LINE_SMOOTHING, showSymbol: false,
        data: closes.map((c) => c / 100),
        lineStyle: { color: tokens.info, width: 2 },
        itemStyle: { color: tokens.info },
        markPoint: {
          symbol: "pin", symbolSize: 34,
          label: { color: tokens.surfaceStrong, fontWeight: 700 },
          data: marks,
        },
      },
    ],
  };
}

export function massOption(
  day: InvestSessionDetail, symbol: string, theme: Resolved,
): EChartsOption {
  const tokens = chartTokens(theme);
  const series = day.report.mass_series[symbol] ?? [];
  const byStep = new Map(series.map((point) => [point.step, point]));
  const steps = day.completed_steps;
  const pick = (key: "buy_bps" | "sell_bps" | "hold_bps") =>
    Array.from({ length: steps }, (_, index) => {
      const point = byStep.get(index + 1);
      return point ? point[key] / 100 : null;
    });
  const bar = (name: string, color: string, data: Array<number | null>) => ({
    name, type: "bar" as const, stack: "masse", barCategoryGap: "35%", data,
    itemStyle: { color },
  });
  return {
    grid: GRID,
    tooltip: {
      trigger: "axis",
      valueFormatter: (value) => (typeof value === "number" ? `${Math.round(value)} %` : "—"),
    },
    xAxis: { type: "category", data: stepLabels(day, steps) },
    yAxis: { type: "value", max: 100, axisLabel: { formatter: (v: number) => `${v} %` } },
    series: [
      bar("Acheter", tokens.positive, pick("buy_bps")),
      bar("Vendre", tokens.negative, pick("sell_bps")),
      bar("Ne rien faire", tokens.muted, pick("hold_bps")),
    ],
  };
}

interface DayChartProps {
  day: InvestSessionDetail;
  symbol?: string;
  height?: number;
}

export function CapitalChart({ day, height = 240 }: DayChartProps) {
  const { resolved } = useTheme();
  return (
    <Chart
      option={capitalOption(day, resolved)}
      height={height}
      ariaLabel="Capital et liquidités au fil de la journée"
    />
  );
}

export function MarketChart({ day, symbol = "", height = 220 }: DayChartProps) {
  const { resolved } = useTheme();
  return (
    <Chart
      option={marketOption(day, symbol, resolved)}
      height={height}
      ariaLabel={`Cours de ${symbol} au fil de la journée, avec les achats et les ventes`}
    />
  );
}

export function MassChart({ day, symbol = "", height = 180 }: DayChartProps) {
  const { resolved } = useTheme();
  return (
    <Chart
      option={massOption(day, symbol, resolved)}
      height={height}
      ariaLabel={`Masse de probabilité du modèle sur ${symbol}, pas par pas`}
    />
  );
}
