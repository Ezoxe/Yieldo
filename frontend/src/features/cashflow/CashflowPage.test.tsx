import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "../../app/ThemeProvider";
import type { Forecast, Runway } from "../../lib/types";
import { CashflowPage } from "./CashflowPage";

// The real chart mounts ECharts against a canvas jsdom does not have. What it
// draws is task 13's business and is pinned by its own suite; this screen's
// job is deciding whether it may be drawn at all.
vi.mock("../../charts/ForecastFanChart", () => ({
  ForecastFanChart: ({ months }: { months: unknown[] }) => (
    <div role="img" aria-label={`Projection (stub, ${months.length} mois)`} />
  ),
}));

const fetchMock = vi.fn();

/** A populated forecast — the state the operator's own ledger cannot reach. */
const forecast: Forecast = {
  months: [
    {
      key: "2026-09",
      start: "2026-09-01",
      end: "2026-09-30",
      recurring_cents: -78000,
      residual_cents: -20000,
      net_p50_cents: -98000,
      balance_p10_cents: 30000,
      balance_p50_cents: 50000,
      balance_p90_cents: 70000,
      below_threshold: false,
      seasonal: false,
    },
    {
      key: "2026-10",
      start: "2026-10-01",
      end: "2026-10-31",
      recurring_cents: -78000,
      residual_cents: -20000,
      net_p50_cents: -98000,
      balance_p10_cents: -40000,
      balance_p50_cents: 20000,
      balance_p90_cents: 80000,
      below_threshold: true,
      seasonal: false,
    },
  ],
  months_observed: 7,
  ledger_months_observed: 9,
  seasonality_used: false,
  recurrences_projected: 5,
  threshold_cents: 0,
  first_breach_key: "2026-10",
  opening_balance_cents: 148000,
  insufficient_reason: null,
  projected_from: "2026-08-31",
  ledger_last_on: "2026-08-31",
  pooled_scale_cents: 42000,
  seasonal_scale_cents: null,
  band_unavailable_reason: null,
  recurring_only: false,
};

/** The operator's real state: three complete months against a floor of six. */
const thinForecast: Forecast = {
  months: [],
  months_observed: 3,
  ledger_months_observed: 3,
  seasonality_used: false,
  recurrences_projected: 0,
  threshold_cents: 0,
  first_breach_key: null,
  opening_balance_cents: -220963,
  insufficient_reason:
    "Pas assez de données pour projeter : il faut au moins 6 mois complets de relevés, et l'historique n'en compte que 3. Importez des relevés supplémentaires pour obtenir une prévision.",
  projected_from: "2026-01-09",
  ledger_last_on: "2026-01-09",
  pooled_scale_cents: 0,
  seasonal_scale_cents: null,
  band_unavailable_reason: null,
  recurring_only: false,
};

const runway: Runway = {
  balance_cents: 148000,
  months_observed: 9,
  ledger_span_months: 11,
  normal: {
    name: "normal",
    monthly_burn_cents: 190000,
    rate: { months: 9, median_cents: 190000, spread_cents: 40000, low_cents: 138800, high_cents: 241200 },
    months: 0.78,
    depleted_on: "2026-09-04",
  },
  essentials: {
    name: "essentials",
    monthly_burn_cents: 120000,
    rate: { months: 6, median_cents: 120000, spread_cents: 30000, low_cents: 81600, high_cents: 158400 },
    months: 1.23,
    depleted_on: "2026-09-19",
  },
  normal_unavailable_reason: null,
  essentials_unavailable_reason: null,
  essential_category_count: 21,
  projected_from: "2026-08-31",
  ledger_last_on: "2026-08-31",
};

/** The operator's real runway: 13 calendar months of ledger, 3 usable. */
const staleRunway: Runway = {
  balance_cents: -220963,
  months_observed: 3,
  ledger_span_months: 13,
  normal: {
    name: "normal",
    monthly_burn_cents: 265449,
    rate: { months: 3, median_cents: 265449, spread_cents: 221457, low_cents: -18360, high_cents: 549258 },
    months: 0.0,
    depleted_on: "2026-08-22",
  },
  essentials: {
    name: "essentials",
    monthly_burn_cents: 125449,
    rate: { months: 3, median_cents: 125449, spread_cents: 113401, low_cents: -19880, high_cents: 270778 },
    months: 0.0,
    depleted_on: "2026-08-22",
  },
  normal_unavailable_reason: null,
  essentials_unavailable_reason: null,
  essential_category_count: 21,
  projected_from: "2026-08-22",
  ledger_last_on: "2026-01-09",
};

/**
 * A nine-month ledger whose essential-tagged spending only reaches two of
 * those months. `normal` measures fine; `essentials` alone refuses, and its
 * refusal is printed six lines above the cell's own "dont 9 mois complets".
 *
 * The string is the backend's, verbatim — `runway._reason_insufficient_history`
 * on its `observed < ledger_months` branch.
 */
const thinEssentialsRunway: Runway = {
  ...runway,
  essentials: null,
  essentials_unavailable_reason:
    "Pas assez de mois pour mesurer les dépenses essentielles : seuls 2 mois portent ce type de dépense sur les 9 mois complets de l'historique, et il en faut au moins 3.",
};

/**
 * The same ledger with nothing at all flagged essential — `runway.py`'s
 * `_reason_no_essential_category`, which quotes no month count because none is
 * relevant: no length of history produces essential spending when no category
 * is flagged.
 */
const noEssentialCategoryRunway: Runway = {
  ...runway,
  essentials: null,
  essentials_unavailable_reason:
    "Ce scénario n'a aucune dépense à mesurer : aucune catégorie n'est marquée essentielle, et la longueur de l'historique n'y change rien.",
  essential_category_count: 0,
};

/**
 * A user's second month: two complete months against a floor of three, so
 * `measure_expense_rate` returns nothing for either scenario and BOTH come
 * back null. Everything the cell says about a measured rate is false here.
 */
const unmeasurableRunway: Runway = {
  balance_cents: 148000,
  months_observed: 2,
  ledger_span_months: 13,
  normal: null,
  essentials: null,
  normal_unavailable_reason:
    "Pas assez d'historique pour mesurer l'ensemble des dépenses : il faut au moins 3 mois complets de relevés, et l'historique n'en compte que 2.",
  essentials_unavailable_reason:
    "Pas assez d'historique pour mesurer les dépenses essentielles : il faut au moins 3 mois complets de relevés, et l'historique n'en compte que 2.",
  essential_category_count: 21,
  projected_from: "2026-08-22",
  ledger_last_on: "2026-01-09",
};

/**
 * The other road to the same state: enough months, but neither median is a
 * measurable burn (`runway.py`'s `rate.median_cents <= 0` branch). Three
 * observed months, so the "bare minimum" sentence is in range too — and it
 * must not claim a fragile rate exists when none was produced.
 */
const noBurnRunway: Runway = {
  ...unmeasurableRunway,
  months_observed: 3,
  normal_unavailable_reason:
    "Aucune autonomie mesurable pour l'ensemble des dépenses : sur les 3 mois complets de l'historique, la dépense médiane d'un mois est nulle, il n'y a donc aucune sortie d'argent à couvrir.",
  essentials_unavailable_reason:
    "Aucune autonomie mesurable pour les dépenses essentielles : sur les 3 mois complets de l'historique, la dépense médiane d'un mois est nulle, il n'y a donc aucune sortie d'argent à couvrir.",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function setupFetch(overrides: { forecast?: () => Response; runway?: () => Response } = {}) {
  fetchMock.mockImplementation((input: string) => {
    const url = new URL(typeof input === "string" ? input : String(input), "http://localhost");
    if (url.pathname === "/api/cashflow/forecast") {
      return Promise.resolve(overrides.forecast ? overrides.forecast() : jsonResponse(forecast));
    }
    if (url.pathname === "/api/cashflow/runway") {
      return Promise.resolve(overrides.runway ? overrides.runway() : jsonResponse(runway));
    }
    throw new Error(`Unhandled fetch in test: ${url.pathname}`);
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
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  });
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/tresorerie"]}>
      <ThemeProvider>
        <CashflowPage />
      </ThemeProvider>
    </MemoryRouter>,
  );
}

/**
 * Opens the runway panel's method tip.
 *
 * The three sentences it holds — over which months, from which date, on which
 * category list — used to sit stacked under the two figures. They are all
 * still written, in full; they are one hover away. See `InfoTip`.
 */
/**
 * Opens the forecast panel's method note.
 *
 * The four sentences it holds — the horizon's start, the months the band was
 * measured on, how many recurrences were carried, what the band is — used to
 * sit stacked under the chart. All four still ship, word for word, one hover
 * away.
 */
async function openForecastMethod() {
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Comment cette prévision est établie" }),
  );
  return screen.getByRole("tooltip");
}

async function openRunwayMethod() {
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Comment cette autonomie est mesurée" }),
  );
  return screen.getByRole("tooltip");
}

describe("CashflowPage", () => {
  it("shows both runway scenarios", async () => {
    setupFetch();
    renderPage();

    expect(await screen.findByText("Rythme actuel")).toBeInTheDocument();
    expect(screen.getByText("Dépenses réduites à l'essentiel")).toBeInTheDocument();
  });

  it("names the first month the balance could fall under the threshold", async () => {
    setupFetch();
    renderPage();

    expect(await screen.findByText(/octobre 2026/i)).toBeInTheDocument();
  });

  it("draws the fan chart when the forecast has months", async () => {
    setupFetch();
    renderPage();

    expect(await screen.findByRole("img", { name: /Projection \(stub, 2 mois\)/ })).toBeInTheDocument();
  });

  // Requirement 3: `ledger_span_months` and `months_observed` are different
  // populations. 13 calendar months of statements with a nine-month import
  // hole must not read as a three-month ledger.
  it("tells the ledger's calendar span apart from the months it could measure", async () => {
    setupFetch({ forecast: () => jsonResponse(thinForecast), runway: () => jsonResponse(staleRunway) });
    renderPage();

    const span = await screen.findByText(/13 mois/);
    expect(span).toHaveTextContent(/13 mois/);
    expect(span).toHaveTextContent(/3 mois complets/);
  });

  it("warns when the rate rests on the bare minimum of three months", async () => {
    setupFetch({ forecast: () => jsonResponse(thinForecast), runway: () => jsonResponse(staleRunway) });
    renderPage();

    expect(await screen.findByText(/minimum/i)).toBeInTheDocument();
  });

  // Requirement 1: two panels, two clocks. Both payloads carry `projected_from`
  // precisely so the screen can say which date each panel starts from.
  it("names the date each panel counts from when the two differ", async () => {
    setupFetch({ forecast: () => jsonResponse(thinForecast), runway: () => jsonResponse(staleRunway) });
    renderPage();

    const note = await screen.findByTestId("yd-cashflow-clocks");
    // The runway's clock: the real calendar date.
    expect(note).toHaveTextContent(/22 août 2026/);
    // The forecast's clock: the ledger's last transaction date.
    expect(note).toHaveTextContent(/9 janvier 2026/);
  });

  it("says nothing about diverging clocks when both panels start from the same date", async () => {
    setupFetch();
    renderPage();

    await screen.findByText("Rythme actuel");
    expect(screen.queryByTestId("yd-cashflow-clocks")).not.toBeInTheDocument();
  });

  // Finding 1. The runway cell was gated only on `runway === null`, so when
  // BOTH scenarios come back null — which is any user's second month — four
  // sentences went on asserting a measured rate beside two "Non mesurable"
  // panels. Nothing was measured; the cell must say so.
  it("claims no measured rate when neither scenario could be measured", async () => {
    setupFetch({
      forecast: () => jsonResponse(thinForecast),
      runway: () => jsonResponse(unmeasurableRunway),
    });
    renderPage();

    expect(await screen.findAllByText("Non mesurable")).toHaveLength(2);
    // The caption over the pair.
    expect(screen.queryByText(/au rythme de dépenses mesuré/)).not.toBeInTheDocument();
    // The scope note: two months that measured nothing were not "exploitables".
    expect(screen.getByTestId("yd-runway-scope")).not.toHaveTextContent(/exploitable/);
    // The anchor sentence: no autonomy is being counted from today.
    const method = await openRunwayMethod();
    expect(method).not.toHaveTextContent(/Autonomie comptée à partir du/);
    expect(method).toHaveTextContent(/Aucune autonomie n'est comptée/);
  });

  it("does not call two months the minimum, nor call a missing rate fragile", async () => {
    setupFetch({
      forecast: () => jsonResponse(thinForecast),
      runway: () => jsonResponse(unmeasurableRunway),
    });
    renderPage();

    // The guard was `months_observed <= MIN`, so at 0, 1 or 2 the screen said
    // two months *is* the minimum. At two that sentence is arithmetically wrong.
    const scope = await screen.findByTestId("yd-runway-scope");
    expect(scope).not.toHaveTextContent(/C'est le minimum/);
    expect(scope).toHaveTextContent(/au moins 3/);
    expect(scope).not.toHaveTextContent(/fragile/);
  });

  // The other road into the same state: enough months, no measurable burn.
  it("states the minimum without promising a rate when three months yielded none", async () => {
    setupFetch({
      forecast: () => jsonResponse(thinForecast),
      runway: () => jsonResponse(noBurnRunway),
    });
    renderPage();

    const scope = await screen.findByTestId("yd-runway-scope");
    expect(scope).toHaveTextContent(/C'est le minimum/);
    expect(scope).not.toHaveTextContent(/le rythme reste fragile/);
  });

  it("still calls a rate resting on exactly three months fragile", async () => {
    setupFetch({
      forecast: () => jsonResponse(thinForecast),
      runway: () => jsonResponse(staleRunway),
    });
    renderPage();

    const scope = await screen.findByTestId("yd-runway-scope");
    expect(scope).toHaveTextContent(/exploitables pour mesurer un rythme/);
    expect(scope).toHaveTextContent(
      /C'est le minimum en dessous duquel rien n'est mesuré : le rythme reste fragile\./,
    );
  });

  // Finding 2. `clocksDiverge` compared the two `projected_from` values and
  // ignored `insufficient_reason`, so the first block of prose on the page
  // announced a projection in the indicative while the cell below it printed
  // a refusal and drew nothing.
  it("puts the projection in the conditional when the forecast refuses", async () => {
    setupFetch({
      forecast: () => jsonResponse(thinForecast),
      runway: () => jsonResponse(staleRunway),
    });
    renderPage();

    const note = await screen.findByTestId("yd-cashflow-clocks");
    expect(note).toHaveTextContent(/La prévision partirait du 9 janvier 2026/);
    expect(note).not.toHaveTextContent(/La prévision part du/);
    // Nothing was drawn, so there is no period the statements pronounced on.
    expect(note).not.toHaveTextContent(/seule période/);
  });

  it("keeps the projection in the indicative when the forecast is actually drawn", async () => {
    setupFetch({
      forecast: () => jsonResponse(forecast),
      // The same populated forecast, against a runway counting from the real
      // calendar date rather than from the ledger's last one.
      runway: () => jsonResponse({ ...runway, projected_from: "2026-09-04" }),
    });
    renderPage();

    const note = await screen.findByTestId("yd-cashflow-clocks");
    expect(note).toHaveTextContent(/La prévision part du 31 août 2026/);
    expect(note).toHaveTextContent(/L'autonomie est comptée depuis le 4 septembre 2026/);
    expect(note).not.toHaveTextContent(/partirait/);
  });

  it("does not say an autonomy is counted when neither scenario was measured", async () => {
    setupFetch({
      forecast: () => jsonResponse(thinForecast),
      runway: () => jsonResponse(unmeasurableRunway),
    });
    renderPage();

    const note = await screen.findByTestId("yd-cashflow-clocks");
    expect(note).not.toHaveTextContent(/L'autonomie est comptée/);
    // Both clocks are still named — the divergence is real either way.
    expect(note).toHaveTextContent(/22 août 2026/);
    expect(note).toHaveTextContent(/9 janvier 2026/);
  });

  it("says the burn rate is only as fresh as the last imported statement", async () => {
    setupFetch({ forecast: () => jsonResponse(thinForecast), runway: () => jsonResponse(staleRunway) });
    renderPage();

    expect(await openRunwayMethod()).toHaveTextContent(/mesuré jusqu'au 9 janvier 2026/);
  });

  // Requirement 6: the operator's own mixed state. The forecast refusing while
  // the runway computes is a pair of deliberate answers, not a broken screen.
  it("prints the backend's refusal instead of an empty chart", async () => {
    setupFetch({ forecast: () => jsonResponse(thinForecast), runway: () => jsonResponse(staleRunway) });
    renderPage();

    expect(await screen.findByText(/au moins 6 mois complets/)).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /Projection/ })).not.toBeInTheDocument();
    // ... while the runway beside it still answers.
    expect(screen.getByText("Rythme actuel")).toBeInTheDocument();
  });

  // Requirement 5: the two unavailability reasons are independent. One may
  // never stand in for the other.
  it("renders each scenario's own unavailability reason beside that scenario", async () => {
    setupFetch({ runway: () => jsonResponse(thinEssentialsRunway) });
    renderPage();

    // The WHOLE clause. `/dépenses essentielles/` alone matched the label the
    // reason opens with and passed whatever the sentence went on to claim —
    // which is how it went on rendering a refusal contradicting the note six
    // lines below it for an entire phase.
    expect(
      await screen.findByText(
        "Pas assez de mois pour mesurer les dépenses essentielles : seuls 2 mois portent ce type de dépense sur les 9 mois complets de l'historique, et il en faut au moins 3.",
      ),
    ).toBeInTheDocument();
    // `normal` computed, so nothing unavailable is said about it. 148 000 cents
    // against a 190 000-a-month burn is genuinely under a month.
    expect(screen.getByText("moins d'un mois")).toBeInTheDocument();
    expect(screen.getAllByText(/Non mesurable/)).toHaveLength(1);
  });

  // B1. The reason and the scope note are six lines apart on one screen, and
  // both quote a count of the ledger's complete months. `essential_months` is
  // built from a filtered entry list, so its length is the months carrying
  // essential spending — never the ledger's. Quoting it as "l'historique n'en
  // compte que 2" under a note reading "dont 9 mois complets" is two numbers
  // for one fact.
  it("agrees with the scope note on how many complete months the ledger holds", async () => {
    setupFetch({ runway: () => jsonResponse(thinEssentialsRunway) });
    renderPage();

    const scope = await screen.findByTestId("yd-runway-scope");
    expect(scope).toHaveTextContent(/dont 9 mois complets/);

    const reason = screen.getByText(/Pas assez de mois pour mesurer/);
    expect(reason).toHaveTextContent(/sur les 9 mois complets de l'historique/);
    // The sentence that contradicted the note.
    expect(reason).not.toHaveTextContent(/l'historique n'en compte que 2/);
    // The essentials sample size is still stated — it is why the scenario
    // failed — but as its own clause, never as the ledger's size.
    expect(reason).toHaveTextContent(/seuls 2 mois portent ce type de dépense/);
  });

  // B1, the worse half: with nothing flagged essential the old refusal blamed
  // a short history AND quoted 0 as the ledger's month count. The replacement
  // carries no number at all, so it cannot contradict the note under it.
  it("blames the empty essential list, not the ledger, when no category is flagged", async () => {
    setupFetch({ runway: () => jsonResponse(noEssentialCategoryRunway) });
    renderPage();

    const reason = await screen.findByText(/Ce scénario n'a aucune dépense à mesurer/);
    expect(reason).toHaveTextContent(
      "Ce scénario n'a aucune dépense à mesurer : aucune catégorie n'est marquée essentielle, et la longueur de l'historique n'y change rien.",
    );
    expect(reason).not.toHaveTextContent(/mois complets de relevés/);
    expect(screen.getByTestId("yd-runway-scope")).toHaveTextContent(/dont 9 mois complets/);
  });

  it("does not let the normal reason stand in for a missing essentials reason", async () => {
    setupFetch({
      runway: () =>
        jsonResponse({
          ...runway,
          normal: null,
          normal_unavailable_reason:
            "Aucune autonomie mesurable pour l'ensemble des dépenses : sur les 9 mois complets de l'historique, la dépense médiane d'un mois est nulle, il n'y a donc aucune sortie d'argent à couvrir.",
        }),
    });
    renderPage();

    // N1: the branch fires on a zero GROSS expense median. It never measured a
    // "solde net" — which in this product is the name of `CashflowChart`'s
    // third series — and must not report one.
    const reason = await screen.findByText(/la dépense médiane d'un mois est nulle/);
    expect(reason).toHaveTextContent(
      "Aucune autonomie mesurable pour l'ensemble des dépenses : sur les 9 mois complets de l'historique, la dépense médiane d'un mois est nulle, il n'y a donc aucune sortie d'argent à couvrir.",
    );
    expect(reason).not.toHaveTextContent(/solde net/);
    expect(reason).not.toHaveTextContent(/déficitaire/);
    // The essentials scenario computed; its panel must not repeat normal's reason.
    expect(screen.getAllByText(/la dépense médiane d'un mois est nulle/)).toHaveLength(1);
    expect(screen.getByText("1,2 mois")).toBeInTheDocument();
  });

  it("says what the reduced scenario rests on", async () => {
    setupFetch();
    renderPage();

    expect(await openRunwayMethod()).toHaveTextContent(/21 catégories marquées essentielles/);
  });

  // Requirement 3 again, on the forecast's own pair: `months_observed` counts
  // months carrying residual activity, `ledger_months_observed` counts what
  // the ledger covers at all.
  it("tells the forecast's residual months apart from the ledger's complete months", async () => {
    setupFetch();
    renderPage();

    const scope = await screen.findByTestId("yd-forecast-scope");
    expect(scope).toHaveTextContent(/9 mois complets/);
    expect(scope).toHaveTextContent(/7/);
  });

  it("states how many recurrences were actually carried into the projection", async () => {
    setupFetch();
    renderPage();

    expect(await openForecastMethod()).toHaveTextContent(/5 récurrences/);
  });

  it("surfaces a failed load in French", async () => {
    setupFetch({ runway: () => jsonResponse({ detail: "Base indisponible" }, 500) });
    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Base indisponible");
  });

  // A database outage takes both routes down with the same `detail`. Repeated
  // verbatim that is one sentence twice over, saying nothing about which half
  // of the screen is missing — and a duplicate React key besides.
  it("names which panel failed when both fail with the same message", async () => {
    setupFetch({
      forecast: () => jsonResponse({ detail: "Base indisponible" }, 500),
      runway: () => jsonResponse({ detail: "Base indisponible" }, 500),
    });
    renderPage();

    const alerts = await screen.findAllByRole("alert");
    expect(alerts).toHaveLength(2);
    expect(alerts[0]).toHaveTextContent("Autonomie indisponible : Base indisponible");
    expect(alerts[1]).toHaveTextContent("Prévision indisponible : Base indisponible");
  });

  // One endpoint failing must not blank the other: they are two independent
  // questions behind two independent routes.
  it("keeps the forecast on screen when only the runway fails", async () => {
    setupFetch({ runway: () => jsonResponse({ detail: "Base indisponible" }, 500) });
    renderPage();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Projection \(stub, 2 mois\)/ })).toBeInTheDocument();
  });
});
