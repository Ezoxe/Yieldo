import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Phase 1 named Geist in tokens.css for twenty-three tasks without ever
// shipping a font file, so every screen silently fell back to the system UI
// font and the "tabular mono figures" the dashboard is built on did not exist.
// jsdom loads no fonts, so nothing mounted can catch that. These read the
// wiring as text instead: the family names, the local packages that provide
// them, and the import that makes Vite bundle the woff2.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (relative: string) => readFileSync(path.resolve(__dirname, relative), "utf8");

const tokensCss = read("./tokens.css");
const mainTsx = read("../main.tsx");
const packageJson = JSON.parse(read("../../package.json")) as {
  dependencies?: Record<string, string>;
};

const FONT_PACKAGES = ["@fontsource-variable/geist", "@fontsource-variable/geist-mono"];

describe("font wiring", () => {
  it("declares both self-hosting packages as runtime dependencies", () => {
    for (const name of FONT_PACKAGES) {
      expect(packageJson.dependencies?.[name], `${name} is not in dependencies`).toBeDefined();
    }
  });

  it("imports them in main.tsx so Vite bundles the woff2 locally", () => {
    for (const name of FONT_PACKAGES) {
      expect(mainTsx).toContain(`import "${name}";`);
    }
  });

  it("names the families the packages actually register, ahead of any fallback", () => {
    // @fontsource-variable registers "Geist Variable" / "Geist Mono Variable".
    // Naming only "Geist" is what silently fell back to the system font.
    expect(tokensCss).toMatch(/--yd-font:\s*"Geist Variable"/);
    expect(tokensCss).toMatch(/--yd-font-mono:\s*"Geist Mono Variable"/);
  });

  it("never reaches a CDN for a font", () => {
    const html = read("../../index.html");
    for (const source of [html, tokensCss, mainTsx]) {
      expect(source).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\./i);
    }
  });
});
