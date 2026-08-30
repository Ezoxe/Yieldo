import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Feasibility } from "../../lib/types";
import { VerdictPanel } from "./VerdictPanel";

const BASE = {
  target_cents: 4_000_000,
  horizon_months: 12,
  down_payment_cents: 0,
  nature: "vehicle",
  horizon_end_on: "2027-08-31",
} as const;

/**
 * THE OPERATOR. Every figure measured from his real ledger by phase 2A's
 * engines, then this phase's arithmetic on top, and re-read off the running
 * `POST /api/feasibility` against the seeded fixture before this file was
 * written.
 */
const OPERATOR = {
  ...BASE,
  capacity: {
    months: 3,
    median_cents: -74_619,
    spread_cents: 213_078,
    low_cents: -347_690,
    high_cents: 198_452,
  },
  capacity_unavailable_reason: null,
  months_observed: 3,
  history: { date_from: "2025-01-24", date_to: "2026-01-09", transaction_count: 197 },
  balance_cents: -220_963,
  verdict: "out_of_reach" as const,
  saved_at_horizon_cents: -895_428,
  saved_at_horizon_low_cents: -4_172_280,
  saved_at_horizon_high_cents: 2_414_442,
  gap_cents: 4_895_428,
} as unknown as Feasibility;

/** `engines/feasibility._reason_capacity_unmeasurable`, verbatim. */
const UNMEASURABLE =
  "Votre capacité d'épargne n'a pas pu être mesurée : il faut au moins trois mois complets " +
  "de relevés pour en tirer une médiane. Sans elle, aucun verdict ne peut être rendu sur cet " +
  "achat — une médiane tirée de moins de trois mois serait une invention, pas une mesure.";

describe("VerdictPanel", () => {
  it("says the pot shrinks, and never presents a deficit as savings", () => {
    render(<VerdictPanel report={OPERATOR} />);
    expect(screen.getByText(/Hors de portée/i)).toBeInTheDocument();
    // The projection is NEGATIVE and printed as such.
    expect(screen.getByText(/−8 954,28/)).toBeInTheDocument();
    // The gap is larger than the price, and the copy says why rather than
    // leaving the reader to think it is an arithmetic error.
    expect(screen.getByText(/48 954,28/)).toBeInTheDocument();
    expect(screen.getByText(/diminue/i)).toBeInTheDocument();
    // NOT the "il vous manque" framing alone: the cause is the deficit.
    expect(screen.getByText(/−746,19/)).toBeInTheDocument();
  });

  it("does not offer the optimistic end of the band as a way through", () => {
    // 24 144,42 € at the band's high end is still short of 40 000 €. If it were
    // reachable the copy would say so; here it must not.
    render(<VerdictPanel report={OPERATOR} />);
    expect(screen.queryByText(/dans un bon mois/i)).not.toBeInTheDocument();
  });

  it("DOES offer it when the band's high end really does reach the target", () => {
    // The control for the case above, and the reason `saved_at_horizon_high_cents`
    // is published at all (`engines/feasibility.py`): "dans un bon mois c'est
    // jouable" versus "même un bon mois n'y suffit pas" are two different
    // answers under one `out_of_reach` verdict. Without this test the previous
    // one passes on a component that never says it in any circumstance.
    render(
      <VerdictPanel
        report={
          {
            ...OPERATOR,
            capacity: {
              months: 6,
              median_cents: 250_000,
              spread_cents: 120_000,
              low_cents: 180_000,
              high_cents: 360_000,
            },
            saved_at_horizon_cents: 3_046_875,
            saved_at_horizon_low_cents: 2_193_750,
            saved_at_horizon_high_cents: 4_387_500,
            gap_cents: 953_125,
          } as unknown as Feasibility
        }
      />,
    );
    expect(screen.getByText(/dans un bon mois/i)).toBeInTheDocument();
  });

  it("prints the refusal and no verdict when the capacity is unmeasurable", () => {
    render(
      <VerdictPanel
        report={
          {
            ...OPERATOR,
            capacity: null,
            verdict: null,
            gap_cents: null,
            saved_at_horizon_cents: null,
            saved_at_horizon_low_cents: null,
            saved_at_horizon_high_cents: null,
            months_observed: 1,
            capacity_unavailable_reason: UNMEASURABLE,
          } as unknown as Feasibility
        }
      />,
    );
    expect(screen.getByText(/trois mois complets/)).toBeInTheDocument();
    expect(screen.queryByText(/Hors de portée/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Atteignable/i)).not.toBeInTheDocument();
    // A refusal is a deliberate answer, not a load failure.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // And the count is this screen's own fact, in the singular French takes.
    expect(screen.getByText(/1 mois complet\b/)).toBeInTheDocument();
  });

  it("calls a surplus a surplus rather than a negative shortfall", () => {
    render(
      <VerdictPanel
        report={
          {
            ...OPERATOR,
            capacity: {
              months: 12,
              median_cents: 400_000,
              spread_cents: 78_000,
              low_cents: 300_000,
              high_cents: 500_000,
            },
            verdict: "tight" as const,
            saved_at_horizon_cents: 4_866_555,
            saved_at_horizon_low_cents: 3_649_916,
            saved_at_horizon_high_cents: 6_100_000,
            gap_cents: -866_555,
          } as unknown as Feasibility
        }
      />,
    );
    expect(screen.getByText(/en serrant/i)).toBeInTheDocument();
    // Anchored on the sentence, not on the digits alone: the projected 48 665,55 €
    // above it contains the same run of characters, and a bare /8 665,55/ would
    // pass on a screen that never printed the surplus at all.
    expect(screen.getByText(/Il reste 8 665,55/)).toBeInTheDocument();
    expect(screen.queryByText(/il vous manque/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Il manque/)).not.toBeInTheDocument();
  });

  it("states the sample the whole verdict rests on", () => {
    render(<VerdictPanel report={OPERATOR} />);
    expect(screen.getByText(/3 mois de relevés/)).toBeInTheDocument();
  });

  it("claims the gap exceeds the price only when it actually does", () => {
    // Same deficit, but an apport large enough that the projection stays above
    // zero. The "l'écart dépasse le prix" clause is then FALSE, and printing it
    // anyway is phase 2A's most repeated defect: a true number under a false
    // sentence. The deficit sentence itself still holds and must stay.
    render(
      <VerdictPanel
        report={
          {
            ...OPERATOR,
            down_payment_cents: 3_000_000,
            saved_at_horizon_cents: 2_104_572,
            saved_at_horizon_low_cents: -1_172_280,
            saved_at_horizon_high_cents: 5_414_442,
            gap_cents: 1_895_428,
          } as unknown as Feasibility
        }
      />,
    );
    expect(screen.getByText(/diminue/i)).toBeInTheDocument();
    expect(screen.queryByText(/plus grand que le prix|dépasse .*le prix/i)).not.toBeInTheDocument();
  });

  it("says so rather than inventing a verdict when the payload contradicts itself", () => {
    // `verdict` is null exactly when `capacity` is null. Both set is a backend
    // defect; falling back to "hors de portée" would print a verdict nobody
    // computed.
    render(
      <VerdictPanel report={{ ...OPERATOR, verdict: null } as unknown as Feasibility} />,
    );
    expect(screen.queryByText(/Hors de portée/i)).not.toBeInTheDocument();
    expect(screen.getByText(/n'a pas renvoyé de verdict/i)).toBeInTheDocument();
  });
});
