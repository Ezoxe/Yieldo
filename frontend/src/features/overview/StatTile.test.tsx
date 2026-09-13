import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { formatCents } from "../../design/theme";

// getByText compares against the DOM's *normalized* text content (runs of
// whitespace collapsed to one regular space -- and JS's \s matches the
// narrow/no-break spaces formatCents uses for thousands separators and
// before the currency sign), but does not normalize the string it is given.
// Collapsing the expected value the same way keeps these assertions honest
// without hand-typing invisible Unicode.
function normalizedText(value: string): string {
  return value.replace(/\s+/g, " ");
}

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("reduced-motion"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

import { StatTile } from "./StatTile";

/**
 * The sparkline is painted behind the figure and bled to the cell's edges —
 * at 1440 a band under a tall tile. Seen at 390: the tile is short, the
 * band reached the middle of the tile, and the rose line ran straight
 * through « −1 318,00 € ». Under 640 px it becomes a strip below the figure.
 */
describe("StatTile stylesheet", () => {
  it("puts the sparkline under the figure on a phone, not behind it", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const css = readFileSync(path.resolve(here, "./StatTile.css"), "utf8");
    const phone = css.match(/@media \(max-width: 640px\)\s*\{([\s\S]*?)\n\}/);
    expect(phone).not.toBeNull();
    const rule = phone?.[1].match(/\.yd-stat-tile__sparkline\s*\{([^}]*)\}/);
    expect(rule?.[1]).toMatch(/position:\s*static/);
  });
});

describe("StatTile", () => {
  it("shows the label and the formatted value", () => {
    render(<StatTile label="Solde net" valueCents={232109} />);
    expect(screen.getByText("Solde net")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", formatCents(232109));
  });

  it("shows a signed delta against the previous period", () => {
    render(<StatTile label="Solde net" valueCents={232109} deltaCents={4180} />);
    expect(screen.getByText(normalizedText(formatCents(4180, { signed: true })))).toBeInTheDocument();
  });

  it("states that there is no comparison rather than showing a fake zero", () => {
    render(<StatTile label="Taux d'épargne" valueCents={null} />);
    expect(screen.getByText("Donnée indisponible")).toBeInTheDocument();
  });

  it("still shows Donnée indisponible even when a delta is supplied alongside a null value", () => {
    // A null current value makes any delta meaningless -- never render a
    // signed comparison against an unknown baseline.
    render(<StatTile label="Taux d'épargne" valueCents={null} deltaCents={500} />);
    expect(screen.getByText("Donnée indisponible")).toBeInTheDocument();
    expect(screen.queryByText(normalizedText(formatCents(500, { signed: true })))).not.toBeInTheDocument();
  });

  it("colors a negative delta as the unfavorable direction", () => {
    render(<StatTile label="Solde net" valueCents={232109} deltaCents={-4180} />);
    const delta = screen.getByText(normalizedText(formatCents(-4180, { signed: true })));
    expect(delta).toHaveClass("yd-stat-tile__delta--bad");
  });

  it("renders a decorative sparkline without exposing it to assistive tech", () => {
    render(<StatTile label="Solde net" valueCents={232109} sparkline={[1, 2, 3, 2, 5]} />);
    const svg = document.querySelector(".yd-stat-tile__sparkline");
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });
});
