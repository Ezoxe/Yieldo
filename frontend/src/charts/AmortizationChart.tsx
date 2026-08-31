import type { EChartsOption } from "echarts";

import { useTheme } from "../app/ThemeProvider";
import { formatCents, formatCompactCents } from "../design/theme";
import type { ScheduleYear } from "../lib/types";
import { Chart, type ChartExportRow } from "./Chart";
import { ChartKey, type ChartKeyEntry } from "./ChartKey";
import { type Resolved, chartTokens } from "./theme";

/** One bar per year, in the order the schedule runs. */
function yearLabel(year: ScheduleYear): string {
  return `An ${year.year}`;
}

/**
 * What each instalment actually buys, year by year: interest below, capital
 * repaid above.
 *
 * The bar is the year's total payment, split in two. A borrower reading a
 * mensualité of 554,60 € has no way to see that 245,78 € of the first one is
 * interest and 308,82 € is capital, nor that the ratio inverts over twenty
 * years — which is the single most consequential fact about a long loan.
 *
 * **`stackStrategy: "all"` on both series, without exception.** ECharts'
 * default is `"samesign"`, which chains a stacked value onto the previous
 * series only when the two share a sign; where it refuses,
 * `stackedOverDimension` is left NaN and the series falls back to `valueStart`
 * — zero. Two charts in this codebase shipped with that defect, one of them
 * drawing the operator's −2 209,63 € year as a bar rising above zero for two
 * whole phases. Interest and capital are never negative, so here it is a guard
 * rather than a fix; it costs one line and it is the line whose absence nobody
 * notices.
 *
 * **Years, not months.** A forty-year mortgage is 480 instalments; drawn one
 * bar per month they are sub-pixel and unreadable, and the roll-up
 * `api/simulators._yearly_rollup` performs is exactly this chart's unit. The
 * months are still reachable — the schedule table beside it walks them a year
 * at a time.
 *
 * Integer cents travel all the way to the axis formatter, like every other
 * chart in this app: `formatCompactCents` and `formatCents` are the display
 * boundary, and rounding the plotted data to euros first would throw away the
 * exactness the whole phase is built on.
 */
export function buildAmortizationOption(years: ScheduleYear[], theme: Resolved): EChartsOption {
  const tokens = chartTokens(theme);
  const entries = amortizationLegend(theme);

  return {
    // `top: 32` clears the Exporter button, which `Chart.css` floats over the
    // canvas' top-right corner. There is no ECharts legend to leave room for:
    // see `ChartKey.css` for why this chart draws its own in HTML.
    //
    // `right: 24` is the last x-axis label's overhang. `containLabel` subtracts
    // a horizontal label's HEIGHT and never its width
    // (coord/cartesian/Grid.js:150), so the last tick is contained only by the
    // half-band a category axis insets it by — and that half-band shrinks
    // towards zero as the bar count grows. At 375px on a 40-year mortgage the
    // half-band is ~4px while "An 40" is ~30px wide, so ~11px overhangs; 24
    // covers it with room for a three-digit year this axis will never see.
    grid: { left: 8, right: 24, top: 32, bottom: 8, containLabel: true },
    tooltip: {
      trigger: "axis",
      formatter: (params) => {
        const rows = (Array.isArray(params) ? params : [params]) as Array<{ dataIndex?: number }>;
        const index = rows[0]?.dataIndex ?? 0;
        const year = years[index];
        if (!year) return "";
        return [
          `<strong>${yearLabel(year)}</strong>`,
          `Intérêts : ${formatCents(year.interest_cents)}`,
          `Capital remboursé : ${formatCents(year.principal_cents)}`,
          // The sum, said outright: the whole point of the stack is that the
          // two parts are one instalment, and a reader should not have to add
          // them in their head to check.
          `Total versé : ${formatCents(year.interest_cents + year.principal_cents)}`,
          `Capital restant dû : ${formatCents(year.remaining_cents)}`,
        ].join("<br/>");
      },
    },
    xAxis: { type: "category", data: years.map(yearLabel) },
    yAxis: {
      type: "value",
      axisLabel: { formatter: (value: number) => formatCompactCents(value) },
    },
    series: [
      {
        type: "bar" as const,
        name: entries[0].name,
        stack: "annuite",
        stackStrategy: "all" as const,
        color: entries[0].color,
        data: years.map((year) => year.interest_cents),
      },
      {
        type: "bar" as const,
        name: entries[1].name,
        stack: "annuite",
        stackStrategy: "all" as const,
        color: entries[1].color,
        data: years.map((year) => year.principal_cents),
      },
    ],
    backgroundColor: tokens.surfaceStrong,
  };
}

/**
 * The key, in the same order and the same colours the series are drawn in.
 *
 * Interest takes the warning tone and capital the accent: one is the price of
 * borrowing and the other is the debt actually shrinking, and a reader glancing
 * at the chart should be able to tell which is which before reading a word.
 */
export function amortizationLegend(theme: Resolved): ChartKeyEntry[] {
  const tokens = chartTokens(theme);
  return [
    { key: "interest", name: "Intérêts", color: tokens.warning },
    { key: "principal", name: "Capital remboursé", color: tokens.accent },
  ];
}

/** The CSV behind the chart: the exact figures each bar was drawn from. */
export function buildAmortizationExportRows(years: ScheduleYear[]): ChartExportRow[] {
  return years.map((year) => ({
    Année: yearLabel(year),
    Intérêts: formatCents(year.interest_cents),
    "Capital remboursé": formatCents(year.principal_cents),
    "Capital restant dû": formatCents(year.remaining_cents),
  }));
}

interface AmortizationChartProps {
  years: ScheduleYear[];
  /** The loan's stated term, for the description. Not `years.length * 12`: a
   *  term that is not a whole number of years, or a loan repaid early by an
   *  overshooting instalment, would be misreported. */
  months: number;
  totalInterestCents: number;
}

export function AmortizationChart({
  years,
  months,
  totalInterestCents,
}: AmortizationChartProps) {
  const { resolved } = useTheme();

  // Nothing at all rather than an axis with no bars on it: an empty plot reads
  // as "this loan costs nothing", which is a claim. Whether there is a loan to
  // draw, and why there is not, is the calling screen's sentence to write.
  if (years.length === 0) return null;

  return (
    <>
      <ChartKey entries={amortizationLegend(resolved)} />
      <Chart
        option={buildAmortizationOption(years, resolved)}
        height={300}
        ariaLabel={
          `Ce que chaque année de remboursement paie, sur ${months} mois : ` +
          `intérêts et capital empilés. ${formatCents(totalInterestCents)} d'intérêts au total.`
        }
        dataForExport={{
          filename: "amortissement",
          headers: ["Année", "Intérêts", "Capital remboursé", "Capital restant dû"],
          rows: buildAmortizationExportRows(years),
        }}
      />
    </>
  );
}
