// Every color a chart uses comes from here, and every color here traces back
// to tokens.css. ECharts renders to canvas, so it cannot consume a CSS custom
// property directly -- some literal value has to exist somewhere. This file
// is the one sanctioned place: the chrome colors below (text, muted text,
// border, the five status/accent tones) are transcribed 1:1 from tokens.css
// and cross-checked against it by theme.test.ts's "stays in sync with
// tokens.css" suite, which parses tokens.css from disk (the same technique
// design/contrast.test.ts already uses) -- so any future edit to tokens.css
// that isn't mirrored here fails the build immediately rather than drifting
// silently. (A live `getComputedStyle` read was considered and rejected: it
// would need jsdom's real CSS cascade turned on for tests, which the
// AppShell test suite already showed misfires -- see the task-20 report.)
//
// The one thing tokens.css does not carry -- a categorical identity ramp and
// a spending-magnitude ramp -- comes from the dataviz skill's validated
// default palette, or is computed mathematically from a token declared here.
// No other chart file may write a hex literal: they all go through
// buildEchartsTheme, chartTokens, seriesColors or sequentialRamp.
export type Resolved = "light" | "dark";

// -- Semantic chart tokens ----------------------------------------------
//
// Transcribed from frontend/src/design/tokens.css. Keep in lockstep with
// that file -- theme.test.ts fails loudly if these ever disagree.

export interface ChartTokens {
  text: string;
  muted: string;
  border: string;
  positive: string;
  negative: string;
  warning: string;
  info: string;
  accent: string;
  accentStrong: string;
  surfaceStrong: string;
}

const DARK_TOKENS: ChartTokens = {
  text: "#eef6f8",
  muted: "#93a9b8",
  border: "rgba(126, 226, 214, 0.18)",
  positive: "#4fd6a8",
  negative: "#e5606b",
  warning: "#f4a261",
  info: "#3b82f6",
  accent: "#7ee2d6",
  accentStrong: "#4dc9ba",
  surfaceStrong: "#0f1c28",
};

const LIGHT_TOKENS: ChartTokens = {
  text: "#0d2029",
  muted: "#4a6577",
  border: "rgba(15, 60, 74, 0.14)",
  positive: "#0e7150",
  negative: "#b3232d",
  warning: "#8a4d08",
  info: "#1d4ed8",
  accent: "#0b6d63",
  accentStrong: "#085951",
  surfaceStrong: "#ffffff",
};

export function chartTokens(resolved: Resolved): ChartTokens {
  return resolved === "dark" ? DARK_TOKENS : LIGHT_TOKENS;
}

// -- Categorical palette ----------------------------------------------------
//
// tokens.css has no categorical ramp (it only names six semantic colors), so
// the eight identity hues a treemap/waterfall fallback needs are the
// dataviz skill's documented, pre-validated default palette (see the
// skill's references/palette.md) rather than an invented set. Validated with
// the skill's validator against this app's own card surfaces
// (--yd-surface-strong: #ffffff light / #0f1c28 dark):
//   light -- all 6 checks PASS (contrast WARN on 3 slots, mitigated by the
//     legend + direct labels + CSV export every chart already ships)
//   dark  -- all 6 checks PASS outright
// Order is the CVD-safety mechanism (see color-formula.md) -- never reorder
// or cycle past index 7; fold a 9th series into "Other" instead.
const LIGHT_CATEGORICAL = [
  "#2a78d6", // blue
  "#eb6834", // orange
  "#1baf7a", // aqua
  "#eda100", // yellow
  "#e87ba4", // magenta
  "#008300", // green
  "#4a3aa7", // violet
  "#e34948", // red
];

const DARK_CATEGORICAL = [
  "#3987e5",
  "#d95926",
  "#199e70",
  "#c98500",
  "#d55181",
  "#008300",
  "#9085e9",
  "#e66767",
];

export function seriesColors(resolved: Resolved): string[] {
  return resolved === "dark" ? DARK_CATEGORICAL : LIGHT_CATEGORICAL;
}

// -- Sequential ramp (spending calendar heatmap) -----------------------------

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace("#", "");
  return [
    parseInt(normalized.slice(0, 2), 16),
    parseInt(normalized.slice(2, 4), 16),
    parseInt(normalized.slice(4, 6), 16),
  ];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  const channel = (value: number) => Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function lerpHex(from: string, to: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(from);
  const [r2, g2, b2] = hexToRgb(to);
  return rgbToHex([r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t]);
}

// A magnitude ramp for the spending calendar's heatmap, one hue light->dark
// per the dataviz skill's sequential rule. tokens.css has no dedicated ramp,
// so this is computed between two tokens that already exist above (the card
// surface and the app's own accent-strong teal) rather than adding new hex.
export function sequentialRamp(resolved: Resolved, steps = 6): string[] {
  const tones = chartTokens(resolved);
  return Array.from({ length: steps }, (_, index) =>
    lerpHex(tones.surfaceStrong, tones.accentStrong, (index + 1) / steps),
  );
}

// -- ECharts theme object ----------------------------------------------------

export interface EChartsThemeShape {
  color: string[];
  backgroundColor: string;
  textStyle: { color: string; fontFamily: string };
  title: { textStyle: { color: string; fontWeight: number } };
  categoryAxis: {
    axisLine: { lineStyle: { color: string } };
    axisTick: { show: boolean };
    axisLabel: { color: string; fontSize: number };
    splitLine: { show: boolean };
  };
  valueAxis: {
    axisLine: { show: boolean };
    axisTick: { show: boolean };
    axisLabel: { color: string; fontSize: number; fontFamily: string };
    splitLine: { lineStyle: { color: string; type: "solid" } };
  };
  tooltip: {
    backgroundColor: string;
    borderColor: string;
    borderWidth: number;
    textStyle: { color: string; fontSize: number };
    axisPointer: { lineStyle: { color: string; type: "dashed" } };
  };
  legend: { textStyle: { color: string }; icon: string };
}

export function buildEchartsTheme(resolved: Resolved): EChartsThemeShape {
  const tones = chartTokens(resolved);

  return {
    color: seriesColors(resolved),
    backgroundColor: "transparent",
    // ECharts draws to canvas and cannot read a CSS custom property, so the
    // stack is repeated here. It must stay in step with --yd-font /
    // --yd-font-mono in design/tokens.css.
    textStyle: { color: tones.text, fontFamily: "Geist Variable, Geist, system-ui, sans-serif" },
    title: { textStyle: { color: tones.text, fontWeight: 600 } },
    categoryAxis: {
      axisLine: { lineStyle: { color: tones.border } },
      axisTick: { show: false },
      axisLabel: { color: tones.muted, fontSize: 11 },
      splitLine: { show: false },
    },
    valueAxis: {
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: tones.muted,
        fontSize: 11,
        fontFamily: "Geist Mono Variable, Geist Mono, ui-monospace, monospace",
      },
      // Solid hairline, never dashed: a dashed grid reads as a projection or
      // threshold, not a neutral reference (dataviz skill anti-pattern).
      splitLine: { lineStyle: { color: tones.border, type: "solid" } },
    },
    tooltip: {
      backgroundColor: tones.surfaceStrong,
      borderColor: tones.border,
      borderWidth: 1,
      textStyle: { color: tones.text, fontSize: 12 },
      // The crosshair is an interactive affordance, not a static gridline --
      // dashing it here helps it read as "the pointer", distinct from the
      // solid reference grid.
      axisPointer: { lineStyle: { color: tones.muted, type: "dashed" } },
    },
    legend: { textStyle: { color: tones.muted }, icon: "roundRect" },
  };
}
