import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Streak } from "../../lib/types";
import { StreakPanel, monthState } from "./StreakPanel";
import { OPERATOR_STREAK } from "./fixtures";

/** `engines/streak.py`'s `_reason_never_started`, verbatim. */
const NEVER_STARTED = "Aucun relevé n'a encore été importé : le suivi n'a pas commencé.";

const LIVE: Streak = {
  current: 4,
  longest: 13,
  last_complete_month: "2026-08",
  months: [
    { key: "2026-05", covered: true, transaction_count: 31, imported: true },
    { key: "2026-06", covered: true, transaction_count: 28, imported: true },
    { key: "2026-07", covered: true, transaction_count: 30, imported: true },
    { key: "2026-08", covered: true, transaction_count: 22, imported: true },
  ],
  broken_reason: null,
};

const NEVER: Streak = {
  current: 0,
  longest: 0,
  last_complete_month: null,
  months: [],
  broken_reason: NEVER_STARTED,
};

describe("monthState", () => {
  it("tells an empty imported month apart from a month never imported", () => {
    // The whole reason `MonthCovered.imported` exists. The operator has eight
    // of the first kind (2025-04..2025-11) and seven of the second, and the
    // streak counts the first and breaks on the second — so they cannot look
    // alike on screen either.
    expect(monthState({ key: "2025-04", covered: false, transaction_count: 0, imported: true }))
      .toBe("empty");
    expect(monthState({ key: "2026-03", covered: false, transaction_count: 0, imported: false }))
      .toBe("missing");
    expect(monthState({ key: "2025-12", covered: true, transaction_count: 77, imported: true }))
      .toBe("covered");
  });
});

describe("StreakPanel", () => {
  it("prints the engine's own broken sentence verbatim", () => {
    // "Le suivi s'est interrompu" and "le suivi n'a pas commencé" are two
    // different refusals with two different remedies. Paraphrasing either into
    // the other is the defect class this project keeps paying for.
    render(<StreakPanel streak={OPERATOR_STREAK} />);
    expect(screen.getByText(OPERATOR_STREAK.broken_reason as string)).toBeInTheDocument();
    expect(screen.queryByText(NEVER_STARTED)).not.toBeInTheDocument();
  });

  it("says the follow-up stopped, never that it never started", () => {
    render(<StreakPanel streak={NEVER} />);
    expect(screen.getByText(NEVER_STARTED)).toBeInTheDocument();
    // Nothing to draw: there is no month to show, and a strip of zero cells
    // would be an empty frame implying a history that does not exist.
    expect(screen.queryByTestId("yd-streak-strip")).not.toBeInTheDocument();
  });

  it("shows the broken count as a measured zero beside the record it broke", () => {
    render(<StreakPanel streak={OPERATOR_STREAK} />);
    expect(screen.getByTestId("yd-streak-current")).toHaveTextContent("0");
    expect(screen.getByText(/Votre plus longue série : 13 mois/)).toBeInTheDocument();
    expect(screen.getByText(/Dernier mois importé : janvier 2026/)).toBeInTheDocument();
  });

  it("carries no refusal at all while the streak is live", () => {
    render(<StreakPanel streak={LIVE} />);
    expect(screen.getByTestId("yd-streak-current")).toHaveTextContent("4");
    expect(screen.queryByTestId("yd-streak-refusal")).not.toBeInTheDocument();
    expect(screen.getByText(/mois consécutifs de relevés importés/)).toBeInTheDocument();
  });

  it("agrees the unit with a streak of exactly one month", () => {
    // French takes the singular for one — "mois" is invariable, the adjective
    // is not, and "1 mois consécutifs" is the kind of wrong this repo has
    // already shipped once.
    render(<StreakPanel streak={{ ...LIVE, current: 1 }} />);
    expect(screen.getByText(/mois consécutif de relevés importés/)).toBeInTheDocument();
  });

  it("draws one cell per month, grouped under its own year", () => {
    render(<StreakPanel streak={OPERATOR_STREAK} />);
    const strip = screen.getByTestId("yd-streak-strip");
    // Twelve months of 2025 and nine of 2026 — the year captions are not list
    // items, they are the group's own heading.
    expect(within(strip).getAllByRole("listitem")).toHaveLength(21);
    expect(within(strip).getByText("2025")).toBeInTheDocument();
    expect(within(strip).getByText("2026")).toBeInTheDocument();
  });

  it("names each month's own state in text, not in colour alone", () => {
    render(<StreakPanel streak={OPERATOR_STREAK} />);
    expect(screen.getByText("décembre 2025 : 77 opérations importées.")).toBeInTheDocument();
    expect(
      screen.getByText("avril 2025 : relevé importé, aucune opération ce mois-là."),
    ).toBeInTheDocument();
    expect(screen.getByText("mars 2026 : aucun relevé importé.")).toBeInTheDocument();
  });

  it("singularises a month holding exactly one operation", () => {
    render(
      <StreakPanel
        streak={{
          ...LIVE,
          months: [{ key: "2026-05", covered: true, transaction_count: 1, imported: true }],
        }}
      />,
    );
    expect(screen.getByText("mai 2026 : 1 opération importée.")).toBeInTheDocument();
  });
});
