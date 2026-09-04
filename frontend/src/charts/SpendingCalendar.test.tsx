import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "../app/ThemeProvider";
import type { CalendarPoint } from "../lib/types";
import { chartTokens, sequentialRamp } from "./theme";
import {
  buildCalendarOption,
  calendarSpan,
  SpendingCalendar,
  weekColumns,
} from "./SpendingCalendar";

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

const points: CalendarPoint[] = [
  { date: "2025-03-01", inflow_cents: 0, outflow_cents: -4732, net_cents: -4732, count: 1 },
  { date: "2025-03-15", inflow_cents: 250000, outflow_cents: -12000, net_cents: 238000, count: 3 },
];

// The operator's own shape: a ledger that opens late in one year and closes a
// few days into the next.
const acrossTwoYears: CalendarPoint[] = [
  { date: "2025-01-24", inflow_cents: 0, outflow_cents: -1200, net_cents: -1200, count: 1 },
  { date: "2025-12-18", inflow_cents: 0, outflow_cents: -8900, net_cents: -8900, count: 2 },
  { date: "2026-01-09", inflow_cents: 0, outflow_cents: -3400, net_cents: -3400, count: 1 },
];

function calendarOf(option: ReturnType<typeof buildCalendarOption>["option"]) {
  return Array.isArray(option.calendar) ? option.calendar[0] : option.calendar;
}

type MonthLabelParams = { nameMap: string; yy: string; yyyy: string; M: number };

function monthFormatter(option: ReturnType<typeof buildCalendarOption>["option"]) {
  return calendarOf(option)?.monthLabel?.formatter as (params: MonthLabelParams) => string;
}

describe("calendarSpan", () => {
  it("spans the whole months the points occupy, in order", () => {
    expect(calendarSpan(acrossTwoYears)).toEqual({ from: "2025-01-01", to: "2026-01-31" });
  });

  it("is unaffected by the order the points arrive in", () => {
    expect(calendarSpan([...acrossTwoYears].reverse())).toEqual({
      from: "2025-01-01",
      to: "2026-01-31",
    });
  });

  it("closes a February correctly in a leap year", () => {
    const leap: CalendarPoint[] = [
      { date: "2024-02-10", inflow_cents: 0, outflow_cents: -100, net_cents: -100, count: 1 },
    ];
    expect(calendarSpan(leap)).toEqual({ from: "2024-02-01", to: "2024-02-29" });
  });

  it("has nothing to span when there are no points", () => {
    expect(calendarSpan([])).toBeNull();
  });
});

describe("buildCalendarOption", () => {
  const tokens = chartTokens("dark");
  const ramp = sequentialRamp("dark", 5);

  it("heats each day by the magnitude of spending, not net balance", () => {
    const { option } = buildCalendarOption(points, calendarSpan(points)!, tokens, ramp);
    const series = (option.series as Array<{ data?: [string, number][] }>)[0];
    expect(series.data).toContainEqual(["2025-03-01", 4732]);
    expect(series.data).toContainEqual(["2025-03-15", 12000]);
  });

  // The defect this replaces: the chart took a single `year`, so on "Tout" it
  // drew 2026 -- nine days of data under eleven and a half blank months.
  it("draws the whole span of the data, not one calendar year", () => {
    const { option } = buildCalendarOption(
      acrossTwoYears,
      calendarSpan(acrossTwoYears)!,
      tokens,
      ramp,
    );
    expect(calendarOf(option)?.range).toEqual(["2025-01-01", "2026-01-31"]);
  });

  it("never clips the grid off the right edge of a narrow panel", () => {
    const span = calendarSpan(acrossTwoYears)!;
    // 57 columns at a fixed 16px needs ~912px; a 375 viewport gives the
    // calendar 293, and ECharts draws past the edge rather than scrolling.
    const { option } = buildCalendarOption(acrossTwoYears, span, tokens, ramp, 293);
    const [width] = calendarOf(option)?.cellSize as [number, number];
    expect(width * weekColumns(span)).toBeLessThanOrEqual(293 - 40 - 16);
  });

  // Two failures, opposite directions. Left to fill the box, the five columns
  // of a single month came out 200px wide: a row of bars, not a calendar.
  // Capped at 16 for every span, the same month came out as five small squares
  // adrift in a 1130px card, which reads as a rendering fault. A month gets
  // the biggest square the bounds allow.
  it("draws a short span as a calendar a person can point at, not as bars", () => {
    const oneMonth: CalendarPoint[] = [
      { date: "2026-01-02", inflow_cents: 0, outflow_cents: -500, net_cents: -500, count: 1 },
      { date: "2026-01-09", inflow_cents: 0, outflow_cents: -900, net_cents: -900, count: 1 },
    ];
    const { option } = buildCalendarOption(
      oneMonth,
      calendarSpan(oneMonth)!,
      tokens,
      ramp,
      1095,
    );
    const calendar = calendarOf(option);
    expect(calendar?.cellSize).toEqual([34, 34]);
    // ... and it sits in the middle of the panel rather than hugging the left.
    expect(calendar?.left).toBe("center");
  });

  // `nameMap: "fr"` was a no-op -- ECharts resolves it against a locale that
  // was never registered and silently falls back to English (Jan, Feb, S, M, T).
  it("names the days of the week in French, starting on Monday", () => {
    const { option } = buildCalendarOption(points, calendarSpan(points)!, tokens, ramp);
    const calendar = calendarOf(option);
    // Sunday-first, which is the order ECharts indexes the array in.
    expect(calendar?.dayLabel?.nameMap).toEqual(["D", "L", "M", "M", "J", "V", "S"]);
    expect(calendar?.dayLabel?.firstDay).toBe(1);
  });

  it("names the months in French", () => {
    const { option } = buildCalendarOption(points, calendarSpan(points)!, tokens, ramp);
    const nameMap = calendarOf(option)?.monthLabel?.nameMap as string[];
    expect(nameMap[0]).toBe("janv.");
    expect(nameMap[1]).toBe("févr.");
    expect(nameMap[11]).toBe("déc.");
  });

  it("says which year a month belongs to once the span crosses one", () => {
    const { option } = buildCalendarOption(
      acrossTwoYears,
      calendarSpan(acrossTwoYears)!,
      tokens,
      ramp,
    );
    const formatter = monthFormatter(option);
    expect(formatter({ nameMap: "janv.", yy: "25", yyyy: "2025", M: 1 })).toBe("janv. 25");
    expect(formatter({ nameMap: "janv.", yy: "26", yyyy: "2026", M: 1 })).toBe("janv. 26");
  });

  it("leaves the month labels bare inside a single year", () => {
    const { option } = buildCalendarOption(points, calendarSpan(points)!, tokens, ramp);
    expect(monthFormatter(option)({ nameMap: "mars", yy: "25", yyyy: "2025", M: 3 })).toBe("mars");
  });

  // At 375 the panel gives a thirteen-month span about 18px per month, and
  // every label overprinted its neighbours into an unreadable smear.
  it("drops month labels that would overprint their neighbours on a narrow panel", () => {
    const { option } = buildCalendarOption(
      acrossTwoYears,
      calendarSpan(acrossTwoYears)!,
      tokens,
      ramp,
      293, // the calendar's measured width at a 375px viewport
    );
    const formatter = monthFormatter(option);
    expect(formatter({ nameMap: "janv.", yy: "25", yyyy: "2025", M: 1 })).toBe("janv. 25");
    expect(formatter({ nameMap: "févr.", yy: "25", yyyy: "2025", M: 2 })).toBe("");
    expect(formatter({ nameMap: "mai", yy: "25", yyyy: "2025", M: 5 })).toBe("mai 25");
  });

  it("labels every month when the panel is wide enough for them all", () => {
    const { option } = buildCalendarOption(
      acrossTwoYears,
      calendarSpan(acrossTwoYears)!,
      tokens,
      ramp,
      1095, // the calendar's measured width at a 1440px viewport
    );
    expect(monthFormatter(option)({ nameMap: "févr.", yy: "25", yyyy: "2025", M: 2 })).toBe(
      "févr. 25",
    );
  });

  // The scale's own end labels are euro amounts and go through formatCents
  // like every other amount on screen; they were printing raw cents ("85371").
  it("labels the intensity scale in euros, never in raw cents", () => {
    const { option } = buildCalendarOption(points, calendarSpan(points)!, tokens, ramp);
    const visualMap = (Array.isArray(option.visualMap) ? option.visualMap[0] : option.visualMap) as {
      formatter?: (value: number) => string;
    };
    expect(visualMap.formatter?.(85371)).toBe("854 €");
  });
});

function renderCalendar(pts: CalendarPoint[] = points) {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <SpendingCalendar points={pts} />
      </ThemeProvider>
    </MemoryRouter>,
  );
}

describe("SpendingCalendar", () => {
  it("renders with an accessible label naming the covered range in French", () => {
    renderCalendar(acrossTwoYears);
    expect(
      screen.getByRole("img", { name: /du 24 janvier 2025 au 9 janvier 2026/i }),
    ).toBeInTheDocument();
  });

  it("shows an inviting empty state instead of a blank calendar grid", () => {
    renderCalendar([]);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText(/Aucune dépense/i)).toBeInTheDocument();
  });
});
