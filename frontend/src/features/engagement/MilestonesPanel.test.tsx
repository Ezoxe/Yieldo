import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import type { GoalProgress, Milestone } from "../../lib/types";
import { MilestonesPanel } from "./MilestonesPanel";

/** `engines/goal.py`'s `_reason_capacity_not_positive` — THE OPERATOR'S STATE.
 *  His measured capacity is −746,19 €/month, so nothing is ever projected. */
const NEGATIVE_CAPACITY =
  "Votre capacité d'épargne mesurée est négative ou nulle : au rythme constaté dans vos " +
  "relevés, aucun objectif ne progresse, et aucune date d'atteinte ne peut être avancée.";

function milestone(percent: number, threshold: number, over: Partial<Milestone> = {}): Milestone {
  return { percent, threshold_cents: threshold, reached: false, months_away: null, projected_on: null, ...over };
}

/** 900 € declared against a 3 000 € target: the 25 % threshold is behind him,
 *  the other three are not, and no date can be put on any of them. */
const REFUSED: GoalProgress = {
  goal_id: 7,
  name: "Fonds d'urgence",
  target_cents: 300_000,
  saved_cents: 90_000,
  remaining_cents: 210_000,
  progress_ratio: 0.3,
  milestones: [
    milestone(25, 75_000, { reached: true }),
    milestone(50, 150_000),
    milestone(75, 225_000),
    milestone(100, 300_000),
  ],
  funding_starts_in_months: 0,
  months_to_completion: null,
  projected_completion_on: null,
  projection_unavailable_reason: NEGATIVE_CAPACITY,
  due_on: null,
  months_until_due: null,
  on_track: null,
};

const PROJECTED: GoalProgress = {
  ...REFUSED,
  goal_id: 8,
  name: "Voyage",
  milestones: [
    milestone(25, 75_000, { reached: true }),
    milestone(50, 150_000, { months_away: 4, projected_on: "2026-12-31" }),
    milestone(75, 225_000, { months_away: 7, projected_on: "2027-03-31" }),
    milestone(100, 300_000, { months_away: 10, projected_on: "2027-06-30" }),
  ],
  months_to_completion: 10,
  projected_completion_on: "2027-06-30",
  projection_unavailable_reason: null,
};

function renderPanel(goals: GoalProgress[]) {
  return render(
    <MemoryRouter>
      <MilestonesPanel goals={goals} />
    </MemoryRouter>,
  );
}

describe("MilestonesPanel", () => {
  it("never puts a date on a milestone that was already reached", () => {
    // `saved_cents` is DECLARED and carries no history, so Yieldo does not know
    // when the threshold was crossed. "Atteint aujourd'hui" would claim it
    // happened now, which is the one thing this screen must never say.
    renderPanel([PROJECTED]);
    const chip = screen.getByTestId("yd-jalon-8-25");
    expect(chip).toHaveTextContent("Atteint");
    expect(chip.textContent).not.toMatch(/20\d\d/);
  });

  it("dates a milestone the engine actually projected", () => {
    renderPanel([PROJECTED]);
    expect(screen.getByTestId("yd-jalon-8-50")).toHaveTextContent("31 décembre 2026");
  });

  it("says a milestone is not projected, and prints the engine's reason once", () => {
    renderPanel([REFUSED]);
    expect(screen.getByTestId("yd-jalon-7-50")).toHaveTextContent("Non projeté");
    expect(screen.getAllByText(NEGATIVE_CAPACITY)).toHaveLength(1);
  });

  it("counts the thresholds actually behind the household", () => {
    renderPanel([REFUSED]);
    expect(screen.getByText(/1 jalon franchi sur 4/)).toBeInTheDocument();
  });

  it("diagnoses an empty list instead of leaving a blank card", () => {
    renderPanel([]);
    expect(screen.getByText(/Aucun objectif déclaré/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /objectif/i })).toHaveAttribute("href", "/objectifs");
  });

  it("gives each goal its own card, in the funding order it was handed", () => {
    renderPanel([REFUSED, PROJECTED]);
    const cards = screen.getAllByTestId(/^yd-jalons-goal-/);
    expect(cards).toHaveLength(2);
    expect(within(cards[0]).getByText("Fonds d'urgence")).toBeInTheDocument();
    expect(within(cards[1]).getByText("Voyage")).toBeInTheDocument();
  });
});
