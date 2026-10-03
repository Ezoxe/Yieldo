import { describe, expect, it } from "vitest";

import { chartMotion, chartSignature } from "./chartAnimation";

describe("chartMotion", () => {
  // A chart is drawn once a session; after that it changes shape from what
  // the reader saw, and does not move at all when the data did not change.
  it("draws a chart seen for the first time", () => {
    expect(chartMotion(undefined, "abc")).toBe("draw");
  });

  it("holds still when the data is what the reader last saw", () => {
    expect(chartMotion("abc", "abc")).toBe("still");
  });

  it("morphs when the data changed since", () => {
    expect(chartMotion("abc", "abd")).toBe("morph");
  });
});

describe("chartSignature", () => {
  it("reads the data and the categories, not the styling", () => {
    const base = {
      xAxis: { type: "category" as const, data: ["a", "b"] },
      series: [{ type: "bar" as const, data: [1, 2], itemStyle: { color: "red" } }],
    };
    const restyled = { ...base, series: [{ ...base.series[0], itemStyle: { color: "blue" } }] };
    const moved = { ...base, series: [{ ...base.series[0], data: [1, 3] }] };
    const otherMonths = { ...base, xAxis: { type: "category" as const, data: ["b", "c"] } };

    expect(chartSignature(restyled)).toBe(chartSignature(base));
    expect(chartSignature(moved)).not.toBe(chartSignature(base));
    expect(chartSignature(otherMonths)).not.toBe(chartSignature(base));
  });
});
