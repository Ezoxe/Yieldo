import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "../../app/ThemeProvider";
import type { GoalProgress, GoalReport, Milestone } from "../../lib/types";
import { GoalsPage, bandMarkers, fillWidth, progressPercent, ratioLabel } from "./GoalsPage";

// -- The engine's own sentences, verbatim ------------------------------------
//
// `backend/app/engines/goal.py` emits FOUR mutually exclusive refusals and each
// one carries a DIFFERENT remedy. They are copied here character for character
// because the screen's whole job on a refusal is to print the one it was given
// and not blur it into another: telling the operator "pas assez d'historique"
// when his capacity is simply negative sends him to the import screen to fix
// something that is not broken.

/** `_reason_capacity_not_positive` — THE OPERATOR'S OWN STATE. */
const NEGATIVE_CAPACITY =
  "Votre capacité d'épargne mesurée est négative ou nulle : au rythme constaté dans vos " +
  "relevés, cet objectif ne progresse pas, et aucune date d'atteinte ne peut être avancée.";

/** `_reason_no_capacity` — fewer than three complete observed months. */
const NO_CAPACITY =
  "Votre capacité d'épargne n'a pas pu être mesurée : il faut au moins trois mois complets " +
  "de relevés. Aucune date ne peut être projetée tant qu'elle n'est pas connue.";

/** `_reason_too_far` — the projection runs past the fifty-year cap. */
const TOO_FAR =
  "Au rythme mesuré, cet objectif ne serait pas atteint avant 50 ans. Aucune date n'est " +
  "avancée au-delà : elle ne voudrait rien dire.";

/** `_reason_blocked_by` — the QUEUE refuses, not this goal. */
const BLOCKED_BY_CHATEAU =
  "Cet objectif ne peut pas commencer à être financé : « Château », plus urgent, n'est pas " +
  "atteint dans les 50 ans projetés et mobilise toute la capacité d'épargne d'ici là. " +
  "Changez sa priorité pour le projeter.";

function milestone(percent: number, threshold: number, over: Partial<Milestone> = {}): Milestone {
  return {
    percent,
    threshold_cents: threshold,
    reached: false,
    months_away: null,
    projected_on: null,
    ...over,
  };
}

/** A goal whose projection succeeded: 1 200 € of a 6 000 € target, 20 %. */
const PROGRESS: GoalProgress = {
  goal_id: 1,
  name: "Fonds d'urgence",
  target_cents: 600_000,
  saved_cents: 120_000,
  remaining_cents: 480_000,
  progress_ratio: 0.2,
  milestones: [
    milestone(25, 150_000, { months_away: 1, projected_on: "2026-09-30" }),
    milestone(50, 300_000, { months_away: 4, projected_on: "2026-12-31" }),
    milestone(75, 450_000, { months_away: 7, projected_on: "2027-03-31" }),
    milestone(100, 600_000, { months_away: 10, projected_on: "2027-06-30" }),
  ],
  funding_starts_in_months: 0,
  months_to_completion: 10,
  projected_completion_on: "2027-06-30",
  projection_unavailable_reason: null,
  due_on: null,
  months_until_due: null,
  on_track: null,
};

/** The operator's measured rate: −746,19 €/month over three months. */
const NEGATIVE_RATE = {
  months: 3,
  median_cents: -74_619,
  spread_cents: 213_078,
  low_cents: -347_690,
  high_cents: 198_452,
};

const HEALTHY_RATE = {
  months: 6,
  median_cents: 50_000,
  spread_cents: 30_000,
  low_cents: 20_000,
  high_cents: 90_000,
};

const HISTORY = { date_from: "2025-01-24", date_to: "2026-01-09", transaction_count: 197 };

function report(over: Partial<GoalReport> = {}): GoalReport {
  return {
    goals: [PROGRESS],
    capacity: HEALTHY_RATE,
    months_observed: 6,
    history: HISTORY,
    ...over,
  };
}

/** Every goal on a refused projection: no dates anywhere, no verdict. */
function refused(goal: GoalProgress, reason: string): GoalProgress {
  return {
    ...goal,
    months_to_completion: null,
    projected_completion_on: null,
    projection_unavailable_reason: reason,
    milestones: goal.milestones.map((m) =>
      m.reached ? m : { ...m, months_away: null, projected_on: null },
    ),
    on_track: null,
  };
}

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface FetchOverrides {
  goals?: () => Response;
  onPost?: (body: unknown) => Response;
  onPatch?: (body: unknown) => Response;
  onDelete?: () => Response;
}

function setupFetch(body: GoalReport = report(), overrides: FetchOverrides = {}) {
  fetchMock.mockImplementation((input: string, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : String(input), "http://localhost");
    const method = init?.method ?? "GET";
    const parsed = init?.body ? JSON.parse(String(init.body)) : null;
    if (url.pathname === "/api/goals" && method === "POST") {
      return Promise.resolve(overrides.onPost ? overrides.onPost(parsed) : jsonResponse({}, 201));
    }
    if (url.pathname.startsWith("/api/goals/") && method === "PATCH") {
      return Promise.resolve(overrides.onPatch ? overrides.onPatch(parsed) : jsonResponse({}));
    }
    if (url.pathname.startsWith("/api/goals/") && method === "DELETE") {
      return Promise.resolve(
        overrides.onDelete ? overrides.onDelete() : new Response(null, { status: 204 }),
      );
    }
    if (url.pathname === "/api/goals") {
      return Promise.resolve(overrides.goals ? overrides.goals() : jsonResponse(body));
    }
    throw new Error(`Unhandled fetch in test: ${method} ${url.pathname}`);
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      // Motion's own reduced-motion probe still calls the legacy pair.
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  });
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/objectifs"]}>
      <ThemeProvider>
        <GoalsPage />
      </ThemeProvider>
    </MemoryRouter>,
  );
}

describe("GoalsPage — the capacity panel", () => {
  it("says the capacity is negative, and does not show an empty projection", async () => {
    // THE OPERATOR'S OWN STATE. −74 619 c/month measured over 3 months.
    setupFetch(
      report({
        goals: [refused(PROGRESS, NEGATIVE_CAPACITY)],
        capacity: NEGATIVE_RATE,
        months_observed: 3,
      }),
    );
    renderPage();

    expect(await screen.findByText(/ne progresse pas/)).toBeInTheDocument();
    // The measured rate is stated as the negative figure it is, with its sample.
    expect(screen.getByText(/−746,19/)).toBeInTheDocument();
    expect(screen.getByText(/3 mois de relevés/)).toBeInTheDocument();
    // The band is quoted whole, never the median alone.
    expect(screen.getByText(/−3 476,90/)).toBeInTheDocument();
    expect(screen.getByText(/\+1 984,52/)).toBeInTheDocument();
    // No projected date anywhere, and no milestone date either.
    expect(screen.queryByText(/Atteint le/)).not.toBeInTheDocument();
  });

  it("never offers the import remedy to a household whose capacity is merely negative", async () => {
    // The defect this wording exists to prevent: sending the operator to the
    // import screen to fix a ledger that is not broken. His statements are
    // fine; he is spending more than he earns.
    setupFetch(
      report({
        goals: [refused(PROGRESS, NEGATIVE_CAPACITY)],
        capacity: NEGATIVE_RATE,
        months_observed: 3,
      }),
    );
    renderPage();

    await screen.findByText(/ne progresse pas/);
    expect(screen.queryByRole("link", { name: /relevés/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/trois mois complets/)).not.toBeInTheDocument();
    // And it says outright that importing more would change nothing.
    expect(screen.getByText(/n'y changerait rien/)).toBeInTheDocument();
  });

  it("tells a household with too little history a DIFFERENT thing", async () => {
    // Same screen, different cause, different remedy: import statements.
    // These two must never render the same sentence.
    setupFetch(
      report({
        goals: [refused(PROGRESS, NO_CAPACITY)],
        capacity: null,
        months_observed: 1,
      }),
    );
    renderPage();

    // `findAllBy`, not `findBy`: the engine's own sentence and the panel's
    // fallback both name this cause, and which of the two is on screen depends
    // on whether any goal is declared at all.
    expect((await screen.findAllByText(/trois mois complets/)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/ne progresse pas/)).not.toBeInTheDocument();
    // Here — and only here — the way out is the import screen.
    expect(screen.getByRole("link", { name: /relevés/i })).toHaveAttribute("href", "/import");
    // No figure is invented to stand in for the rate that could not be measured.
    expect(screen.getByText("Non mesurable")).toBeInTheDocument();
  });

  it("places zero and the median inside the measured band", () => {
    const markers = bandMarkers(NEGATIVE_RATE);
    // 0 sits 347 690 of the way along the 546 142-wide band, and the median
    // −74 619 sits exactly halfway (273 071 × 2 = 546 142).
    expect(markers).not.toBeNull();
    expect(markers?.zero).toBe("63.662930153696294%");
    expect(markers?.median).toBe("50%");
  });

  it("draws no band at all when it has no width", () => {
    // low === high is a single repeated observation: the marker would divide by
    // zero, emit `NaN%`, and React would drop the declaration — leaving the
    // median pinned to the left edge as if it were the band's minimum.
    expect(bandMarkers({ ...HEALTHY_RATE, low_cents: 5_000, high_cents: 5_000 })).toBeNull();
  });
});

describe("GoalsPage — the goal cards", () => {
  it("names the wait before a second goal starts being funded", async () => {
    // Without it, a date sixteen months out on a 300 000 c goal at 500 EUR/month
    // looks like an arithmetic error.
    const urgence: GoalProgress = { ...PROGRESS, goal_id: 1, name: "Urgence" };
    const voiture: GoalProgress = {
      ...PROGRESS,
      goal_id: 2,
      name: "Voiture",
      funding_starts_in_months: 10,
      months_to_completion: 16,
      projected_completion_on: "2027-12-31",
    };
    setupFetch(report({ goals: [urgence, voiture] }));
    renderPage();

    expect(
      await screen.findByText(/Ce financement commence dans 10 mois, une fois « Urgence » atteint/),
    ).toBeInTheDocument();
  });

  it("marks a reached milestone without inventing a date for it", async () => {
    // reached: true, projected_on: null -> "Atteint" and nothing else. Never
    // "Atteint le 25 août 2026", which is today and is not when it happened.
    const goal: GoalProgress = {
      ...PROGRESS,
      milestones: [
        milestone(25, 150_000, { reached: true }),
        ...PROGRESS.milestones.slice(1),
      ],
    };
    setupFetch(report({ goals: [goal] }));
    renderPage();

    const first = await screen.findByTestId("yd-milestone-1-25");
    expect(within(first).getByText("Atteint")).toBeInTheDocument();
    expect(within(first).queryByText(/2026|2027/)).not.toBeInTheDocument();
  });

  it("shows a progress bar whose width is a real percentage", async () => {
    // Percentage widths inside an auto-width flex column resolve to ZERO. The
    // track sits in a grid row with a definite inline size (GoalsPage.css).
    setupFetch();
    renderPage();

    const bar = await screen.findByRole("progressbar", { name: /Fonds d'urgence/ });
    expect(bar).toHaveAttribute("aria-valuenow", "20");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
    // Read raw, so the no-break spaces `formatCents` emits are normalised here
    // rather than by testing-library's own matcher.
    expect(bar.getAttribute("aria-valuetext")?.replace(/\s/g, " ")).toBe(
      "1 200,00 € épargnés sur 6 000,00 €, soit 20 %",
    );
    expect(screen.getByTestId("yd-goal-fill-1")).toHaveStyle({ width: "20%" });
  });

  it("caps the bar at 100 % while the text still reports the overfunding", async () => {
    const over: GoalProgress = {
      ...PROGRESS,
      saved_cents: 900_000,
      remaining_cents: 0,
      progress_ratio: 1.5,
      milestones: PROGRESS.milestones.map((m) => ({
        ...m,
        reached: true,
        months_away: null,
        projected_on: null,
      })),
      months_to_completion: 0,
      projected_completion_on: "2026-08-30",
    };
    setupFetch(report({ goals: [over] }));
    renderPage();

    await screen.findByText(/Objectif atteint/);
    expect(screen.getByTestId("yd-goal-fill-1")).toHaveStyle({ width: "100%" });
    expect(screen.getByText(/150 %/)).toBeInTheDocument();
    // `projected_completion_on` is TODAY on a goal already funded, not a
    // forecast. Printing it as an achievement date would claim it happened now,
    // which is the same lie a dated reached-milestone would tell.
    expect(screen.queryByText(/Atteint le/)).not.toBeInTheDocument();
  });

  it("never renders a full bar for a ratio it cannot read", () => {
    // Defence in depth. `target_cents` is `gt=0` on the wire so a NaN ratio
    // should be unreachable — but `width: NaN%` is dropped by React and the bar
    // falls back to `width: auto`, i.e. FULL. A full bar on an unknown is the
    // worst lie this screen can tell, so the guard is explicit.
    expect(progressPercent(Number.NaN)).toBe(0);
    expect(fillWidth(Number.NaN)).toBe("0%");
    expect(ratioLabel(Number.NaN)).toBe("part inconnue");
    expect(progressPercent(1.5)).toBe(100);
    // The space before the "%" is U+00A0, as French typography asks and as
    // `formatCents` already emits before its "€". A plain space here passes the
    // eye and fails the assertion — which is the point of pinning it.
    expect(ratioLabel(1.5)).toBe("150 %");
  });

  it("prints the fifty-year refusal and the queue refusal as the different things they are", async () => {
    const chateau = refused({ ...PROGRESS, goal_id: 1, name: "Château" }, TOO_FAR);
    const casque = refused(
      { ...PROGRESS, goal_id: 2, name: "Casque", funding_starts_in_months: 0 },
      BLOCKED_BY_CHATEAU,
    );
    setupFetch(report({ goals: [chateau, casque] }));
    renderPage();

    // The blocked goal blames the queue and names the blocker — not its own size.
    expect(await screen.findByText(BLOCKED_BY_CHATEAU)).toBeInTheDocument();
    expect(screen.getByText(TOO_FAR)).toBeInTheDocument();
    const blocked = screen.getByTestId("yd-goal-2");
    expect(within(blocked).queryByText(/ne serait pas atteint/)).not.toBeInTheDocument();
  });

  it("renders on_track in three states and never accuses without a basis", async () => {
    const late: GoalProgress = {
      ...PROGRESS, goal_id: 1, name: "Tard", due_on: "2026-09-30",
      months_until_due: 1, on_track: false,
    };
    const fine: GoalProgress = {
      ...PROGRESS, goal_id: 2, name: "Bien", due_on: "2029-01-01",
      months_until_due: 29, on_track: true,
    };
    const mute: GoalProgress = refused(
      { ...PROGRESS, goal_id: 3, name: "Muet", due_on: "2027-07-01", months_until_due: 11 },
      NEGATIVE_CAPACITY,
    );
    setupFetch(report({ goals: [late, fine, mute] }));
    renderPage();

    await screen.findByTestId("yd-goal-3");
    expect(within(screen.getByTestId("yd-goal-1")).getByText(/en retard/i)).toBeInTheDocument();
    expect(within(screen.getByTestId("yd-goal-2")).getByText(/dans les temps/i)).toBeInTheDocument();
    const undecidable = within(screen.getByTestId("yd-goal-3"));
    expect(undecidable.getByText(/on ne peut pas se prononcer/i)).toBeInTheDocument();
    expect(undecidable.queryByText(/en retard/i)).not.toBeInTheDocument();
  });
});

describe("GoalsPage — the empty state and the writes", () => {
  it("diagnoses an empty list instead of describing it", async () => {
    setupFetch(report({ goals: [] }));
    renderPage();

    expect(await screen.findByText("Aucun objectif.")).toBeInTheDocument();
    // The diagnosis: Yieldo cannot tell which euros belong to which goal.
    expect(screen.getByText(/ressemble à n'importe quelle autre/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ajouter un objectif/ })).toBeInTheDocument();
  });

  it("reloads after a goal is archived", async () => {
    const user = userEvent.setup();
    setupFetch();
    renderPage();

    await user.click(await screen.findByRole("button", { name: /Archiver Fonds d'urgence/ }));
    await user.click(screen.getByRole("button", { name: "Confirmer" }));

    await waitFor(() => {
      const deletes = fetchMock.mock.calls.filter((call) => call[1]?.method === "DELETE");
      expect(deletes).toHaveLength(1);
      expect(String(deletes[0][0])).toContain("/api/goals/1");
    });
  });

  it("surfaces a failed load instead of rendering an empty screen", async () => {
    setupFetch(report(), {
      goals: () => jsonResponse({ detail: "Base de données indisponible" }, 500),
    });
    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(/Base de données indisponible/);
  });
});
