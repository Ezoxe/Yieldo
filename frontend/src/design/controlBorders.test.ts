import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The rule this file exists to hold:
 *
 *   a CSS rule that declares itself a control (`cursor: pointer`) may not take
 *   its border colour from `--yd-border` or `--yd-border-strong`.
 *
 * Both of those are translucent container edges — measured on rendered
 * screens they come out at 1.30–1.55:1 against the surface they sit on, which
 * is under the 3:1 WCAG 1.4.11 asks of "the visual information required to
 * identify user interface components". That is tolerable on a card, whose
 * contents carry their own contrast; it is not tolerable on a button drawn
 * with `background: transparent`, where the hairline is the only thing on
 * screen saying "this is a control". `--yd-border-control` exists for exactly
 * that job and is pinned to 3:1 by design/contrast.test.ts.
 *
 * Scope, stated plainly: this reads the *declarations of one rule*. It cannot
 * see a border colour a control inherits from another class it is composed
 * with (`.yd-dropzone` takes its edge from `.yd-glass--raised`, so no rule of
 * its own would ever be flagged here), and it does not resolve the cascade.
 * It is a regression guard for the shape of defect this repo actually shipped
 * — a control written with a hairline edge — not a proof of contrast.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = path.resolve(__dirname, "..");

const HAIRLINE_BORDER_TOKENS = ["--yd-border", "--yd-border-strong"] as const;

function cssFilesUnder(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) found.push(...cssFilesUnder(full));
    else if (full.endsWith(".css")) found.push(full);
  }
  return found;
}

interface CssRule {
  file: string;
  line: number;
  selectors: string[];
  body: string;
}

/**
 * Every innermost `selector { declarations }` pair in a stylesheet. The
 * declaration body may not itself contain braces, which is what makes the
 * pattern skip an `@media`/`@supports` header and land on the rules nested
 * inside it — none of this app's stylesheets nest any deeper than that.
 */
function parseRules(css: string, file: string): CssRule[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: CssRule[] = [];
  for (const match of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1]
      .trim()
      .replace(/\s+/g, " ")
      .split(",")
      .map((selector) => selector.trim())
      .filter(Boolean);
    if (selectors.length === 0) continue;
    rules.push({
      file,
      line: withoutComments.slice(0, match.index).split("\n").length,
      selectors,
      body: match[2],
    });
  }
  return rules;
}

const RULES: CssRule[] = cssFilesUnder(SRC_ROOT).flatMap((file) =>
  parseRules(readFileSync(file, "utf8"), path.relative(SRC_ROOT, file).split(path.sep).join("/")),
);

/** Selectors of every rule that declares `cursor: pointer` — the controls. */
const CONTROL_SELECTORS = new Set(
  RULES.filter((rule) => /cursor\s*:\s*pointer/.test(rule.body)).flatMap((rule) => rule.selectors),
);

/**
 * A selector belongs to a control if it *is* one of the control selectors, or
 * if it is one of them narrowed by a pseudo-class or an attribute — so a
 * `:hover` / `[aria-expanded="true"]` twin cannot quietly put the hairline
 * back on a control this file just cleared.
 */
function controlBehind(selector: string): string | null {
  for (const control of CONTROL_SELECTORS) {
    if (selector === control) return control;
    if (selector.startsWith(`${control}:`) || selector.startsWith(`${control}[`)) return control;
  }
  return null;
}

function hairlineBordersIn(body: string): string[] {
  const pattern = new RegExp(
    `border(?:-color|-top|-bottom|-left|-right)?\\s*:\\s*[^;]*var\\((${HAIRLINE_BORDER_TOKENS.join("|")})\\)`,
    "g",
  );
  return [...body.matchAll(pattern)].map((match) => match[1]);
}

describe("control boundaries (WCAG 1.4.11)", () => {
  it("finds the app's stylesheets and its controls at all", () => {
    // Guards the guard: a parser that silently matched nothing would let every
    // assertion below pass while checking exactly zero rules.
    expect(RULES.length).toBeGreaterThan(200);
    expect(CONTROL_SELECTORS.size).toBeGreaterThan(20);
  });

  it("never draws a control's border with a container hairline token", () => {
    const offenders = RULES.flatMap((rule) => {
      const hairlines = hairlineBordersIn(rule.body);
      if (hairlines.length === 0) return [];
      return rule.selectors
        .filter((selector) => controlBehind(selector) !== null)
        .map((selector) => `${rule.file}:${rule.line}  ${selector}  ->  ${[...new Set(hairlines)].join(", ")}`);
    });

    expect(
      offenders,
      `These rules style a control (cursor: pointer) but take the border from a container hairline token. ` +
        `Use --yd-border-control for the resting boundary, or --yd-accent for a hover/active state:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
