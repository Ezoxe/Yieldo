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
