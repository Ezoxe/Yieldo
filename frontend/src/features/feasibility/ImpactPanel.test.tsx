import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Impact } from "../../lib/types";
import { ImpactPanel, runwayLabel } from "./ImpactPanel";
import { OPERATOR_REPORT } from "./fixtures";

const OPERATOR = OPERATOR_REPORT.impact;

function renderPanel(impact: Impact = OPERATOR) {
  render(<ImpactPanel impact={impact} targetCents={4_000_000} downPaymentCents={0} />);
}

describe("runwayLabel", () => {
  it("calls an exhausted fund exhausted rather than measuring it at zero", () => {
    expect(runwayLabel(0)).toBe("déjà épuisé");
    expect(runwayLabel(-2)).toBe("déjà épuisé");
  });

  it("keeps the tenth of a month, which is a real answer", () => {
    expect(runwayLabel(0.4)).toBe("0,4 mois");
    expect(runwayLabel(3.25)).toBe("3,3 mois");
  });
});

describe("ImpactPanel — the emergency fund", () => {
  it("says déjà épuisé avant comme après rather than 0,0 mois twice", () => {
    // THE OPERATOR'S OWN STATE: both figures are 0.0 because his balance is
    // already below zero. "0,0 mois → 0,0 mois" is a comparison of nothing
    // with nothing.
    renderPanel();
    expect(screen.getByTestId("yd-impact-emergency")).toHaveTextContent(
      /Déjà épuisé avant comme après/,
    );
    expect(screen.queryByText(/0,0 mois/)).not.toBeInTheDocument();
  });

  it("shows both durations when there IS a fund to reduce", () => {
    renderPanel({
      ...OPERATOR,
      emergency: {
        runway_months_before: 6.2,
        runway_months_after: 1.4,
        unavailable_reason: null,
      },
    });
    const pair = screen.getByTestId("yd-impact-emergency");
    expect(pair).toHaveTextContent(/6,2 mois/);
    expect(pair).toHaveTextContent(/1,4 mois/);
  });

  it("prints the engine's refusal verbatim when the burn is unmeasurable", () => {
    const reason =
      "Votre rythme de dépenses n'a pas pu être mesuré : il faut au moins trois mois complets " +
      "de relevés. L'effet de cet achat sur votre fonds d'urgence ne peut donc pas être chiffré.";
    renderPanel({
      ...OPERATOR,
      emergency: {
        runway_months_before: null,
        runway_months_after: null,
        unavailable_reason: reason,
      },
    });
    expect(screen.getByText(reason)).toBeInTheDocument();
  });

  it("says the WHOLE price is removed, never the price minus the apport", () => {
    renderPanel();
    expect(screen.getByText(/retire le prix entier/)).toBeInTheDocument();
    expect(screen.getByText(/jamais le prix moins l'apport/)).toBeInTheDocument();
  });
});

describe("ImpactPanel — five years, and the two absences", () => {
  it("shows the liquid trajectory with and without, signed", () => {
    renderPanel();
    const pair = screen.getByTestId("yd-impact-liquid");
    expect(pair).toHaveTextContent(/−46 981,03/);
    expect(pair).toHaveTextContent(/−86 981,03/);
  });

  it("prints the liquid refusal instead of a zero trajectory", () => {
    const reason =
      "Votre capacité d'épargne n'a pas pu être mesurée : il faut au moins trois mois complets " +
      "de relevés. La trajectoire de vos liquidités à cinq ans repose entièrement sur ce rythme, " +
      "elle ne peut donc pas être tracée, ni avec cet achat ni sans lui.";
    renderPanel({
      ...OPERATOR,
      liquid_in_five_years_before_cents: null,
      liquid_in_five_years_after_cents: null,
      liquid_unavailable_reason: reason,
    });
    expect(screen.getByText(reason)).toBeInTheDocument();
    expect(screen.queryByTestId("yd-impact-liquid")).not.toBeInTheDocument();
  });

  it("states BOTH things design §6.3 item 7 asks for and this phase does not compute", () => {
    // `ImpactOut` deliberately carries no field for either. A blank panel or a
    // zero would be worse than saying it.
    renderPanel();
    const absent = screen.getByTestId("yd-impact-absent");
    expect(absent).toHaveTextContent(/patrimoine net à cinq ans/);
    expect(absent).toHaveTextContent(/score de santé financière/);
    expect(absent).toHaveTextContent(/phase Patrimoine/);
    expect(absent).toHaveTextContent(/mécaniques de suivi/);
  });

  it("distinguishes the liquid trajectory from a net worth, in words", () => {
    renderPanel();
    expect(screen.getByText(/Ce n'est pas un patrimoine/)).toBeInTheDocument();
  });
});
