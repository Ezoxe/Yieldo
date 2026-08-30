import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Ownership } from "../../lib/types";
import { OwnershipPanel } from "./OwnershipPanel";
import { OPERATOR_REPORT } from "./fixtures";

function renderPanel(ownership: Ownership = OPERATOR_REPORT.ownership) {
  render(
    <OwnershipPanel
      ownership={ownership}
      opportunityCostCents={OPERATOR_REPORT.opportunity_cost_cents}
      opportunityHorizonMonths={OPERATOR_REPORT.opportunity_horizon_months}
    />,
  );
}

describe("OwnershipPanel", () => {
  it("lists every cost line with its total and its monthly average", () => {
    renderPanel();
    const table = within(screen.getByTestId("yd-own-lines"));
    expect(table.getByText("Assurance")).toBeInTheDocument();
    expect(table.getByText(/3 900,00/)).toBeInTheDocument();
    expect(table.getByText(/^65,00 €$/)).toBeInTheDocument();
    expect(table.getByText("Carburant")).toBeInTheDocument();
    expect(table.getByText(/7 800,00/)).toBeInTheDocument();
  });

  it("states depreciation and residual value SEPARATELY from the running costs", () => {
    // One is money leaving the account, the other is value leaving the asset,
    // and a panel that summed them without saying so would be comparing two
    // different things under one total.
    renderPanel();
    const split = screen.getByText(/argent qui quitte votre compte/);
    expect(split).toHaveTextContent(/15 900,00/); // running costs
    expect(split).toHaveTextContent(/22 251,79/); // depreciation
    expect(split).toHaveTextContent(/17 748,21/); // residual value
    expect(split).toHaveTextContent(/valeur qui quitte le bien/);
  });

  it("prints the total, and says which two things it adds", () => {
    renderPanel();
    expect(screen.getByText(/38 151,79/)).toBeInTheDocument();
    expect(screen.getByText(/Frais de fonctionnement et décote réunis/)).toHaveTextContent(
      /635,86/,
    );
  });

  it("prints the opportunity cost over the HOLDING period, not the saving horizon", () => {
    renderPanel();
    expect(screen.getByText(/6 464,66/)).toBeInTheDocument();
    expect(screen.getByText(/60 mois de possession/)).toBeInTheDocument();
    // And says what kind of figure it is, since it is not a payment.
    expect(screen.getByText(/gain auquel vous renoncez/)).toBeInTheDocument();
  });

  it("labels every line as a French average rather than as a measurement", () => {
    renderPanel();
    expect(screen.getByText(/moyenne française, pas une mesure/)).toBeInTheDocument();
  });

  it("says so rather than showing an empty table when a nature has no defaults", () => {
    // `defaults_for("other")` returns nothing at all, on purpose: inventing a
    // fuel budget for a sofa would be a fabricated figure.
    renderPanel({
      ...OPERATOR_REPORT.ownership,
      lines: [],
      running_cost_cents: 0,
      total_cost_cents: 0,
      monthly_average_cents: 0,
    });
    expect(screen.queryByTestId("yd-own-lines")).not.toBeInTheDocument();
    expect(screen.getByText(/Yieldo n'invente pas de moyenne/)).toBeInTheDocument();
  });
});
