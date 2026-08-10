import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "../app/ThemeProvider";
import type { CalendarPoint } from "../lib/types";
import { chartTokens, sequentialRamp } from "./theme";
import { buildCalendarOption, SpendingCalendar } from "./SpendingCalendar";

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

describe("buildCalendarOption", () => {
  const tokens = chartTokens("dark");
  const ramp = sequentialRamp("dark", 5);

  it("heats each day by the magnitude of spending, not net balance", () => {
    const { option } = buildCalendarOption(points, 2025, tokens, ramp);
    const series = (option.series as Array<{ data?: [string, number][] }>)[0];
    expect(series.data).toContainEqual(["2025-03-01", 4732]);
    expect(series.data).toContainEqual(["2025-03-15", 12000]);
  });

  it("scopes the calendar to the requested year", () => {
    const { option } = buildCalendarOption(points, 2025, tokens, ramp);
    const calendar = Array.isArray(option.calendar) ? option.calendar[0] : option.calendar;
    expect(calendar?.range).toBe("2025");
  });
});

function renderCalendar(pts: CalendarPoint[] = points) {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <SpendingCalendar points={pts} year={2025} />
      </ThemeProvider>
    </MemoryRouter>,
  );
}

describe("SpendingCalendar", () => {
  it("renders with an accessible label naming the year", () => {
    renderCalendar();
    expect(screen.getByRole("img", { name: /2025/ })).toBeInTheDocument();
  });

  it("shows an inviting empty state instead of a blank calendar grid", () => {
    renderCalendar([]);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText(/Aucune dépense/i)).toBeInTheDocument();
  });
});
