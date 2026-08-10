import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// WCAG 2.x AA threshold for normal-weight text (small headings/labels use the
// same figure in this app — nothing here relies on the relaxed large-text
// 3:1 threshold).
const AA_NORMAL_TEXT = 4.5;

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

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    throw new Error(`Not a 6-digit hex colour: "${hex}"`);
  }
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return [r, g, b];
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  const [rl, gl, bl] = [srgbChannelToLinear(r), srgbChannelToLinear(g), srgbChannelToLinear(b)];
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

/** WCAG 2.x contrast ratio: (L_lighter + 0.05) / (L_darker + 0.05). */
function contrastRatio(hexA: string, hexB: string): number {
  const l1 = relativeLuminance(hexA);
  const l2 = relativeLuminance(hexB);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
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

const STATUS_TOKENS = [
  "--yd-accent",
  "--yd-accent-strong",
  "--yd-positive",
  "--yd-negative",
  "--yd-warning",
  "--yd-info",
] as const;

const TEXT_TOKENS = ["--yd-text", "--yd-text-muted"] as const;

const THEMES: Array<{ name: string; tokens: Map<string, string> }> = [
  { name: "light", tokens: lightTokens },
  { name: "dark", tokens: darkTokens },
];

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
