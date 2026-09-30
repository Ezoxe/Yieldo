import { describe, expect, it } from "vitest";

import { formatCents } from "../design/theme";
import { buildCategoryMonthsOption } from "./CategoryMonthsChart";
import { chartTokens } from "./theme";

const series = [
  { month: "2026-06", spent_cents: -24000, count: 7, complete: true },
  { month: "2026-07", spent_cents: -41000, count: 9, complete: true },
  { month: "2026-08", spent_cents: -30000, count: 1, complete: true },
  { month: "2026-09", spent_cents: -26200, count: 9, complete: false },
];

type Bar = { value: number; itemStyle: { color: string; opacity: number } };
type BarSeries = { data: Bar[]; markLine?: { data: Array<{ yAxis: number }> } };

function barSeries(averageCents: number | null, current = "2026-08"): BarSeries {
  const { option } = buildCategoryMonthsOption(series, current, averageCents, chartTokens("dark"));
  return (option.series as BarSeries[])[0];
}

describe("buildCategoryMonthsOption", () => {
  it("draws one bar per month, as a positive magnitude in cents", () => {
    expect(barSeries(null).data.map((bar) => bar.value)).toEqual([24000, 41000, 30000, 26200]);
  });

  it("sets the month on screen apart from the others", () => {
    const bars = barSeries(null).data;
    expect(bars[2].itemStyle.color).not.toBe(bars[0].itemStyle.color);
    expect(bars[2].itemStyle.opacity).toBe(1);
    expect(bars[0].itemStyle.opacity).toBeLessThan(1);
  });

  it("draws the mean as a line when there is one, and none otherwise", () => {
    expect(barSeries(-31667).markLine?.data).toEqual([{ yAxis: 31667 }]);
    expect(barSeries(null).markLine).toBeUndefined();
  });

  it("says in the tooltip what a month cost, in how many operations, and when it is incomplete", () => {
    const { option } = buildCategoryMonthsOption(series, "2026-09", null, chartTokens("dark"));
    const tooltip = option.tooltip as { formatter: (params: unknown) => string };
    const september = tooltip.formatter([{ dataIndex: 3 }]);
    expect(september).toContain("septembre 2026");
    expect(september).toContain(formatCents(26200));
    expect(september).toContain("9 opérations");
    expect(september).toContain("mois incomplet");
    expect(tooltip.formatter([{ dataIndex: 2 }])).toContain("1 opération");
  });

  it("exports the months in euros, never raw cents", () => {
    const { exportRows } = buildCategoryMonthsOption(series, "2026-09", null, chartTokens("dark"));
    expect(exportRows[0]).toEqual({ Mois: "juin 2026", Dépense: formatCents(24000) });
  });
});
