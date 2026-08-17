import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * jsdom applies no stylesheets and composites nothing, so a mounted test can
 * assert a skeleton bar exists while it is, on screen, the same colour as the
 * card underneath it. That is not hypothetical: `.yd-skeleton` was painted with
 * `--yd-surface-raised`, which in the light theme is rgba(255,255,255,0.86)
 * over a #ffffff cell -- measured in a browser at exactly 1.000:1, i.e. three
 * blank white cards for the whole of every screen's loading state.
 *
 * So this test does the compositing arithmetic itself: it reads the real token
 * values out of tokens.css, resolves the `color-mix()` the stylesheet declares,
 * lays the result over the cell surface a skeleton actually sits on
 * (`--yd-surface-strong`, from Bento.css), and checks the two differ.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (relative: string) => readFileSync(path.resolve(__dirname, relative), "utf8");

const skeletonCss = read("./Skeleton.css").replace(/\/\*[\s\S]*?\*\//g, "");
const tokensCss = read("./tokens.css");

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
  const n = hex.trim().replace(/^#/, "");
  return [
    parseInt(n.slice(0, 2), 16),
    parseInt(n.slice(2, 4), 16),
    parseInt(n.slice(4, 6), 16),
  ];
}

function srgbChannelToLinear(channel255: number): number {
  const channel = channel255 / 255;
  return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
}

function relativeLuminance([r, g, b]: Rgb): number {
  return (
    0.2126 * srgbChannelToLinear(r) +
    0.7152 * srgbChannelToLinear(g) +
    0.0722 * srgbChannelToLinear(b)
  );
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const [l1, l2] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** `source-over` compositing of a colour at `alpha` onto an opaque backdrop. */
function composite(color: Rgb, alpha: number, backdrop: Rgb): Rgb {
  return color.map((c, i) => c * alpha + backdrop[i] * (1 - alpha)) as Rgb;
}

function findRuleBlock(css: string, selector: RegExp): string {
  const match = selector.exec(css);
  if (!match) throw new Error(`No rule matching ${selector}`);
  const start = css.indexOf("{", match.index);
  return css.slice(start + 1, css.indexOf("}", start));
}

function parseHex(block: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const [, name, value] of block.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    out.set(name, value);
  }
  return out;
}

const rootTokens = parseHex(findRuleBlock(tokensCss, /:root\s*\{/));
const THEMES = {
  dark: new Map([...rootTokens, ...parseHex(findRuleBlock(tokensCss, /:root\[data-theme="dark"\]\s*\{/))]),
  light: new Map([...rootTokens, ...parseHex(findRuleBlock(tokensCss, /:root\[data-theme="light"\]\s*\{/))]),
};

const skeletonRule = findRuleBlock(skeletonCss, /\.yd-skeleton\s*\{/);

/**
 * The `color-mix(in srgb, var(--token) N%, transparent)` the stylesheet
 * declares, or null if the background is not one. Deliberately not asserting
 * here: this runs at collection time, and a bare `expect` would fail the whole
 * file with "no tests" instead of naming which check broke.
 */
function parseSkeletonMix(): { token: string; percent: number } | null {
  const match =
    /background:\s*color-mix\(\s*in srgb\s*,\s*var\((--[\w-]+)\)\s+([\d.]+)%\s*,\s*transparent\s*\)/.exec(
      skeletonRule,
    );
  if (!match) return null;
  return { token: match[1], percent: Number(match[2]) };
}

// A skeleton bar is a placeholder, not text: it only has to be *seen*, so the
// bar is held to the 1.1:1 a plain grey placeholder on white clears rather
// than to any AA text threshold. The failure this guards against is 1.000:1,
// which is not "subtle" but literally absent.
const MIN_VISIBLE = 1.1;

describe("Skeleton.css", () => {
  const mix = parseSkeletonMix();

  it("paints the bar as a tint of a token, so the arithmetic below can be done", () => {
    expect(
      mix,
      `.yd-skeleton's background is not a color-mix over a token: "${skeletonRule.trim()}"`,
    ).not.toBeNull();
  });

  it("does not paint the bar with a surface token, which tracks the card underneath it", () => {
    // --yd-surface-raised is 86% white in the light theme and the cell is pure
    // white: the two cannot be told apart. Whatever the bar is made of, it must
    // not be one of the surfaces it is drawn on top of.
    expect(skeletonRule).not.toMatch(/background:[^;]*--yd-surface/);
  });

  for (const [themeName, tokens] of Object.entries(THEMES)) {
    it(`${themeName} theme: the bar is visible against the cell it sits on`, () => {
      expect(mix).not.toBeNull();
      const { token, percent } = mix as { token: string; percent: number };
      const mixed = tokens.get(token);
      const surface = tokens.get("--yd-surface-strong");
      expect(mixed, `${token} is not declared for the ${themeName} theme`).toBeDefined();
      expect(surface, `--yd-surface-strong is not declared for the ${themeName} theme`).toBeDefined();

      const cell = hexToRgb(surface as string);
      const bar = composite(hexToRgb(mixed as string), percent / 100, cell);
      const ratio = contrastRatio(bar, cell);

      expect(
        ratio,
        `${themeName}: a skeleton bar composites to rgb(${bar.map(Math.round)}) on ` +
          `--yd-surface-strong (${surface}), only ${ratio.toFixed(3)}:1 — invisible on screen`,
      ).toBeGreaterThanOrEqual(MIN_VISIBLE);
    });
  }
});
