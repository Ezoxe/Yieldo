import type { EChartsOption } from "echarts";

import { useTheme } from "../app/ThemeProvider";
import { frenchDate } from "../design/EmptyState";
import { formatCents, formatCompactCents } from "../design/theme";
import type { NetWorthPoint } from "../lib/types";
import { Chart, type ChartExportRow } from "./Chart";
import { ChartKey, type ChartKeyEntry } from "./ChartKey";
import { LINE_SMOOTHING, chartTokens, type Resolved } from "./theme";

/** Two readings make a line; one is a dot, and a dot is not a history. */
export const MIN_NET_WORTH_POINTS = 2;

function axisLabel(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("fr-FR", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
}

/**
 * Net worth, day by day, from the snapshots the route wrote on the days
 * somebody looked. One line, the net; the assets and the debts are in the
 * tooltip and the CSV, where there is room to read three figures.
 *
 * The axis is fitted to the data, unlike the health score's: net worth has
 * no natural scale, and a line pinned to zero on a 120 000 EUR household
 * would flatten a 4 000 EUR month into nothing. A zero line is drawn when
 * the range crosses it, so a household that owes more than it owns sees the
 * side it is on.
 */
export function buildNetWorthOption(history: NetWorthPoint[], theme: Resolved): EChartsOption {
  const tokens = chartTokens(theme);
  const crossesZero =
    history.some((point) => point.net_cents < 0) && history.some((point) => point.net_cents > 0);

  return {
    grid: { left: 8, right: 28, top: 32, bottom: 8, containLabel: true },
    tooltip: {
      trigger: "axis",
      formatter: (params) => {
        const rows = (Array.isArray(params) ? params : [params]) as Array<{ dataIndex?: number }>;
        const point = history[rows[0]?.dataIndex ?? 0];
        if (!point) return "";
        return (
          `<strong>${frenchDate(point.taken_on)}</strong><br/>` +
          `Patrimoine net : <strong>${formatCents(point.net_cents)}</strong><br/>` +
          `Actifs : ${formatCents(point.assets_cents)} · Dettes : ${formatCents(point.debts_cents)}`
        );
      },
    },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: history.map((point) => axisLabel(point.taken_on)),
    },
    yAxis: {
      type: "value",
      scale: true,
      axisLabel: { formatter: (value: number) => formatCompactCents(value) },
    },
    series: [
      {
        type: "line",
        ...LINE_SMOOTHING,
        name: "Patrimoine net",
        showSymbol: true,
        symbolSize: 7,
        lineStyle: { width: 1.8 },
        areaStyle: { opacity: 0.18 },
        color: tokens.accent,
        data: history.map((point) => point.net_cents),
        ...(crossesZero
          ? {
              markLine: {
                silent: true,
                symbol: "none",
                lineStyle: { color: tokens.negative, type: "dashed" as const },
                label: { formatter: "Zéro", color: tokens.muted },
                data: [{ yAxis: 0 }],
              },
            }
          : {}),
      },
    ],
    backgroundColor: tokens.surfaceStrong,
  };
}

export function netWorthKey(theme: Resolved): ChartKeyEntry[] {
  return [{ key: "net", name: "Patrimoine net", color: chartTokens(theme).accent }];
}

export function buildNetWorthRows(history: NetWorthPoint[]): ChartExportRow[] {
  return history.map((point) => ({
    Date: frenchDate(point.taken_on),
    "Patrimoine net": formatCents(point.net_cents),
    Actifs: formatCents(point.assets_cents),
    Dettes: formatCents(point.debts_cents),
  }));
}

export function NetWorthChart({ history }: { history: NetWorthPoint[] }) {
  const { resolved } = useTheme();
  if (history.length < MIN_NET_WORTH_POINTS) return null;

  const first = history[0];
  const last = history[history.length - 1];
  return (
    <>
      <ChartKey entries={netWorthKey(resolved)} />
      <Chart
        option={buildNetWorthOption(history, resolved)}
        height={240}
        ariaLabel={
          `${history.length} relevés du patrimoine net, du ${frenchDate(first.taken_on)} au ` +
          `${frenchDate(last.taken_on)}. Dernier : ${formatCents(last.net_cents)}.`
        }
        dataForExport={{
          filename: "patrimoine-net",
          headers: ["Date", "Patrimoine net", "Actifs", "Dettes"],
          rows: buildNetWorthRows(history),
        }}
      />
    </>
  );
}
