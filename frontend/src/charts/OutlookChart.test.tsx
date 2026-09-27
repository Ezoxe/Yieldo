import { describe, expect, it } from "vitest";

import { OUTLOOK } from "../features/avenir/fixtures";
import type { Outlook } from "../lib/types";
import { buildOutlookOption } from "./OutlookChart";
import { chartTokens } from "./theme";

type Series = {
  name?: string;
  data?: unknown[];
  lineStyle?: { type?: string };
  markLine?: { data?: Array<{ yAxis?: number }> };
  markArea?: { data?: unknown[][] };
  markPoint?: { data?: Array<{ name?: string; coord?: unknown[] }> };
};

function seriesOf(outlook: Outlook, scenario: Outlook | null = null): Series[] {
  const option = buildOutlookOption(outlook, scenario, chartTokens("dark"));
  return option.series as Series[];
}

describe("buildOutlookOption", () => {
  it("draws the band as its floor plus its height, and the median on top", () => {
    const [floor, band, median] = seriesOf(OUTLOOK);
    expect(floor.data).toEqual(OUTLOOK.days.map((day) => day.p10_cents));
    expect(band.data).toEqual(OUTLOOK.days.map((day) => day.p90_cents - day.p10_cents));
    expect(median.data).toEqual(OUTLOOK.days.map((day) => day.p50_cents));
  });

  it("draws no band when there is none to draw", () => {
    const names = seriesOf({ ...OUTLOOK, band: false }).map((series) => series.name);
    expect(names).not.toContain("band");
  });

  it("marks the threshold on the median", () => {
    const median = seriesOf(OUTLOOK).find((series) => series.name === "median");
    expect(median?.markLine?.data).toEqual([{ yAxis: 0 }]);
  });

  it("shades the days already past but not yet imported", () => {
    const median = seriesOf({ ...OUTLOOK, stale_days: 5 }).find((s) => s.name === "median");
    expect(median?.markArea?.data).toHaveLength(1);
    const fresh = seriesOf({ ...OUTLOOK, stale_days: 0 }).find((s) => s.name === "median");
    expect(fresh?.markArea).toBeUndefined();
  });

  it("marks incomes and the large charges, not every coffee", () => {
    const median = seriesOf(OUTLOOK).find((series) => series.name === "median");
    const names = (median?.markPoint?.data ?? []).map((point) => point.name);
    expect(names).toContain("VIR SEPA ACME SAS SALAIRE");
    expect(names).toContain("PRLV SEPA FONCIA LOYER");
  });

  it("adds the scenario as a dashed line of its own", () => {
    const scenario = { ...OUTLOOK, days: OUTLOOK.days.map((day) => ({ ...day, p50_cents: 0 })) };
    const drawn = seriesOf(OUTLOOK, scenario).find((series) => series.name === "scenario");
    expect(drawn?.lineStyle?.type).toBe("dashed");
    expect(drawn?.data).toEqual(OUTLOOK.days.map(() => 0));
  });

  it("prints an event's label as text in the tooltip", () => {
    const hostile = { ...OUTLOOK, events: [{ ...OUTLOOK.events[0], label: "<img src=x onerror=1>" }] };
    const option = buildOutlookOption(hostile, null, chartTokens("dark"));
    const formatter = (option.tooltip as { formatter: (p: unknown) => string }).formatter;
    const salaryIndex = OUTLOOK.days.findIndex((day) => day.on === "2026-09-28");
    const html = formatter([{ dataIndex: salaryIndex }]);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});
