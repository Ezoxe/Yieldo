import type { EChartsOption } from "echarts";

import { useTheme } from "../app/ThemeProvider";
import { formatCents, formatCompactCents } from "../design/theme";
import type { ForecastMonth } from "../lib/types";
import { Chart, type ChartExportRow } from "./Chart";
import { type ChartTokens, chartTokens } from "./theme";

/** "2026-09" → "sept. 2026". */
export function monthAxisLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("fr-FR", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function monthLongLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export interface ForecastOptionResult {
  option: EChartsOption;
  ariaLabel: string;
  exportRows: ChartExportRow[];
}

/**
 * A P10/P50/P90 fan, never a single line.
 *
 * The band is drawn the standard ECharts way: an invisible series carrying
 * P10, and a second stacked on top of it carrying the band's *height*
 * (P90 − P10), not P90 itself. Stacking absolute values would draw the band
 * from P10 to (P10 + P90) and put the shaded region roughly twice as high as
 * the truth.
 *
 * The median is dashed on purpose. `charts/theme.ts` reserves solid strokes
 * for measured reference lines and dashes for anything projected; every
 * value on this chart is projected.
 */
export function buildForecastOption(
  months: ForecastMonth[],
  thresholdCents: number,
  tokens: ChartTokens,
): ForecastOptionResult {
  const labels = months.map((month) => monthAxisLabel(month.key));
  const breach = months.find((month) => month.below_threshold);

  const option: EChartsOption = {
    legend: {
      data: ["Intervalle P10–P90", "Solde projeté (médiane)"],
      top: 0,
      // These two labels are longer than any other chart's legend in this
      // app (French, and there are two of them) -- reserving the export
      // button's own width on the right lets ECharts wrap the second entry
      // onto its own line on a narrow viewport instead of the button's
      // opaque background silently covering it.
      right: 84,
    },
    grid: { left: 8, right: 8, top: 56, bottom: 32, containLabel: true },
    xAxis: { type: "category", data: labels, boundaryGap: false },
    yAxis: {
      type: "value",
      axisLabel: { formatter: (value: number) => formatCompactCents(value) },
    },
    tooltip: {
      trigger: "axis",
      formatter: (params) => {
        const rows = (Array.isArray(params) ? params : [params]) as Array<{
          dataIndex?: number;
        }>;
        const index = rows[0]?.dataIndex ?? 0;
        const month = months[index];
        if (!month) return "";
        return [
          `<strong>${monthLongLabel(month.key)}</strong>`,
          `Médiane : ${formatCents(month.balance_p50_cents)}`,
          `Fourchette : ${formatCents(month.balance_p10_cents)} à ${formatCents(month.balance_p90_cents)}`,
          month.seasonal
            ? "Estimation saisonnière (même mois observé plusieurs fois)"
            : "Estimation moyenne (mois jamais observé deux fois)",
          month.below_threshold ? "Ce mois pourrait passer sous le seuil." : "",
        ]
          .filter(Boolean)
          .join("<br/>");
      },
    },
    series: [
      {
        // Invisible floor of the band. Carries P10 so the stack starts there.
        name: "P10",
        type: "line",
        stack: "confidence",
        symbol: "none",
        lineStyle: { opacity: 0 },
        areaStyle: { opacity: 0 },
        silent: true,
        data: months.map((month) => month.balance_p10_cents),
      },
      {
        name: "Intervalle P10–P90",
        type: "line",
        stack: "confidence",
        symbol: "none",
        lineStyle: { opacity: 0 },
        areaStyle: { color: tokens.accent, opacity: 0.18 },
        // Without this, ECharts' legend swatch falls back to the theme's
        // default categorical color (the palette's second entry, an orange)
        // instead of matching the area actually drawn on the chart.
        itemStyle: { color: tokens.accent },
        // The band's HEIGHT, not its top edge — see the doc comment above.
        data: months.map((month) => month.balance_p90_cents - month.balance_p10_cents),
      },
      {
        name: "Solde projeté (médiane)",
        type: "line",
        symbol: "circle",
        symbolSize: 6,
        lineStyle: { width: 2, type: "dashed", color: tokens.accentStrong },
        itemStyle: { color: tokens.accentStrong },
        z: 3,
        data: months.map((month) => month.balance_p50_cents),
        // The month a breach was first detected, called out on the median
        // line itself rather than as a fourth series — `below_threshold` is
        // computed against the LOW estimate by the engine, so this point is
        // not literally on the dashed line, but it is the first month the
        // reader should worry about.
        markPoint: breach
          ? {
              symbol: "pin",
              symbolSize: 42,
              itemStyle: { color: tokens.negative },
              // `surfaceStrong` here is doing contrast work, not surface work:
              // it is near-black in dark mode and white in light mode, which
              // is exactly the opposite-extreme text color `tokens.negative`
              // needs to clear 4.5:1 on itself -- verified by hand (5.10:1
              // dark, 6.57:1 light) since this pairing is a chart-only
              // combination `design/contrast.test.ts` does not enumerate.
              label: { color: tokens.surfaceStrong, fontSize: 10 },
              data: [
                {
                  name: "Seuil franchi",
                  coord: [labels[months.indexOf(breach)], breach.balance_p50_cents],
                  value: "!",
                },
              ],
            }
          : undefined,
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: tokens.negative, type: "solid", width: 1 },
          label: {
            formatter: `Seuil ${formatCompactCents(thresholdCents)}`,
            color: tokens.muted,
            position: "insideEndTop",
          },
          data: [{ yAxis: thresholdCents }],
        },
      },
    ],
  };

  const ariaLabel = months.length
    ? `Projection du solde sur ${months.length} mois, de ${monthLongLabel(months[0].key)} à ${monthLongLabel(months[months.length - 1].key)}. ` +
      `Médiane de ${formatCents(months[0].balance_p50_cents)} à ${formatCents(months[months.length - 1].balance_p50_cents)}, ` +
      `fourchette P10 à P90 de ${formatCents(months[months.length - 1].balance_p10_cents)} à ${formatCents(months[months.length - 1].balance_p90_cents)} en fin de période.` +
      (breach
        ? ` Le solde pourrait passer sous le seuil dès ${monthLongLabel(breach.key)}.`
        : " Le solde ne passe sous le seuil sur aucun mois projeté.")
    : "Projection du solde.";

  const exportRows: ChartExportRow[] = months.map((month) => ({
    Mois: monthAxisLabel(month.key),
    "Estimation basse": formatCents(month.balance_p10_cents),
    Médiane: formatCents(month.balance_p50_cents),
    "Estimation haute": formatCents(month.balance_p90_cents),
    Saisonnier: month.seasonal ? "oui" : "non",
  }));

  return { option, ariaLabel, exportRows };
}

interface ForecastFanChartProps {
  months: ForecastMonth[];
  thresholdCents: number;
}

export function ForecastFanChart({ months, thresholdCents }: ForecastFanChartProps) {
  const { resolved } = useTheme();

  if (months.length === 0) {
    // Never an empty plot with axes and no data: an axis with nothing on it
    // reads as "the balance is flat at zero", which is a claim. The reason
    // this is empty (too few months, no dispersion...) is the caller's own
    // `insufficient_reason` to surface, not this chart's job.
    return <p className="yd-chart-empty">Aucune projection disponible.</p>;
  }

  const { option, ariaLabel, exportRows } = buildForecastOption(
    months,
    thresholdCents,
    chartTokens(resolved),
  );

  return (
    <Chart
      option={option}
      height={340}
      ariaLabel={ariaLabel}
      dataForExport={{
        filename: "prevision-de-tresorerie",
        headers: ["Mois", "Estimation basse", "Médiane", "Estimation haute", "Saisonnier"],
        rows: exportRows,
      }}
    />
  );
}
