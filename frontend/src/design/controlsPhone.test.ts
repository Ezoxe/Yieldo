import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// jsdom applies no stylesheet, so these read the CSS as text, comments
// stripped: every rule below is something a phone notices at once and a
// mounted test cannot see at all.
const here = path.dirname(fileURLToPath(import.meta.url));
const css = (file: string) =>
  readFileSync(path.resolve(here, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

describe("phone controls", () => {
  // iOS zooms the whole page into any field whose text is under 16px the
  // moment it takes focus, and never zooms back out on its own.
  it("never lets a field zoom an iPhone: 16px under 900px", () => {
    expect(css("./controls.css")).toMatch(
      /@media \(max-width: 899px\)\s*\{[^@]*:where\(input:not[^)]*\), select, textarea\)\s*\{\s*font-size:\s*max\(16px, 1em\) !important/,
    );
  });

  it("raises every standalone control in a screen to 44px on a coarse pointer", () => {
    expect(css("./controls.css")).toMatch(
      /@media \(pointer: coarse\)[\s\S]*\.yd-shell__main :is\([\s\S]*button[\s\S]*\)\s*\{\s*min-height:\s*44px/,
    );
  });

  it("gives a coarse pointer a 44px target", () => {
    expect(css("./controls.css")).toMatch(
      /@media \(pointer: coarse\)[\s\S]*\.yd-tap[^}]*min-height:\s*44px/,
    );
  });
});
