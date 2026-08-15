import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  SIGNATURE_EASE,
  bentoStagger,
  cardEntry,
  entryProps,
  fadeInUp,
  inViewStaggerProps,
  slideOver,
  staggerProps,
} from "./variants";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKENS_PATH = path.resolve(__dirname, "../tokens.css");

/** Reads a `transition.ease` off a variant without fighting Motion's union types. */
function easeOf(variant: unknown): unknown {
  const visible = (variant as Record<string, { transition?: { ease?: unknown } }>).visible;
  return visible?.transition?.ease;
}

describe("SIGNATURE_EASE", () => {
  it("is the phase 1.5 signature curve", () => {
    expect(SIGNATURE_EASE).toEqual([0.16, 1, 0.3, 1]);
  });

  // The CSS side and the JS side animate the same elements; a drift between
  // them is invisible in tests and obvious on screen.
  it("matches the --yd-ease token in tokens.css", () => {
    const tokens = readFileSync(TOKENS_PATH, "utf8");
    const match = /--yd-ease:\s*cubic-bezier\(([^)]+)\)/.exec(tokens);
    expect(match, "--yd-ease is not declared as a cubic-bezier in tokens.css").not.toBeNull();
    const numbers = (match as RegExpExecArray)[1].split(",").map((part) => Number(part.trim()));
    expect(numbers).toEqual([...SIGNATURE_EASE]);
  });
});

describe("motion variants", () => {
  it("uses the signature easing everywhere", () => {
    for (const variant of [fadeInUp, slideOver, cardEntry]) {
      expect(easeOf(variant)).toEqual([...SIGNATURE_EASE]);
    }
  });

  it("cardEntry rises from below at full transparency", () => {
    expect(cardEntry.hidden).toEqual({ opacity: 0, y: 18 });
    expect(cardEntry.visible).toMatchObject({ opacity: 1, y: 0 });
  });

  it("bentoStagger spaces its children", () => {
    expect(bentoStagger.visible).toEqual({
      transition: { staggerChildren: 0.06, delayChildren: 0.05 },
    });
  });
});

describe("entry helpers", () => {
  it("the container drives the timeline", () => {
    expect(staggerProps(false)).toEqual({
      initial: "hidden",
      animate: "visible",
      variants: bentoStagger,
    });
  });

  // An item that declared its own `animate` would opt out of the parent's
  // stagger and fire on mount, so it carries variants and nothing else.
  it("an item carries variants only, so it inherits the stagger", () => {
    expect(entryProps(false)).toEqual({ variants: cardEntry });
  });

  it("the scroll-triggered container arrives once and never replays", () => {
    expect(inViewStaggerProps(false)).toEqual({
      initial: "hidden",
      whileInView: "visible",
      viewport: { once: true, amount: 0.1 },
      variants: bentoStagger,
    });
  });

  // A section five viewports tall never shows more than 20% of itself, and a
  // threshold it cannot cross leaves its cells at opacity 0 permanently.
  it("keeps the viewport threshold low enough for a very tall section", () => {
    const viewport = inViewStaggerProps(false).viewport;
    expect(viewport?.amount).toBeLessThanOrEqual(0.15);
    expect(viewport?.amount).toBeGreaterThan(0);
  });

  it("all three are inert under reduced motion", () => {
    expect(staggerProps(true)).toEqual({});
    expect(entryProps(true)).toEqual({});
    expect(inViewStaggerProps(true)).toEqual({});
  });
});
