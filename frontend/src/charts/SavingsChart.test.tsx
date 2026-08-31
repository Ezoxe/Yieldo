import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "../app/ThemeProvider";
import { formatCents } from "../design/theme";
import type { SavingsSimulation } from "../lib/types";
import {
  SavingsChart,
  buildSavingsExportRows,
  buildSavingsOption,
  savingsLegend,
} from "./SavingsChart";

/**
 * A real answer from POST /api/simulators/epargne: 1 000 € put aside, then
 * −746,19 € a month — the operator's own measured capacity — at 3,00 % over six
 * months. **The balance crosses zero at month 2.** This is the exact shape the
 * `samesign` stacking default destroys, so it is the fixture every assertion
 * below runs on.
 */
const WITHDRAWAL: SavingsSimulation = {
  initial_cents: 100000,
  monthly_cents: -74619,
  annual_rate_bps: 300,
  months: 6,
  final_cents: -347400,
  contributed_cents: -447714,
  interest_cents: 314,
  points: [
    { month: 1, contributed_cents: -74619, interest_cents: 250, balance_cents: 25631 },
    { month: 2, contributed_cents: -149238, interest_cents: 314, balance_cents: -48924 },
    { month: 3, contributed_cents: -223857, interest_cents: 314, balance_cents: -123543 },
    { month: 4, contributed_cents: -298476, interest_cents: 314, balance_cents: -198162 },
    { month: 5, contributed_cents: -373095, interest_cents: 314, balance_cents: -272781 },
    { month: 6, contributed_cents: -447714, interest_cents: 314, balance_cents: -347400 },
  ],
};

/** The same endpoint on a plain savings plan with nothing put aside first. */
const CONTRIBUTING: SavingsSimulation = {
  initial_cents: 0,
  monthly_cents: 10000,
  annual_rate_bps: 1200,
  months: 3,
  final_cents: 30301,
  contributed_cents: 30000,
  interest_cents: 301,
  points: [
    { month: 1, contributed_cents: 10000, interest_cents: 0, balance_cents: 10000 },
    { month: 2, contributed_cents: 20000, interest_cents: 100, balance_cents: 20100 },
    { month: 3, contributed_cents: 30000, interest_cents: 301, balance_cents: 30301 },
  ],
};

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

describe("buildSavingsOption", () => {
  it("stacks with stackStrategy 'all' on every series", () => {
    // Not a guard here — a REQUIREMENT. `contributed_cents` is negative on this
    // fixture from month 1, and under ECharts' default `"samesign"` the band
    // would refuse to chain onto the positive initial amount below it and fall
    // back to a zero floor (dataStack.js:87,115-118), drawing a plan that
    // reaches −3 474,00 € as one that flattens at zero.
    const option = buildSavingsOption(WITHDRAWAL, "light");
    const series = option.series as Array<Record<string, unknown>>;
    for (const item of series) {
      expect(item.stack).toBe("solde");
      expect(item.stackStrategy).toBe("all");
    }
  });

  it("stacks to the exact balance at every month, below zero included", () => {
    const option = buildSavingsOption(WITHDRAWAL, "light");
    const series = option.series as Array<{ data: number[] }>;
    for (const [index, point] of WITHDRAWAL.points.entries()) {
      const stacked = series.reduce((sum, item) => sum + item.data[index], 0);
      expect(stacked).toBe(point.balance_cents);
    }
    // And the crossing itself is in the data, not smoothed away.
    expect(series.reduce((sum, item) => sum + item.data[1], 0)).toBeLessThan(0);
  });

  it("keeps a withdrawal negative rather than plotting its magnitude", () => {
    const option = buildSavingsOption(WITHDRAWAL, "light");
    const series = option.series as Array<{ name: string; data: number[] }>;
    const contributions = series.find((s) => s.name === "Versements cumulés");
    expect(contributions?.data).toEqual([
      -74619, -149238, -223857, -298476, -373095, -447714,
    ]);
  });

  it("names the starting amount as its own band when there is one", () => {
    const series = buildSavingsOption(WITHDRAWAL, "light").series as Array<{ name: string }>;
    expect(series.map((s) => s.name)).toEqual([
      "Mise de départ",
      "Versements cumulés",
      "Intérêts cumulés",
    ]);
  });

  it("drops the starting band when nothing was put aside first", () => {
    // A band of constant zero is a legend entry pointing at nothing.
    const series = buildSavingsOption(CONTRIBUTING, "light").series as Array<{ name: string }>;
    expect(series.map((s) => s.name)).toEqual(["Versements cumulés", "Intérêts cumulés"]);
    const key = savingsLegend(CONTRIBUTING, "light");
    expect(key.map((e) => e.name)).toEqual(["Versements cumulés", "Intérêts cumulés"]);
  });

  it("puts no legend inside the canvas, where it could reach the plot", () => {
    expect(buildSavingsOption(WITHDRAWAL, "light").legend).toBeUndefined();
  });

  it("reserves the last x-axis label's overhang on the right", () => {
    const option = buildSavingsOption(WITHDRAWAL, "light");
    expect((option.grid as { right: number }).right).toBeGreaterThanOrEqual(24);
  });
});

describe("SavingsChart", () => {
  it("says where the plan ends, sign and all, in its description", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    render(
      <ThemeProvider>
        <SavingsChart projection={WITHDRAWAL} />
      </ThemeProvider>,
    );
    // Through `formatCents`, not a literal: the thousands separator it emits is
    // a narrow no-break space, which a hand-typed expectation gets wrong.
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain(
      formatCents(-347400, { signed: true }),
    );
  });

  it("draws nothing at all rather than an empty axis on an empty projection", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    const { container } = render(
      <ThemeProvider>
        <SavingsChart projection={{ ...WITHDRAWAL, points: [] }} />
      </ThemeProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("exports the balance beside the parts that make it up", () => {
    const rows = buildSavingsExportRows(WITHDRAWAL);
    expect(rows[1]).toEqual({
      Mois: 2,
      "Mise de départ": formatCents(100000),
      "Versements cumulés": formatCents(-149238),
      "Intérêts cumulés": formatCents(314),
      Solde: formatCents(-48924),
    });
  });
});
