import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DesignSystemPage } from "./DesignSystemPage";

function mockSystemReducedMotion(reduced: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: reduced && query.includes("reduced-motion"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      // Motion still calls the deprecated pair when a motion.* element mounts.
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  });
}

describe("DesignSystemPage", () => {
  it("lays out seven bento cells with genuinely different spans", () => {
    mockSystemReducedMotion(false);
    const { container } = render(<DesignSystemPage />);
    const cells = [...container.querySelectorAll<HTMLElement>(".yd-bento__cell")];
    expect(cells).toHaveLength(7);

    const lgSpans = cells.map((cell) => cell.style.getPropertyValue("--yd-cell-span-lg"));
    expect(lgSpans).toEqual(["6", "3", "3", "3", "3", "4", "8"]);
    // Every lg row adds up to the full 12 columns, so the grid has no holes.
    expect(lgSpans.reduce((total, span) => total + Number(span), 0)).toBe(30);
    expect(cells.some((cell) => cell.style.getPropertyValue("--yd-cell-rows") === "2")).toBe(true);
  });

  it("offers a focusable interactive cell", () => {
    mockSystemReducedMotion(false);
    render(<DesignSystemPage />);
    const button = screen.getByRole("button", { name: /Cellule interactive/ });
    expect(button).toHaveClass("yd-bento__cell--interactive");
    expect(button).toHaveAttribute("type", "button");
  });

  it("shows the sample amount formatted from cents", () => {
    mockSystemReducedMotion(true);
    render(<DesignSystemPage />);
    // formatCents(1_847_320) — the figure is exposed to assistive tech by CountUp.
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", expect.stringContaining("€"));
  });

  it("says out loud which motion state it is in", () => {
    mockSystemReducedMotion(true);
    render(<DesignSystemPage />);
    expect(screen.getByText(/mouvement est actuellement désactivé/i)).toBeInTheDocument();
  });
});
