import type { EChartsOption } from "echarts";

import { useTheme } from "../app/ThemeProvider";
import { formatCents, formatCompactCents } from "../design/theme";
import type { SavingsSimulation } from "../lib/types";
import { Chart, type ChartExportRow } from "./Chart";
import { ChartKey, type ChartKeyEntry } from "./ChartKey";
import { LINE_SMOOTHING, chartTokens, type Resolved } from "./theme";

/**
 * Where a savings plan goes, month by month, split into the three things that
 * make up its balance: what was put aside on day one, what has been paid in
 * since, and what the pot has earned.
 *
 * **The three bands sum to the balance, exactly.** `engines/savings.py`
 * guarantees `final_cents == initial_cents + contributed_cents +
 * interest_cents` at every point, by accumulating the same rounded monthly
 * figures the balance itself is built from. Drawing them stacked is therefore
 * not an approximation of the balance — it IS the balance, decomposed.
 *
 * **`stackStrategy: "all"` is a requirement here, not a guard.** A monthly
 * contribution may be negative — a withdrawal plan, or the operator's own
 * measured capacity of −746,19 €/month — and the cumulative band then runs
 * negative under a positive starting amount. ECharts' default `"samesign"`
 * chains a stacked value onto the previous series only when the two share a
 * sign (dataStack.js:87,115-118); where it refuses, `stackedOverDimension` is
 * left NaN and the band falls back to a zero floor
 * (layout/barGrid.js:398-399). The plan would draw as flattening at zero
 * instead of crossing it. Two charts in this codebase already shipped that way.
 *
 * Integer cents travel all the way to the axis formatter, like every other
 * chart in this app.
 */
export function buildSavingsOption(
  projection: SavingsSimulation,
  theme: Resolved,
): EChartsOption {
  const tokens = chartTokens(theme);
  const entries = savingsLegend(projection, theme);
  // A constant band. Omitted entirely when nothing was put aside first —
  // `savingsLegend` agrees, so the key never names a band of height zero.
  const initial = projection.initial_cents;

  const bands: Array<{ name: string; color: string; data: number[] }> = entries.map((entry) => ({
    name: entry.name,
    color: entry.color,
    data: projection.points.map((point) =>
      entry.key === "initial"
        ? initial
        : entry.key === "contributed"
          ? point.contributed_cents
          : point.interest_cents,
    ),
  }));

  return {
    // `top: 32` clears the Exporter button; `right: 24` is the last x-axis
    // label's overhang. A line series sets `boundaryGap: false`, so the last
    // tick sits ON the grid's right edge and half its label hangs past it —
    // "m600" is ~30px at the 11px mono axis font, so ~15px, and `containLabel`
    // subtracts a horizontal label's height and never its width
    // (coord/cartesian/Grid.js:150).
    grid: { left: 8, right: 24, top: 32, bottom: 8, containLabel: true },
    tooltip: {
      trigger: "axis",
      formatter: (params) => {
        const rows = (Array.isArray(params) ? params : [params]) as Array<{ dataIndex?: number }>;
        const index = rows[0]?.dataIndex ?? 0;
        const point = projection.points[index];
        if (!point) return "";
        return [
          `<strong>Mois ${point.month}</strong>`,
          ...(initial !== 0 ? [`Mise de départ : ${formatCents(initial)}`] : []),
          `Versements cumulés : ${formatCents(point.contributed_cents, { signed: true })}`,
          `Intérêts cumulés : ${formatCents(point.interest_cents)}`,
          // The sum, said outright and signed: a balance below zero is the
          // answer on a withdrawal plan, not a rendering accident.
          `Solde : ${formatCents(point.balance_cents, { signed: true })}`,
        ].join("<br/>");
      },
    },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: projection.points.map((point) => `m${point.month}`),
    },
    yAxis: {
      type: "value",
      axisLabel: { formatter: (value: number) => formatCompactCents(value) },
    },
    series: bands.map((band) => ({
      type: "line" as const,
      ...LINE_SMOOTHING,
      name: band.name,
      stack: "solde",
      stackStrategy: "all" as const,
      areaStyle: { opacity: 0.35 },
      showSymbol: false,
      lineStyle: { width: 1.5 },
      color: band.color,
      data: band.data,
    })),
    backgroundColor: tokens.surfaceStrong,
  };
}

/**
 * The key, in the same order and the same colours the bands are drawn in.
 *
 * The starting amount is dropped when it is zero: a band of constant zero is a
 * legend entry pointing at nothing on the canvas.
 */
export function savingsLegend(
  projection: SavingsSimulation,
  theme: Resolved,
): ChartKeyEntry[] {
  const tokens = chartTokens(theme);
  const entries: ChartKeyEntry[] = [];
  if (projection.initial_cents !== 0) {
    entries.push({ key: "initial", name: "Mise de départ", color: tokens.muted });
  }
  entries.push({ key: "contributed", name: "Versements cumulés", color: tokens.accent });
  entries.push({ key: "interest", name: "Intérêts cumulés", color: tokens.positive });
  return entries;
}

/** The CSV behind the chart: the three parts and the balance they sum to. */
export function buildSavingsExportRows(projection: SavingsSimulation): ChartExportRow[] {
  return projection.points.map((point) => ({
    Mois: point.month,
    "Mise de départ": formatCents(projection.initial_cents),
    "Versements cumulés": formatCents(point.contributed_cents),
    "Intérêts cumulés": formatCents(point.interest_cents),
    Solde: formatCents(point.balance_cents),
  }));
}

export function SavingsChart({ projection }: { projection: SavingsSimulation }) {
  const { resolved } = useTheme();

  // Nothing at all rather than an axis with no line on it. What to say instead
  // is the calling screen's sentence to write.
  if (projection.points.length === 0) return null;

  return (
    <>
      <ChartKey entries={savingsLegend(projection, resolved)} />
      <Chart
        option={buildSavingsOption(projection, resolved)}
        height={300}
        ariaLabel={
          `Évolution du solde sur ${projection.months} mois, décomposée en mise de départ, ` +
          `versements et intérêts. Solde final : ` +
          `${formatCents(projection.final_cents, { signed: true })}.`
        }
        dataForExport={{
          filename: "epargne",
          headers: [
            "Mois",
            "Mise de départ",
            "Versements cumulés",
            "Intérêts cumulés",
            "Solde",
          ],
          rows: buildSavingsExportRows(projection),
        }}
      />
    </>
  );
}
