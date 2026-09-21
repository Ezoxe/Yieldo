import { describe, expect, it } from "vitest";

import type { InvestSessionDetail } from "../../lib/types";
import { capitalOption, marketOption, massOption } from "./SessionCharts";

function day(): InvestSessionDetail {
  return {
    id: 1, mode: "paper", seed: 527, steps: 4, interval_minutes: 5, completed_steps: 4,
    status: "finished", stop_requested: false, message: null, provider: "laya",
    model: "laya-typed-decisions", initial_cash_cents: 1_000_000, final_equity_cents: 1_004_000,
    realised_pnl_cents: 2_000, unrealised_pnl_cents: 2_000, max_drawdown_bps: 120,
    started_at: "2026-09-21T09:00:00Z", finished_at: "2026-09-21T09:10:00Z",
    points: [
      { step: 1, equity_cents: 1_000_000, cash_cents: 1_000_000, exposure_cents: 0, orders: 0 },
      { step: 2, equity_cents: 1_001_000, cash_cents: 800_000, exposure_cents: 201_000, orders: 1 },
      { step: 3, equity_cents: 998_000, cash_cents: 800_000, exposure_cents: 198_000, orders: 0 },
      { step: 4, equity_cents: 1_004_000, cash_cents: 1_004_000, exposure_cents: 0, orders: 1 },
    ],
    closes: { AAPL: [3_343, 3_350, 3_340, 3_360], "BTC-EUR": [42_165, 42_200, 42_100, 42_300] },
    symbols: ["AAPL", "BTC-EUR"],
    decisions: [
      { id: 10, step: 1, symbol: "AAPL", outcome: "held", rule: "hold", message: null,
        choice: "ne rien faire", score_value: null, probability_bps: null,
        mass_bps: { acheter: 3_000, vendre: 2_000, "ne rien faire": 5_000 },
        confidence_bps: 400, act_bps: 10_000, latency_ms: 800, reference_price_cents: 3_343,
        rules_choice: "ne rien faire", created_at: "2026-09-21T09:00:00Z" },
      { id: 11, step: 2, symbol: "AAPL", outcome: "ordered", rule: null, message: null,
        choice: "acheter", score_value: 7, probability_bps: 6_000,
        mass_bps: { acheter: 6_000, vendre: 1_000, "ne rien faire": 3_000 },
        confidence_bps: 2_000, act_bps: 10_000, latency_ms: 900, reference_price_cents: 3_350,
        rules_choice: "ne rien faire", created_at: "2026-09-21T09:05:00Z" },
      { id: 12, step: 4, symbol: "AAPL", outcome: "ordered", rule: null, message: null,
        choice: "vendre", score_value: 8, probability_bps: 7_000,
        mass_bps: { acheter: 1_000, vendre: 7_000, "ne rien faire": 2_000 },
        confidence_bps: 3_000, act_bps: 10_000, latency_ms: 850, reference_price_cents: 3_360,
        rules_choice: "vendre", created_at: "2026-09-21T09:15:00Z" },
    ],
    orders: [
      { id: 5, step: 2, symbol: "AAPL", side: "buy", status: "filled", quantity: "60",
        notional_cents: 201_000, average_price_cents: 3_350, realised_pnl_cents: 0,
        created_at: "2026-09-21T09:05:00Z" },
      { id: 6, step: 4, symbol: "AAPL", side: "sell", status: "filled", quantity: "60",
        notional_cents: 201_600, average_price_cents: 3_360, realised_pnl_cents: 600,
        created_at: "2026-09-21T09:15:00Z" },
    ],
    report: {
      final_equity_cents: 1_004_000, return_bps: 40, max_drawdown_bps: 120, decisions: 3,
      held: 1, refused: 0, ordered: 2, failed: 0, orders: 2, filled: 2, winning: 1, losing: 0,
      realised_pnl_cents: 600, compared: 3, agreement_bps: 6_667, mean_confidence_bps: 1_800,
      mean_act_bps: 10_000, latency_p50_ms: 850,
      mass_series: { AAPL: [
        { step: 1, buy_bps: 3_000, sell_bps: 2_000, hold_bps: 5_000 },
        { step: 2, buy_bps: 6_000, sell_bps: 1_000, hold_bps: 3_000 },
        { step: 4, buy_bps: 1_000, sell_bps: 7_000, hold_bps: 2_000 },
      ] },
    },
  };
}

type Series = { name?: string; type?: string; data?: unknown[]; markPoint?: { data: unknown[] } };

describe("capitalOption", () => {
  it("draws capital and cash over the steps, in euros, on the day's clock", () => {
    const option = capitalOption(day(), "dark");
    const series = option.series as Series[];
    expect(series.map((s) => s.name)).toEqual(["Capital", "Liquidités"]);
    expect(series[0].data).toEqual([10_000, 10_010, 9_980, 10_040]);
    const axis = option.xAxis as { data: string[] };
    expect(axis.data[0]).toBe("09:00");
    expect(axis.data[3]).toBe("09:15");
  });
});

describe("marketOption", () => {
  it("draws the close and marks buys and sells at their step", () => {
    const option = marketOption(day(), "AAPL", "dark");
    const series = option.series as Series[];
    expect(series[0].data).toEqual([33.43, 33.5, 33.4, 33.6]);
    const marks = series[0].markPoint?.data as Array<{ name: string; coord: unknown[] }>;
    expect(marks.map((m) => m.name)).toEqual(["Achat", "Vente"]);
    expect(marks[0].coord).toEqual([1, 33.5]);
    expect(marks[1].coord).toEqual([3, 33.6]);
  });
});

describe("massOption", () => {
  it("stacks the three directions per step, in percent, on the day's clock", () => {
    const option = massOption(day(), "AAPL", "dark");
    const series = option.series as Series[];
    expect(series.map((s) => s.name)).toEqual(["Acheter", "Vendre", "Ne rien faire"]);
    // Step 3 had no mass: the bar is absent, not zero.
    expect(series[0].data).toEqual([30, 60, null, 10]);
    expect(series[2].data).toEqual([50, 30, null, 20]);
  });
});
