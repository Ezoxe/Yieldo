import type { EChartsOption } from "echarts";

/**
 * How a chart arrives, given what the session last showed of it:
 *
 *   - `draw`  the first time this session — the line traces itself, the bars
 *             rise one after another: the shape is being shown;
 *   - `morph` the data changed since — the shape moves from what the reader
 *             saw to what is true now, so the change is what they see;
 *   - `still` nothing changed — no animation at all; a chart that redraws
 *             itself on every visit says nothing but « I was redrawn ».
 */
export type ChartMotion = "draw" | "morph" | "still";

export function chartMotion(previous: string | undefined, signature: string): ChartMotion {
  if (previous === undefined) return "draw";
  return previous === signature ? "still" : "morph";
}

function asList<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * What a chart SAYS, for comparing two visits: its series' data and its
 * category axes — never its colours or formatters, which change with the
 * theme and say nothing new.
 */
export function chartSignature(option: EChartsOption): string {
  const data = (entry: unknown) => (entry as { data?: unknown } | undefined)?.data ?? null;
  return JSON.stringify({
    series: asList(option.series).map(data),
    x: asList(option.xAxis as unknown).map(data),
    y: asList(option.yAxis as unknown).map(data),
  });
}
