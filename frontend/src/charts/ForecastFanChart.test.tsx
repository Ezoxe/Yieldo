import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "../app/ThemeProvider";
import type { ForecastMonth } from "../lib/types";
import { buildForecastOption, ForecastFanChart, monthAxisLabel } from "./ForecastFanChart";
import { chartTokens } from "./theme";

function month(key: string, p10: number, p50: number, p90: number, breached = false): ForecastMonth {
  const [year, m] = key.split("-").map(Number);
  return {
    key,
    start: `${key}-01`,
    end: `${key}-28`,
    recurring_cents: -78000,
    residual_cents: -20000,
    net_p50_cents: -98000,
    balance_p10_cents: p10,
    balance_p50_cents: p50,
    balance_p90_cents: p90,
    below_threshold: breached,
    seasonal: m === 12 && year > 0,
  };
}

const months = [
  month("2026-09", 80000, 100000, 120000),
  month("2026-10", 40000, 90000, 140000),
  month("2026-11", -20000, 80000, 180000, true),
];

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  });
});

describe("monthAxisLabel", () => {
  it("writes a French abbreviated month and year", () => {
    // ECharts' own `nameMap: "fr"` is a no-op without a registered locale — the
    // spending calendar shipped twelve English month names for exactly that
    // reason. Labels are supplied outright here.
    expect(monthAxisLabel("2026-09")).toMatch(/sept/i);
    expect(monthAxisLabel("2026-09")).toContain("2026");
  });
});

describe("buildForecastOption", () => {
  const tokens = chartTokens("dark");

  it("draws a band and a median, never a single line", () => {
    const { option } = buildForecastOption(months, 0, tokens);
    const series = option.series as Array<{ name?: string; data?: number[] }>;
    // Three series: the invisible P10 floor, the stacked band, the P50 line.
    expect(series).toHaveLength(3);
    const median = series.find((s) => s.name === "Solde projeté (médiane)");
    expect(median?.data).toEqual([100000, 90000, 80000]);
  });

  it("insets the extreme category ticks so the last month's label cannot overflow the grid", () => {
    // `boundaryGap: false` puts the first and last ticks exactly ON the grid's
    // edges, and a label centred on the last tick then overflows to the right
    // by half its own width -- "janv. 2027" rendered as "janv. 20" at 1440,
    // reproduced in a browser (see the task 19 report). `containLabel` does
    // not rescue it: `coord/cartesian/Grid.js:150` subtracts only the label's
    // HEIGHT for a horizontal axis. The category default insets every tick by
    // half a band, which is what the two sibling charts already do.
    const { option } = buildForecastOption(months, 0, tokens);
    const xAxis = option.xAxis as { type?: string; boundaryGap?: boolean };
    expect(xAxis.type).toBe("category");
    expect(xAxis.boundaryGap).not.toBe(false);
  });

  it("stacks the band as a height above P10, not as an absolute P90", () => {
    const { option } = buildForecastOption(months, 0, tokens);
    const series = option.series as Array<{ name?: string; data?: number[] }>;
    const band = series.find((s) => s.name === "Intervalle P10–P90");
    expect(band?.data).toEqual([40000, 100000, 200000]);
  });

  it("keeps the band anchored on P10 when P10 is negative", () => {
    // The last fixture month has P10 = -20 000 c and a positive height. Under
    // ECharts' DEFAULT `stackStrategy: "samesign"` a stacked value is only
    // chained onto the previous series' when both share a sign, so a negative
    // floor plus a positive height is not chained at all: the band would be
    // drawn from the axis' zero baseline instead of from P10, erasing exactly
    // the overdraft the P10 estimate exists to warn about. Only "all" stacks
    // unconditionally. This pins the option; the drawn result was verified in
    // a browser (see the task 13 report).
    const { option } = buildForecastOption(months, 0, tokens);
    const series = option.series as Array<{ stack?: string; stackStrategy?: string }>;
    const stacked = series.filter((s) => s.stack === "confidence");
    expect(stacked).toHaveLength(2);
    for (const s of stacked) expect(s.stackStrategy).toBe("all");
    expect(months.some((m) => m.balance_p10_cents < 0)).toBe(true);
  });

  it("paints the band's legend swatch with the same wash as the band", () => {
    // ECharts' legend itemStyle defaults every property to "inherit" and reads
    // them off the series' `itemStyle` -- never off `areaStyle`, which is where
    // the band's real translucency lives. Without a matching opacity the key
    // shows a solid teal block for a pale wash.
    const { option } = buildForecastOption(months, 0, tokens);
    const series = option.series as Array<{
      name?: string;
      areaStyle?: { color?: string; opacity?: number };
      itemStyle?: { color?: string; opacity?: number };
    }>;
    const band = series.find((s) => s.name === "Intervalle P10–P90");
    expect(band?.itemStyle?.color).toBe(band?.areaStyle?.color);
    expect(band?.itemStyle?.opacity).toBe(band?.areaStyle?.opacity);
  });

  it("gives the median's legend entry the series' own mark, not a block", () => {
    // `charts/theme.ts` forces `legend.icon: "roundRect"` app-wide, which would
    // render both entries as near-identical teal blocks (accent against
    // accentStrong is ~1.32:1). "inherit" routes this entry through
    // LineSeriesModel.getLegendIcon, which draws the dashed stroke and its
    // round symbol -- so the two entries differ by shape, not only by hue.
    const { option } = buildForecastOption(months, 0, tokens);
    const data = (option.legend as { data?: Array<{ name?: string; icon?: string }> }).data ?? [];
    expect(data.find((entry) => entry.name === "Solde projeté (médiane)")?.icon).toBe("inherit");
    expect(data.find((entry) => entry.name === "Intervalle P10–P90")?.icon).toBeUndefined();
  });

  it("marks the threshold so the reader can see where the floor is", () => {
    const { option } = buildForecastOption(months, 0, tokens);
    const series = option.series as Array<{ name?: string; markLine?: unknown }>;
    const median = series.find((s) => s.name === "Solde projeté (médiane)");
    expect(median?.markLine).toBeDefined();
  });

  it("describes the projection and its uncertainty in the aria label", () => {
    const { ariaLabel } = buildForecastOption(months, 0, tokens);
    expect(ariaLabel).toMatch(/projection/i);
    expect(ariaLabel).toMatch(/P10/);
    expect(ariaLabel).toMatch(/P90/);
  });

  it("names the first month that could fall under the threshold", () => {
    const { ariaLabel } = buildForecastOption(months, 0, tokens);
    expect(ariaLabel).toMatch(/novembre 2026/i);
  });

  it("says plainly when no month breaches the threshold", () => {
    const safeMonths = months.map((m) => ({ ...m, below_threshold: false }));
    const { ariaLabel } = buildForecastOption(safeMonths, -1_000_000, tokens);
    expect(ariaLabel).not.toMatch(/pourrait passer sous le seuil/i);
  });

  it("exports the three bounds per month, not just the median", () => {
    const { exportRows } = buildForecastOption(months, 0, tokens);
    expect(exportRows).toHaveLength(3);
    expect(Object.keys(exportRows[0])).toEqual(
      expect.arrayContaining(["Mois", "Estimation basse", "Médiane", "Estimation haute"]),
    );
  });
});

describe("ForecastFanChart", () => {
  it("says so plainly rather than drawing an empty plot", () => {
    render(
      <ThemeProvider>
        <ForecastFanChart months={[]} thresholdCents={0} />
      </ThemeProvider>,
    );
    expect(screen.getByText(/Aucune projection/)).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("renders a labelled chart when there is something to draw", () => {
    render(
      <ThemeProvider>
        <ForecastFanChart months={months} thresholdCents={0} />
      </ThemeProvider>,
    );
    expect(screen.getByRole("img", { name: /projection/i })).toBeInTheDocument();
  });
});
