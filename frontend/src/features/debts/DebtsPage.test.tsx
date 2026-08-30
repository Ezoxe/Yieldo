import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "../../app/ThemeProvider";
import type { Debt, PayoffPlan, StrategyComparison } from "../../lib/types";
import { DebtsPage } from "./DebtsPage";

// The real chart mounts ECharts against a canvas jsdom does not have. What it
// draws is pinned by charts/DebtPayoffChart.test.tsx; this screen's job is
// deciding whether it may be drawn at all.
vi.mock("../../charts/DebtPayoffChart", () => ({
  DebtPayoffChart: ({ points }: { points: unknown[] }) => (
    <div role="img" aria-label={`Remboursement (stub, ${points.length} mois)`} />
  ),
}));

const DEBTS: Debt[] = [
  {
    id: 1, name: "Conso", kind: "consumer", principal_cents: 200_000, annual_rate_bps: 2000,
    minimum_payment_cents: 5_000, term_months: null, opened_on: null, archived: false,
  },
  {
    id: 2, name: "Auto", kind: "auto", principal_cents: 50_000, annual_rate_bps: 500,
    minimum_payment_cents: 5_000, term_months: null, opened_on: null, archived: false,
  },
];

function plan(strategy: string, order: number[], interest: number): PayoffPlan {
  return {
    strategy,
    monthly_budget_cents: 10_000,
    first_month_interest_cents: 3_542,
    months: 30,
    cleared_on: "2029-02-28",
    total_interest_cents: interest,
    total_paid_cents: 250_000 + interest,
    order,
    payoffs: [],
    points: [
      {
        month: 1, on: "2026-09-30",
        balances_cents: { "1": 198_000, "2": 47_000 },
        total_cents: 245_000,
      },
    ],
    unavailable_reason: null,
  };
}

const HEALTHY: StrategyComparison = {
  snowball: plan("snowball", [2, 1], 40_000),
  avalanche: plan("avalanche", [1, 2], 31_000),
  interest_saved_cents: 9_000,
  months_saved: 2,
};

/** `engines/debt._reason_budget_too_small`, verbatim. */
const BUDGET_REASON =
  "La mensualité totale disponible ne couvre pas les intérêts du premier mois : le capital ne " +
  "diminuerait jamais, et aucun échéancier ne peut être établi. Augmentez le versement mensuel, " +
  "ou renégociez le taux de la dette la plus chère.";

/** The engine's own refusal branch: `budget <= first_interest`, so the budget
 *  here is genuinely BELOW the first month's interest, as it must be. */
function refused(strategy: string): PayoffPlan {
  return {
    ...plan(strategy, [1, 2], 0),
    monthly_budget_cents: 3_000,
    first_month_interest_cents: 3_542,
    months: null,
    cleared_on: null,
    total_interest_cents: 0,
    total_paid_cents: 0,
    points: [],
    unavailable_reason: BUDGET_REASON,
  };
}

const REFUSED: StrategyComparison = {
  snowball: refused("snowball"),
  avalanche: refused("avalanche"),
  interest_saved_cents: null,
  months_saved: null,
};

/** What the engine answers a household with no debts: 0 months, no refusal. */
const NO_DEBTS: StrategyComparison = {
  snowball: {
    ...plan("snowball", [], 0), months: 0, cleared_on: null, monthly_budget_cents: 0,
    first_month_interest_cents: 0, total_interest_cents: 0, total_paid_cents: 0, points: [],
  },
  avalanche: {
    ...plan("avalanche", [], 0), months: 0, cleared_on: null, monthly_budget_cents: 0,
    first_month_interest_cents: 0, total_interest_cents: 0, total_paid_cents: 0, points: [],
  },
  interest_saved_cents: 0,
  months_saved: 0,
};

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface FetchOverrides {
  debts?: () => Response;
  payoff?: (extra: string | null) => Response;
  onPost?: (body: unknown) => Response;
  onDelete?: () => Response;
}

function setupFetch(overrides: FetchOverrides = {}) {
  fetchMock.mockImplementation((input: string, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : String(input), "http://localhost");
    const method = init?.method ?? "GET";
    if (url.pathname === "/api/debts" && method === "POST") {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      return Promise.resolve(overrides.onPost ? overrides.onPost(body) : jsonResponse(DEBTS[0], 201));
    }
    if (url.pathname.startsWith("/api/debts/") && method === "DELETE") {
      return Promise.resolve(
        overrides.onDelete ? overrides.onDelete() : new Response(null, { status: 204 }),
      );
    }
    if (url.pathname === "/api/debts/payoff") {
      const extra = url.searchParams.get("extra_cents");
      return Promise.resolve(
        overrides.payoff ? overrides.payoff(extra) : jsonResponse(HEALTHY),
      );
    }
    if (url.pathname === "/api/debts") {
      return Promise.resolve(overrides.debts ? overrides.debts() : jsonResponse(DEBTS));
    }
    throw new Error(`Unhandled fetch in test: ${method} ${url.pathname}`);
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("ResizeObserver", undefined);
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
    <MemoryRouter initialEntries={["/dettes"]}>
      <ThemeProvider>
        <DebtsPage />
      </ThemeProvider>
    </MemoryRouter>,
  );
}

describe("DebtsPage", () => {
  it("shows what choosing avalanche over snowball actually saves", async () => {
    setupFetch();
    renderPage();

    expect(await screen.findByText(/90,00/)).toBeInTheDocument();
    expect(screen.getByText(/2 mois/)).toBeInTheDocument();
  });

  it("prints the engine's own refusal, and no chart, when the budget is too small", async () => {
    setupFetch({ payoff: () => jsonResponse(REFUSED) });
    renderPage();

    expect(
      await screen.findByText(/ne couvre pas les intérêts du premier mois/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    // And it must NOT be dressed as a load failure. Phase 2A shipped exactly
    // that: a deliberate refusal rendered in the negative alert under "Ce
    // panneau n'a pas pu être chargé".
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("states the shortfall in euros behind a budget refusal", async () => {
    // `monthly_budget_cents` and `first_month_interest_cents` are published by
    // the engine precisely so the screen can say this without recomputing it.
    setupFetch({ payoff: () => jsonResponse(REFUSED) });
    renderPage();

    const shortfall = await screen.findByTestId("yd-debts-shortfall");
    expect(shortfall).toHaveTextContent(/30,00/);
    expect(shortfall).toHaveTextContent(/35,42/);
    // The gap itself, not left for the reader to subtract.
    expect(shortfall).toHaveTextContent(/5,42/);
  });

  it("says the household has no debts rather than refusing", async () => {
    setupFetch({ debts: () => jsonResponse([]), payoff: () => jsonResponse(NO_DEBTS) });
    renderPage();

    expect(await screen.findByText(/Aucune dette enregistrée/)).toBeInTheDocument();
    expect(screen.queryByText(/ne couvre pas/)).not.toBeInTheDocument();
    // "soldé dans 0 mois" would be absurd. So would a chart of nothing.
    expect(screen.queryByText(/0 mois/)).not.toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("never claims a saving the comparison refused to compute", async () => {
    setupFetch({ payoff: () => jsonResponse(REFUSED) });
    renderPage();

    await screen.findByText(/ne couvre pas les intérêts du premier mois/);
    expect(screen.queryByText(/d'intérêts en moins/)).not.toBeInTheDocument();
  });

  it("says the two strategies cost the same rather than printing a 0 € saving", async () => {
    setupFetch({
      payoff: () =>
        jsonResponse({
          snowball: plan("snowball", [1, 2], 31_000),
          avalanche: plan("avalanche", [1, 2], 31_000),
          interest_saved_cents: 0,
          months_saved: 0,
        }),
    });
    renderPage();

    expect(await screen.findByText(/coûtent exactement la même chose/)).toBeInTheDocument();
    expect(screen.queryByText(/0,00 € d'intérêts en moins/)).not.toBeInTheDocument();
  });

  it("says so plainly when rounding leaves avalanche a cent behind", async () => {
    // `test_avalanche_can_tie_or_trail_by_a_cent` pins this in the backend:
    // rounding each month's interest to the cent can put avalanche BEHIND.
    // "vous économisez −0,01 €" is not an answer.
    setupFetch({
      payoff: () =>
        jsonResponse({
          snowball: plan("snowball", [2, 1], 31_000),
          avalanche: plan("avalanche", [1, 2], 31_001),
          interest_saved_cents: -1,
          months_saved: 0,
        }),
    });
    renderPage();

    expect(await screen.findByText(/coûte .* de plus/)).toBeInTheDocument();
    expect(screen.queryByText(/d'intérêts en moins/)).not.toBeInTheDocument();
  });

  it("shows each strategy's attack order by name, never by position on screen", async () => {
    setupFetch();
    renderPage();

    const snowball = await screen.findByTestId("yd-plan-snowball");
    expect(within(snowball).getByRole("list", { name: /ordre d'attaque/i })).toHaveTextContent(
      /Auto.*Conso/s,
    );
    const avalanche = screen.getByTestId("yd-plan-avalanche");
    expect(within(avalanche).getByRole("list", { name: /ordre d'attaque/i })).toHaveTextContent(
      /Conso.*Auto/s,
    );
  });

  it("re-queries the payoff with the extra payment, and shows it is working", async () => {
    const user = userEvent.setup();
    setupFetch();
    renderPage();
    // "Conso" also appears in each plan's attack order; the row's own control is
    // the unambiguous handle on the list itself.
    await screen.findByRole("button", { name: "Modifier Conso" });

    await user.clear(screen.getByLabelText(/Versement mensuel supplémentaire/));
    await user.type(screen.getByLabelText(/Versement mensuel supplémentaire/), "50");

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([input]) => String(input).includes("extra_cents=5000")),
      ).toBe(true),
    );
  });

  it("refuses a negative extra payment at the field, not in a page alert", async () => {
    const user = userEvent.setup();
    setupFetch();
    renderPage();
    // "Conso" also appears in each plan's attack order; the row's own control is
    // the unambiguous handle on the list itself.
    await screen.findByRole("button", { name: "Modifier Conso" });

    const field = screen.getByLabelText(/Versement mensuel supplémentaire/);
    await user.clear(field);
    await user.type(field, "-40");

    await screen.findByText(/ne peut pas être négatif/);
    expect(field).toHaveAttribute("aria-invalid", "true");
    // Attached to the field it describes, not floated to the top of the page:
    // at 375px a page-level alert sits several screens above this input.
    const describedBy = field.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent(/ne peut pas être négatif/);
    // And nothing was asked of the backend with that value.
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).includes("extra_cents=-")),
    ).toBe(false);
  });

  it("adds a debt and reloads both queries", async () => {
    const user = userEvent.setup();
    setupFetch();
    renderPage();
    // "Conso" also appears in each plan's attack order; the row's own control is
    // the unambiguous handle on the list itself.
    await screen.findByRole("button", { name: "Modifier Conso" });

    await user.click(screen.getByRole("button", { name: /Ajouter une dette/ }));
    await user.type(screen.getByLabelText(/Intitulé/), "Étudiant");
    await user.type(screen.getByLabelText(/Capital restant dû/), "12000");
    await user.type(screen.getByLabelText(/Mensualité/), "150");
    await user.click(screen.getByRole("button", { name: /Enregistrer/ }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
      expect(post).toBeDefined();
      expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({
        name: "Étudiant",
        principal_cents: 1_200_000,
        minimum_payment_cents: 15_000,
      });
    });
    // Both queries again: the list AND the plan that was computed from it.
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/debts/payoff")).length,
      ).toBeGreaterThan(1),
    );
  });

  it("reports a failed load in the alert, which a refusal never uses", async () => {
    setupFetch({
      payoff: () => jsonResponse({ detail: "Base de données indisponible" }, 500),
    });
    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(/Base de données indisponible/);
  });
});
