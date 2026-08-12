import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BentoCell } from "./BentoCell";
import { BentoGrid } from "./BentoGrid";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Comments are stripped so a rule named in prose ("no backdrop-filter here")
// cannot satisfy — or falsify — an assertion about the declarations.
const css = readFileSync(path.resolve(__dirname, "./Bento.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

describe("BentoGrid", () => {
  it("renders its cells", () => {
    render(
      <BentoGrid>
        <BentoCell>Solde</BentoCell>
      </BentoGrid>,
    );
    expect(screen.getByText("Solde")).toBeInTheDocument();
  });

  it("keeps caller classes and semantics", () => {
    render(<BentoGrid as="section" aria-label="Tableau de bord" className="mt-4" />);
    const grid = screen.getByRole("region", { name: "Tableau de bord" });
    expect(grid).toHaveClass("yd-bento");
    expect(grid).toHaveClass("mt-4");
  });
});

describe("BentoCell spans", () => {
  it("declares its span as custom properties, not as grid-column", () => {
    const { container } = render(<BentoCell span={{ base: 1, md: 3, lg: 4 }} rows={2} />);
    const cell = container.firstChild as HTMLElement;
    expect(cell.style.getPropertyValue("--yd-cell-span-base")).toBe("1");
    expect(cell.style.getPropertyValue("--yd-cell-span-md")).toBe("3");
    expect(cell.style.getPropertyValue("--yd-cell-span-lg")).toBe("4");
    expect(cell.style.getPropertyValue("--yd-cell-rows")).toBe("2");
    // An inline grid-column would beat every media query in Bento.css.
    expect(cell.style.gridColumn).toBe("");
  });

  it("defaults to full width on mobile, half the 6-column grid otherwise", () => {
    const { container } = render(<BentoCell />);
    const cell = container.firstChild as HTMLElement;
    expect(cell.style.getPropertyValue("--yd-cell-span-base")).toBe("1");
    expect(cell.style.getPropertyValue("--yd-cell-span-md")).toBe("6");
    expect(cell.style.getPropertyValue("--yd-cell-span-lg")).toBe("6");
    expect(cell.style.getPropertyValue("--yd-cell-rows")).toBe("1");
  });

  it("falls back to the md span when only md is given", () => {
    const { container } = render(<BentoCell span={{ md: 2 }} />);
    const cell = container.firstChild as HTMLElement;
    expect(cell.style.getPropertyValue("--yd-cell-span-lg")).toBe("2");
  });

  it("keeps caller styles alongside the span properties", () => {
    const { container } = render(<BentoCell span={{ md: 2 }} style={{ minHeight: "200px" }} />);
    const cell = container.firstChild as HTMLElement;
    expect(cell.style.minHeight).toBe("200px");
    expect(cell.style.getPropertyValue("--yd-cell-span-md")).toBe("2");
  });
});

describe("BentoCell interactivity", () => {
  it("is inert by default", () => {
    const { container } = render(<BentoCell>x</BentoCell>);
    expect(container.firstChild).not.toHaveClass("yd-bento__cell--interactive");
  });

  it("renders as a real button so the focus ring has something to attach to", () => {
    render(
      <BentoCell as="button" type="button" interactive>
        Ouvrir
      </BentoCell>,
    );
    const button = screen.getByRole("button", { name: "Ouvrir" });
    expect(button).toHaveClass("yd-bento__cell--interactive");
  });
});

// jsdom applies no stylesheets, so these read Bento.css as text — every rule
// below is a defect that a mounted test cannot see.
describe("Bento.css", () => {
  it("steps 1 -> 6 -> 12 columns", () => {
    expect(css).toMatch(/\.yd-bento \{[^}]*grid-template-columns:\s*repeat\(1, 1fr\)/);
    expect(css).toMatch(
      /@media \(min-width: 768px\) \{[\s\S]*?grid-template-columns:\s*repeat\(6, 1fr\)/,
    );
    expect(css).toMatch(
      /@media \(min-width: 1200px\) \{[\s\S]*?grid-template-columns:\s*repeat\(12, 1fr\)/,
    );
  });

  it("keeps cells opaque — no backdrop-filter on a data surface", () => {
    expect(css).not.toMatch(/backdrop-filter/);
  });

  // The lift must use `translate`, not `transform`. A cell rendered as a
  // `motion.*` element carries an inline `transform: none` once its entry
  // animation settles, and that inline declaration beats this rule — the hover
  // then does nothing at all, which is invisible in jsdom and was confirmed in
  // a browser.
  it("lifts interactive cells with `translate`, and never scales them", () => {
    const hover = /\.yd-bento__cell--interactive:hover \{([^}]*)\}/.exec(css);
    expect(hover, "no hover rule for interactive cells").not.toBeNull();
    const body = (hover as RegExpExecArray)[1];
    expect(body).toMatch(/translate:\s*0 -2px\s*;/);
    expect(body).not.toMatch(/transform:/);
    expect(body).not.toMatch(/scale\(/);
  });

  it("gives every cell min-width: 0 so a long figure cannot widen the grid", () => {
    const cell = /\.yd-bento__cell \{([^}]*)\}/.exec(css);
    expect(cell, "no .yd-bento__cell rule").not.toBeNull();
    expect((cell as RegExpExecArray)[1]).toMatch(/min-width:\s*0\s*;/);
  });
});
