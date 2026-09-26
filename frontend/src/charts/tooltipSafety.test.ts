import { describe, expect, it } from "vitest";

import type { CategoryBreakdown, Summary } from "../lib/types";
import { buildAnswerOption } from "./AnswerChart";
import { treemapTooltip } from "./CategoryTreemap";
import { buildPayoffOption } from "./DebtPayoffChart";
import { buildDonutOption } from "./SpendingDonut";
import { chartTokens, seriesColors } from "./theme";
import { buildWaterfallOption } from "./WaterfallChart";

// ECharts writes a tooltip formatter's return value with innerHTML. A category,
// a label or a debt is typed by the household -- or by an agent holding a
// ledger key -- so any of them can be markup. None may reach the DOM as markup.
const HOSTILE = `<img src=x onerror="alert(1)">`;

type Formatter = (params: unknown) => string;

function formatterOf(option: unknown): Formatter {
  return (option as { tooltip: { formatter: Formatter } }).tooltip.formatter;
}

function assertInert(html: string) {
  expect(html).not.toContain("<img");
  expect(html).toContain("&lt;img");
}

describe("chart tooltips never render data as markup", () => {
  it("the spending donut", () => {
    const { option } = buildDonutOption(
      [{ categoryId: 1, name: HOSTILE, amountCents: 1_000, color: null }],
      1_000,
      chartTokens("dark"),
      seriesColors("dark"),
    );
    assertInert(formatterOf(option)({ name: HOSTILE, value: 1_000, percent: 100 }));
  });

  it("the treemap", () => {
    assertInert(treemapTooltip({ name: HOSTILE, value: 1_000 }));
  });

  it("the waterfall", () => {
    const summary = {
      date_from: "2026-03-01",
      date_to: "2026-03-31",
      inflow_cents: 300_000,
      outflow_cents: -1_000,
      net_cents: 299_000,
      transaction_count: 2,
      savings_rate: 0.99,
      set_aside_cents: 0,
      set_aside_gap_cents: 0,
      previous: null,
      comparison: null,
      history: { date_from: "2026-01-01", date_to: "2026-03-31", transaction_count: 2 },
    } as unknown as Summary;
    const categories: CategoryBreakdown[] = [
      { category_id: 1, name: HOSTILE, color: "#ffffff", total_cents: -1_000, count: 1, share: 1 },
    ];
    const { option, steps } = buildWaterfallOption(summary, categories, chartTokens("dark"));
    const index = steps.findIndex((step) => step.name === HOSTILE);
    expect(index).toBeGreaterThanOrEqual(0);
    assertInert(formatterOf(option)({ dataIndex: index }));
  });

  it("the assistant's answer chart", () => {
    const option = buildAnswerOption(
      { kind: "bars", title: "Dépenses", points: [{ label: HOSTILE, amount_cents: -1_000 }] },
      "dark",
    );
    assertInert(formatterOf(option)([{ dataIndex: 0 }]));
  });

  it("the debt payoff chart", () => {
    const option = buildPayoffOption(
      [{ month: 1, on: "2026-10-01", balances_cents: { "7": 1_000 }, total_cents: 1_000 }],
      new Map([[7, HOSTILE]]),
      "dark",
    );
    assertInert(formatterOf(option)([{ dataIndex: 0 }]));
  });
});
