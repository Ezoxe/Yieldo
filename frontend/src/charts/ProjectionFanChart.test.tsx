import type { LineSeriesOption } from "echarts";
import { describe, expect, it } from "vitest";

import type { MonteCarloProjection } from "../lib/types";
import { bandsFor, buildProjectionFanOption } from "./ProjectionFanChart";
import { chartTokens } from "./theme";

const TOKENS = chartTokens("dark");

function projection(
  bands: Array<[number, number, number]>,
  percentiles = [10, 50, 90],
): MonteCarloProjection {
  return {
    initial_cents: 1_000_000,
    months: bands.length,
    assumptions: {
      annual_return_bps: 300,
      annual_volatility_bps: 1_500,
      monthly_cents: -74_619,
      trials: 1_000,
      seed: 424_242,
      percentiles,
    },
    points: bands.map(([low, median, high], index) => ({
      month: index + 1,
      on: `2026-0${index + 1}-30`,
      percentiles_cents: {
        [String(percentiles[0])]: low,
        [String(percentiles[1])]: median,
        [String(percentiles[2])]: high,
      },
    })),
    horizon_end_on: `2026-0${bands.length}-30`,
  };
}

function series(option: ReturnType<typeof buildProjectionFanOption>["option"]) {
  return option.series as LineSeriesOption[];
}

describe("buildProjectionFanOption", () => {
  it("declares no ECharts legend at all", () => {
    // Since phase 2B the key lives in HTML above the canvas: a legend wraps
    // onto as many rows as it needs while `grid.top` is fixed pixels, and at
    // 375px the extra rows paint over the plot.
    const { option, keyEntries } = buildProjectionFanOption(
      projection([
        [100, 200, 300],
        [90, 210, 340],
      ]),
      bandsFor([10, 50, 90])!,
      TOKENS,
    );
    expect(option.legend).toBeUndefined();
    expect(keyEntries.map((entry) => entry.key)).toEqual(["band", "median"]);
  });

  it("stacks the band with stackStrategy all on every series of the stack", () => {
    // ECharts' default "samesign" refuses to chain a positive height onto a
    // negative floor, leaves the stacked value NaN, and falls back to the
    // axis' value start -- re-anchoring the band at zero on exactly the months
    // the reader most needs to see.
    const { option } = buildProjectionFanOption(
      projection([
        [100, 200, 300],
        [-500, 210, 340],
      ]),
      bandsFor([10, 50, 90])!,
      TOKENS,
    );
    const stacked = series(option).filter((s) => s.stack === "fan");
    expect(stacked).toHaveLength(2);
    for (const s of stacked) expect(s.stackStrategy).toBe("all");
  });

  it("carries the band's height, not its top edge", () => {
    // Stacking absolute values would draw the band from P10 to (P10 + P90) and
    // put the shaded region roughly twice as high as the truth.
    const { option } = buildProjectionFanOption(
      projection([
        [100, 200, 300],
        [-500, 210, 340],
      ]),
      bandsFor([10, 50, 90])!,
      TOKENS,
    );
    const [floor, band] = series(option);
    expect(floor.data).toEqual([100, -500]);
    expect(band.data).toEqual([200, 840]);
  });

  it("never clamps a negative lower percentile, and never floors the axis at zero", () => {
    const { option, ariaLabel } = buildProjectionFanOption(
      projection([
        [1_000, 1_200, 1_400],
        [-12_345, 800, 2_000],
        [-98_765, -400, 3_000],
      ]),
      bandsFor([10, 50, 90])!,
      TOKENS,
    );
    const [floor] = series(option);
    expect(floor.data).toEqual([1_000, -12_345, -98_765]);
    // `yAxis.min` unset -- pinning it at 0 is the same defect by another route.
    expect((option.yAxis as { min?: unknown }).min).toBeUndefined();
    expect(ariaLabel).toContain("passe sous zéro");
  });

  it("draws the zero line only when the low band actually crosses it", () => {
    const crossing = buildProjectionFanOption(
      projection([
        [100, 200, 300],
        [-500, 210, 340],
      ]),
      bandsFor([10, 50, 90])!,
      TOKENS,
    );
    const healthy = buildProjectionFanOption(
      projection([
        [100, 200, 300],
        [150, 260, 380],
      ]),
      bandsFor([10, 50, 90])!,
      TOKENS,
    );
    expect(series(crossing.option)[2].markLine).toBeDefined();
    expect(series(healthy.option)[2].markLine).toBeUndefined();
    // And the key says what the line means, rather than leaving it to colour.
    expect(crossing.keyEntries.map((e) => e.key)).toContain("zero");
    expect(healthy.keyEntries.map((e) => e.key)).not.toContain("zero");
    expect(healthy.ariaLabel).toContain("Aucune trajectoire");
  });

  it("names the seed and the trial count in the accessible label and the export", () => {
    // A run nobody can reproduce is not a measurement: the seed travels onto
    // the chart itself, not only into the assumptions panel.
    const { ariaLabel, exportRows } = buildProjectionFanOption(
      projection([[100, 200, 300]]),
      bandsFor([10, 50, 90])!,
      TOKENS,
    );
    expect(ariaLabel).toContain("graine 424242");
    expect(ariaLabel).toContain("1000 trajectoires");
    expect(Object.keys(exportRows[0])).toEqual(["Mois", "P10", "P50", "P90"]);
  });

  it("reads the percentiles the run actually asked for, never a hard-coded 10/50/90", () => {
    const bands = bandsFor([5, 50, 95]);
    expect(bands).toEqual({ low: "5", median: "50", high: "95" });
    const { option, keyEntries } = buildProjectionFanOption(
      projection([[10, 20, 30]], [5, 50, 95]),
      bands!,
      TOKENS,
    );
    expect(series(option)[0].data).toEqual([10]);
    expect(keyEntries[0].name).toContain("P5–P95");
  });

  it("refuses a set it cannot draw a band from rather than inventing one", () => {
    expect(bandsFor([50])).toBeNull();
    expect(bandsFor([])).toBeNull();
  });
});
