import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { RunwayScenario } from "../../lib/types";
import { formatMonths, RunwayPanel } from "./RunwayPanel";

/** A scenario shaped like the wire's, band included. */
function makeScenario(overrides: Partial<RunwayScenario> = {}): RunwayScenario {
  return {
    name: "normal",
    monthly_burn_cents: 190000,
    rate: {
      months: 9,
      median_cents: 190000,
      spread_cents: 40000,
      low_cents: 138800,
      high_cents: 241200,
    },
    months: 6.3,
    depleted_on: "2027-02-18",
    ...overrides,
  };
}

describe("formatMonths", () => {
  it("writes whole months without a decimal point", () => {
    expect(formatMonths(6)).toBe("6 mois");
  });

  it("keeps one decimal when it carries information", () => {
    expect(formatMonths(6.3)).toBe("6,3 mois");
  });

  it("uses the singular form for one month", () => {
    expect(formatMonths(1)).toBe("1 mois");
  });

  it("says less than a month rather than rounding a fraction to zero", () => {
    expect(formatMonths(0.05)).toBe("moins d'un mois");
  });

  // The engine returns exactly 0.0 when the balance is already at or below
  // zero -- the operator's actual state. "moins d'un mois" would promise
  // something still left to spend.
  it("says the money is already gone at zero rather than 'moins d'un mois'", () => {
    expect(formatMonths(0)).toBe("Déjà épuisé");
  });
});

describe("RunwayPanel", () => {
  it("states the duration, the burn and the date", () => {
    render(<RunwayPanel scenario={makeScenario()} label="Rythme actuel" unavailableReason={null} />);

    expect(screen.getByText("6,3 mois")).toBeInTheDocument();
    expect(screen.getByText(/1 900,00/)).toBeInTheDocument();
    expect(screen.getByText(/18 février 2027/)).toBeInTheDocument();
  });

  // Requirement 4: a burn quoted as a bare median invites the reader to treat
  // it as a certainty. `capacity.py` says so in as many words.
  it("shows the measured band around the burn, not the median alone", () => {
    render(<RunwayPanel scenario={makeScenario()} label="Rythme actuel" unavailableReason={null} />);

    expect(screen.getByText(/1 388,00/)).toBeInTheDocument();
    expect(screen.getByText(/2 412,00/)).toBeInTheDocument();
  });

  // Requirement 2: `scenario.months` is a float duration, `rate.months` is an
  // integer sample size. They are two different numbers and neither may wear
  // the other's label.
  it("labels the rate's own sample size as months of statements, never as a duration", () => {
    render(
      <RunwayPanel
        scenario={makeScenario({ months: 6.3, rate: { ...makeScenario().rate, months: 4 } })}
        label="Rythme actuel"
        unavailableReason={null}
      />,
    );

    expect(screen.getByText(/mesuré sur 4 mois de relevés/i)).toBeInTheDocument();
    // The duration keeps its own slot and its own number.
    expect(screen.getByText("6,3 mois")).toBeInTheDocument();
  });

  it("uses each scenario's own sample size, not a count handed down from the report", () => {
    render(
      <RunwayPanel
        scenario={makeScenario({ name: "essentials", rate: { ...makeScenario().rate, months: 3 } })}
        label="Dépenses réduites à l'essentiel"
        unavailableReason={null}
      />,
    );

    expect(screen.getByText(/mesuré sur 3 mois de relevés/i)).toBeInTheDocument();
  });

  it("says the low end of the band is not even a positive expense when it is negative", () => {
    render(
      <RunwayPanel
        scenario={makeScenario({
          rate: { months: 3, median_cents: 265449, spread_cents: 221457, low_cents: -18360, high_cents: 549258 },
        })}
        label="Rythme actuel"
        unavailableReason={null}
      />,
    );

    expect(screen.getByText(/descend sous z[ée]ro/i)).toBeInTheDocument();
  });

  it("stays silent about the band's low end when it is a genuine expense", () => {
    render(<RunwayPanel scenario={makeScenario()} label="Rythme actuel" unavailableReason={null} />);

    expect(screen.queryByText(/descend sous z[ée]ro/i)).not.toBeInTheDocument();
  });

  it("omits the date rather than inventing one when there is none", () => {
    render(
      <RunwayPanel
        scenario={makeScenario({ depleted_on: null, months: 900 })}
        label="Rythme actuel"
        unavailableReason={null}
      />,
    );

    expect(screen.queryByText(/épuisé le/i)).not.toBeInTheDocument();
    // "900 mois" is not an answer a reader can hold; the headline says so and
    // the line under it says why no date is given.
    expect(screen.getByText("Plus de cinquante ans")).toBeInTheDocument();
    expect(screen.getByText(/Aucune date n'est avancée/)).toBeInTheDocument();
  });

  // The engine sets `depleted_on` to `today` on the already-at-zero branch.
  // Printing "épuisé le 22 août 2026" there reads as a forecast about a date
  // that has already arrived.
  it("does not announce a future depletion date when the balance is already gone", () => {
    render(
      <RunwayPanel
        scenario={makeScenario({ months: 0, depleted_on: "2026-08-22" })}
        label="Rythme actuel"
        unavailableReason={null}
      />,
    );

    expect(screen.getByText("Déjà épuisé")).toBeInTheDocument();
    expect(screen.queryByText(/épuisé le/i)).not.toBeInTheDocument();
  });

  it("prints this scenario's own unavailability reason when it could not be measured", () => {
    render(
      <RunwayPanel
        scenario={null}
        label="Dépenses réduites à l'essentiel"
        unavailableReason="Pas assez d'historique pour mesurer les dépenses essentielles : il faut au moins 3 mois complets de relevés, et l'historique n'en compte que 2."
      />,
    );

    expect(screen.getByText(/dépenses essentielles/i)).toBeInTheDocument();
    expect(screen.getByText(/au moins 3 mois complets/)).toBeInTheDocument();
  });

  // No silent failure: the contract says the reason is set exactly when the
  // scenario is null, so a missing one is a backend defect and must be visible
  // rather than rendering an empty panel.
  it("says the reason itself is missing rather than showing a blank panel", () => {
    render(<RunwayPanel scenario={null} label="Rythme actuel" unavailableReason={null} />);

    expect(screen.getByText(/n'a pas indiqué pourquoi/i)).toBeInTheDocument();
  });
});
