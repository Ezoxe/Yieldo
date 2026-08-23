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

  it("says the burn rate is only as fresh as the last imported statement", async () => {
    setupFetch({ forecast: () => jsonResponse(thinForecast), runway: () => jsonResponse(staleRunway) });
    renderPage();

    expect(await screen.findByText(/mesuré jusqu'au 9 janvier 2026/)).toBeInTheDocument();
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
    setupFetch({
      runway: () =>
        jsonResponse({
          ...runway,
          essentials: null,
          essentials_unavailable_reason:
            "Pas assez d'historique pour mesurer les dépenses essentielles : il faut au moins 3 mois complets de relevés, et l'historique n'en compte que 2.",
        }),
    });
    renderPage();

    expect(await screen.findByText(/dépenses essentielles/)).toBeInTheDocument();
    // `normal` computed, so nothing unavailable is said about it. 148 000 cents
    // against a 190 000-a-month burn is genuinely under a month.
    expect(screen.getByText("moins d'un mois")).toBeInTheDocument();
    expect(screen.getAllByText(/Non mesurable/)).toHaveLength(1);
  });

  it("does not let the normal reason stand in for a missing essentials reason", async () => {
    setupFetch({
      runway: () =>
        jsonResponse({
          ...runway,
          normal: null,
          normal_unavailable_reason:
            "Le solde net mesuré sur l'ensemble des dépenses n'est pas déficitaire (9 mois observés) : sans dépense nette à combler, aucune autonomie ne peut être calculée.",
        }),
    });
    renderPage();

    expect(await screen.findByText(/n'est pas déficitaire/)).toBeInTheDocument();
    // The essentials scenario computed; its panel must not repeat normal's reason.
    expect(screen.getAllByText(/n'est pas déficitaire/)).toHaveLength(1);
    expect(screen.getByText("1,2 mois")).toBeInTheDocument();
  });

  it("says what the reduced scenario rests on", async () => {
    setupFetch();
    renderPage();

    expect(await screen.findByText(/21 catégories marquées essentielles/)).toBeInTheDocument();
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

    expect(await screen.findByText(/5 récurrences/)).toBeInTheDocument();
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
