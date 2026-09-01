import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { formatCents } from "../../design/theme";
import type { Challenge } from "../../lib/types";
import { ChallengeList, challengeFigureLabel, outcomeSentence } from "./ChallengeList";
import { OPERATOR_CHALLENGE } from "./fixtures";

/** `engines/challenge.py`'s `_reason_not_enough_time_elapsed`, verbatim — the
 *  one the operator gets the moment he accepts. */
const TOO_SOON =
  "Pas assez de temps écoulé depuis l'acceptation de ce défi : le résultat n'est mesurable " +
  "qu'une fois le mois suivant entièrement terminé.";

const NAMES = new Map([[38, "Loisirs"]]);

function accepted(over: Partial<Challenge> = {}): Challenge {
  return {
    ...OPERATOR_CHALLENGE,
    state: "accepted",
    decided_on: "2026-09-01",
    outcome_unavailable_reason: TOO_SOON,
    ...over,
  };
}

describe("challengeFigureLabel", () => {
  it("names what `target_cents` actually measured, kind by kind", () => {
    // The same integer means four different things. A bare "168,14 €" beside a
    // title is a figure with no measurement behind it — which is exactly what
    // §10 exists to prevent.
    expect(challengeFigureLabel("anomaly")).toBe("Écart avec l'habitude de la catégorie");
    expect(challengeFigureLabel("unused_subscription")).toBe("Coût du prélèvement");
    expect(challengeFigureLabel("category_above_past_level")).toBe("Écart sur un an");
    expect(challengeFigureLabel("budget_overrun")).toBe("Dépassement typique par mois");
  });
});

describe("outcomeSentence", () => {
  // The amounts are compared through `formatCents` rather than typed out: the
  // real string carries a non-breaking space before its "€", and an
  // expectation written with a plain one would pass only by accident.
  it("reads a positive measurement as spending LESS", () => {
    const sentence = outcomeSentence(4210, "2026-10-31");
    expect(sentence).toContain("Résultat mesuré le 31 octobre 2026");
    expect(sentence).toContain(`${formatCents(4210)} de moins dépensés dans cette catégorie`);
  });

  it("reads a negative measurement as spending MORE, without softening it", () => {
    expect(outcomeSentence(-4210, "2026-10-31")).toContain(
      `${formatCents(4210)} de plus dépensés`,
    );
  });

  it("says a genuine zero is a genuine zero", () => {
    // A measured "no change" is a result, not an absence — and it is the one
    // case where a zero on this screen is honest.
    expect(outcomeSentence(0, "2026-10-31")).toMatch(/exactement autant/);
  });
});

describe("ChallengeList", () => {
  it("prints the figure with the label that says what it measured", () => {
    render(<ChallengeList challenges={[OPERATOR_CHALLENGE]} categoryNames={NAMES} onDecide={vi.fn()} />);
    const card = screen.getByTestId("yd-challenge-1");
    expect(within(card).getByText("Écart avec l'habitude de la catégorie")).toBeInTheDocument();
    expect(within(card).getByText("168,14 €")).toBeInTheDocument();
    // The engine's own sentence, naming the span it was measured over.
    expect(within(card).getByText(OPERATOR_CHALLENGE.detail)).toBeInTheDocument();
  });

  it("does not repeat the kind above a title that already names it", () => {
    // Every title `engines/challenge.py` emits opens with its own kind, so a
    // chip above it read "DÉPENSE INHABITUELLE" directly over "Dépense
    // inhabituelle : CARTE X1234 FNAC DARTY" when this shipped. That is a
    // decorative badge, which this phase's closing rule forbids outright.
    render(<ChallengeList challenges={[OPERATOR_CHALLENGE]} categoryNames={NAMES} onDecide={vi.fn()} />);
    // The buttons carry the whole title in their accessible names on purpose,
    // so only what is actually PAINTED is counted here.
    const card = screen.getByTestId("yd-challenge-1").cloneNode(true) as HTMLElement;
    for (const hidden of card.querySelectorAll(".sr-only")) hidden.remove();
    const occurrences = (card.textContent ?? "").match(/Dépense inhabituelle/gi) ?? [];
    expect(occurrences).toHaveLength(1);
  });

  it("names the category the outcome will actually be measured on", () => {
    render(<ChallengeList challenges={[OPERATOR_CHALLENGE]} categoryNames={NAMES} onDecide={vi.fn()} />);
    expect(screen.getByText(/Catégorie suivie : Loisirs/)).toBeInTheDocument();
  });

  it("admits it when the category id resolves to no name", () => {
    // Never a blank, and never an invented label: the outcome is measured on
    // this id whether or not the name came back.
    render(<ChallengeList challenges={[OPERATOR_CHALLENGE]} categoryNames={new Map()} onDecide={vi.fn()} />);
    expect(screen.getByText(/identifiant 38, dont le nom n'a pas pu être retrouvé/)).toBeInTheDocument();
  });

  it("says outright what accepting a challenge will measure", () => {
    render(<ChallengeList challenges={[OPERATOR_CHALLENGE]} categoryNames={NAMES} onDecide={vi.fn()} />);
    expect(screen.getByText(/mois complet précédent/)).toBeInTheDocument();
  });

  it("offers accept and reject only while the challenge is still proposed", async () => {
    const onDecide = vi.fn();
    render(<ChallengeList challenges={[OPERATOR_CHALLENGE]} categoryNames={NAMES} onDecide={onDecide} />);
    await userEvent.click(screen.getByRole("button", { name: /Accepter/ }));
    expect(onDecide).toHaveBeenCalledWith(1, "accept");
    await userEvent.click(screen.getByRole("button", { name: /Rejeter/ }));
    expect(onDecide).toHaveBeenCalledWith(1, "reject");
  });

  it("prints the engine's refusal, not a zero, while the outcome is unmeasurable", () => {
    render(<ChallengeList challenges={[accepted()]} categoryNames={NAMES} onDecide={vi.fn()} />);
    const card = screen.getByTestId("yd-challenge-1");
    expect(within(card).getByText(/Accepté le 1er septembre 2026/)).toBeInTheDocument();
    expect(within(card).getByText(TOO_SOON)).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: /Accepter/ })).not.toBeInTheDocument();
  });

  it("prints the measured outcome once there is one", () => {
    render(
      <ChallengeList
        challenges={[
          accepted({ measured_cents: 4210, measured_on: "2026-10-31", outcome_unavailable_reason: null }),
        ]}
        categoryNames={NAMES}
        onDecide={vi.fn()}
      />,
    );
    expect(screen.getByText(/42,10 € de moins dépensés/)).toBeInTheDocument();
  });

  it("measures nothing on a rejected challenge, and says why", () => {
    render(
      <ChallengeList
        challenges={[{ ...OPERATOR_CHALLENGE, state: "rejected", decided_on: "2026-09-01" }]}
        categoryNames={NAMES}
        onDecide={vi.fn()}
      />,
    );
    expect(screen.getByText(/Rejeté le 1er septembre 2026/)).toBeInTheDocument();
    expect(screen.getByText(/aucun résultat n'est mesuré/i)).toBeInTheDocument();
  });

  it("says nothing could be quantified rather than padding the list", () => {
    // One challenge is the honest answer on the operator's ledger; zero is the
    // honest answer on a smaller one. Neither is filled out with decoration.
    render(<ChallengeList challenges={[]} categoryNames={NAMES} onDecide={vi.fn()} />);
    expect(screen.getByText(/Aucun défi proposé/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Accepter/ })).not.toBeInTheDocument();
  });

  it("disables both buttons on the row being decided, and only that row", () => {
    const other: Challenge = { ...OPERATOR_CHALLENGE, id: 2, title: "Abonnement « Spotify »" };
    render(
      <ChallengeList
        challenges={[OPERATOR_CHALLENGE, other]}
        categoryNames={NAMES}
        onDecide={vi.fn()}
        pendingId={1}
      />,
    );
    const first = within(screen.getByTestId("yd-challenge-1"));
    expect(first.getByRole("button", { name: /Accepter/ })).toBeDisabled();
    const second = within(screen.getByTestId("yd-challenge-2"));
    expect(second.getByRole("button", { name: /Accepter/ })).toBeEnabled();
  });
});
