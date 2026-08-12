import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useMotionPreference } from "../motion/motionPreference";
import { AtmosphericBackground } from "./AtmosphericBackground";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSS_PATH = path.resolve(__dirname, "./AtmosphericBackground.css");
// Comments are stripped so prose naming a property cannot satisfy an
// assertion about the declarations.
const css = readFileSync(CSS_PATH, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

function mockSystemReducedMotion(reduced: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: reduced && query.includes("reduced-motion"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      // Motion still calls the deprecated pair on mount.
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  });
}

afterEach(() => {
  useMotionPreference.setState({ disabled: false });
});

describe("AtmosphericBackground", () => {
  it("is decorative: hidden from assistive technology", () => {
    mockSystemReducedMotion(false);
    const { getByTestId } = render(<AtmosphericBackground />);
    expect(getByTestId("yd-atmosphere")).toHaveAttribute("aria-hidden", "true");
  });

  it("renders the dither above the blobs, so it breaks their contours", () => {
    mockSystemReducedMotion(false);
    const { container } = render(<AtmosphericBackground />);
    const children = [...(container.querySelector(".yd-atmosphere")?.children ?? [])];
    expect(children.at(-1)).toHaveClass("yd-atmosphere__grain");
  });

  it("renders the three ambient blobs", () => {
    mockSystemReducedMotion(false);
    const { container } = render(<AtmosphericBackground />);
    expect(container.querySelectorAll(".yd-atmosphere__blob")).toHaveLength(3);
    expect(container.querySelector(".yd-atmosphere__blob--a")).not.toBeNull();
    expect(container.querySelector(".yd-atmosphere__blob--b")).not.toBeNull();
    expect(container.querySelector(".yd-atmosphere__blob--c")).not.toBeNull();
  });

  it("animates when motion is allowed", () => {
    mockSystemReducedMotion(false);
    const { getByTestId } = render(<AtmosphericBackground />);
    expect(getByTestId("yd-atmosphere")).toHaveClass("yd-atmosphere--animated");
  });

  it("drops the animation class entirely when the OS asks for reduced motion", () => {
    mockSystemReducedMotion(true);
    const { getByTestId } = render(<AtmosphericBackground />);
    expect(getByTestId("yd-atmosphere")).not.toHaveClass("yd-atmosphere--animated");
  });

  it("drops it for the in-app Animations switch too", () => {
    mockSystemReducedMotion(false);
    useMotionPreference.setState({ disabled: true });
    const { getByTestId } = render(<AtmosphericBackground />);
    expect(getByTestId("yd-atmosphere")).not.toHaveClass("yd-atmosphere--animated");
  });
});

// jsdom applies no stylesheets, so these read the CSS as text. They exist
// because each rule below is a defect that is invisible in a mounted test and
// obvious in a browser.
describe("AtmosphericBackground.css", () => {
  it("keeps the layer at z-index 0, never behind the root background", () => {
    const layer = /\.yd-atmosphere \{([^}]*)\}/.exec(css);
    expect(layer, ".yd-atmosphere rule not found").not.toBeNull();
    expect((layer as RegExpExecArray)[1]).toMatch(/z-index:\s*0\s*;/);
  });

  it("only ever animates transform", () => {
    const keyframeBodies = css.match(/@keyframes[^{]*\{[\s\S]*?\n\}/g) ?? [];
    expect(keyframeBodies.length).toBe(3);
    for (const body of keyframeBodies) {
      const properties = [...body.matchAll(/^\s{4}([a-z-]+):/gm)].map((match) => match[1]);
      expect(properties.every((property) => property === "transform")).toBe(true);
    }
  });

  // Visible strength is size x tint alpha x element opacity. The plan caps
  // only the last of the three, so that cap is the one thing a future pass
  // raising the atmosphere must not quietly step over.
  it("keeps every blob's element opacity inside the plan's 0.08-0.12 band", () => {
    // Scoped to the blob rules: the dither carries an opacity of its own, and
    // it is not covered by the plan's band.
    const opacities = [
      ...css.matchAll(/\.yd-atmosphere__blob--[abc] \{([^}]*)\}/g),
    ].map((rule) => Number(/opacity:\s*([\d.]+)\s*;/.exec(rule[1])?.[1]));
    expect(opacities).toHaveLength(3);
    for (const opacity of opacities) {
      expect(opacity).toBeGreaterThanOrEqual(0.08);
      expect(opacity).toBeLessThanOrEqual(0.12);
    }
  });

  it("gives each halo a core: the tint falls off well inside its box", () => {
    const stops = [...css.matchAll(/radial-gradient\(circle,[^)]*\)[^;]*transparent (\d+)%/g)].map(
      (match) => Number(match[1]),
    );
    expect(stops).toHaveLength(3);
    for (const stop of stops) {
      expect(stop).toBeLessThanOrEqual(62);
    }
  });

  it("dithers with an inline data URI, never a fetched asset", () => {
    const grain = /\.yd-atmosphere__grain \{([^}]*)\}/.exec(css);
    expect(grain, ".yd-atmosphere__grain rule not found").not.toBeNull();
    const body = (grain as RegExpExecArray)[1];
    expect(body).toMatch(/background-image:\s*url\("data:image\/svg\+xml,/);
    expect(body).toMatch(/feTurbulence/);
    // Any url() left once the data URI is removed would be a network request
    // on a layer that must cost none. (The one inside the SVG is its own
    // filter reference, which never leaves the document.)
    expect(body.replace(/url\("data:[^"]*"\)/g, "")).not.toMatch(/url\(/);
  });

  it("holds the blobs still under prefers-reduced-motion, before hydration", () => {
    const start = css.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(start, "no prefers-reduced-motion block in AtmosphericBackground.css").toBeGreaterThan(
      -1,
    );
    expect(css.slice(start)).toMatch(/animation:\s*none\s*;/);
  });
});
