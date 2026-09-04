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
  text: "#f4f4f6",
  muted: "#a1a1ad",
  border: "rgba(255, 255, 255, 0.06)",
  positive: "#34d399",
  negative: "#fb7185",
  warning: "#fbbf24",
  info: "#60a5fa",
  accent: "#8f8cf8",
  accentStrong: "#a9a7fb",
  surfaceStrong: "#17171d",
};

const LIGHT_TOKENS: ChartTokens = {
  text: "#18181d",
  muted: "#55555f",
  border: "rgba(9, 9, 16, 0.08)",
  positive: "#047857",
  negative: "#be123c",
  warning: "#92400e",
  info: "#1d4ed8",
  accent: "#4f46e5",
  accentStrong: "#3f37c9",
  surfaceStrong: "#ffffff",
};

export function chartTokens(resolved: Resolved): ChartTokens {
  return resolved === "dark" ? DARK_TOKENS : LIGHT_TOKENS;
}

// The two colours a label painted ON a categorical fill may take. Not part of
// `ChartTokens` because they do not vary by theme: the ground under such a
// label is the tile it sits on, not the page. Transcribed from
// `--yd-chart-label-ink` / `--yd-chart-label-paper` and pinned to them by
// theme.test.ts, like every other colour in this file.
export const CHART_LABEL_INK = "#010305";
export const CHART_LABEL_PAPER = "#ffffff";

// -- Categorical palette ----------------------------------------------------
//
// tokens.css names five semantic colours and no categorical ramp, so the eight
// identity hues a treemap or a waterfall needs live here.
//
// One family per theme, at one lightness step: the 400s on the dark card, the
// 500s on the white one. That is what makes a chart read as part of the same
// object as the card around it — the previous ramp mixed a fully saturated
// #008300 green with a pastel magenta and every chart looked like a different
// application.
//
// The 500s and not the 600s in light mode, because `--yd-chart-label-ink` has
// to clear 4.5:1 on every fill it can be painted over: at 600 the darkest of
// them falls to 3.3:1 and no single ink clears the set. Measured worst case as
// written: indigo-500 #6366f1 at 4.62:1.
//
// Order is the CVD-safety mechanism (see the dataviz colour formula): adjacent
// slots never share a hue family. Never reorder or cycle past index 7 — fold a
// ninth series into "Other" instead.
const LIGHT_CATEGORICAL = [
  "#6366f1", // indigo
  "#14b8a6", // teal
  "#f43f5e", // rose
  "#f59e0b", // amber
  "#8b5cf6", // violet
  "#10b981", // emerald
  "#3b82f6", // blue
  "#ec4899", // pink
];

const DARK_CATEGORICAL = [
  "#818cf8", // indigo
  "#2dd4bf", // teal
  "#fb7185", // rose
  "#fbbf24", // amber
  "#a78bfa", // violet
  "#34d399", // emerald
  "#60a5fa", // blue
  "#f472b6", // pink
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

// -- Shared series and control styling ---------------------------------------

/**
 * The curvature every line series in this app is drawn with.
 *
 * `smoothMonotone: "x"` is not decoration — a plain `smooth: 0.35` spline
 * overshoots between two close points and can draw a balance dipping below a
 * value it never reached. Monotone interpolation cannot invent a local
 * minimum that is not in the data, which is the only kind of smoothing a
 * financial series may take.
 */
export const LINE_SMOOTHING = { smooth: 0.35, smoothMonotone: "x" as const };

/**
 * A vertical fade of `color`, from a wash at the line down to nothing at the
 * axis. What turns a hairline into a mass without hiding the gridlines under
 * it — the fill never exceeds 22% alpha.
 */
export function areaFade(color: string): {
  color: {
    type: "linear";
    x: number;
    y: number;
    x2: number;
    y2: number;
    colorStops: Array<{ offset: number; color: string }>;
  };
} {
  return {
    color: {
      type: "linear",
      x: 0,
      y: 0,
      x2: 0,
      y2: 1,
      colorStops: [
        { offset: 0, color: `${color}38` },
        { offset: 1, color: `${color}00` },
      ],
    },
  };
}

/**
 * The time-range control under a chart.
 *
 * ECharts' default slider is a grey box with two square handles and a
 * miniature copy of the series inside it — it reads as a native scrollbar
 * someone left on the page. This restyles it to the app's own surfaces:
 * a hairline groove, an accent-tinted selection, and two pill handles.
 */
export function zoomSlider(tones: ChartTokens) {
  return {
    type: "slider" as const,
    height: 20,
    bottom: 8,
    borderColor: "transparent",
    backgroundColor: "transparent",
    fillerColor: `${tones.accent}1f`,
    // The miniature series inside the groove is noise at 20px tall: the shape
    // is already on the chart above it, in full.
    showDataShadow: false,
    showDetail: false,
    handleIcon:
      "path://M4,0 L8,0 A4,4 0 0 1 12,4 L12,26 A4,4 0 0 1 8,30 L4,30 A4,4 0 0 1 0,26 L0,4 A4,4 0 0 1 4,0 Z",
    handleSize: "115%",
    handleStyle: { color: tones.surfaceStrong, borderColor: tones.muted, borderWidth: 1 },
    moveHandleSize: 4,
    moveHandleStyle: { color: `${tones.accent}66` },
    dataBackground: { lineStyle: { opacity: 0 }, areaStyle: { opacity: 0 } },
    selectedDataBackground: { lineStyle: { opacity: 0 }, areaStyle: { opacity: 0 } },
    brushSelect: false,
  };
}
