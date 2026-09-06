import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { FeasibilityContext } from "../../lib/types";
import { OPERATOR_CONTEXT, OWNERSHIP_DEFAULTS } from "./fixtures";
import { NaturePicker } from "./NaturePicker";
import { SavingPlan } from "./VerdictPanel";
import { OPERATOR_REPORT } from "./fixtures";

const CONTEXT: FeasibilityContext = {
  ...OPERATOR_CONTEXT,
  ownership_defaults: OWNERSHIP_DEFAULTS,
  natures: ["vehicle", "property", "tech", "other"],
};

describe("NaturePicker", () => {
  it("offers every nature the server publishes", () => {
    render(<NaturePicker context={CONTEXT} value={null} onChoose={vi.fn()} />);
    for (const label of ["Véhicule", "Immobilier", "High-tech et équipement", "Autre"]) {
      expect(screen.getByRole("button", { name: new RegExp(label) })).toBeInTheDocument();
    }
  });

  /**
   * The note is the load-bearing part of the choice: it says which figures a
   * nature prefills and which it deliberately leaves empty. A select can show
   * only one at a time, and only after the choice has been made.
   */
  it("says what each nature assumes, before the choice is made", () => {
    render(<NaturePicker context={CONTEXT} value={null} onChoose={vi.fn()} />);
    expect(screen.getByText(/Aucun coût d'usage prérempli/)).toBeInTheDocument();
  });

  it("reports the nature that was chosen", async () => {
    const onChoose = vi.fn();
    render(<NaturePicker context={CONTEXT} value={null} onChoose={onChoose} />);
    await userEvent.click(screen.getByRole("button", { name: /High-tech/ }));
    expect(onChoose).toHaveBeenCalledWith("tech");
  });

  it("shows the current choice as pressed", () => {
    render(<NaturePicker context={CONTEXT} value="property" onChoose={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Immobilier/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  // A nature the server names but publishes no profile for would render a card
  // with no label and no note. Skipped rather than half-drawn.
  it("skips a nature with no profile behind it", () => {
    render(
      <NaturePicker
        context={{ ...CONTEXT, natures: [...CONTEXT.natures, "bateau"] }}
        value={null}
        onChoose={vi.fn()}
      />,
    );
    expect(screen.getAllByRole("button")).toHaveLength(4);
  });
});

describe("SavingPlan", () => {
  /**
   * "Combien je dois mettre de côté par mois, sur combien de temps" is the
   * question the screen exists to answer, and it used to be buried in a lever
   * four panels down.
   */
  it("leads with the monthly amount and the horizon", () => {
    render(<SavingPlan report={{ ...OPERATOR_REPORT, required_monthly_cents: 328_312 }} />);
    expect(screen.getByText("3 283,12 €")).toBeInTheDocument();
    expect(screen.getByText(/par mois pendant 12 mois/)).toBeInTheDocument();
  });

  it("says how much more that is than the household actually saves", () => {
    render(
      <SavingPlan
        report={{
          ...OPERATOR_REPORT,
          required_monthly_cents: 100_000,
          capacity: { months: 12, median_cents: 40_000, spread_cents: 0,
                      low_cents: 30_000, high_cents: 50_000 },
        }}
      />,
    );
    expect(screen.getByText(/600,00 € de plus/)).toBeInTheDocument();
  });

  it("says when the measured rate already suffices, rather than inventing a shortfall", () => {
    render(
      <SavingPlan
        report={{
          ...OPERATOR_REPORT,
          required_monthly_cents: 20_000,
          capacity: { months: 12, median_cents: 40_000, spread_cents: 0,
                      low_cents: 30_000, high_cents: 50_000 },
        }}
      />,
    );
    expect(screen.getByText(/y suffit déjà/)).toBeInTheDocument();
  });

  /**
   * A pot that shrinks never arrives. `null` says so; a large month count
   * dressed up as a date would say the opposite.
   */
  it("refuses to name a date when the measured rate never reaches the target", () => {
    render(<SavingPlan report={{ ...OPERATOR_REPORT, months_at_measured_capacity: null }} />);
    expect(screen.getByText(/n'est jamais atteinte/)).toBeInTheDocument();
  });

  it("names the delay when there is one", () => {
    render(<SavingPlan report={{ ...OPERATOR_REPORT, months_at_measured_capacity: 41 }} />);
    expect(screen.getByText(/vous y seriez en 41 mois/)).toBeInTheDocument();
  });

  // The one figure a household with two months of statements can still act on.
  it("still names the monthly amount when no capacity could be measured", () => {
    render(
      <SavingPlan
        report={{ ...OPERATOR_REPORT, capacity: null, required_monthly_cents: 50_000 }}
      />,
    );
    expect(screen.getByText("500,00 €")).toBeInTheDocument();
    expect(screen.getByText(/n'a pas pu être mesurée/)).toBeInTheDocument();
  });
});
