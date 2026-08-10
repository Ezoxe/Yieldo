import type { EChartsOption } from "echarts";
import { useNavigate } from "react-router";

import { useTheme } from "../app/ThemeProvider";
import { formatCents } from "../design/theme";
import type { CalendarPoint } from "../lib/types";
import { Chart, type ChartExportRow } from "./Chart";
import { type ChartTokens, chartTokens, sequentialRamp } from "./theme";

interface SpendingCalendarProps {
  points: CalendarPoint[];
  year: number;
}

export interface CalendarOptionResult {
  option: EChartsOption;
  exportRows: ChartExportRow[];
}

function frenchDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

// Heats each day by how much was SPENT (outflow magnitude), a sequential
// (one-hue) magnitude encoding -- not net balance, which would mix a
// polarity question ("did I gain or lose that day") into what is meant to
// answer a magnitude question ("which days did I spend the most").
export function buildCalendarOption(
  points: CalendarPoint[],
  year: number,
  tokens: ChartTokens,
  ramp: string[],
): CalendarOptionResult {
  const maxOutflow = Math.max(1, ...points.map((point) => Math.abs(point.outflow_cents)));

  const option: EChartsOption = {
    tooltip: {
      formatter: (params) => {
        const point = params as { data?: [string, number] };
        const [date, value] = point.data ?? ["", 0];
        return `${frenchDate(date)}<br/>Dépensé : <strong>${formatCents(-value)}</strong>`;
      },
    },
    visualMap: {
      type: "continuous",
      min: 0,
      max: maxOutflow,
      calculable: true,
      orient: "horizontal",
      left: "center",
      bottom: 0,
      text: ["Élevé", "Faible"],
      textStyle: { color: tokens.muted },
      inRange: { color: ramp },
    },
    calendar: {
      range: String(year),
      cellSize: [16, 16],
      splitLine: { lineStyle: { color: tokens.border } },
      itemStyle: { borderColor: tokens.surfaceStrong, borderWidth: 2, color: "transparent" },
      dayLabel: { color: tokens.muted, nameMap: "fr" },
      monthLabel: { color: tokens.muted, nameMap: "fr" },
      yearLabel: { show: false },
    },
    series: [
      {
        type: "heatmap",
        coordinateSystem: "calendar",
        data: points.map((point) => [point.date, Math.abs(point.outflow_cents)]),
      },
    ],
  };

  const exportRows: ChartExportRow[] = points.map((point) => ({
    Date: point.date,
    Dépensé: formatCents(point.outflow_cents),
    Entrées: formatCents(point.inflow_cents),
    "Solde net": formatCents(point.net_cents),
  }));

  return { option, exportRows };
}

export function SpendingCalendar({ points, year }: SpendingCalendarProps) {
  const { resolved } = useTheme();
  const navigate = useNavigate();

  if (points.length === 0) {
    return <p className="yd-chart-empty">Aucune dépense enregistrée en {year}.</p>;
  }

  const { option, exportRows } = buildCalendarOption(
    points,
    year,
    chartTokens(resolved),
    sequentialRamp(resolved, 6),
  );

  return (
    <Chart
      option={option}
      height={220}
      ariaLabel={`Calendrier des dépenses pour ${year}, un jour plus foncé signifie plus de dépenses.`}
      onEvents={{
        click: (params) => {
          const point = params as { data?: [string, number] };
          const date = point.data?.[0];
          if (date) navigate(`/transactions?periode=custom&du=${date}&au=${date}`);
        },
      }}
      dataForExport={{
        filename: `calendrier-depenses-${year}`,
        headers: ["Date", "Dépensé", "Entrées", "Solde net"],
        rows: exportRows,
      }}
    />
  );
}
