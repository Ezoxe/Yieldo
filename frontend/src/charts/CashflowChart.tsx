import type { EChartsOption } from "echarts";

import { useTheme } from "../app/ThemeProvider";
import { formatCents, formatCompactCents } from "../design/theme";
import type { Granularity, SeriesBucket } from "../lib/types";
import { Chart, type ChartExportRow } from "./Chart";
import { areaFade, type ChartTokens, chartTokens, LINE_SMOOTHING, zoomSlider } from "./theme";

interface CashflowChartProps {
  buckets: SeriesBucket[];
  granularity: Granularity;
}

const GRANULARITY_LABEL: Record<Granularity, string> = {
  day: "jour",
  week: "semaine",
  month: "mois",
  quarter: "trimestre",
  year: "année",
};

function bucketLabel(bucket: SeriesBucket, granularity: Granularity): string {
  const start = new Date(`${bucket.start}T00:00:00Z`);
  switch (granularity) {
    case "day":
      return start.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
    case "week":
      return `Sem. ${start.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", timeZone: "UTC" })}`;
    case "month":
      return start.toLocaleDateString("fr-FR", { month: "short", year: "numeric", timeZone: "UTC" });
    case "quarter": {
      const quarter = Math.floor(start.getUTCMonth() / 3) + 1;
      return `T${quarter} ${start.getUTCFullYear()}`;
    }
    case "year":
      return String(start.getUTCFullYear());
  }
}

export interface CashflowOptionResult {
  option: EChartsOption;
  ariaLabel: string;
  exportRows: ChartExportRow[];
}

// Deliberately a SINGLE value axis, not the dual-axis "bars + a line on a
// second scale" the task brief describes: two y-scales on one plot invent an
// alignment that isn't in the data (the dataviz skill's #1 anti-pattern).
// Inflow, outflow and net balance are all already euro amounts of comparable
// magnitude, so all three read honestly off one axis -- outflow keeps its
// true negative sign and simply extends below the zero baseline.
export function buildCashflowOption(
  buckets: SeriesBucket[],
  granularity: Granularity,
  tokens: ChartTokens,
): CashflowOptionResult {
  const labels = buckets.map((bucket) => bucketLabel(bucket, granularity));

  const option: EChartsOption = {
    legend: {
      data: [
        { name: "Entrées" },
        { name: "Sorties" },
        // `charts/theme.ts` forces `legend.icon: "roundRect"` app-wide, which
        // draws this entry as a block of `accentStrong` beside "Entrées"'
        // block of `positive` -- two teals 1.11:1 apart in the dark theme,
        // 1.37:1 in the light one, telling apart only by their labels. This is
        // a LINE over two stacked BARS, so "inherit" routes the entry through
        // LineSeriesModel.getLegendIcon and draws the mark actually on the
        // plot: the stroke and its round symbol. The two entries then differ
        // by shape, which is how they differ on the chart. Same fix, same
        // reason, as the forecast fan's median entry.
        { name: "Solde net", icon: "inherit" },
      ],
      top: 0,
      // The "Exporter" button is a DOM button absolutely positioned over this
      // chart's top-right corner; ECharts lays the legend out across the full
      // canvas width and has no idea it is there. At 375 the chart box is
      // 293px and the three entries fill it, so "Solde net" rendered
      // underneath the button's opaque background and read as
      // "Sold*Exporte*r". Reserving the button's own width lets ECharts wrap
      // the third entry onto its own line instead. Same number, same reason,
      // as ForecastFanChart's legend.
      right: 84,
    },
    grid: { left: 8, right: 8, top: 40, bottom: 64, containLabel: true },
    xAxis: { type: "category", data: labels },
    yAxis: { type: "value", axisLabel: { formatter: (value: number) => formatCompactCents(value) } },
    dataZoom: [{ type: "inside" }, zoomSlider(tokens)],
    tooltip: {
      trigger: "axis",
      valueFormatter: undefined,
      formatter: (params) => {
        const rows = (Array.isArray(params) ? params : [params]) as Array<{
          axisValueLabel?: string;
          seriesName?: string;
          value?: number;
          marker?: string;
        }>;
        const header = rows[0]?.axisValueLabel ?? "";
        const lines = rows.map(
          (row) => `${row.marker ?? ""}${row.seriesName} : <strong>${formatCents(row.value ?? 0)}</strong>`,
        );
        return [header, ...lines].join("<br/>");
      },
    },
    series: [
      {
        name: "Entrées",
        type: "bar",
        stack: "flow",
        data: buckets.map((bucket) => bucket.inflow_cents),
        // Rounded on the outer end only: the two series are stacked across the
        // zero baseline, so rounding all four corners would leave a notch
        // where they meet.
        itemStyle: { color: tokens.positive, borderRadius: [3, 3, 0, 0] },
        barMaxWidth: 22,
      },
      {
        name: "Sorties",
        type: "bar",
        stack: "flow",
        // Kept negative on purpose -- it is what makes the bar extend below
        // the zero baseline instead of a second, misleading positive block.
        data: buckets.map((bucket) => bucket.outflow_cents),
        itemStyle: { color: tokens.negative, borderRadius: [0, 0, 3, 3] },
        barMaxWidth: 22,
      },
      {
        name: "Solde net",
        type: "line",
        data: buckets.map((bucket) => bucket.net_cents),
        ...LINE_SMOOTHING,
        lineStyle: { width: 2, color: tokens.accent },
        itemStyle: { color: tokens.accent },
        areaStyle: areaFade(tokens.accent),
        // The dots are drawn on hover only. A marker on every one of thirty
        // daily buckets is a dotted line, not a series of readings; the axis
        // pointer and the tooltip are what identify a point.
        symbol: "circle",
        symbolSize: 7,
        showSymbol: false,
        z: 3,
      },
    ],
  };

  const first = buckets[0];
  const last = buckets[buckets.length - 1];
  const humanDate = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
  const ariaLabel = first
    ? `Entrées, sorties et solde net par ${GRANULARITY_LABEL[granularity]}, du ${humanDate(first.start)} au ${humanDate(last.end)}.`
    : "Entrées, sorties et solde net.";

  const exportRows: ChartExportRow[] = buckets.map((bucket, index) => ({
    Période: labels[index],
    Entrées: formatCents(bucket.inflow_cents),
    Sorties: formatCents(bucket.outflow_cents),
    "Solde net": formatCents(bucket.net_cents),
  }));

  return { option, ariaLabel, exportRows };
}

export function CashflowChart({ buckets, granularity }: CashflowChartProps) {
  const { resolved } = useTheme();

  if (buckets.length === 0) {
    return <p className="yd-chart-empty">Aucune activité sur cette période.</p>;
  }

  const { option, ariaLabel, exportRows } = buildCashflowOption(buckets, granularity, chartTokens(resolved));

  return (
    <Chart
      option={option}
      height={340}
      ariaLabel={ariaLabel}
      dataForExport={{
        filename: "flux-de-tresorerie",
        headers: ["Période", "Entrées", "Sorties", "Solde net"],
        rows: exportRows,
      }}
    />
  );
}
