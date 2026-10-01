import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface SceneSources {
  /** Every stylesheet of the scene, concatenated. */
  css: string;
  /** Every stylesheet and component of the scene, tests left out. */
  text: string;
}

/** Each scene directory (`car`, `house`, …) and its sources; `shared/` is everyone's on purpose. */
function sceneSources(): Map<string, SceneSources> {
  const scenes = new Map<string, SceneSources>();
  for (const entry of readdirSync(__dirname, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "shared") continue;
    const directory = path.join(__dirname, entry.name);
    const files = readdirSync(directory).filter(
      (file) => /\.(css|tsx?)$/.test(file) && !/\.test\.tsx?$/.test(file),
    );
    const read = (file: string) => readFileSync(path.join(directory, file), "utf8");
    scenes.set(entry.name, {
      css: files.filter((file) => file.endsWith(".css")).map(read).join("\n"),
      text: files.map(read).join("\n"),
    });
  }
  return scenes;
}

/** The lens classes a stylesheet styles for the whole document: a selector that starts with one. */
function unscopedLensClasses(css: string): Set<string> {
  return new Set([...css.matchAll(/^\s*\.(yd-lens__[\w-]+)/gm)].map((match) => match[1]));
}

function mentionedLensClasses(text: string): Set<string> {
  return new Set([...text.matchAll(/yd-lens__[\w-]+/g)].map((match) => match[0]));
}

describe("scene stylesheets", () => {
  // Every scene's stylesheet is loaded with the page, so a rule written for one
  // scene's lens reaches any other scene that uses the same class name.
  it("never let a lens rule written for one scene reach another", () => {
    const scenes = sceneSources();
    const leaks: string[] = [];
    for (const [owner, { css }] of scenes) {
      for (const name of unscopedLensClasses(css)) {
        for (const [other, { text }] of scenes) {
          if (other !== owner && mentionedLensClasses(text).has(name)) {
            leaks.push(`${name}: styled by ${owner}, used by ${other}`);
          }
        }
      }
    }
    expect(leaks).toEqual([]);
  });
});
