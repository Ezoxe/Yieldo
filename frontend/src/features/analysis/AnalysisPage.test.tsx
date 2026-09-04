import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "../../app/ThemeProvider";
import type { AnomalyReport, Inflation, PriceIndexPoint } from "../../lib/types";
import { AnalysisPage } from "./AnalysisPage";

const fetchMock = vi.fn();

const inflation: Inflation = {
  current_from: "2026-01-01",
  current_to: "2026-06-30",
  previous_from: "2025-01-01",
  previous_to: "2025-06-30",
  lines: [
    {
      category_id: 1,
      name: "Courses",
      color: "#4fd6a8",
      current_cost_cents: 30000,
      previous_cost_cents: 25000,
      delta_cents: 5000,
      ratio: 0.2,
      months_current: 6,
      months_previous: 6,
      comparable: true,
      reason: null,
    },
    {
      category_id: 2,
      name: "Restaurants",
      color: "#fb7185",
      // A real, non-zero current cost and a meaningful-looking delta on a line
      // that may not be read as a change: the exact shape of requirement 5.
      current_cost_cents: 12000,
      previous_cost_cents: 0,
      delta_cents: 12000,
      ratio: null,
      months_current: 6,
      months_previous: 0,
      comparable: false,
      reason:
        "Pas assez de données pour conclure : il faut au moins 3 mois de dépenses dans chacune des deux périodes, et cette catégorie en compte 6 sur la période récente et 0 un an plus tôt.",
    },
  ],
  basket_current_cost_cents: 30000,
  basket_previous_cost_cents: 25000,
  basket_ratio: 0.2,
  reference_ratio: 0.019,
  comparable: true,
  reason: null,
};

const refusedInflation: Inflation = {
  ...inflation,
  lines: [inflation.lines[1]],
  basket_current_cost_cents: 0,
  basket_previous_cost_cents: 0,
  basket_ratio: null,
  reference_ratio: null,
  comparable: false,
  reason:
    "Pas assez de données pour conclure : aucune catégorie ne dispose de 3 mois de dépenses à la fois sur la période choisie et sur la même période un an plus tôt.",
};

const anomalies: AnomalyReport = {
  anomalies: [
    {
      transaction_id: 42,
      date: "2026-03-14",
      // Signed, while `category_median_cents` is an unsigned magnitude.
      amount_cents: -90000,
      label: "CARTE X1234 FNAC DARTY",
      category_id: 3,
      category_name: "Équipement et high-tech",
      category_color: "#fb7185",
      category_median_cents: 4000,
      modified_z: 12.4,
      direction: "high",
    },
    {
      transaction_id: 43,
      date: "2026-02-02",
      amount_cents: -1006,
      label: "PRLV NETFLIX",
      category_id: 5,
      category_name: "Streaming",
      category_color: "#7ee2d6",
      category_median_cents: 1000,
      // A far larger score than the row above it, and deliberately second:
      // the list is ranked on cents moved, not on the score.
      modified_z: 40.2,
      direction: "high",
    },
  ],
  skipped: [
    {
      category_id: 4,
      name: "Pharmacie",
      direction: "expense",
      observations: 6,
      reason:
        "Pas assez de données pour conclure : il faut au moins 10 dépenses dans cette catégorie pour juger qu'un montant sort de l'ordinaire, et elle n'en compte que 6.",
    },
  ],
  scored_groups: 5,
  date_from: "2026-01-01",
  date_to: "2026-06-30",
};

const emptyWindow: AnomalyReport = {
  anomalies: [],
  skipped: [],
  scored_groups: 0,
  date_from: "2026-08-01",
  date_to: "2026-08-31",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface Overrides {
  inflation?: () => Response;
  anomalies?: () => Response;
  index?: () => Response;
}

function setupFetch(overrides: Overrides = {}) {
  fetchMock.mockImplementation((input: string, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : String(input), "http://localhost");
    if (url.pathname === "/api/analysis/inflation") {
      return Promise.resolve(overrides.inflation ? overrides.inflation() : jsonResponse(inflation));
    }
    if (url.pathname === "/api/analysis/anomalies") {
      return Promise.resolve(overrides.anomalies ? overrides.anomalies() : jsonResponse(anomalies));
    }
    if (url.pathname === "/api/analysis/price-index") {
      if (init?.method === "PUT") return Promise.resolve(jsonResponse([]));
      return Promise.resolve(overrides.index ? overrides.index() : jsonResponse([]));
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

afterEach(() => vi.unstubAllGlobals());

function renderPage(path = "/analyse") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ThemeProvider>
        <AnalysisPage />
      </ThemeProvider>
    </MemoryRouter>,
  );
}

describe("AnalysisPage — inflation", () => {
  it("states the basket's own inflation", async () => {
    setupFetch();
    renderPage();
    expect(await screen.findByLabelText("+20,0 %")).toBeInTheDocument();
  });

  // The three sentences that say HOW the basket was measured — which two
  // windows, how many categories entered it, what the reference index is
  // doing — moved out from under the headline percentage and behind the mark
  // in the panel's head. Nothing was dropped; it is one interaction away, and
  // these tests take that interaction.
  async function openBasketMethod() {
    const user = userEvent.setup();
    const trigger = await screen.findByRole("button", { name: "Comment ce panier est mesuré" });
    await user.click(trigger);
    return screen.getByRole("tooltip");
  }

  it("names both windows being compared", async () => {
    setupFetch();
    renderPage();
    const method = await openBasketMethod();
    expect(method).toHaveTextContent(/1er janvier 2026 – 30 juin 2026/);
    expect(method).toHaveTextContent(/1er janvier 2025 – 30 juin 2025/);
  });

  it("says the basket holds only the categories that could be compared", async () => {
    setupFetch();
    renderPage();
    const method = await openBasketMethod();
    expect(method).toHaveTextContent(/1 catégorie entre dans ce panier/);
    expect(method).toHaveTextContent(/1 n'a pas pu être comparée/);
  });

  it("shows the reference index beside the basket when one is configured", async () => {
    setupFetch({ index: () => jsonResponse([{ month: "2025-01", value_hundredths: 11842 }]) });
    renderPage();
    expect(await openBasketMethod()).toHaveTextContent(/\+1,9 %/);
  });

  // Requirement 6: no index is not an index of zero.
  it("says the index is not configured rather than showing a zero", async () => {
    setupFetch({ inflation: () => jsonResponse({ ...inflation, reference_ratio: null }) });
    renderPage();
    const method = await openBasketMethod();
    expect(method).toHaveTextContent(/vous n'avez saisi aucun indice de référence/);
    // No figure, of any value, stands in for the missing comparison.
    expect(method).not.toHaveTextContent(/Indice de référence sur les mêmes périodes/);
  });

  it("tells a stored index that misses a window apart from no index at all", async () => {
    setupFetch({
      inflation: () => jsonResponse({ ...inflation, reference_ratio: null }),
      index: () => jsonResponse([{ month: "2025-01", value_hundredths: 11842 }]),
    });
    renderPage();
    expect(await openBasketMethod()).toHaveTextContent(/ne couvre pas les deux périodes comparées/);
  });

  it("still states the two costs the percentage is a ratio of, without asking", async () => {
    setupFetch();
    renderPage();
    const basket = await screen.findByTestId("yd-analysis-basket");
    expect(basket).toHaveTextContent(/Un an plus tôt/);
    expect(basket).toHaveTextContent(/Période récente/);
  });

  it("keeps an incomparable category visible with its own month counts", async () => {
    setupFetch();
    renderPage();
    expect(await screen.findByText("Restaurants")).toBeInTheDocument();
    expect(screen.getByText(/6 mois récents · 0 un an plus tôt/)).toBeInTheDocument();
    // The shared half of the engine's seventeen near-identical sentences,
    // stated once above the list rather than repeated on every row.
    expect(screen.getByText(/au moins 3 mois de dépenses dans chacune des deux périodes/))
      .toBeInTheDocument();
  });

  // The engine also refuses a previous-side cost of zero, which its own month
  // counts would not explain. There the sentence it wrote is printed verbatim,
  // rather than a "3 mois récents · 3 un an plus tôt" that reads as a bug under
  // a rule asking for three.
  it("falls back to the engine's own sentence when the counts do not explain the refusal", async () => {
    setupFetch({
      inflation: () =>
        jsonResponse({
          ...inflation,
          lines: [
            {
              ...inflation.lines[1],
              months_current: 4,
              months_previous: 4,
              reason: "Motif inattendu venu du moteur.",
            },
          ],
        }),
    });
    renderPage();
    expect(await screen.findByText("Motif inattendu venu du moteur.")).toBeInTheDocument();
  });

  // Requirement 5: the three cost fields exist on an incomparable line and
  // none of them may be rendered as a change, a price or a trend.
  it("prints no cost at all for an incomparable line", async () => {
    setupFetch();
    renderPage();
    const line = await screen.findByTestId("yd-analysis-line-2");
    // 12000 cents current, 0 previous, +12000 delta — none of them on screen.
    expect(line.textContent).not.toMatch(/120,00/);
    expect(line.textContent).not.toMatch(/%/);
  });

  it("prints the backend's refusal when nothing can be compared", async () => {
    setupFetch({ inflation: () => jsonResponse(refusedInflation) });
    renderPage();
    expect(await screen.findByText(/aucune catégorie ne dispose de 3 mois/)).toBeInTheDocument();
  });

  it("prints no basket figure at all on a refusal", async () => {
    setupFetch({ inflation: () => jsonResponse(refusedInflation) });
    renderPage();
    const basket = await screen.findByTestId("yd-analysis-basket");
    expect(basket.textContent).not.toMatch(/%/);
    expect(basket.textContent).not.toMatch(/0,00/);
  });

  it("still names the windows the refused comparison would have used", async () => {
    setupFetch({ inflation: () => jsonResponse(refusedInflation) });
    renderPage();
    expect(await screen.findByText(/porterait sur/)).toBeInTheDocument();
  });
});

describe("AnalysisPage — anomalies", () => {
  it("explains what an anomaly is before listing any", async () => {
    setupFetch();
    renderPage();
    expect(await screen.findByText(/n'est pas un reproche/)).toBeInTheDocument();
    expect(screen.getByText(/prime d'assurance annuelle/)).toBeInTheDocument();
  });

  // With MAD 0 the score falls back to the mean absolute deviation, rounded to
  // integer cents (`engines/robust.py`). Six cents inside a twelve-row group
  // gives `mean_ad = 1` and a z of about 4.8; the same six cents inside a
  // thirty-row group rounds `mean_ad` to 0, `modified_z` returns `None`, and no
  // line appears. The caption must not promise the reader a size it cannot
  // always deliver.
  it("does not promise that six cents always surfaces a line", async () => {
    setupFetch();
    renderPage();
    const caption = await screen.findByText(/n'est pas un reproche/);
    expect(caption).toHaveTextContent(/quelques centimes peuvent suffire/);
    expect(caption.textContent).not.toMatch(/six centimes/);
  });

  // Requirement 3: `category_median_cents` is a magnitude, `amount_cents` is
  // signed. The gap is |‖amount‖ − median|, and the screen states it so the
  // reader never subtracts the two figures as printed.
  it("states the gap from the category's usual amount rather than leaving it to be subtracted", async () => {
    setupFetch();
    renderPage();
    const row = await screen.findByTestId("yd-analysis-anomaly-42");
    expect(row).toHaveTextContent(/habituellement 40,00/);
    expect(row).toHaveTextContent(/860,00 € de plus/);
  });

  // Requirement 2: `modified_z` qualifies, it does not rank.
  it("keeps the backend's order and never prints the score", async () => {
    setupFetch();
    renderPage();
    const list = await screen.findByRole("list", { name: /Montants inhabituels/ });
    const labels = within(list)
      .getAllByRole("listitem")
      .map((item) => item.getAttribute("data-testid"));
    expect(labels).toEqual(["yd-analysis-anomaly-42", "yd-analysis-anomaly-43"]);
    expect(list.textContent).not.toContain("12.4");
    expect(list.textContent).not.toContain("40.2");
  });

  it("says the ranking is cents moved, not the statistical score", async () => {
    setupFetch();
    renderPage();
    expect(await screen.findByText(/Classées par écart en euros/)).toBeInTheDocument();
    expect(screen.getByText(/ne la classe pas/)).toBeInTheDocument();
  });

  // Requirement 4: `skipped` / `scored_groups` are window-scoped, the
  // statistics behind them are not.
  it("says the habit is measured over the whole history, not the window", async () => {
    setupFetch();
    renderPage();
    expect(await screen.findByText(/sur tout votre historique/)).toBeInTheDocument();
    expect(screen.getByText(/jamais sur la seule période affichée/)).toBeInTheDocument();
  });

  it("says which groups were too short to judge, and on which side", async () => {
    setupFetch();
    renderPage();
    expect(await screen.findByText(/Pharmacie/)).toBeInTheDocument();
    expect(screen.getByText(/au moins 10 dépenses/)).toBeInTheDocument();
    expect(screen.getByText(/1 groupe non analysé/)).toBeInTheDocument();
  });

  // `scored_groups: 0` with an empty `skipped` is NOT proof of an empty window.
  // `detect_anomalies` drops every `category_id is None` row before grouping and
  // `anomaly_points` filters transfers out of the query, so a window holding
  // only uncategorised rows — every ledger between import and categorisation —
  // or only internal transfers produces exactly the same pair of values. The
  // sentence has to say what is actually true of all three cases, and must never
  // tell the reader to import statements they have already imported.
  it("tells an empty window apart from a ledger with no usable history", async () => {
    setupFetch({ anomalies: () => jsonResponse(emptyWindow) });
    renderPage();
    const sentence = await screen.findByText(/Aucune opération catégorisée sur cette période/);
    expect(sentence).toHaveTextContent(/virements internes/);
    expect(sentence.textContent).not.toMatch(/importez des relevés/);
  });

  it("names categorisation, not importing, as what an unscored window may be missing", async () => {
    setupFetch({ anomalies: () => jsonResponse(emptyWindow) });
    renderPage();
    const sentence = await screen.findByText(/Aucune opération catégorisée sur cette période/);
    expect(sentence).toHaveTextContent(/catégoris/);
  });

  it("says nothing stood out when groups were scored and none qualified", async () => {
    setupFetch({
      anomalies: () => jsonResponse({ ...anomalies, anomalies: [], skipped: [] }),
    });
    renderPage();
    expect(await screen.findByText(/Aucun montant inhabituel/)).toBeInTheDocument();
  });
});

describe("AnalysisPage — loading and failures", () => {
  it("surfaces a failed load in French, naming the half that failed", async () => {
    setupFetch({ anomalies: () => jsonResponse({ detail: "Base indisponible" }, 500) });
    renderPage();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Base indisponible");
    expect(alert).toHaveTextContent(/anomalies/i);
  });

  it("keeps the other half on screen when one route fails", async () => {
    setupFetch({ anomalies: () => jsonResponse({ detail: "Base indisponible" }, 500) });
    renderPage();
    expect(await screen.findByLabelText("+20,0 %")).toBeInTheDocument();
  });

  // A 422 is not a failure. `compute_inflation` answered — deliberately, with a
  // reason — and the router forwarded that French sentence. Rendering it in the
  // negative-coloured alert reserved for a load failure, beside "Ce panneau n'a
  // pas pu être chargé.", tells the reader something broke when nothing did.
  it("reports a range the engine refuses as the explanation it is", async () => {
    setupFetch({
      inflation: () =>
        jsonResponse({ detail: "La période demandée dépasse douze mois : …" }, 422),
    });
    renderPage();
    const basket = await screen.findByTestId("yd-analysis-basket");
    const refusal = within(basket).getByText(/dépasse douze mois/);
    // The warning treatment a refusal gets everywhere on this screen, never the
    // negative colour, which is reserved for something having gone wrong.
    expect(refusal).toHaveClass("yd-analysis__insufficient");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // The panel WAS loaded. Nothing on the screen may say otherwise.
    expect(screen.queryByText(/n'a pas pu être chargé/)).not.toBeInTheDocument();
  });

  it("still treats a genuine inflation failure as a failure", async () => {
    setupFetch({ inflation: () => jsonResponse({ detail: "Base indisponible" }, 500) });
    renderPage();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Base indisponible");
    expect(alert).toHaveTextContent(/Inflation personnelle indisponible/);
    expect(screen.getAllByText(/n'a pas pu être chargé/).length).toBeGreaterThan(0);
  });
});

describe("AnalysisPage — period", () => {
  it("asks each route for the whole ledger when no period is in the URL", async () => {
    setupFetch();
    renderPage();
    await screen.findByLabelText("+20,0 %");

    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls).toContain("/api/analysis/inflation");
    expect(urls).toContain("/api/analysis/anomalies");
  });

  // Clicking "Personnalisé" writes `periode=custom&du=&au=`, `buildUrl` drops
  // both empty params, and the two engines fall back to their two DIFFERENT
  // defaults — the last twelve complete ledger months against the whole ledger.
  // The banner claiming both panels answer on "la période choisie ci-dessus" is
  // false twice over there: no period was chosen, and the panels do not agree.
  it("keeps the two-windows warning on a custom period with no bounds yet", async () => {
    setupFetch();
    renderPage("/analyse?periode=custom&du=&au=");
    await screen.findByLabelText("+20,0 %");

    expect(screen.getByText(/Aucune période imposée/)).toBeInTheDocument();
    expect(
      screen.queryByText(/Les deux panneaux répondent sur la période choisie/),
    ).not.toBeInTheDocument();
  });

  it("says both panels agree once a custom period actually has bounds", async () => {
    setupFetch();
    renderPage("/analyse?periode=custom&du=2025-01-01&au=2025-06-30");
    await screen.findByLabelText("+20,0 %");

    expect(
      screen.getByText(/Les deux panneaux répondent sur la période choisie/),
    ).toBeInTheDocument();
  });

  it("passes an explicit period on to both routes", async () => {
    setupFetch();
    renderPage("/analyse?periode=custom&du=2025-01-01&au=2025-06-30");
    await screen.findByLabelText("+20,0 %");

    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls).toContain("/api/analysis/inflation?date_from=2025-01-01&date_to=2025-06-30");
    expect(urls).toContain("/api/analysis/anomalies?date_from=2025-01-01&date_to=2025-06-30");
  });

  it("reloads the inflation figure once a reference index has been saved", async () => {
    const stored: PriceIndexPoint[] = [];
    setupFetch({ index: () => jsonResponse(stored) });
    renderPage();
    await screen.findByLabelText("+20,0 %");

    await userEvent.type(screen.getByLabelText(/Série de l'indice/), "2025-01;118,42");
    await userEvent.click(screen.getByRole("button", { name: /Enregistrer l'indice/ }));

    await vi.waitFor(() => {
      const inflationCalls = fetchMock.mock.calls.filter(([url]) =>
        String(url).startsWith("/api/analysis/inflation"),
      );
      expect(inflationCalls.length).toBeGreaterThan(1);
    });
  });
});
