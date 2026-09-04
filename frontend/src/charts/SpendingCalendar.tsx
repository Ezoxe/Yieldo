import type { EChartsOption } from "echarts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";

import { useTheme } from "../app/ThemeProvider";
import { formatCents, formatCompactCents } from "../design/theme";
import type { CalendarPoint } from "../lib/types";
import { Chart, type ChartExportRow } from "./Chart";
import { type ChartTokens, chartTokens, sequentialRamp } from "./theme";

interface SpendingCalendarProps {
  points: CalendarPoint[];
}

/** The whole months the drawn grid covers, as ISO days. */
export interface CalendarSpan {
  from: string;
  to: string;
}

export interface CalendarOptionResult {
  option: EChartsOption;
  exportRows: ChartExportRow[];
  /** The day cell's side, so the caller can size the chart box around it. */
  cell: number;
}

function frenchDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

function frenchDay(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

// ECharts resolves `nameMap: "fr"` against a locale that has to have been
// registered first; nothing registers one, so it fell back to the built-in
// English and the main screen read "Jan Feb Mar" and "S M T W T F S". The
// names are supplied outright instead, out of the same Intl formatter every
// other French date in the app comes from.
const MONTH_NAMES_FR: string[] = Array.from({ length: 12 }, (_, month) =>
  new Date(Date.UTC(2021, month, 1)).toLocaleDateString("fr-FR", {
    month: "short",
    timeZone: "UTC",
  }),
);

// Sunday-first: that is the order ECharts indexes dayLabel.nameMap in,
// regardless of which day the grid itself starts on.
const DAY_NAMES_FR = ["D", "L", "M", "M", "J", "V", "S"];

/**
 * The span the calendar should draw: the whole months the data occupies.
 *
 * Not a calendar year. The chart used to take a single `year`, so the
 * dashboard's own "Tout" preset rendered whatever year happened to be current
 * -- on a ledger running to 9 January it was a full-width panel blank for
 * eleven and a half months. Rounding out to whole months (rather than stopping
 * on the exact first and last transaction) is what keeps the month labels
 * aligned with the columns underneath them.
 */
export function calendarSpan(points: CalendarPoint[]): CalendarSpan | null {
  if (points.length === 0) return null;

  let earliest = points[0].date;
  let latest = points[0].date;
  for (const point of points) {
    // ISO-8601 days sort lexicographically, so this is a date comparison.
    if (point.date < earliest) earliest = point.date;
    if (point.date > latest) latest = point.date;
  }

  const [year, month] = latest.split("-").map(Number);
  // Day 0 of the next month is the last day of this one -- leap years included.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    from: `${earliest.slice(0, 7)}-01`,
    to: `${latest.slice(0, 7)}-${String(lastDay).padStart(2, "0")}`,
  };
}

/** Grid inset: the day-name gutter on the left, a hair of air on the right. */
const GRID_LEFT = 40;
const GRID_RIGHT = 16;

/** Roughly what "janv. 25" occupies at the chart's label size, plus air. */
const MONTH_LABEL_PX = 58;

/**
 * How many months apart the drawn month labels stand.
 *
 * The grid stretches to fill the panel, so on a phone a thirteen-month span
 * puts its months ~18px apart -- every label then overprints its neighbours
 * into an unreadable smear. One label every `step` months keeps them apart at
 * any width. A width of 0 (nothing measured yet) labels every month, which is
 * the desktop answer and the one that never hides information.
 */
export function monthLabelStep(monthCount: number, availableWidth: number): number {
  if (availableWidth <= 0 || monthCount <= 1) return 1;
  return Math.max(1, Math.ceil(MONTH_LABEL_PX / (availableWidth / monthCount)));
}

/** Whole months from `span.from` to `span.to`, inclusive. */
function monthCount(span: CalendarSpan): number {
  const [fromYear, fromMonth] = span.from.split("-").map(Number);
  const [toYear, toMonth] = span.to.split("-").map(Number);
  return (toYear - fromYear) * 12 + (toMonth - fromMonth) + 1;
}

/** The biggest a day cell is allowed to get.
 *
 * 16 for years, and it used to be 16 for everything — which is how a single
 * month ended up as five 16px squares adrift in a 1130px card, reading as a
 * rendering fault rather than as a calendar. A month has room to be drawn at
 * a size a person can actually point at; a thirteen-month span does not, and
 * `cellSizeFor` below is what tells them apart. */
const MAX_CELL = 34;

/* No floor, deliberately. A minimum cell and the promise never to draw past
   the right edge cannot both hold: 57 week-columns at even 6px need 342px, and
   a 375 viewport gives this chart 237. ECharts neither scrolls nor wraps a
   calendar — it draws past the edge and the back half of the year is simply
   gone. A 4px cell is small; a silently truncated year is wrong. */

/** Week columns the span draws, counting the part-weeks at either end. */
export function weekColumns(span: CalendarSpan, firstDayOfWeek = 1): number {
  const from = new Date(`${span.from}T00:00:00Z`);
  const to = new Date(`${span.to}T00:00:00Z`);
  const lead = (from.getUTCDay() - firstDayOfWeek + 7) % 7;
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
  return Math.ceil((lead + days) / 7);
}

/**
 * The side of one day cell — SQUARE, and sized to the span.
 *
 * Two failures to avoid, in opposite directions. Too wide: left to fill the
 * box, a one-month span turned its five columns into 200px-wide bars that
 * stopped reading as a calendar at all. Too narrow: ECharts neither scrolls
 * nor wraps a calendar, it draws past the right edge, so a fixed cell silently
 * lost the back half of a thirteen-month range on any panel under ~900px.
 *
 * So the cell takes whatever the width allows, capped at the top only. A month
 * comes out at `MAX_CELL` and reads as a wall calendar; a year on a phone comes
 * out at 4px and reads as a strip. An unmeasured width (0, which is what jsdom
 * reports) means the full cell.
 */
export function cellSizeFor(columns: number, availableWidth: number): number {
  if (availableWidth <= 0 || columns <= 0) return MAX_CELL;
  return Math.min(MAX_CELL, availableWidth / columns);
}

/**
 * How tall the chart has to be for a grid of this cell size.
 *
 * Seven weekday rows, plus the month labels above and the magnitude scale
 * below. Derived rather than fixed: a fixed 220px box was what capped the cell
 * at 20px however much room the card had.
 */
export function calendarHeightFor(cell: number): number {
  return CALENDAR_TOP + cell * 7 + CALENDAR_BOTTOM;
}

/** Room above the grid for the month labels. */
const CALENDAR_TOP = 52;
/** Room below it for the "Faible / Élevé" magnitude scale. */
const CALENDAR_BOTTOM = 46;

// Heats each day by how much was SPENT (outflow magnitude), a sequential
// (one-hue) magnitude encoding -- not net balance, which would mix a
// polarity question ("did I gain or lose that day") into what is meant to
// answer a magnitude question ("which days did I spend the most").
export function buildCalendarOption(
  points: CalendarPoint[],
  span: CalendarSpan,
  tokens: ChartTokens,
  ramp: string[],
  /** Rendered width of the chart in px; 0 until it has been measured. */
  chartWidth = 0,
): CalendarOptionResult {
  const maxOutflow = Math.max(1, ...points.map((point) => Math.abs(point.outflow_cents)));
  const crossesAYear = span.from.slice(0, 4) !== span.to.slice(0, 4);
  const months = monthCount(span);
  const available = chartWidth - GRID_LEFT - GRID_RIGHT;
  const columns = weekColumns(span);
  const cell = cellSizeFor(columns, available);
  // A grid narrower than the panel sits in the middle of it; one hugging the
  // left edge of a wide empty cell reads as a layout mistake.
  const centred = cell * columns < available;
  const step = monthLabelStep(months, cell * columns);
  const firstYear = Number(span.from.slice(0, 4));
  const firstMonth = Number(span.from.slice(5, 7));

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
      // `calculable` puts the two draggable handles on the scale, and each one
      // prints its own value: unformatted, that is a raw integer number of
      // cents on screen ("85371" for 853,71 €).
      formatter: (value) => formatCompactCents(Number(value)),
      inRange: { color: ramp },
    },
    calendar: {
      range: [span.from, span.to],
      cellSize: [cell, cell],
      left: centred ? "center" : GRID_LEFT,
      top: CALENDAR_TOP,
      splitLine: { lineStyle: { color: tokens.border } },
      itemStyle: { borderColor: tokens.surfaceStrong, borderWidth: 2, color: "transparent" },
      dayLabel: { color: tokens.muted, nameMap: DAY_NAMES_FR, firstDay: 1 },
      monthLabel: {
        color: tokens.muted,
        nameMap: MONTH_NAMES_FR,
        formatter: (params: { nameMap: string; yy: string; yyyy: string; M: number }) => {
          const index = (Number(params.yyyy) - firstYear) * 12 + (params.M - firstMonth);
          if (index % step !== 0) return "";
          // Two bare "janv." columns in one strip are indistinguishable.
          return crossesAYear ? `${params.nameMap} ${params.yy}` : params.nameMap;
        },
      },
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

  return { option, exportRows, cell };
}

/**
 * The chart's own rendered width. ECharts stretches the grid to fill it, so
 * how many month labels fit is a question only the browser can answer -- and
 * jsdom, which has no layout, answers 0, which reads as "label every month".
 */
function useChartWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    setWidth(node.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setWidth(node.clientWidth));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}

export function SpendingCalendar({ points }: SpendingCalendarProps) {
  const { resolved } = useTheme();
  const navigate = useNavigate();
  const [measureRef, chartWidth] = useChartWidth();

  // Stable across renders -- an inline object here would make Chart.tsx's
  // onEvents effect see a new identity every render and unbind/rebind the
  // click handler on every single re-render (theme change, prop tick, etc.)
  // instead of only when the navigation target logic actually changes.
  const handleDayClick = useCallback(
    (params: unknown) => {
      const point = params as { data?: [string, number] };
      const date = point.data?.[0];
      if (date) navigate(`/transactions?periode=custom&du=${date}&au=${date}`);
    },
    [navigate],
  );
  const onEvents = useMemo(() => ({ click: handleDayClick }), [handleDayClick]);

  const span = calendarSpan(points);
  if (span === null) {
    return <p className="yd-chart-empty">Aucune dépense enregistrée sur cette période.</p>;
  }

  const { option, exportRows, cell } = buildCalendarOption(
    points,
    span,
    chartTokens(resolved),
    sequentialRamp(resolved, 6),
    chartWidth,
  );

  // The days that actually carry data, which is what the reader is being told
  // about -- the grid rounds out to whole months around them.
  const first = points.reduce((min, point) => (point.date < min ? point.date : min), points[0].date);
  const last = points.reduce((max, point) => (point.date > max ? point.date : max), points[0].date);

  return (
    <div ref={measureRef}>
      <Chart
        option={option}
        height={calendarHeightFor(cell)}
        ariaLabel={`Calendrier des dépenses du ${frenchDay(first)} au ${frenchDay(last)}, un jour plus foncé signifie plus de dépenses.`}
        onEvents={onEvents}
        dataForExport={{
          filename: `calendrier-depenses-${first}-${last}`,
          headers: ["Date", "Dépensé", "Entrées", "Solde net"],
          rows: exportRows,
        }}
      />
    </div>
  );
}
