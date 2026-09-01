import { render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "../../app/ThemeProvider";
import type { Health, HealthComponent } from "../../lib/types";
import {
  HealthComponentList,
  HealthHistoryPanel,
  HealthScoreSummary,
  componentValueLabel,
  measuredWeight,
  scoreDeltaSentence,
} from "./HealthPanel";
import { NO_BUDGET_REASON, OPERATOR_COMPONENTS, OPERATOR_HEALTH } from "./fixtures";

/** `engines/health.py`'s `_reason_too_few_components`, on a household where
 *  only the runway measured. */
const ONLY_ONE_COMPONENT =
  "Le score de santé financière ne peut pas être calculé : seule la composante " +
  "« Autonomie financière » a pu être mesurée, et il en faut au moins 2 sur 4. Le détail de " +
  "chaque composante ci-dessous explique pourquoi.";

function unmeasured(component: HealthComponent, reason: string): HealthComponent {
  return { ...component, score: null, measured_value: null, unavailable_reason: reason };
}

const NO_SCORE: Health = {
  score: null,
  components: [
    unmeasured(OPERATOR_COMPONENTS[0], "Votre capacité d'épargne n'a pas pu être mesurée."),
    unmeasured(OPERATOR_COMPONENTS[1], "La part de vos dépenses essentielles n'a pas pu être mesurée."),
    OPERATOR_COMPONENTS[2],
    OPERATOR_COMPONENTS[3],
  ],
  unavailable_reason: ONLY_ONE_COMPONENT,
  previous_taken_on: null,
  score_delta: null,
  history: [],
};

/** A household on its second day, with a real previous snapshot behind it. */
const SECOND_DAY: Health = {
  ...OPERATOR_HEALTH,
  score: 12,
  components: OPERATOR_HEALTH.components.map((c) =>
    c.key === "savings_rate" ? { ...c, score: 18, delta_score: 18 } : c,
  ),
  previous_taken_on: "2026-08-31",
  score_delta: 12,
  history: [
    { taken_on: "2026-08-31", score: 0 },
    { taken_on: "2026-09-01", score: 12 },
  ],
};

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

/** The non-breaking space `formatRateBps` sets before its "%", and that this
 *  module sets before "mois". Spelt out so the source carries no invisible
 *  character and the expectations below are exact rather than approximate. */
const NBSP = "\u00a0";

describe("componentValueLabel", () => {
  it("prints each component in its OWN unit, never as a bare index", () => {
    // A ratio of income, a ratio of income, a month count and a share: four
    // different units behind one 0-100 scale. Printing "0" four times would
    // hide that three of them are measurements of very different things.
    expect(componentValueLabel(OPERATOR_COMPONENTS[0])).toBe(
      `−158,39${NBSP}% du revenu médian`,
    );
    expect(componentValueLabel(OPERATOR_COMPONENTS[1])).toBe(`266,28${NBSP}% du revenu médian`);
    expect(componentValueLabel(OPERATOR_COMPONENTS[2])).toBe(
      `0,0${NBSP}mois de dépenses essentielles`,
    );
    expect(
      componentValueLabel({ ...OPERATOR_COMPONENTS[3], score: 60, measured_value: 0.6 }),
    ).toBe(`60,00${NBSP}% des mois budgétés tenus`);
  });

  it("returns null on a component that was not measured", () => {
    // Never a "0 %" standing in for an absent measurement.
    expect(componentValueLabel(OPERATOR_COMPONENTS[3])).toBeNull();
  });
});

describe("measuredWeight", () => {
  it("adds up only the components that actually measured", () => {
    // 30 + 25 + 25 = 80. The missing 20 is what the screen says was
    // redistributed — `health.py` renormalises over the available weights.
    expect(measuredWeight(OPERATOR_COMPONENTS)).toBe(80);
  });
});

describe("scoreDeltaSentence", () => {
  it("says there is no earlier reading rather than printing a zero", () => {
    expect(scoreDeltaSentence(OPERATOR_HEALTH)).toMatch(/premier relevé/i);
    expect(scoreDeltaSentence(OPERATOR_HEALTH)).not.toMatch(/0 point/);
  });

  it("names the day the comparison is actually against", () => {
    expect(scoreDeltaSentence(SECOND_DAY)).toBe(
      "+12 points depuis le relevé du 31 août 2026.",
    );
  });

  it("says «aucun changement» rather than «+0 points»", () => {
    expect(scoreDeltaSentence({ ...SECOND_DAY, score_delta: 0 })).toBe(
      "Aucun changement depuis le relevé du 31 août 2026.",
    );
  });

  it("has nothing to compare when today's own score could not be measured", () => {
    expect(scoreDeltaSentence(NO_SCORE)).toBeNull();
  });
});

describe("HealthScoreSummary", () => {
  it("prints a MEASURED zero as a figure, with the count of components behind it", () => {
    render(<HealthScoreSummary health={OPERATOR_HEALTH} />);
    expect(screen.getByTestId("yd-health-score")).toHaveTextContent("0");
    expect(screen.getByText(/sur 100/)).toBeInTheDocument();
    expect(screen.getByText(/3 composantes sur 4/)).toBeInTheDocument();
  });

  it("prints an UNCALCULABLE score in words, with no numeral anywhere near it", () => {
    // The whole point: a score of 0 that was measured and a score that could
    // not be measured must not look alike. One is a figure, the other is a
    // refusal — and a "0" here would be a lie about a household nobody
    // measured.
    render(<HealthScoreSummary health={NO_SCORE} />);
    const figure = screen.getByTestId("yd-health-score");
    expect(figure).toHaveTextContent("Non calculable");
    expect(figure.textContent).not.toMatch(/\d/);
    expect(screen.getByText(ONLY_ONE_COMPONENT)).toBeInTheDocument();
  });

  it("states the fixed weighting, and that it was renormalised", () => {
    // `health.py`: the weights are fixed integers summing to 100 and never
    // move with how much data exists. Saying so on screen is design §10.
    render(<HealthScoreSummary health={OPERATOR_HEALTH} />);
    expect(screen.getByText(/poids fixes/i)).toBeInTheDocument();
    expect(screen.getByText(/80 % du barème/)).toBeInTheDocument();
  });
});

describe("HealthComponentList", () => {
  it("gives a gauge only to the components that were measured", () => {
    render(<HealthComponentList components={OPERATOR_COMPONENTS} />);
    // Three meters, not four. An unmeasurable component is not a bar at zero.
    expect(screen.getAllByRole("meter")).toHaveLength(3);
  });

  it("draws a measured zero as a real reading on a real scale", () => {
    render(<HealthComponentList components={OPERATOR_COMPONENTS} />);
    const row = screen.getByTestId("yd-hcomp-savings_rate");
    const meter = within(row).getByRole("meter");
    expect(meter).toHaveAttribute("aria-valuenow", "0");
    expect(meter).toHaveAttribute("aria-valuemax", "100");
    expect(within(row).getByTestId("yd-hcomp-score-savings_rate")).toHaveTextContent("0");
    expect(within(row).getByText("−158,39 % du revenu médian")).toBeInTheDocument();
  });

  it("draws an unmeasurable component as an absence, never as a zero", () => {
    render(<HealthComponentList components={OPERATOR_COMPONENTS} />);
    const row = screen.getByTestId("yd-hcomp-budget_adherence");
    expect(within(row).queryByRole("meter")).not.toBeInTheDocument();
    expect(within(row).queryByTestId("yd-hcomp-score-budget_adherence")).not.toBeInTheDocument();
    expect(within(row).getByText("Non mesurée")).toBeInTheDocument();
    // The engine's own sentence, which names the cause. Verbatim.
    expect(within(row).getByText(NO_BUDGET_REASON)).toBeInTheDocument();
    // And what its weight did, so the reader is not left thinking a fifth of
    // the score was scored at zero.
    expect(within(row).getByText(/ses 20 % ont été répartis/i)).toBeInTheDocument();
  });

  it("still states the weight of a component it could not measure", () => {
    // The weight is a property of the SCORE's design, not of what was
    // measured this time — `health.py` says so, and the screen agrees.
    render(<HealthComponentList components={OPERATOR_COMPONENTS} />);
    const row = screen.getByTestId("yd-hcomp-budget_adherence");
    expect(within(row).getByText("20 % du barème")).toBeInTheDocument();
  });

  it("prints no per-component delta at all on a first reading", () => {
    render(<HealthComponentList components={OPERATOR_COMPONENTS} />);
    expect(screen.queryByTestId("yd-hcomp-delta-savings_rate")).not.toBeInTheDocument();
  });

  it("prints a per-component delta once there is a stored snapshot behind it", () => {
    render(
      <HealthComponentList
        components={SECOND_DAY.components}
        previousTakenOn={SECOND_DAY.previous_taken_on}
      />,
    );
    expect(screen.getByTestId("yd-hcomp-delta-savings_rate")).toHaveTextContent(
      "+18 points depuis le 31 août 2026",
    );
    // The component that could not be measured has no delta to show, and says
    // which half is missing rather than showing a zero.
    expect(screen.getByTestId("yd-hcomp-delta-budget_adherence")).toHaveTextContent(
      /l'une des deux mesures manque/,
    );
  });
});

describe("HealthHistoryPanel", () => {
  it("refuses to draw a curve through a single reading, and says why", () => {
    render(
      <ThemeProvider>
        <HealthHistoryPanel health={OPERATOR_HEALTH} />
      </ThemeProvider>,
    );
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText(/un seul relevé/i)).toBeInTheDocument();
    expect(screen.getByText(/1er septembre 2026/)).toBeInTheDocument();
  });

  it("draws the curve once a second reading exists", () => {
    render(
      <ThemeProvider>
        <HealthHistoryPanel health={SECOND_DAY} />
      </ThemeProvider>,
    );
    expect(screen.getByRole("img", { name: /2 relevés du score/ })).toBeInTheDocument();
  });

  it("says nothing was ever stored rather than drawing an empty axis", () => {
    render(
      <ThemeProvider>
        <HealthHistoryPanel health={NO_SCORE} />
      </ThemeProvider>,
    );
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText(/aucun relevé n'a encore pu être enregistré/i)).toBeInTheDocument();
  });
});
