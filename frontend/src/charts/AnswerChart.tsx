import type { EChartsOption } from "echarts";

import { useTheme } from "../app/ThemeProvider";
import { formatCents, formatCompactCents } from "../design/theme";
import type { ChatChart } from "../lib/types";
import { Chart, type ChartExportRow } from "./Chart";
import { ChartKey, type ChartKeyEntry } from "./ChartKey";
import { LINE_SMOOTHING, chartTokens, type Resolved } from "./theme";

/**
 * The chart a chat answer deserves — and nothing when it deserves none.
 *
 * **This component draws what `engines/answer.py` decomposed and never
 * anything else.** It does no arithmetic on the points it is given: no
 * resampling, no smoothing, no "autres" bucket, no cumulative sum. A bar chart
 * of a monthly total sums back to the total the sentence beside it quotes,
 * because it IS that total, split by the same engine that produced it.
 *
 * `option.legend` stays undefined on purpose: the key is HTML above the
 * canvas, like every other chart in this app (see ChartKey.css), so it is
 * selectable, readable by a screen reader, and not painted at a size ECharts
 * chose. `AnswerChart.test.tsx` asserts the absence.
 *
 * Integer cents travel all the way to the axis formatter. Nothing here divides
 * by 100.
 */

/** Whether a series has values on both sides of zero — which is the only case
 *  where a column's height cannot carry its sign on its own. */
function crossesZero(chart: ChatChart): boolean {
  return (
    chart.points.some((point) => point.amount_cents < 0) &&
    chart.points.some((point) => point.amount_cents >= 0)
  );
}

export function buildAnswerOption(chart: ChatChart, theme: Resolved): EChartsOption {
  const tokens = chartTokens(theme);
  const values = chart.points.map((point) => point.amount_cents);
  const bars = chart.kind === "bars";

  return {
    // `top: 32` clears the Exporter button the Chart shell paints over the
    // canvas; `right: 24` is the overhang of the last x-axis label.
    grid: { left: 8, right: 24, top: 32, bottom: 8, containLabel: true },
    tooltip: {
      trigger: "axis",
      formatter: (params) => {
        const rows = (Array.isArray(params) ? params : [params]) as Array<{ dataIndex?: number }>;
        const point = chart.points[rows[0]?.dataIndex ?? 0];
        if (!point) return "";
        // Signed: a positive column on a spending chart is a refund, and
        // dropping the sign would make it read as more spending.
        return `<strong>${point.label}</strong><br/>${formatCents(point.amount_cents, {
          signed: true,
        })}`;
      },
    },
    xAxis: {
      type: "category",
      // A bar needs the gap its own width sits in; a line must start on the
      // axis rather than one half-step inside it.
      boundaryGap: bars,
      data: chart.points.map((point) => point.label),
    },
    yAxis: {
      type: "value",
      axisLabel: { formatter: (value: number) => formatCompactCents(value) },
    },
    series: [
      bars
        ? {
            type: "bar" as const,
            name: chart.title,
            // Per-column colour by SIGN, carried on the datum rather than by a
            // callback: two columns of the same height on either side of zero
            // are two different facts, and the axis crossing is the only other
            // thing on the canvas saying so.
            data: chart.points.map((point) => ({
              value: point.amount_cents,
              itemStyle: {
                color: point.amount_cents < 0 ? tokens.negative : tokens.positive,
              },
            })),
            itemStyle: { borderRadius: [4, 4, 0, 0] },
          }
        : {
            type: "line" as const,
            ...LINE_SMOOTHING,
            name: chart.title,
            data: values,
            showSymbol: false,
            lineStyle: { width: 2, color: tokens.accentStrong },
            itemStyle: { color: tokens.accentStrong },
            areaStyle: { opacity: 0.22, color: tokens.accentStrong },
          },
    ],
    backgroundColor: tokens.surfaceStrong,
  };
}

/**
 * The key. It names what the colours mean, and it names only the ones actually
 * on the canvas: a series that never goes negative gets no "dépense" entry
 * pointing at a colour nobody painted.
 */
export function answerLegend(chart: ChatChart, theme: Resolved): ChartKeyEntry[] {
  const tokens = chartTokens(theme);
  if (chart.kind === "line") {
    return [{ key: "positive", name: "Solde projeté", color: tokens.accentStrong }];
  }
  const entries: ChartKeyEntry[] = [];
  if (chart.points.some((point) => point.amount_cents < 0)) {
    entries.push({ key: "negative", name: "Sortie d'argent", color: tokens.negative });
  }
  if (chart.points.some((point) => point.amount_cents >= 0)) {
    entries.push({ key: "positive", name: "Entrée d'argent", color: tokens.positive });
  }
  return entries;
}

/** The CSV behind the chart: the exact points, nothing derived. */
export function buildAnswerExportRows(chart: ChatChart): ChartExportRow[] {
  return chart.points.map((point) => ({
    Période: point.label,
    Montant: formatCents(point.amount_cents, { signed: true }),
  }));
}

export function AnswerChart({ chart }: { chart: ChatChart }) {
  const { resolved } = useTheme();

  // Nothing at all rather than an axis with nothing on it. What to say instead
  // is the answer's own sentence, which is already on screen above this.
  if (chart.points.length === 0) return null;

  const total = chart.points.reduce((sum, point) => sum + point.amount_cents, 0);
  const label =
    chart.kind === "bars"
      ? `${chart.title} : ${chart.points.length} colonnes, de ${chart.points[0].label} à ` +
        `${chart.points[chart.points.length - 1].label}, pour un total de ` +
        `${formatCents(total, { signed: true })}.` +
        (crossesZero(chart) ? " La série passe de part et d'autre de zéro." : "")
      : `${chart.title} : ${chart.points.length} mois, de ` +
        `${formatCents(chart.points[0].amount_cents, { signed: true })} à ` +
        `${formatCents(chart.points[chart.points.length - 1].amount_cents, { signed: true })}.`;

  return (
    <>
      <ChartKey entries={answerLegend(chart, resolved)} />
      <Chart
        option={buildAnswerOption(chart, resolved)}
        height={260}
        ariaLabel={label}
        dataForExport={{
          filename: "reponse",
          headers: ["Période", "Montant"],
          rows: buildAnswerExportRows(chart),
        }}
      />
    </>
  );
}
