import { describe, expect, it } from "vitest";

import type { ChatChart } from "../lib/types";
import { buildAnswerOption, answerLegend, buildAnswerExportRows } from "./AnswerChart";

const BARS: ChatChart = {
  kind: "bars",
  title: "Dépenses par mois — Restaurant",
  points: [
    { label: "janvier 2026", amount_cents: -2_000 },
    { label: "février 2026", amount_cents: -6_000 },
    { label: "mars 2026", amount_cents: 1_500 },
  ],
};

const LINE: ChatChart = {
  kind: "line",
  title: "Solde projeté, mois par mois",
  points: [
    { label: "Mois 1", amount_cents: 20_000 },
    { label: "Mois 2", amount_cents: 40_050 },
    { label: "Mois 3", amount_cents: 60_150 },
  ],
};

interface BarDatum {
  value: number;
  itemStyle: { color: string };
}

/** The bar series' data, typed: each column carries its own colour, so the
 *  sign it stands for is readable off the datum rather than off a callback. */
function barData(option: ReturnType<typeof buildAnswerOption>): BarDatum[] {
  return (option.series as Array<{ data: BarDatum[] }>)[0].data;
}

describe("the option a chat answer's chart builds", () => {
  it("draws one bar per point, in the order the engine sent them", () => {
    const option = buildAnswerOption(BARS, "dark");
    const series = (option.series as Array<{ type: string; data: unknown[] }>)[0];
    expect(series.type).toBe("bar");
    expect(series.data).toHaveLength(3);
    expect((option.xAxis as { data: string[] }).data).toEqual([
      "janvier 2026",
      "février 2026",
      "mars 2026",
    ]);
  });

  it("draws a line for a line chart, and never a bar", () => {
    const option = buildAnswerOption(LINE, "dark");
    expect((option.series as Array<{ type: string }>)[0].type).toBe("line");
  });

  it("keeps every amount in integer cents, sign intact, all the way to the series", () => {
    // A spend of −60,00 € must reach the axis as −6000. Dividing by 100 on the
    // way in is how a float gets into a money value.
    const bars = barData(buildAnswerOption(BARS, "dark"));
    expect(bars.map((datum) => datum.value)).toEqual([-2_000, -6_000, 1_500]);

    const line = (buildAnswerOption(LINE, "dark").series as Array<{ data: number[] }>)[0];
    expect(line.data).toEqual([20_000, 40_050, 60_150]);
  });

  it("colours a negative column differently from a positive one", () => {
    // Sign is the one thing a bar's height cannot carry on its own when the
    // axis crosses zero: a −60,00 € bar and a +15,00 € bar are both bars.
    const bars = barData(buildAnswerOption(BARS, "dark"));
    expect(bars[0].itemStyle.color).toBe(bars[1].itemStyle.color);
    expect(bars[2].itemStyle.color).not.toBe(bars[0].itemStyle.color);
  });

  it("never declares an ECharts legend — the key is HTML above the canvas", () => {
    expect(buildAnswerOption(BARS, "dark").legend).toBeUndefined();
    expect(buildAnswerOption(LINE, "light").legend).toBeUndefined();
  });

  it("names both signs in the key when the series crosses zero, and one when it does not", () => {
    expect(answerLegend(BARS, "dark").map((entry) => entry.key)).toEqual([
      "negative",
      "positive",
    ]);
    expect(answerLegend(LINE, "dark").map((entry) => entry.key)).toEqual(["positive"]);
  });

  it("exports the rows the chart was drawn from, formatted as euros", () => {
    const rows = buildAnswerExportRows(BARS);
    expect(rows).toHaveLength(3);
    expect(rows[0].Période).toBe("janvier 2026");
    expect(String(rows[1].Montant)).toContain("60,00");
  });
});
