import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "../app/ThemeProvider";
import type { CategoryBreakdown, Summary } from "../lib/types";
import { chartTokens, seriesColors } from "./theme";
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
  // The whole ledger's span, which the chart does not read -- it draws the
  // period it was handed. Present because the response carries it.
  history: { date_from: "2025-01-24", date_to: "2026-01-09", transaction_count: 197 },
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

  it("picks the fallback categorical color from the theme actually being rendered, not a fixed dark palette", () => {
    // No `color` on the category -- this is the one case that falls back to
    // the categorical ramp rather than the category's own backend color.
    const uncolored: CategoryBreakdown[] = [
      { category_id: 5, name: "Divers", color: "", total_cents: -30000, count: 4, share: 1 },
    ];

    const darkResult = buildWaterfallOption(summary, uncolored, chartTokens("dark"), "dark");
    const lightResult = buildWaterfallOption(summary, uncolored, chartTokens("light"), "light");

    const darkFallback = darkResult.steps.find((s) => s.name === "Divers")?.color;
    const lightFallback = lightResult.steps.find((s) => s.name === "Divers")?.color;

    expect(darkFallback).toBeDefined();
    expect(lightFallback).toBeDefined();
    expect(darkFallback).not.toBe(lightFallback);
  });

  it("defaults the fallback palette to dark when no theme is specified, for backward compatibility", () => {
    const uncolored: CategoryBreakdown[] = [
      { category_id: 5, name: "Divers", color: "", total_cents: -30000, count: 4, share: 1 },
    ];
    const { steps } = buildWaterfallOption(summary, uncolored, tokens);
    const fallback = steps.find((s) => s.name === "Divers")?.color;
    expect(fallback).toBe(seriesColors("dark")[0]);
  });

  // --- the running balance dipping below zero -------------------------------
  // A month whose expenses outrun its income: 1 000 € in, 3 000 € out, so the
  // cascade crosses zero on the second step and rests at -2 000 €. That is the
  // operator's own shape, not a contrived one.
  const deficit: Summary = {
    ...summary,
    inflow_cents: 100000,
    outflow_cents: -300000,
    net_cents: -200000,
  };
  const deficitCategories: CategoryBreakdown[] = [
    { category_id: 9, name: "Logement", color: "#7ee2d6", total_cents: -300000, count: 1, share: 1 },
  ];

  it("carries the true floor of each bar, including the ones below zero", () => {
    const { option } = buildWaterfallOption(deficit, deficitCategories, tokens);
    const series = option.series as Array<{ name?: string; data?: unknown[] }>;
    const support = series.find((s) => s.name === "support");
    // Revenus rises 0 -> 100 000; Logement falls 100 000 -> -200 000, so its
    // floor is -200 000; Épargne spans from -200 000 up to zero.
    expect(support?.data).toEqual([0, -200000, -200000]);
  });

  it("keeps every bar anchored on its own floor when the running balance goes negative", () => {
    // Same defect as the forecast fan chart's band, through the bar path.
    // ECharts' DEFAULT `stackStrategy: "samesign"` only chains a stacked value
    // onto the series below when both share a sign. Here the visible series
    // carries a HEIGHT (always >= 0) sitting on a FLOOR that goes negative the
    // moment the cascade crosses zero -- opposite signs, so "samesign" refuses
    // to chain, the stack result stays equal to the raw height, and
    // `layout/barGrid.js:398-399` computes `stackStartValue = stackResult -
    // rawValue` = 0. Both the deficit step and the negative Épargne total would
    // then be drawn UPWARD from the zero baseline: the right height, the wrong
    // anchor, and a loss rendered as a gain. Only "all" stacks unconditionally.
    // This pins the option; the drawn result was verified in a browser (see the
    // task 19 report).
    const { option } = buildWaterfallOption(deficit, deficitCategories, tokens);
    const series = option.series as Array<{ stack?: string; stackStrategy?: string }>;
    const stacked = series.filter((s) => s.stack === "waterfall");
    expect(stacked).toHaveLength(2);
    for (const s of stacked) expect(s.stackStrategy).toBe("all");

    // Guards the fixture itself: if a later edit makes this cascade stay
    // positive throughout, the test above would pass while proving nothing.
    const support = series[0] as { data?: number[] };
    expect(support.data?.some((value) => value < 0)).toBe(true);
  });

  it("drops a bar label rather than overprinting it on its neighbour", () => {
    // Two consecutive steps share a top whenever a rise is followed by a fall
    // from the same level -- on the operator's ledger "Revenus" (+10 220 €)
    // and "Logement" (-3 900 €) both anchor at 10 220, so at 375 the two
    // labels rendered on top of each other as "+10 2209 00 €": two figures on
    // screen, neither readable. Printing all of them is not available at that
    // width -- the plotting area is 235px for eight bands, each label is
    // ~55px, and a cascade's own geometry (bar i's bottom IS bar i+1's top)
    // leaves no free level to move one to. `hideOverlap` is ECharts' own
    // answer: it measures the laid-out label boxes and drops the ones that
    // would collide, so at 1440 every amount still prints and at 375 what
    // prints is legible. The dropped figures stay in the tooltip and the CSV.
    const { option } = buildWaterfallOption(summary, categories, tokens);
    const series = option.series as Array<{ name?: string; labelLayout?: { hideOverlap?: boolean } }>;
    const visible = series.find((s) => s.name === "montant");
    expect(visible?.labelLayout?.hideOverlap).toBe(true);
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
