import type { EChartsOption } from "echarts";

import { useTheme } from "../app/ThemeProvider";
import { frenchDate } from "../design/EmptyState";
import { formatCents, formatCompactCents } from "../design/theme";
import type { BalancePoint } from "../lib/types";
import { Chart, type ChartExportRow } from "./Chart";
import "./DebtPayoffChart.css";
import { LINE_SMOOTHING, chartTokens, seriesColors, type Resolved } from "./theme";

/** "2026-09-30" → "sept. 2026". */
function monthLabel(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("fr-FR", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** The debt ids the plan carries, in the order the engine put them in — its
 *  attack order, so the bands stack in the order they are paid off. */
function debtIds(points: BalancePoint[]): string[] {
  return points.length > 0 ? Object.keys(points[0].balances_cents) : [];
}

function debtName(names: Map<number, string>, id: string): string {
  // Never silently drop a band: a debt the caller could not name is still owed.
  return names.get(Number(id)) ?? `Dette ${id}`;
}

/**
 * One stacked area per debt: what is still owed, month by month, until the last
 * one clears.
 *
 * `stackStrategy: "all"` on every series, without exception. ECharts' default
 * is `"samesign"`, which chains a stacked value onto the previous series only
 * when the two share a sign; where it refuses, `stackedOverDimension` is left
 * NaN and the series falls back to `valueStart` — zero. Two charts in this
 * codebase shipped with that defect, one of them drawing the operator's
 * −2 209,63 € year as a bar rising above zero for two whole phases. Remaining
 * balances are non-negative today, so this is a guard rather than a fix; it
 * costs one line and it is the line whose absence nobody notices.
 *
 * Integer cents travel all the way to the axis formatter, like every other
 * chart in this app: `formatCompactCents` and `formatCents` are the display
 * boundary, and rounding the plotted data to euros first would throw away the
 * exactness the whole phase is built on.
 */
export function buildPayoffOption(
  points: BalancePoint[],
  names: Map<number, string>,
  theme: Resolved,
): EChartsOption {
  const tokens = chartTokens(theme);
  const ramp = seriesColors(theme);
  const ids = debtIds(points);

  return {
    // `top: 32` clears the Exporter button, which `Chart.css` floats over the
    // canvas' top-right corner. There is no ECharts legend to leave room for:
    // see `payoffLegend` below for why this chart draws its own in HTML.
    //
    // `right: 30` is the last x-axis label's overhang, and it is load-bearing.
    // `containLabel` subtracts only a horizontal axis label's HEIGHT, never its
    // width (`coord/cartesian/Grid.js:150`), so the last label is contained only
    // by the half-band `boundaryGap` insets it by — and that half-band shrinks
    // towards zero as the month count grows. Measured at 375px on a 52-month
    // plan: the last tick sat ~4px from the edge and "déc. 2030" rendered as
    // "déc. 20". Half of the widest label this axis can print ("sept. 2026",
    // ~56px at the 11px axis font) is the worst-case overhang at any length.
    grid: { left: 8, right: 30, top: 32, bottom: 8, containLabel: true },
    tooltip: {
      trigger: "axis",
      formatter: (params) => {
        const rows = (Array.isArray(params) ? params : [params]) as Array<{ dataIndex?: number }>;
        const index = rows[0]?.dataIndex ?? 0;
        const point = points[index];
        if (!point) return "";
        return [
          `<strong>${frenchDate(point.on)}</strong>`,
          ...ids.map(
            (id) => `${debtName(names, id)} : ${formatCents(point.balances_cents[id] ?? 0)}`,
          ),
          `Total restant dû : ${formatCents(point.total_cents)}`,
        ].join("<br/>");
      },
    },
    xAxis: { type: "category", data: points.map((point) => monthLabel(point.on)) },
    yAxis: {
      type: "value",
      axisLabel: { formatter: (value: number) => formatCompactCents(value) },
    },
    series: ids.map((id, index) => ({
      type: "line" as const,
      ...LINE_SMOOTHING,
      name: debtName(names, id),
      stack: "solde",
      stackStrategy: "all" as const,
      areaStyle: { opacity: 0.35 },
      showSymbol: false,
      lineStyle: { width: 1.5 },
      color: ramp[index % ramp.length],
      data: points.map((point) => point.balances_cents[id] ?? 0),
    })),
    backgroundColor: tokens.surfaceStrong,
  };
}

export interface PayoffLegendEntry {
  id: string;
  name: string;
  color: string;
}

/**
 * The key, in the same order and the same colours the series are drawn in.
 *
 * Drawn as HTML above the canvas rather than as an ECharts `legend`, and the
 * reason is a defect measured at 375px: ECharts lays a legend out inside the
 * canvas and wraps it onto as many rows as it needs, while `grid.top` is a
 * fixed number of pixels. Three debts with user-written names wrapped onto
 * three rows and the third was painted straight over the plot's top gridline.
 * No value of `grid.top` is right for every debt count and every name length.
 * In HTML the rows are flex-wrapped by the browser, the card grows to fit, and
 * the plot cannot be reached at all — which also retires the `legend.right: 84`
 * dance the two sibling charts need to stay out from under the Exporter button.
 */
export function payoffLegend(
  points: BalancePoint[],
  names: Map<number, string>,
  theme: Resolved,
): PayoffLegendEntry[] {
  const ramp = seriesColors(theme);
  return debtIds(points).map((id, index) => ({
    id,
    name: debtName(names, id),
    color: ramp[index % ramp.length],
  }));
}

/** The CSV behind the chart: exact figures, one column per debt. */
export function buildPayoffExportRows(
  points: BalancePoint[],
  names: Map<number, string>,
): ChartExportRow[] {
  const ids = debtIds(points);
  return points.map((point) => {
    const row: ChartExportRow = { Mois: point.on };
    for (const id of ids) row[debtName(names, id)] = formatCents(point.balances_cents[id] ?? 0);
    return row;
  });
}

interface DebtPayoffChartProps {
  points: BalancePoint[];
  names: Map<number, string>;
}

export function DebtPayoffChart({ points, names }: DebtPayoffChartProps) {
  const { resolved } = useTheme();

  // Nothing at all rather than an axis with no data on it: an empty plot reads
  // as "nothing is owed", which is a claim. Whether there is a plan to draw,
  // and why there is not, is the calling screen's sentence to write.
  if (points.length === 0) return null;

  const first = frenchDate(points[0].on);
  const last = frenchDate(points[points.length - 1].on);
  const ids = debtIds(points);
  const legend = payoffLegend(points, names, resolved);

  return (
    <>
    <ul className="yd-payoff-legend">
      {legend.map((entry) => (
        <li key={entry.id} className="yd-payoff-legend__item">
          {/* The swatch is decorative: the name beside it is what identifies
              the band, so colour is never the only channel. */}
          <span
            className="yd-payoff-legend__swatch"
            style={{ background: entry.color }}
            aria-hidden="true"
          />
          {entry.name}
        </li>
      ))}
    </ul>
    <Chart
      option={buildPayoffOption(points, names, resolved)}
      height={300}
      ariaLabel={
        `Capital restant dû, du ${first} au ${last}, une bande par dette. ` +
        `${formatCents(points[0].total_cents)} au départ, ` +
        `${formatCents(points[points.length - 1].total_cents)} à la fin.`
      }
      dataForExport={{
        filename: "remboursement-dettes",
        headers: ["Mois", ...ids.map((id) => debtName(names, id))],
        rows: buildPayoffExportRows(points, names),
      }}
    />
    </>
  );
}
