import { describe, expect, it } from "vitest";

import { formatCents } from "../design/theme";
import type { NetWorthPoint } from "../lib/types";
import { buildNetWorthOption, buildNetWorthRows, MIN_NET_WORTH_POINTS } from "./NetWorthChart";

const history: NetWorthPoint[] = [
  { taken_on: "2026-07-01", assets_cents: 2_000_000, debts_cents: 1_200_000, net_cents: 800_000 },
  { taken_on: "2026-08-01", assets_cents: 2_100_000, debts_cents: 1_150_000, net_cents: 950_000 },
  { taken_on: "2026-09-01", assets_cents: 2_390_000, debts_cents: 1_157_000, net_cents: 1_233_000 },
];

describe("buildNetWorthOption", () => {
  it("draws one line of the net, fitted to the data rather than pinned to zero", () => {
    const option = buildNetWorthOption(history, "dark");
    const series = option.series as Array<{ data: number[]; markLine?: unknown }>;
    expect(series[0].data).toEqual([800_000, 950_000, 1_233_000]);
    expect((option.yAxis as { scale?: boolean }).scale).toBe(true);
    expect(series[0].markLine).toBeUndefined();
  });

  // A household that owes more than it owns must see which side of zero it
  // is on; a line fitted to the data alone would hide the crossing.
  it("draws the zero line only when the history crosses it", () => {
    const crossing = [
      { ...history[0], net_cents: -300_000 },
      { ...history[1], net_cents: 200_000 },
    ];
    const series = buildNetWorthOption(crossing, "dark").series as Array<{ markLine?: unknown }>;
    expect(series[0].markLine).toBeDefined();
  });

  it("exports the three figures per day in French", () => {
    expect(buildNetWorthRows(history)[2]).toEqual({
      Date: "1er septembre 2026",
      "Patrimoine net": formatCents(1_233_000),
      Actifs: formatCents(2_390_000),
      Dettes: formatCents(1_157_000),
    });
  });

  it("needs two readings to be a line", () => {
    expect(MIN_NET_WORTH_POINTS).toBe(2);
  });
});
