import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { BudgetLine } from "../../lib/types";
import { BudgetBar, fillPercent } from "./BudgetBar";

const line: BudgetLine = {
  category_id: 1,
  name: "Courses",
  color: "#4fd6a8",
  is_essential: true,
  budget_cents: 30000,
  spent_cents: -24000,
  remaining_cents: 6000,
  consumed_ratio: 0.8,
  projected_cents: null,
  status: "ok",
};

describe("fillPercent", () => {
  it("is the consumed share as a percentage string", () => {
    expect(fillPercent(0.8)).toBe("80%");
  });

  it("caps at 100 so a threefold overrun does not overflow the row", () => {
    expect(fillPercent(3.4)).toBe("100%");
  });

  it("never goes negative", () => {
    expect(fillPercent(-1)).toBe("0%");
  });
});

describe("BudgetBar", () => {
  it("names the category and states both figures", () => {
    render(<BudgetBar line={line} />);
    expect(screen.getByText("Courses")).toBeInTheDocument();
    // Spent as a magnitude, never "−240,00 € sur 300,00 €".
    expect(screen.getByText(/240,00/)).toBeInTheDocument();
    expect(screen.getByText(/300,00/)).toBeInTheDocument();
  });

  it("exposes the consumption as a progress bar with its real value", () => {
    render(<BudgetBar line={line} />);
    const bar = screen.getByRole("progressbar", { name: /Courses/ });
    expect(bar).toHaveAttribute("aria-valuenow", "80");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
  });

  it("says what is left in words, not only in colour", () => {
    render(<BudgetBar line={line} />);
    expect(screen.getByText(/Il reste/)).toBeInTheDocument();
  });

  it("says how much was overspent when the ceiling is passed", () => {
    render(<BudgetBar line={{ ...line, spent_cents: -34500, remaining_cents: -4500, consumed_ratio: 1.15, status: "over" }} />);
    expect(screen.getByText(/Dépassé de/)).toBeInTheDocument();
    expect(screen.getByText(/Dépassé de 45,00/)).toBeInTheDocument();
  });

  it("states the projection when the month is on pace to overrun", () => {
    render(<BudgetBar line={{ ...line, spent_cents: -20000, remaining_cents: 10000, consumed_ratio: 0.67, projected_cents: -41333, status: "at_risk" }} />);
    expect(screen.getByText(/À ce rythme/)).toBeInTheDocument();
    expect(screen.getByText(/413,33/)).toBeInTheDocument();
  });

  it("says nothing about a pace it does not have", () => {
    render(<BudgetBar line={line} />);
    expect(screen.queryByText(/À ce rythme/)).not.toBeInTheDocument();
  });
});
