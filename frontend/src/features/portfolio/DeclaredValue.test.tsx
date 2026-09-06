import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DeclaredHolding, PortfolioTotal } from "../../lib/types";
import { declaredAmountInput, parseDeclaredAmount } from "./AccountForm";
import { TotalPanel, declaredOnSentence } from "./TotalPanel";

const total: PortfolioTotal = {
  market_value_cents: 2_450_000,
  cost_basis_cents: 1_000_000,
  unrealised_gain_cents: 0,
  positions_total: 1,
  positions_valued: 1,
  positions_missing_price: 0,
  positions_missing_fx: 0,
};

const declared: DeclaredHolding[] = [
  { account_id: 4, name: "MACIF", kind: "assurance_vie", value_cents: 1_450_000,
    declared_on: "2026-08-31" },
];

beforeEach(() => {
  vi.restoreAllMocks();
});

// null is "declares nothing", undefined is "cannot be read". A typo that
// collapsed the two would take thousands of euros off the total without a word.
describe("parseDeclaredAmount", () => {
  it("reads an empty field as declaring nothing", () => {
    expect(parseDeclaredAmount("")).toBeNull();
    expect(parseDeclaredAmount("   ")).toBeNull();
  });

  it("reads euros as integer cents, both separators and thousands spaces", () => {
    expect(parseDeclaredAmount("14500")).toBe(1_450_000);
    expect(parseDeclaredAmount("14 500,50")).toBe(1_450_050);
    expect(parseDeclaredAmount("14500.50")).toBe(1_450_050);
  });

  it("refuses what it cannot read, distinctly from an empty field", () => {
    expect(parseDeclaredAmount("douze")).toBeUndefined();
    expect(parseDeclaredAmount("-1")).toBeUndefined();
    expect(parseDeclaredAmount("1,234")).toBeUndefined();
  });

  it("round-trips through the field it fills", () => {
    expect(declaredAmountInput(1_450_000)).toBe("14500,00");
    expect(declaredAmountInput(null)).toBe("");
    expect(parseDeclaredAmount(declaredAmountInput(1_450_050))).toBe(1_450_050);
  });
});

// The date is never invented. A declared amount with no date is reported
// without one rather than dressed up as today's reading.
describe("declaredOnSentence", () => {
  it("names the day the figure was read", () => {
    expect(declaredOnSentence("2026-08-31")).toBe(" au 31 août 2026");
  });

  it("says nothing at all when the household did not say", () => {
    expect(declaredOnSentence(null)).toBe("");
  });
});

describe("TotalPanel with a declared amount", () => {
  it("says how much of the total was declared rather than measured", () => {
    render(<TotalPanel total={total} reportingCurrency="EUR" declared={declared}
                       declaredTotalCents={1_450_000} />);

    const block = screen.getByTestId("yd-portfolio-declared");
    expect(block).toHaveTextContent("MACIF");
    expect(block).toHaveTextContent("au 31 août 2026");
  });

  // A declared envelope was not valued from a price, so counting it among the
  // "positions valorisées" would overstate what the application measured.
  it("leaves the position counts alone", () => {
    render(<TotalPanel total={total} reportingCurrency="EUR" declared={declared}
                       declaredTotalCents={1_450_000} />);

    expect(screen.getByTestId("yd-portfolio-completeness")).toHaveTextContent(
      "1 position valorisée sur 1.",
    );
  });

  it("prints nothing at all when nothing was declared", () => {
    render(<TotalPanel total={total} reportingCurrency="EUR" />);
    expect(screen.queryByTestId("yd-portfolio-declared")).toBeNull();
  });
});
