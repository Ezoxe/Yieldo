import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { GlassCard } from "./GlassCard";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Comments are stripped so a rule described in prose cannot satisfy — or
// falsify — an assertion about the declarations themselves.
const css = readFileSync(path.resolve(__dirname, "./GlassCard.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

describe("GlassCard", () => {
  it("renders its children", () => {
    render(<GlassCard>Patrimoine</GlassCard>);
    expect(screen.getByText("Patrimoine")).toBeInTheDocument();
  });

  it("uses a blurred surface by default", () => {
    const { container } = render(<GlassCard>x</GlassCard>);
    expect(container.firstChild).toHaveClass("yd-glass");
    expect(container.firstChild).not.toHaveClass("yd-glass--solid");
  });

  it("drops the blur for data surfaces", () => {
    const { container } = render(<GlassCard tone="solid">x</GlassCard>);
    expect(container.firstChild).toHaveClass("yd-glass--solid");
  });

  it("only mounts the sheen when interactive", () => {
    const { container: plain } = render(<GlassCard>x</GlassCard>);
    expect(plain.querySelector(".yd-sheen")).toBeNull();
    const { container: interactive } = render(<GlassCard interactive>x</GlassCard>);
    expect(interactive.querySelector(".yd-sheen")).not.toBeNull();
  });

  it("renders as the requested element for correct semantics", () => {
    render(<GlassCard as="section" aria-label="Résumé">x</GlassCard>);
    expect(screen.getByRole("region", { name: "Résumé" })).toBeInTheDocument();
  });

  it("keeps caller classes", () => {
    const { container } = render(<GlassCard className="p-6">x</GlassCard>);
    expect(container.firstChild).toHaveClass("p-6");
  });
});

// jsdom applies no stylesheets, so these read GlassCard.css as text — the
// defect below is invisible to a mounted test and was only ever caught in a
// browser.
describe("GlassCard.css", () => {
  // Same defect Bento.css was fixed for: a card rendered under a `motion.*`
  // element carries an inline `transform: none` that Motion writes once the
  // entry animation settles, and an inline declaration beats a stylesheet
  // rule. A `transform` lift here is therefore dead on arrival — the
  // independent `translate` property is not touched by Motion.
  it("lifts interactive cards with `translate`, never with `transform`", () => {
    const hover = /\.yd-glass--interactive:hover \{([^}]*)\}/.exec(css);
    expect(hover, "no hover rule for interactive cards").not.toBeNull();
    const body = (hover as RegExpExecArray)[1];
    expect(body).toMatch(/translate:\s*0 -2px\s*;/);
    expect(body).not.toMatch(/transform:/);
  });

  it("cancels the lift for reduced motion and for the in-app switch", () => {
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.yd-glass--interactive:hover \{[^}]*translate:\s*none/,
    );
    expect(css).toMatch(
      /:root\[data-motion="off"\] \.yd-glass--interactive:hover \{[^}]*translate:\s*none/,
    );
  });

  it("transitions the property it actually animates", () => {
    const base = /\.yd-glass \{([^}]*)\}/.exec(css);
    expect(base, "no .yd-glass rule").not.toBeNull();
    expect((base as RegExpExecArray)[1]).toMatch(/transition:[^;]*translate/);
  });
});
