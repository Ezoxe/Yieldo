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

  it("stacks the band as a height above P10, not as an absolute P90", () => {
    const { option } = buildForecastOption(months, 0, tokens);
    const series = option.series as Array<{ name?: string; data?: number[] }>;
    const band = series.find((s) => s.name === "Intervalle P10–P90");
    expect(band?.data).toEqual([40000, 100000, 200000]);
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
