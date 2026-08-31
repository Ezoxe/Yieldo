import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "../app/ThemeProvider";
import { formatCents } from "../design/theme";
import type { ScheduleRow, ScheduleYear } from "../lib/types";
import { CREDIT_100K } from "../features/simulators/fixtures";
import {
  AmortizationChart,
  amortizationLegend,
  buildAmortizationExportRows,
  buildAmortizationOption,
  rollUpScheduleYears,
} from "./AmortizationChart";

// A real answer from POST /api/simulators/credit: 12 000 € at 5,00 % over 18
// months. Eighteen months is deliberately NOT a whole number of years, so the
// second bar rolls up six rows and the "parts sum to the whole" assertion below
// has a short year to get wrong.
const YEARS: ScheduleYear[] = [
  { year: 1, interest_cents: 42059, principal_cents: 789985, remaining_cents: 410015 },
  { year: 2, interest_cents: 6001, principal_cents: 410015, remaining_cents: 0 },
];

// The same loan's instalments, summed per year by the test itself rather than
// read from YEARS — the point is to check the bars against the payments, not
// against the roll-up that produced them.
const YEAR_PAYMENT_CENTS = [832044, 416016];

const ROWS: ScheduleRow[] = [
  { month: 1, payment_cents: 69337, interest_cents: 5000, principal_cents: 64337, remaining_cents: 1135663 },
  { month: 18, payment_cents: 69331, interest_cents: 288, principal_cents: 69043, remaining_cents: 0 },
];

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

describe("buildAmortizationOption", () => {
  it("stacks with stackStrategy 'all' on every series", () => {
    // ECharts chains a stacked value onto the previous series ONLY when both
    // share the same sign (dataStack.js:87,115-118). Two charts in this
    // codebase shipped drawing negative values above zero for exactly this
    // reason. Interest and principal are never negative, so this is a guard
    // rather than a fix — and it is the line whose absence nobody notices.
    const option = buildAmortizationOption(YEARS, "light");
    const series = option.series as Array<Record<string, unknown>>;
    expect(series).toHaveLength(2);
    for (const item of series) {
      expect(item.stack).toBe("annuite");
      expect(item.stackStrategy).toBe("all");
    }
  });

  it("draws two parts that sum to the year's total payment", () => {
    // A stacked chart whose parts do not sum to the whole is drawing a
    // different quantity from the one its legend claims.
    const option = buildAmortizationOption(YEARS, "light");
    const series = option.series as Array<{ name: string; data: number[] }>;
    expect(series.map((s) => s.name)).toEqual(["Intérêts", "Capital remboursé"]);
    for (const [index, expected] of YEAR_PAYMENT_CENTS.entries()) {
      expect(series[0].data[index] + series[1].data[index]).toBe(expected);
    }
  });

  it("plots integer cents, never euros rounded on the way in", () => {
    const option = buildAmortizationOption(YEARS, "light");
    const series = option.series as Array<{ data: number[] }>;
    expect(series[0].data).toEqual([42059, 6001]);
    expect(series[1].data).toEqual([789985, 410015]);
  });

  it("labels each bar with the year it covers", () => {
    const option = buildAmortizationOption(YEARS, "light");
    const axis = option.xAxis as { data: string[] };
    expect(axis.data).toEqual(["An 1", "An 2"]);
  });

  it("reserves the last x-axis label's overhang on the right", () => {
    // `containLabel` subtracts a horizontal axis label's height, never its
    // width (coord/cartesian/Grid.js:150). On a 40-bar mortgage the half-band
    // inset shrinks towards nothing and the last label is clipped — which is
    // exactly what phase 2A shipped on the cashflow chart.
    const option = buildAmortizationOption(YEARS, "light");
    expect((option.grid as { right: number }).right).toBeGreaterThanOrEqual(24);
  });

  it("puts no legend inside the canvas, where it could reach the plot", () => {
    // ECharts wraps a legend onto as many rows as it needs while `grid.top`
    // stays a fixed number of pixels; at 375 px the extra rows paint over the
    // plot. Tasks 6, 9 and 16 all moved the key into HTML for this reason.
    const option = buildAmortizationOption(YEARS, "light");
    expect(option.legend).toBeUndefined();
  });
});

describe("amortizationLegend", () => {
  it("names both bands in the series' own order and colours", () => {
    const entries = amortizationLegend("light");
    expect(entries.map((e) => e.name)).toEqual(["Intérêts", "Capital remboursé"]);
    const series = buildAmortizationOption(YEARS, "light").series as Array<{ color: string }>;
    expect(entries.map((e) => e.color)).toEqual(series.map((s) => s.color));
  });

  it("changes colour with the theme rather than baking one in", () => {
    expect(amortizationLegend("dark").map((e) => e.color)).not.toEqual(
      amortizationLegend("light").map((e) => e.color),
    );
  });
});

describe("AmortizationChart", () => {
  it("carries an accessible description naming the term and the interest", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    render(
      <ThemeProvider>
        <AmortizationChart years={YEARS} months={18} totalInterestCents={48060} />
      </ThemeProvider>,
    );
    const figure = screen.getByRole("img");
    expect(figure.getAttribute("aria-label")).toContain("18 mois");
    expect(figure.getAttribute("aria-label")).toContain("480,60");
  });

  it("draws nothing at all rather than an empty axis when nothing was borrowed", () => {
    // An empty plot reads as "this loan costs nothing", which is a claim. What
    // to say instead is the calling screen's sentence to write.
    vi.stubGlobal("ResizeObserver", undefined);
    const { container } = render(
      <ThemeProvider>
        <AmortizationChart years={[]} months={240} totalInterestCents={0} />
      </ThemeProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("exports the exact integer cents behind each bar", () => {
    const rows = buildAmortizationExportRows(YEARS);
    expect(rows[0]).toEqual({
      Année: "An 1",
      Intérêts: formatCents(42059),
      "Capital remboursé": formatCents(789985),
      "Capital restant dû": formatCents(410015),
    });
    expect(rows[1]["Capital restant dû"]).toBe(formatCents(0));
  });
});

// `ROWS` is imported by the schedule table's own test; referenced here so the
// fixture cannot drift from the years above it without a failure.
describe("the fixture itself", () => {
  it("agrees with the roll-up it was taken from", () => {
    expect(ROWS[0].interest_cents + ROWS[0].principal_cents).toBe(ROWS[0].payment_cents);
    expect(ROWS[1].remaining_cents).toBe(YEARS[1].remaining_cents);
  });
});

describe("rollUpScheduleYears", () => {
  it("answers exactly what the backend's own roll-up answers", () => {
    // `POST /simulators/immobilier` publishes `rows` and no `years`, so the
    // property tab rolls its own. CREDIT_100K carries BOTH — its 240 rows and
    // the 20 years the router computed from them — which makes this a genuine
    // cross-check against the server rather than a restatement of this file's
    // own arithmetic. Change either grouping rule and this goes red.
    expect(rollUpScheduleYears(CREDIT_100K.rows)).toEqual(CREDIT_100K.years);
  });

  it("gives a short final year the rows it actually has", () => {
    // Eighteen months is a year and a half: the second group holds six rows,
    // and its `remaining_cents` is the LAST of them, not the twelfth of a group
    // that has no twelfth.
    const rows: ScheduleRow[] = Array.from({ length: 18 }, (_, index) => ({
      month: index + 1,
      payment_cents: 1000,
      interest_cents: 100,
      principal_cents: 900,
      remaining_cents: 18_000 - 900 * (index + 1),
    }));
    const years = rollUpScheduleYears(rows);
    expect(years).toHaveLength(2);
    expect(years[1]).toEqual({
      year: 2,
      interest_cents: 600,
      principal_cents: 5_400,
      remaining_cents: 18_000 - 900 * 18,
    });
  });

  it("returns nothing at all on an empty schedule", () => {
    expect(rollUpScheduleYears([])).toEqual([]);
  });
});
