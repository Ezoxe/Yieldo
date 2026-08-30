import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Lever, LeverKind } from "../../lib/types";
import { OPERATOR_REPORT } from "./fixtures";
import { LeverList } from "./LeverList";

/** A lever with every field explicitly null, the way `levers._lever` builds it,
 *  so a card can never read a stale value from another kind. */
function lever(kind: LeverKind, over: Partial<Lever> = {}): Lever {
  return {
    kind,
    feasible: true,
    unavailable_reason: null,
    note: null,
    extra_monthly_cents: null,
    effort_ratio: null,
    reached_in_months: null,
    delay_months: null,
    reduced_target_cents: null,
    borrow_cents: null,
    loan_payment_cents: null,
    loan_total_interest_cents: null,
    debt_ratio_bps: null,
    debt_ratio_exceeded: false,
    category_id: null,
    category_name: null,
    category_median_cents: null,
    cut_monthly_cents: null,
    months_at_or_below: null,
    months_observed: null,
    ...over,
  };
}

function card(kind: LeverKind) {
  return within(screen.getByTestId(`yd-lever-${kind}`));
}

describe("LeverList", () => {
  it("renders the five levers with feasible ones first", () => {
    render(<LeverList levers={OPERATOR_REPORT.levers} />);
    // Anchored: the refusal paragraphs carry `yd-lever-reason-*` testids of
    // their own, and a loose prefix would count nine "cards".
    const cards = screen.getAllByTestId(
      /^yd-lever-(save_more|borrow|delay|reduce_target|cut_category)$/,
    );
    expect(cards).toHaveLength(5);
    // Exactly the order `build_levers` returned for this household: feasible
    // first, so `borrow` sits SECOND and `delay` third — not the documented
    // tie-break order, which only applies inside each group.
    expect(cards.map((node) => node.dataset.testid)).toEqual([
      "yd-lever-save_more",
      "yd-lever-borrow",
      "yd-lever-delay",
      "yd-lever-reduce_target",
      "yd-lever-cut_category",
    ]);
  });

  it("says what an extra monthly saving really costs on a deficit", () => {
    render(<LeverList levers={OPERATOR_REPORT.levers} />);
    const saveMore = card("save_more");
    expect(saveMore.getByText(/\+4 033,94/)).toBeInTheDocument();
    // No effort percentage: `effort_ratio` is null against a negative capacity,
    // and a ratio there would render as "−540 % d'effort".
    expect(saveMore.queryByText(/d'effort/)).not.toBeInTheDocument();
    expect(saveMore.getByText(/retour à l'équilibre/)).toBeInTheDocument();
  });

  it("prints the effort percentage when there IS one", () => {
    // The control for the case above: without it, "no percentage" passes on a
    // component that never prints one at all.
    render(
      <LeverList
        levers={[lever("save_more", { extra_monthly_cents: 25_000, effort_ratio: 0.5 })]}
      />,
    );
    expect(screen.getByText(/50 %/)).toBeInTheDocument();
  });

  it("prints each infeasible lever's own reason, never a shared one", () => {
    render(<LeverList levers={OPERATOR_REPORT.levers} />);
    const delayText = card("delay").getByTestId("yd-lever-reason-delay").textContent;
    const reduceText = card("reduce_target").getByTestId(
      "yd-lever-reason-reduce_target",
    ).textContent;
    expect(delayText).toMatch(/attendre n'y change rien/);
    expect(reduceText).toMatch(/Aucune cible n'est atteignable/);
    expect(delayText).not.toEqual(reduceText);
  });

  it("raises the 35 % alarm on the borrow lever and states the ratio", () => {
    render(<LeverList levers={OPERATOR_REPORT.levers} />);
    const borrow = card("borrow");
    expect(borrow.getByText(/196,10 %/)).toBeInTheDocument();
    expect(borrow.getByText(/seuil de 35,00 %/)).toBeInTheDocument();
    expect(borrow.getByTestId("yd-lever-ratio")).toHaveClass("yd-lever__ratio--exceeded");
    // The instalment and the interest, both from the schedule.
    expect(borrow.getByText(/923,83/)).toBeInTheDocument();
    expect(borrow.getByText(/6 475,32/)).toBeInTheDocument();
  });

  it("says the debt ratio is absent rather than showing 0 %", () => {
    // `debt_ratio_exceeded` is false BOTH under the threshold and when there is
    // no ratio at all. Reading the flag alone cannot tell them apart, so the
    // component branches on the null first and this proves it does.
    render(
      <LeverList
        levers={[
          lever("borrow", {
            borrow_cents: 4_895_428,
            loan_payment_cents: 92_383,
            loan_total_interest_cents: 647_532,
            debt_ratio_bps: null,
            debt_ratio_exceeded: false,
            note:
              "Le taux d'endettement n'est pas calculé : vos revenus n'ont pas pu être mesurés " +
              "sur au moins trois mois complets de relevés.",
          }),
        ]}
      />,
    );
    expect(screen.queryByText(/0,00 %/)).not.toBeInTheDocument();
    expect(screen.getByText(/n'est pas calculé/)).toBeInTheDocument();
  });

  it("leaves the alarm off a ratio that is comfortably under the threshold", () => {
    render(
      <LeverList
        levers={[
          lever("borrow", {
            borrow_cents: 500_000,
            loan_payment_cents: 9_500,
            loan_total_interest_cents: 70_000,
            debt_ratio_bps: 1_200,
            debt_ratio_exceeded: false,
          }),
        ]}
      />,
    );
    expect(screen.getByText(/12,00 %/)).toBeInTheDocument();
    expect(screen.getByTestId("yd-lever-ratio")).not.toHaveClass("yd-lever__ratio--exceeded");
  });

  it("backs the category cut with the history rather than asserting it", () => {
    render(
      <LeverList
        levers={[
          lever("cut_category", {
            category_id: 7,
            category_name: "Courses",
            category_median_cents: 60_000,
            cut_monthly_cents: 20_000,
            months_at_or_below: 0,
            months_observed: 4,
          }),
        ]}
      />,
    );
    expect(screen.getByText(/aucun mois à ce niveau/)).toBeInTheDocument();
  });

  it("counts the months that already sat at or below the cut", () => {
    render(
      <LeverList
        levers={[
          lever("cut_category", {
            category_id: 7,
            category_name: "Courses",
            category_median_cents: 60_000,
            cut_monthly_cents: 20_000,
            months_at_or_below: 3,
            months_observed: 4,
          }),
        ]}
      />,
    );
    expect(screen.getByText(/3 des 4 mois observés/)).toBeInTheDocument();
  });

  it("never counts a history on a refusal that merely names a category", () => {
    // The operator's own `cut_category`: it names « Loyer » and its median, but
    // `months_at_or_below` is null because there is no post-cut level to count
    // against. "0 des 1 mois observés" would be a measurement nobody made.
    render(<LeverList levers={OPERATOR_REPORT.levers} />);
    const cut = card("cut_category");
    // Exact: the refusal sentence names « Loyer » too, and a loose match would
    // pass on a card that only printed the refusal.
    expect(cut.getByText("Loyer")).toBeInTheDocument();
    expect(cut.getByText(/780,00/)).toBeInTheDocument();
    expect(cut.queryByText(/mois observés/)).not.toBeInTheDocument();
    expect(cut.queryByText(/aucun mois à ce niveau/)).not.toBeInTheDocument();
  });

  it("renders nothing at all when the lever list is empty", () => {
    // `capacity` null -> `levers` []. The capacity refusal is shown once by
    // VerdictPanel; five copies of it here would be five copies of one sentence.
    const { container } = render(<LeverList levers={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
