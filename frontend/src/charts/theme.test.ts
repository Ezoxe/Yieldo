import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildEchartsTheme, chartTokens, seriesColors, sequentialRamp } from "./theme";

describe("echarts theme", () => {
  it("uses readable text on a dark background", () => {
    const theme = buildEchartsTheme("dark");
    expect(theme.textStyle.color).toBe("#eef6f8");
    expect(theme.backgroundColor).toBe("transparent");
  });

  it("swaps to dark text on a light background", () => {
    expect(buildEchartsTheme("light").textStyle.color).toBe("#0d2029");
  });

  it("uses tabular monospace for value axes so figures align", () => {
    expect(buildEchartsTheme("dark").valueAxis.axisLabel.fontFamily).toContain("Geist Mono");
  });

  it("provides enough categorical colors before repeating", () => {
    expect(seriesColors("dark").length).toBeGreaterThanOrEqual(8);
    expect(new Set(seriesColors("dark")).size).toBe(seriesColors("dark").length);
  });

  it("never repaints the same categorical hue for two different slots in light mode either", () => {
    expect(seriesColors("light").length).toBeGreaterThanOrEqual(8);
    expect(new Set(seriesColors("light")).size).toBe(seriesColors("light").length);
  });

  it("draws gridlines as solid hairlines, never dashed (dataviz anti-pattern)", () => {
    const theme = buildEchartsTheme("dark");
    expect(theme.valueAxis.splitLine.lineStyle.type).toBe("solid");
  });

  it("uses the muted text token for axis labels in both themes", () => {
    expect(buildEchartsTheme("dark").categoryAxis.axisLabel.color).toBe("#93a9b8");
    expect(buildEchartsTheme("light").categoryAxis.axisLabel.color).toBe("#4a6577");
  });
});

describe("chartTokens", () => {
  it("exposes the semantic tokens charts need", () => {
    const dark = chartTokens("dark");
    expect(dark.positive).toBe("#4fd6a8");
    expect(dark.info).toBe("#3b82f6");
    expect(dark.surfaceStrong).toBe("#0f1c28");
  });
});

describe("sequentialRamp", () => {
  it("returns a monotonic light-to-strong ramp with no repeated stops", () => {
    const ramp = sequentialRamp("dark", 5);
    expect(ramp).toHaveLength(5);
    expect(new Set(ramp).size).toBe(5);
  });
});

// -- Cross-check against tokens.css ------------------------------------------
//
// ECharts renders to canvas and cannot consume a CSS custom property, so
// theme.ts keeps its own literal copy of the tokens it needs (see the header
// comment in theme.ts for why a live getComputedStyle read was rejected).
// This suite is what keeps that copy honest: it parses tokens.css from disk,
// exactly like design/contrast.test.ts already does, and fails the moment
// theme.ts's values drift from the source of truth.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKENS_PATH = path.resolve(__dirname, "../design/tokens.css");

function extractBlock(css: string, selector: RegExp): string {
  const match = selector.exec(css);
  if (!match) throw new Error(`No CSS rule found in tokens.css for pattern ${selector}`);
  const braceStart = css.indexOf("{", match.index);
  const braceEnd = css.indexOf("}", braceStart);
  return css.slice(braceStart + 1, braceEnd);
}

function parseDeclarations(block: string): Map<string, string> {
  const declarations = new Map<string, string>();
  const pattern = /(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6}|rgba?\([^;]+\))\s*;/g;
  for (const match of block.matchAll(pattern)) declarations.set(match[1], match[2].trim());
  return declarations;
}

const tokensCss = readFileSync(TOKENS_PATH, "utf8");
const rootTokens = parseDeclarations(extractBlock(tokensCss, /:root\s*\{/));
const darkTokens = new Map([...rootTokens, ...parseDeclarations(extractBlock(tokensCss, /:root\[data-theme="dark"\]\s*\{/))]);
const lightTokens = new Map([...rootTokens, ...parseDeclarations(extractBlock(tokensCss, /:root\[data-theme="light"\]\s*\{/))]);

// Normalizes rgba() whitespace so "rgba(126,226,214,.18)" and
// "rgba(126, 226, 214, 0.18)" compare equal -- only formatting differs.
function normalizeColor(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
}

describe("theme.ts stays in sync with tokens.css", () => {
  const CHART_TO_CSS_VAR: Record<keyof ReturnType<typeof chartTokens>, string> = {
    text: "--yd-text",
    muted: "--yd-text-muted",
    border: "--yd-border",
    positive: "--yd-positive",
    negative: "--yd-negative",
    warning: "--yd-warning",
    info: "--yd-info",
    accent: "--yd-accent",
    accentStrong: "--yd-accent-strong",
    surfaceStrong: "--yd-surface-strong",
  };

  for (const [resolvedName, cssTokens] of [
    ["dark", darkTokens],
    ["light", lightTokens],
  ] as const) {
    for (const [chartKey, cssVar] of Object.entries(CHART_TO_CSS_VAR)) {
      it(`${resolvedName}.${chartKey} matches tokens.css's ${cssVar}`, () => {
        const cssValue = cssTokens.get(cssVar);
        expect(cssValue, `${cssVar} is not declared in tokens.css for the ${resolvedName} theme`).toBeDefined();
        const chartValue = chartTokens(resolvedName)[chartKey as keyof ReturnType<typeof chartTokens>];
        expect(normalizeColor(chartValue)).toBe(normalizeColor(cssValue as string));
      });
    }
  }
});
