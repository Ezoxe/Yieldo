import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "../app/ThemeProvider";
import { formatCents } from "../design/theme";
import { chartTokens } from "./theme";
import { buildCashflowOption, CashflowChart } from "./CashflowChart";

const buckets = [
  { key: "2025-01", start: "2025-01-01", end: "2025-01-31", inflow_cents: 250000, outflow_cents: -180000, net_cents: 70000, count: 12 },
  { key: "2025-02", start: "2025-02-01", end: "2025-02-28", inflow_cents: 260000, outflow_cents: -220000, net_cents: 40000, count: 15 },
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

describe("buildCashflowOption", () => {
  const tokens = chartTokens("dark");

  it("keeps outflow values negative -- never flips their sign for display", () => {
    const { option } = buildCashflowOption(buckets, "month", tokens);
    const series = option.series as Array<{ name?: string; data?: number[] }>;
    const outflow = series.find((s) => s.name === "Sorties");
    expect(outflow?.data).toEqual([-180000, -220000]);
  });

  it("plots inflow, outflow and net balance on a single shared value axis (no dual axis)", () => {
    const { option } = buildCashflowOption(buckets, "month", tokens);
    expect(Array.isArray(option.yAxis) ? option.yAxis.length : 1).toBe(1);
  });

  it("builds one category label per bucket", () => {
    const { option } = buildCashflowOption(buckets, "month", tokens);
    const xAxis = (Array.isArray(option.xAxis) ? option.xAxis[0] : option.xAxis) as { data?: unknown[] };
    expect(xAxis?.data).toHaveLength(2);
  });

  it("produces export rows in euros, never raw cents", () => {
    const { exportRows } = buildCashflowOption(buckets, "month", tokens);
    expect(exportRows[0].Entrées).toBe(formatCents(250000));
    expect(exportRows[0].Sorties).toBe(formatCents(-180000));
  });

  it("names the chart with the covered date range for the accessible label", () => {
    const { ariaLabel } = buildCashflowOption(buckets, "month", tokens);
    expect(ariaLabel).toMatch(/janvier/i);
  });
  it("distinguishes the net line's legend entry from the inflow bar's by shape, not by hue", () => {
    // `--yd-positive` (the Entrées bar) and `--yd-accent-strong` (the Solde net
    // line) sit 1.11:1 apart in the dark theme and 1.37:1 in the light one.
    // App-wide `legend.icon: "roundRect"` would draw both as near-identical
    // blocks; "inherit" makes the line entry draw its own mark instead.
    const { option } = buildCashflowOption(buckets, "month", tokens);
    const legend = option.legend as { data: Array<{ name: string; icon?: string }> };
    const entries = new Map(legend.data.map((entry) => [entry.name, entry.icon]));
    expect(entries.get("Solde net")).toBe("inherit");
    expect(entries.get("Entrées")).toBeUndefined();
    expect(entries.get("Sorties")).toBeUndefined();
  });

  it("reserves the Exporter button's width so the legend cannot render underneath it", () => {
    // Measured at 375: the chart box is 293px wide and the three entries run
    // the full width, so "Solde net" rendered *under* the opaque "Exporter"
    // button in the top-right corner and read as "Sold*Exporte*r". The legend
    // is ECharts' own; it has no idea a DOM button is floated over its box.
    // 84px is the same reservation ForecastFanChart.tsx already carries for
    // exactly this collision -- the button is ~72px plus the toolbar's inset.
    const { option } = buildCashflowOption(buckets, "month", tokens);
    const legend = option.legend as { right?: number };
    expect(legend.right).toBe(84);
  });
});

describe("CashflowChart", () => {
  it("renders the chart with an accessible label when there is data", () => {
    render(
      <ThemeProvider>
        <CashflowChart buckets={buckets} granularity="month" />
      </ThemeProvider>,
    );
    expect(screen.getByRole("img")).toBeInTheDocument();
  });

  it("shows an inviting empty state instead of an empty grid when there is no activity", () => {
    render(
      <ThemeProvider>
        <CashflowChart buckets={[]} granularity="month" />
      </ThemeProvider>,
    );
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText(/Aucune activité/i)).toBeInTheDocument();
  });
});
