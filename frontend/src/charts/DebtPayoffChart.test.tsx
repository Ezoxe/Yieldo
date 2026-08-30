import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "../app/ThemeProvider";
import { formatCents } from "../design/theme";
import type { BalancePoint } from "../lib/types";
import {
  DebtPayoffChart,
  buildPayoffExportRows,
  buildPayoffOption,
  payoffLegend,
} from "./DebtPayoffChart";

const POINTS: BalancePoint[] = [
  { month: 1, on: "2026-09-30", balances_cents: { "1": 20000, "2": 80000 }, total_cents: 100000 },
  { month: 2, on: "2026-10-31", balances_cents: { "1": 0, "2": 60000 }, total_cents: 60000 },
];

const NAMES = new Map([
  [1, "Conso"],
  [2, "Auto"],
]);

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

describe("buildPayoffOption", () => {
  it("stacks with stackStrategy 'all' on every series", () => {
    // ECharts chains a stacked value onto the previous series ONLY when both
    // share the same sign (dataStack.js:87,115-118). Two charts in this
    // codebase shipped drawing negative values above zero for exactly this
    // reason. A remaining balance is never negative today, but the guard is
    // one line and its absence is invisible until it is not.
    const option = buildPayoffOption(POINTS, NAMES, "light");
    const series = option.series as Array<Record<string, unknown>>;
    expect(series).toHaveLength(2);
    for (const item of series) {
      expect(item.stack).toBe("solde");
      expect(item.stackStrategy).toBe("all");
    }
  });

  it("gives every debt a value at every month, cleared ones included", () => {
    const option = buildPayoffOption(POINTS, NAMES, "light");
    const series = option.series as Array<{ name: string; data: number[] }>;
    expect(series.map((s) => s.name)).toEqual(["Conso", "Auto"]);
    // Integer cents all the way to the axis formatter, like every other chart
    // in this app -- no euro rounding baked into the plotted data.
    expect(series[0].data).toEqual([20000, 0]);
    expect(series[1].data).toEqual([80000, 60000]);
  });

  it("labels the x axis with French months", () => {
    const option = buildPayoffOption(POINTS, NAMES, "light");
    const axis = option.xAxis as { data: string[] };
    expect(axis.data[0]).toMatch(/sept/i);
  });

  it("names a debt the caller could not name rather than dropping its band", () => {
    const option = buildPayoffOption(POINTS, new Map([[1, "Conso"]]), "dark");
    const series = option.series as Array<{ name: string }>;
    expect(series.map((s) => s.name)).toEqual(["Conso", "Dette 2"]);
  });

  it("reserves the last x-axis label's overhang on the right", () => {
    // `containLabel` subtracts a horizontal axis label's height, never its
    // width, so on a long plan the last tick sits a few pixels from the grid's
    // right edge and its label is clipped. Measured at 375px on a 52-month
    // plan before this: "déc. 2030" rendered as "déc. 20".
    const option = buildPayoffOption(POINTS, NAMES, "light");
    expect((option.grid as { right: number }).right).toBeGreaterThanOrEqual(30);
  });

  it("puts no legend inside the canvas, where it could reach the plot", () => {
    // ECharts wraps a legend onto as many rows as it needs while `grid.top`
    // stays a fixed number of pixels. Measured at 375px with three debts: the
    // third row was painted over the plot's top gridline. The key is HTML.
    const option = buildPayoffOption(POINTS, NAMES, "light");
    expect(option.legend).toBeUndefined();
  });
});

describe("payoffLegend", () => {
  it("names every band, in the series' own order and colours", () => {
    const entries = payoffLegend(POINTS, NAMES, "light");
    expect(entries.map((e) => e.name)).toEqual(["Conso", "Auto"]);
    const option = buildPayoffOption(POINTS, NAMES, "light");
    const series = option.series as Array<{ color: string }>;
    expect(entries.map((e) => e.color)).toEqual(series.map((s) => s.color));
  });
});

describe("DebtPayoffChart", () => {
  it("carries an accessible description naming both ends of the plan", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    render(
      <ThemeProvider>
        <DebtPayoffChart points={POINTS} names={NAMES} />
      </ThemeProvider>,
    );
    const figure = screen.getByRole("img");
    expect(figure.getAttribute("aria-label")).toContain("30 septembre 2026");
    expect(figure.getAttribute("aria-label")).toContain("31 octobre 2026");
  });

  it("draws nothing at all rather than an empty axis when there is no plan", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    const { container } = render(
      <ThemeProvider>
        <DebtPayoffChart points={[]} names={NAMES} />
      </ThemeProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("exports the exact integer cents, not the axis' rounded euros", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    const rows = buildPayoffExportRows(POINTS, NAMES);
    expect(rows[0]).toEqual({ Mois: "2026-09-30", Conso: formatCents(20000), Auto: formatCents(80000) });
    expect(rows[1].Conso).toBe(formatCents(0));
  });
});
