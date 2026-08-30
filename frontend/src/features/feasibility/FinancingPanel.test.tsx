import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Financing } from "../../lib/types";
import { FinancingPanel } from "./FinancingPanel";
import { OPERATOR_REPORT } from "./fixtures";

const OPERATOR = OPERATOR_REPORT.financing;

function renderPanel(financing: Financing = OPERATOR, loanRateBps = 500) {
  const onAddLoa = vi.fn();
  render(
    <FinancingPanel financing={financing} loanRateBps={loanRateBps} onAddLoa={onAddLoa} />,
  );
  return onAddLoa;
}

describe("FinancingPanel", () => {
  it("shows the three columns with their own cash figures", () => {
    renderPanel();
    const cash = within(screen.getByTestId("yd-fin-cash"));
    // TWICE on the cash line, and correctly so: what leaves the account on day
    // one and what is paid in total are the same 40 000 € when there is no loan.
    expect(cash.getAllByText(/40 000,00/)).toHaveLength(2);
    expect(cash.getByText(/4 879,85|48 798,54/)).toBeInTheDocument();
    const credit = within(screen.getByTestId("yd-fin-credit"));
    expect(credit.getByText(/754,85/)).toBeInTheDocument();
    // Anchored: the 45 290,93 € total paid on the same card contains this run
    // of characters, and an unanchored match would find both.
    expect(credit.getByText(/^5 290,93/)).toBeInTheDocument();
    expect(credit.getByText(/^45 290,93/)).toBeInTheDocument();
    expect(screen.getByTestId("yd-fin-loa")).toBeInTheDocument();
  });

  it("names the break-even rate AND which side the user's own rate falls on", () => {
    renderPanel();
    const crossover = screen.getByTestId("yd-fin-crossover");
    expect(crossover).toHaveTextContent(/2,99 %/);
    expect(crossover).toHaveTextContent(/5,00 %/);
    expect(crossover).toHaveTextContent(/au-dessus/);
    expect(crossover).toHaveTextContent(/payer comptant est préférable/);
  });

  it("says the user's rate is below the crossing when it is", () => {
    // The control: without it, "au-dessus" passes on a panel hardcoding it.
    renderPanel(OPERATOR, 150);
    expect(screen.getByTestId("yd-fin-crossover")).toHaveTextContent(/en dessous/);
  });

  it("prints the break-even reason verbatim when there is no crossing", () => {
    const reason =
      "Emprunter coûte plus que ne rapporte votre épargne, quel que soit le taux : au rendement " +
      "retenu, payer comptant est toujours préférable.";
    renderPanel({ ...OPERATOR, break_even_rate_bps: null, break_even_reason: reason });
    expect(screen.getByTestId("yd-fin-crossover")).toHaveTextContent(reason);
  });

  it("reads the wealth gap before better_kind, so a tie is not called a win", () => {
    // `better_kind` reports an exact tie as "cash" and cannot tell it from a
    // win. A panel branching on the flag alone would name a preference that
    // does not exist.
    renderPanel({ ...OPERATOR, better_kind: "cash", wealth_gap_cents: 0 });
    expect(screen.getByText(/exactement le même patrimoine/)).toBeInTheDocument();
    expect(screen.queryByText(/de plus que payer comptant/)).not.toBeInTheDocument();
  });

  it("says comptant wins by a stated amount on the operator's figures", () => {
    renderPanel();
    expect(screen.getByText(/Payer comptant vous laisse 2 333,88 . de plus/)).toBeInTheDocument();
  });

  it("declines to name a better path when the credit could not be priced", () => {
    renderPanel({ ...OPERATOR, better_kind: null, wealth_gap_cents: null });
    expect(screen.getByText(/ne peut être déclaré préférable/)).toBeInTheDocument();
  });

  it("states in words that only cash and credit were compared", () => {
    renderPanel();
    expect(screen.getByText(/ne compare que le comptant et le crédit/)).toBeInTheDocument();
    expect(screen.getByText(/La LOA n'est pas dans la course/)).toBeInTheDocument();
  });

  it("offers the LOA fields rather than inventing a quote", async () => {
    const user = userEvent.setup();
    const onAddLoa = renderPanel();
    const loa = within(screen.getByTestId("yd-fin-loa"));
    expect(loa.getByText(/Yieldo ne les invente pas/)).toBeInTheDocument();
    await user.click(loa.getByRole("button", { name: /Saisir un devis de LOA/ }));
    expect(onAddLoa).toHaveBeenCalled();
  });

  it("never renders a null end wealth as zero on an available option", () => {
    const reason =
      "Aucun patrimoine final n'est calculé pour la LOA : selon que l'option d'achat est levée " +
      "ou non, vous finissez propriétaire du bien ou sans rien, et le contrat laisse ce choix " +
      "ouvert.";
    renderPanel({
      ...OPERATOR,
      options: [
        ...OPERATOR.options.slice(0, 2),
        {
          kind: "loa",
          available: true,
          unavailable_reason: null,
          out_of_pocket_cents: 500_000,
          monthly_cents: 45_000,
          total_paid_cents: 4_460_000,
          interest_cents: null,
          wealth_at_end_cents: null,
          wealth_unavailable_reason: reason,
        },
      ],
    });
    const loa = within(screen.getByTestId("yd-fin-loa"));
    expect(loa.getByText(reason)).toBeInTheDocument();
    expect(loa.queryByText(/Patrimoine à la fin/)).not.toBeInTheDocument();
    expect(loa.queryByText(/^0,00 €$/)).not.toBeInTheDocument();
  });
});
