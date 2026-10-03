import type { EChartsOption } from "echarts";

import { useTheme } from "../app/ThemeProvider";
import { formatCents, formatCompactCents } from "../design/theme";
import type { Outlook } from "../lib/types";
import { Chart, type ChartExportRow } from "./Chart";
import { escapeHtml } from "./escapeHtml";
import { type ChartTokens, chartTokens } from "./theme";

/**
 * Avenir's curve: the balance day by day.
 *
 * * the band (P10–P90) as a floor plus its height, stacked -- the fan chart's
 *   technique -- and nothing when the engine says there is no band;
 * * the median on top, with the threshold marked on it;
 * * the days between the last statement and today shaded: already past, not
 *   yet imported;
 * * a point on every income and every charge of 100 € or more, named;
 * * the « Et si… » scenario, when there is one, as a dashed line of its own.
 *
 * Integer cents all the way to the axis formatter.
 */

// Below this a charge is part of the day's noise, not a landmark on the curve.
const MARKED_CHARGE_CENTS = 10_000;

/**
 * How long the curve takes to unroll the first time it is drawn: at constant
 * speed, linear — it is time passing, day after day, not a shape settling.
 * Each landmark (an income, a large charge, the low point) appears when the
 * curve reaches its day, so the reader meets them in the order they come.
 */
const UNROLL_MS = 900;

function unrollDelay(dayIndex: number, dayCount: number): number {
  if (dayIndex <= 0 || dayCount <= 1) return 0;
  return Math.round((UNROLL_MS * dayIndex) / (dayCount - 1));
}

function shortDay(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("fr-FR", {
    day: "numeric", month: "short", timeZone: "UTC",
  });
}

export function buildOutlookOption(
  outlook: Outlook,
  scenario: Outlook | null,
  tokens: ChartTokens,
): EChartsOption {
  const days = outlook.days;
  const eventsByDay = new Map<string, Outlook["events"]>();
  for (const event of outlook.events) {
    eventsByDay.set(event.on, [...(eventsByDay.get(event.on) ?? []), event]);
  }
  const marked = outlook.events.filter(
    (event) => event.amount_cents > 0 || -event.amount_cents >= MARKED_CHARGE_CENTS,
  );
  const stale = outlook.stale_days > 0 && days.length > 0;
  const dayIndex = new Map(days.map((day, index) => [day.on, index]));
  const unrolled = { animationDuration: UNROLL_MS, animationEasing: "linear" as const };
  const low = outlook.low_point;
  const landmarks = [
    ...marked.map((event) => ({
      name: event.label,
      coord: [event.on, event.balance_after_cents],
      itemStyle: { color: event.amount_cents > 0 ? tokens.positive : tokens.warning },
      day: event.on,
    })),
    ...(low
      ? [{
          name: "Point bas",
          coord: [low.on, low.p50_cents],
          symbolSize: 10,
          itemStyle: {
            color: low.p50_cents < outlook.threshold_cents ? tokens.negative : tokens.warning,
          },
          day: low.on,
        }]
      : []),
  ];

  const series: NonNullable<EChartsOption["series"]> = [];
  if (outlook.band) {
    series.push(
      {
        name: "floor", type: "line", stack: "band", stackStrategy: "all", symbol: "none",
        lineStyle: { opacity: 0 }, areaStyle: { opacity: 0 }, silent: true,
        data: days.map((day) => day.p10_cents),
        ...unrolled,
      },
      {
        name: "band", type: "line", stack: "band", stackStrategy: "all", symbol: "none",
        lineStyle: { opacity: 0 }, areaStyle: { color: tokens.accent, opacity: 0.18 },
        silent: true,
        data: days.map((day) => day.p90_cents - day.p10_cents),
        ...unrolled,
      },
    );
  }
  series.push({
    name: "median", type: "line", symbol: "none", z: 3,
    lineStyle: { width: 2, color: tokens.accentStrong },
    itemStyle: { color: tokens.accentStrong },
    data: days.map((day) => day.p50_cents),
    ...unrolled,
    markLine: {
      silent: true, symbol: "none", animation: false,
      lineStyle: { color: tokens.negative, type: "solid", width: 1 },
      label: {
        formatter: outlook.threshold_source === "alert"
          ? `Seuil ${formatCompactCents(outlook.threshold_cents)}` : "Zéro",
        color: tokens.muted, position: "insideEndTop",
      },
      data: [{ yAxis: outlook.threshold_cents }],
    },
    markArea: stale
      ? {
          silent: true,
          itemStyle: { color: tokens.muted, opacity: 0.08 },
          // From the area's left edge rightwards: centred on a strip of a few
          // days, the words ran off the chart's left edge on a phone.
          label: { show: true, formatter: "Déjà passé, pas encore importé", color: tokens.muted,
                   position: "insideTopLeft", fontSize: 10 },
          data: [[{ xAxis: days[0].on }, {
            xAxis: days[Math.min(outlook.stale_days, days.length) - 1].on }]],
        }
      : undefined,
    markPoint: {
      symbol: "circle", symbolSize: 7,
      label: { show: false },
      // Each landmark pops in when the unrolling curve reaches its day.
      animationDuration: 280,
      animationEasing: "cubicOut",
      animationDelay: (index: number) =>
        unrollDelay(dayIndex.get(landmarks[index]?.day ?? "") ?? 0, days.length),
      data: landmarks.map(({ day: _day, ...point }) => point),
    },
  });
  if (scenario !== null) {
    series.push({
      name: "scenario", type: "line", symbol: "none", z: 4,
      lineStyle: { width: 2, type: "dashed", color: tokens.warning },
      itemStyle: { color: tokens.warning },
      data: scenario.days.map((day) => day.p50_cents),
    });
  }

  return {
    grid: { left: 8, right: 16, top: 24, bottom: 8, containLabel: true },
    xAxis: {
      type: "category", boundaryGap: false, data: days.map((day) => day.on),
      axisLabel: { formatter: (value: string) => shortDay(value) },
    },
    yAxis: { type: "value", axisLabel: { formatter: (value: number) => formatCompactCents(value) } },
    tooltip: {
      trigger: "axis",
      formatter: (params) => {
        const rows = (Array.isArray(params) ? params : [params]) as Array<{ dataIndex?: number }>;
        const day = days[rows[0]?.dataIndex ?? 0];
        if (!day) return "";
        const lines = [`<strong>${escapeHtml(shortDay(day.on))}</strong>`,
          `Solde prévu : ${formatCents(day.p50_cents, { signed: true })}`];
        if (outlook.band) {
          lines.push(`Fourchette : ${formatCents(day.p10_cents, { signed: true })} à ${formatCents(day.p90_cents, { signed: true })}`);
        }
        const other = scenario?.days[rows[0]?.dataIndex ?? 0];
        if (other) lines.push(`Avec le scénario : ${formatCents(other.p50_cents, { signed: true })}`);
        for (const event of eventsByDay.get(day.on) ?? []) {
          lines.push(`${escapeHtml(event.label)} : ${formatCents(event.amount_cents, { signed: true })}`);
        }
        return lines.join("<br/>");
      },
    },
    series,
  };
}

export function OutlookChart({ outlook, scenario = null }: {
  outlook: Outlook;
  scenario?: Outlook | null;
}) {
  const { resolved } = useTheme();
  const option = buildOutlookOption(outlook, scenario, chartTokens(resolved));
  const first = outlook.days[0];
  const last = outlook.days[outlook.days.length - 1];
  const ariaLabel = first && last
    ? `Solde prévu jour après jour du ${shortDay(first.on)} au ${shortDay(last.on)} : de ` +
      `${formatCents(first.p50_cents)} à ${formatCents(last.p50_cents)}` +
      (outlook.low_point
        ? `, point bas ${formatCents(outlook.low_point.p50_cents)} le ${shortDay(outlook.low_point.on)}.`
        : ".")
    : "Solde prévu jour après jour.";
  const rows: ChartExportRow[] = outlook.days.map((day) => ({
    Jour: day.on,
    "Basse (P10)": formatCents(day.p10_cents),
    "Médiane": formatCents(day.p50_cents),
    "Haute (P90)": formatCents(day.p90_cents),
  }));
  return (
    <Chart
      memoryKey="chart.outlook"
      option={option}
      height={300}
      ariaLabel={ariaLabel}
      dataForExport={{ filename: "avenir-solde-prevu", headers: ["Jour", "Basse (P10)", "Médiane", "Haute (P90)"], rows }}
    />
  );
}
