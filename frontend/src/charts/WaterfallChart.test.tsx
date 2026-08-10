import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "../app/ThemeProvider";
import type { CategoryBreakdown, Summary } from "../lib/types";
import { chartTokens } from "./theme";
import { buildWaterfallOption, WaterfallChart } from "./WaterfallChart";

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

const summary: Summary = {
  date_from: "2025-03-01",
  date_to: "2025-03-31",
  inflow_cents: 300000,
  outflow_cents: -220000,
  net_cents: 80000,
  transaction_count: 40,
  savings_rate: 0.2667,
  previous: {
    date_from: "2025-02-01",
    date_to: "2025-02-28",
    inflow_cents: 280000,
    outflow_cents: -200000,
    net_cents: 80000,
    transaction_count: 38,
    savings_rate: 0.2857,
  },
  comparison: { delta_cents: 0, delta_ratio: 0 },
};

const categories: CategoryBreakdown[] = [
  { category_id: 1, name: "Logement", color: "#7ee2d6", total_cents: -100000, count: 1, share: 0.45 },
  { category_id: 2, name: "Alimentation", color: "#4fd6a8", total_cents: -60000, count: 20, share: 0.27 },
  { category_id: 3, name: "Transport", color: "#8ab4f8", total_cents: -40000, count: 10, share: 0.18 },
  { category_id: 4, name: "Loisirs", color: "#f472b6", total_cents: -20000, count: 9, share: 0.1 },
];

describe("buildWaterfallOption", () => {
  const tokens = chartTokens("dark");

  it("starts with income as a positive step", () => {
    const { steps } = buildWaterfallOption(summary, categories, tokens);
    expect(steps[0]).toMatchObject({ name: "Revenus", delta: 300000 });
  });

  it("shows every major expense category as its own negative step, colored by category", () => {
    const { steps } = buildWaterfallOption(summary, categories, tokens);
    const logement = steps.find((s) => s.name === "Logement");
    expect(logement?.delta).toBe(-100000);
    expect(logement?.color).toBe("#7ee2d6");
  });

  it("never colors an ordinary expense category red -- red is reserved for anomalies", () => {
    const { steps } = buildWaterfallOption(summary, categories, tokens);
    const expenseSteps = steps.filter((s) => s.name !== "Revenus" && s.name !== "Épargne");
    for (const step of expenseSteps) expect(step.color).not.toBe(tokens.negative);
  });

  it("ends with savings as the final running total, matching the authoritative summary net", () => {
    const { steps } = buildWaterfallOption(summary, categories, tokens);
    const last = steps[steps.length - 1];
    expect(last).toMatchObject({ name: "Épargne", delta: 80000 });
    expect(last.color).toBe(tokens.positive);
  });

  it("colors a deficit savings step as the negative token -- the one legitimate red", () => {
    const deficitSummary: Summary = { ...summary, net_cents: -50000 };
    const { steps } = buildWaterfallOption(deficitSummary, categories, tokens);
    const last = steps[steps.length - 1];
    expect(last.color).toBe(tokens.negative);
  });
});

describe("WaterfallChart", () => {
  it("renders with an accessible label", () => {
    render(
      <ThemeProvider>
        <WaterfallChart summary={summary} categories={categories} />
      </ThemeProvider>,
    );
    expect(screen.getByRole("img")).toBeInTheDocument();
  });

  it("shows an inviting empty state instead of an empty grid when nothing happened", () => {
    const emptySummary: Summary = { ...summary, inflow_cents: 0, outflow_cents: 0, net_cents: 0 };
    render(
      <ThemeProvider>
        <WaterfallChart summary={emptySummary} categories={[]} />
      </ThemeProvider>,
    );
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText(/Aucune activité/i)).toBeInTheDocument();
  });
});
