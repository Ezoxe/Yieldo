import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// WCAG 2.x AA threshold for normal-weight text (small headings/labels use the
// same figure in this app — nothing here relies on the relaxed large-text
// 3:1 threshold).
const AA_NORMAL_TEXT = 4.5;

// WCAG 2.x 1.4.11 (non-text contrast): the visual information required to
// identify a user interface component and its state. A control's boundary is
// held to this, not to the 4.5:1 text figure.
const AA_NON_TEXT = 3;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKENS_PATH = path.resolve(__dirname, "./tokens.css");

/**
 * WCAG 2.x relative luminance: normalise each sRGB channel to [0, 1], then
 * linearise it (the 0.03928 threshold below which the response is treated as
 * linear), then weight by the standard luminosity coefficients.
 */
function srgbChannelToLinear(channel255: number): number {
  const channel = channel255 / 255;
  return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
}

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
  const normalized = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    throw new Error(`Not a 6-digit hex colour: "${hex}"`);
  }
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return [r, g, b];
}

function relativeLuminanceFromRgb([r, g, b]: Rgb): number {
  const [rl, gl, bl] = [srgbChannelToLinear(r), srgbChannelToLinear(g), srgbChannelToLinear(b)];
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

/** WCAG 2.x contrast ratio: (L_lighter + 0.05) / (L_darker + 0.05). */
function contrastRatioRgb(a: Rgb, b: Rgb): number {
  const l1 = relativeLuminanceFromRgb(a);
  const l2 = relativeLuminanceFromRgb(b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function contrastRatio(hexA: string, hexB: string): number {
  return contrastRatioRgb(hexToRgb(hexA), hexToRgb(hexB));
}

/** Parses `rgb(r, g, b)` / `rgba(r, g, b, a)` -- the shape tokens.css uses for
 * its translucent surface tokens -- into channel values and an alpha
 * (defaulting to 1 when absent). */
function parseRgba(value: string): { rgb: Rgb; alpha: number } {
  const match = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(value.trim());
  if (!match) {
    throw new Error(`Not an rgb()/rgba() colour: "${value}"`);
  }
  const [, r, g, b, a] = match;
  return { rgb: [Number(r), Number(g), Number(b)], alpha: a === undefined ? 1 : Number(a) };
}

/** Extracts `--token: rgba(...);` declarations from a single CSS block body. */
function parseRgbaDeclarations(block: string): Map<string, { rgb: Rgb; alpha: number }> {
  const declarations = new Map<string, { rgb: Rgb; alpha: number }>();
  const propertyPattern = /(--[\w-]+)\s*:\s*(rgba?\([^)]*\))\s*;/g;
  for (const match of block.matchAll(propertyPattern)) {
    const [, name, value] = match;
    declarations.set(name, parseRgba(value));
  }
  return declarations;
}

/**
 * Alpha-composites a translucent foreground over an opaque background,
 * channel by channel, using the raw (fractional) blend rather than rounding
 * to an integer pixel first. Matches how the ratios already documented in
 * tokens.css's own comments were derived, and how a browser's flat
 * `background-color` alpha blend actually lands.
 */
function compositeOverOpaque(fg: { rgb: Rgb; alpha: number }, bg: Rgb): Rgb {
  const [fr, fgc, fb] = fg.rgb;
  const [br, bgc, bb] = bg;
  return [
    fg.alpha * fr + (1 - fg.alpha) * br,
    fg.alpha * fgc + (1 - fg.alpha) * bgc,
    fg.alpha * fb + (1 - fg.alpha) * bb,
  ];
}

/** Extracts `--token: #rrggbb;` declarations from a single CSS block body. */
function parseHexDeclarations(block: string): Map<string, string> {
  const declarations = new Map<string, string>();
  const propertyPattern = /(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g;
  for (const match of block.matchAll(propertyPattern)) {
    const [, name, value] = match;
    declarations.set(name, value);
  }
  return declarations;
}

/**
 * Finds the first CSS rule whose selector matches `selectorPattern` and
 * returns its declaration block (the text between its outermost braces).
 * None of the token rules in tokens.css nest braces inside themselves, so a
 * simple "next closing brace" scan is sufficient.
 */
function findRuleBlock(css: string, selectorPattern: RegExp): string {
  const match = selectorPattern.exec(css);
  if (!match) {
    throw new Error(`No CSS rule found in tokens.css for pattern ${selectorPattern}`);
  }
  const braceStart = css.indexOf("{", match.index);
  const braceEnd = css.indexOf("}", braceStart);
  if (braceStart === -1 || braceEnd === -1) {
    throw new Error(`Malformed CSS rule for pattern ${selectorPattern}`);
  }
  return css.slice(braceStart + 1, braceEnd);
}

const tokensCss = readFileSync(TOKENS_PATH, "utf8");

// The bare `:root` block holds the theme-agnostic defaults (including the
// dark-tuned status colours). Each themed block overrides only what differs,
// exactly like the CSS cascade resolves custom properties in the browser —
// so a theme that forgets to override a token (the actual bug here) is
// caught by evaluating the *effective* cascaded value, not just presence.
const rootBlock = findRuleBlock(tokensCss, /:root\s*\{/);
const darkBlock = findRuleBlock(tokensCss, /:root\[data-theme="dark"\]\s*\{/);
const lightBlock = findRuleBlock(tokensCss, /:root\[data-theme="light"\]\s*\{/);

const rootTokens = parseHexDeclarations(rootBlock);
const darkTokens = new Map([...rootTokens, ...parseHexDeclarations(darkBlock)]);
const lightTokens = new Map([...rootTokens, ...parseHexDeclarations(lightBlock)]);

const rootRgbaTokens = parseRgbaDeclarations(rootBlock);
const darkRgbaTokens = new Map([...rootRgbaTokens, ...parseRgbaDeclarations(darkBlock)]);
const lightRgbaTokens = new Map([...rootRgbaTokens, ...parseRgbaDeclarations(lightBlock)]);

const STATUS_TOKENS = [
  "--yd-accent",
  "--yd-accent-strong",
  "--yd-positive",
  "--yd-negative",
  "--yd-warning",
  "--yd-info",
] as const;

// `--yd-negative-text` is here and not in STATUS_TOKENS on purpose: it is a
// TEXT colour (the one an alert's message takes when the panel under it is
// tinted from `--yd-negative` itself), so 4.5:1 is its floor, not 3:1. Listing
// it is what stops it being quietly edited back towards `--yd-negative` --
// the regression class the phase-wide contrast pass existed to find. This
// check sees it against the bare page only; the tinted-panel composite that
// motivated the token is measured in a browser, not here (tokens.css cannot
// express a composite and this file cannot render one).
const TEXT_TOKENS = ["--yd-text", "--yd-text-muted", "--yd-negative-text"] as const;

// Boundaries of user interface components, held to 1.4.11's 3:1 rather than
// to the text threshold. `--yd-border` and `--yd-border-strong` are
// deliberately NOT here: they are container edges, they are translucent (so
// they have no fixed ratio at all), and `design/controlBorders.test.ts` is
// what keeps them off controls.
//
// An earlier version of this suite measured only against
// `--yd-surface-strong` on the claim that it is "the lightest ground in the
// dark theme and the darkest in the light one". That is false for the light
// theme: `--yd-surface-strong` there is `#ffffff` (tokens.css:135), the
// lightest possible value, not the darkest -- it was the easier of two
// pairings tokens.css's own comments already measure (tokens.css:139-141).
// `controlGroundsForTheme` below now tests every token in
// CONTROL_BORDER_TOKENS against both `--yd-surface-strong` AND the genuine
// worst-case ground per theme:
//   - light: `--yd-bg` itself. Every light-theme surface token is a
//     white/near-white overlay ON TOP of `--yd-bg` (rgba(255,255,255,*)), so
//     nothing in the theme is darker -- `--yd-bg` is the deepest exposed
//     ground, exactly what tokens.css:139-141 already calls "the deepest
//     exposed ground".
//   - dark: `--yd-surface-raised` (a 50% wash, tokens.css:81) composited over
//     `--yd-bg`. The dark theme's translucent surfaces LIGHTEN the near-black
//     page rather than darken it, so the lightest exposed ground -- not the
//     opaque `--yd-surface-strong` card -- is the worst case for a border
//     that is lighter than its ground.
const CONTROL_BORDER_TOKENS = ["--yd-border-control"] as const;

const THEMES: Array<{
  name: string;
  tokens: Map<string, string>;
  rgbaTokens: Map<string, { rgb: Rgb; alpha: number }>;
}> = [
  { name: "light", tokens: lightTokens, rgbaTokens: lightRgbaTokens },
  { name: "dark", tokens: darkTokens, rgbaTokens: darkRgbaTokens },
];

interface Ground {
  label: string;
  rgb: Rgb;
}

/** The set of grounds a control's edge can genuinely land on in a theme --
 * see the CONTROL_BORDER_TOKENS comment above for why these two, and why
 * they differ by theme rather than both being `--yd-surface-strong`. */
function controlGroundsForTheme(
  themeName: string,
  tokens: Map<string, string>,
  rgbaTokens: Map<string, { rgb: Rgb; alpha: number }>,
): Ground[] {
  const surfaceStrong = tokens.get("--yd-surface-strong");
  const bg = tokens.get("--yd-bg");
  if (!surfaceStrong) {
    throw new Error(`--yd-surface-strong is not declared as a plain hex for the ${themeName} theme`);
  }
  if (!bg) {
    throw new Error(`--yd-bg is not declared for the ${themeName} theme`);
  }

  const grounds: Ground[] = [{ label: "--yd-surface-strong (the opaque card)", rgb: hexToRgb(surfaceStrong) }];

  if (themeName === "light") {
    grounds.push({ label: "--yd-bg (the deepest exposed ground)", rgb: hexToRgb(bg) });
  } else {
    const surfaceRaised = rgbaTokens.get("--yd-surface-raised");
    if (!surfaceRaised) {
      throw new Error(`--yd-surface-raised is not declared as rgba(...) for the ${themeName} theme`);
    }
    grounds.push({
      label: "--yd-surface-raised composited over --yd-bg (the lightest exposed ground)",
      rgb: compositeOverOpaque(surfaceRaised, hexToRgb(bg)),
    });
  }

  return grounds;
}

describe("contrast helper (WCAG 2.x formulas)", () => {
  it("matches the WCAG worked example of black on white (21:1)", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
  });

  it("is 1:1 for identical colours", () => {
    expect(contrastRatio("#7ee2d6", "#7ee2d6")).toBeCloseTo(1, 5);
  });

  it("is symmetric regardless of argument order", () => {
    expect(contrastRatio("#12897d", "#f2f7f9")).toBeCloseTo(contrastRatio("#f2f7f9", "#12897d"), 10);
  });
});

describe("tokens.css contrast (WCAG 2.x AA, normal text, 4.5:1)", () => {
  for (const { name: themeName, tokens } of THEMES) {
    const bg = tokens.get("--yd-bg");

    it(`${themeName} theme declares --yd-bg`, () => {
      expect(bg, `--yd-bg is not declared for the ${themeName} theme`).toBeDefined();
    });

    for (const tokenName of [...STATUS_TOKENS, ...TEXT_TOKENS]) {
      it(`${themeName} theme: ${tokenName} clears 4.5:1 against --yd-bg`, () => {
        const hex = tokens.get(tokenName);
        expect(hex, `${tokenName} is not declared (directly or via :root) for the ${themeName} theme`).toBeDefined();
        expect(bg, `--yd-bg is not declared for the ${themeName} theme`).toBeDefined();

        const ratio = contrastRatio(hex as string, bg as string);
        expect(
          ratio,
          `${themeName} ${tokenName} (${hex}) against --yd-bg (${bg}) is only ${ratio.toFixed(2)}:1, below the ${AA_NORMAL_TEXT}:1 AA threshold`,
        ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
      });
    }
  }
});

describe("tokens.css control boundaries (WCAG 2.x 1.4.11, non-text, 3:1)", () => {
  for (const { name: themeName, tokens, rgbaTokens } of THEMES) {
    const grounds = controlGroundsForTheme(themeName, tokens, rgbaTokens);

    for (const tokenName of CONTROL_BORDER_TOKENS) {
      for (const ground of grounds) {
        it(`${themeName} theme: ${tokenName} clears 3:1 against ${ground.label}`, () => {
          const hex = tokens.get(tokenName);
          expect(
            hex,
            `${tokenName} is not declared (directly or via :root) for the ${themeName} theme`,
          ).toBeDefined();

          const ratio = contrastRatioRgb(hexToRgb(hex as string), ground.rgb);
          expect(
            ratio,
            `${themeName} ${tokenName} (${hex}) against ${ground.label} is only ${ratio.toFixed(2)}:1, below the ${AA_NON_TEXT}:1 threshold WCAG 1.4.11 sets for a control's boundary`,
          ).toBeGreaterThanOrEqual(AA_NON_TEXT);
        });
      }
    }
  }
});
