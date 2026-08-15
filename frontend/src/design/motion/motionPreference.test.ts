import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { applyMotionAttribute, useMotionPreference } from "./motionPreference";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Comments are stripped everywhere below, so prose naming a selector can never
// satisfy an assertion about the declarations.
const read = (relative: string) =>
  readFileSync(path.resolve(__dirname, relative), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

afterEach(() => {
  useMotionPreference.setState({ disabled: false });
  delete document.documentElement.dataset.motion;
});

describe("motion preference DOM hook", () => {
  it("writes data-motion=\"off\" when the switch disables animations", () => {
    applyMotionAttribute(true);
    expect(document.documentElement.dataset.motion).toBe("off");
  });

  it("writes data-motion=\"on\" when animations are allowed", () => {
    applyMotionAttribute(false);
    expect(document.documentElement.dataset.motion).toBe("on");
  });

  it("moves the attribute with the store, so CSS sees the switch", () => {
    useMotionPreference.getState().setDisabled(true);
    expect(document.documentElement.dataset.motion).toBe("off");

    useMotionPreference.getState().setDisabled(false);
    expect(document.documentElement.dataset.motion).toBe("on");
  });
});

// The point of the attribute is that stylesheets can respond to it. jsdom
// applies no stylesheets, so these read the CSS as text — and each rule below
// is motion the OS media query alone used to gate, which left the in-app
// switch with no reach into CSS at all.
describe("stylesheets respond to data-motion=\"off\"", () => {
  it("zeroes the shared motion duration tokens", () => {
    const tokens = read("../tokens.css");
    const block = /:root\[data-motion="off"\]\s*\{([^}]*)\}/.exec(tokens);
    expect(block, "no :root[data-motion=\"off\"] rule in tokens.css").not.toBeNull();
    const body = (block as RegExpExecArray)[1];
    for (const token of ["--yd-motion-fast", "--yd-motion-base", "--yd-motion-slow"]) {
      expect(body).toMatch(new RegExp(`${token}:\\s*0ms\\s*;`));
    }
  });

  // Every transition in the app is written in those tokens, so zeroing them
  // covers durations. Movement is the other half: a 0ms transition still lets
  // a hover jump the element. These are the rules that hold it still.
  it.each([
    ["../bento/Bento.css", ".yd-bento__cell--interactive:hover", /translate:\s*none/],
    ["../glass/GlassCard.css", ".yd-glass--interactive:hover", /transform:\s*none/],
    [
      "../../features/import/ImportPage.css",
      ".yd-dropzone[data-over]",
      /transform:\s*none/,
    ],
  ])("holds %s's %s still", (file, selector, declaration) => {
    const css = read(file);
    const index = css.indexOf(`:root[data-motion="off"] ${selector}`);
    expect(index, `no :root[data-motion="off"] ${selector} rule in ${file}`).toBeGreaterThan(-1);
    expect(css.slice(index, css.indexOf("}", index))).toMatch(declaration);
  });

  // Keyframe animations carry their own hard-coded durations, so the tokens
  // above cannot reach them.
  it.each([
    ["../atmosphere/AtmosphericBackground.css", ".yd-atmosphere__blob-fill"],
    ["../../features/overview/OverviewPage.css", ".yd-skeleton::after"],
  ])("stops %s's keyframe animation on %s", (file, selector) => {
    const css = read(file);
    const index = css.indexOf(':root[data-motion="off"]');
    expect(index, `no :root[data-motion="off"] rule in ${file}`).toBeGreaterThan(-1);
    const rule = css.slice(index, css.indexOf("}", index));
    expect(rule).toContain(selector);
    expect(rule).toMatch(/animation:\s*none/);
  });
});
