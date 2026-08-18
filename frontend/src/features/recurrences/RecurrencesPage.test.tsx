import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "../../app/ThemeProvider";
import type { Recurrence, RecurrenceReport } from "../../lib/types";
import { COUNTED_LIST_LABEL, EXCLUDED_LIST_LABEL, RecurrencesPage } from "./RecurrencesPage";

const fetchMock = vi.fn();

const netflix: Recurrence = {
  label: "PRELEVEMENT SEPA NETFLIX INTERNATIONAL BV",
  label_key: "netflix",
  category_id: 12,
  category_name: "Streaming",
  category_color: "#7ee2d6",
  periodicity: "monthly",
  occurrences: 8,
  first_on: "2025-09-10",
  last_on: "2026-04-10",
  median_interval_days: 30,
  amount_cents: -1599,
  amount_spread_cents: 0,
  annual_cents: -19188,
  observed_span_days: 212,
  annualisable: true,
  expected_next_on: "2026-05-10",
  status: "active",
  confidence: "confirmed",
  price_change: {
    previous_cents: -1349,
    current_cents: -1599,
    changed_on: "2026-01-10",
    ratio: 0.1853,
  },
};

const gym: Recurrence = {
  ...netflix,
  label: "PRELEVEMENT SEPA SALLE DE SPORT",
  label_key: "salle",
  category_name: "Sport",
  amount_cents: -3990,
  annual_cents: -47880,
  status: "missing",
  price_change: null,
};

/** The trap: the biggest annual figure in the payload, counted nowhere. */
const burst: Recurrence = {
  ...netflix,
  label: "CARTE X1234 FNAC DARTY",
  label_key: "fnac",
  category_name: "Équipement et high-tech",
  periodicity: "weekly",
  occurrences: 6,
  first_on: "2025-12-13",
  last_on: "2026-01-04",
  median_interval_days: 5,
  amount_cents: -16088,
  amount_spread_cents: 4181,
  annual_cents: -836576,
  observed_span_days: 22,
  annualisable: false,
  expected_next_on: "2026-01-09",
  price_change: null,
};

const salary: Recurrence = {
  ...netflix,
  label: "VIREMENT SEPA RECU SALAIRE",
  label_key: "salaire",
  category_name: "Salaire",
  amount_cents: 250000,
  annual_cents: 3000000,
  price_change: null,
};

const oldFee: Recurrence = {
  ...netflix,
  label: "PRELEVEMENT ASSURANCE HABITATION",
  label_key: "assurance",
  category_name: "Assurance",
  amount_cents: -1000,
  annual_cents: -12000,
  last_on: "2025-06-10",
  status: "ended",
  price_change: null,
};

// The order the backend actually sends: descending |annual_cents|, gate
// ignored. salary 3 000 000 > burst 836 576 > gym 47 880 > netflix 19 188 >
// oldFee 12 000.
const report: RecurrenceReport = {
  recurrences: [salary, burst, gym, netflix, oldFee],
  annual_subscription_cents: -67068,
  monthly_subscription_cents: -5589,
  analysed_groups: 25,
  rejected_thin: 14,
  rejected_irregular: 6,
  notice: null,
  missing_count: 1,
  price_change_count: 1,
  ledger_last_on: "2026-05-02",
};

/** The operator's own fixture: four bursts, nothing annualisable, total zero. */
const nothingAnnualisable: RecurrenceReport = {
  recurrences: [burst, { ...burst, label: "CARTE X1234 PHARMACIE", label_key: "pharma" }],
  annual_subscription_cents: 0,
  monthly_subscription_cents: 0,
  analysed_groups: 25,
  rejected_thin: 0,
  rejected_irregular: 21,
  notice:
    "Rien d'annualisable : tout ce qui a été repéré est observé sur moins de 91 jours, une fenêtre trop courte pour en déduire un coût annuel. Ces lignes sont affichées telles qu'elles ont été observées. Importez un historique plus long.",
  missing_count: 0,
  price_change_count: 0,
  ledger_last_on: "2026-01-09",
};

const emptyReport: RecurrenceReport = {
  recurrences: [],
  annual_subscription_cents: 0,
  monthly_subscription_cents: 0,
  analysed_groups: 22,
  rejected_thin: 20,
  rejected_irregular: 2,
  notice:
    "Aucune récurrence détectée : il faut au moins 3 opérations portant le même libellé, espacées d'intervalles réguliers.",
  missing_count: 0,
  price_change_count: 0,
  ledger_last_on: "2026-01-09",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function setupFetch(response: () => Response = () => jsonResponse(report)) {
  fetchMock.mockImplementation((input: string) => {
    const url = new URL(typeof input === "string" ? input : String(input), "http://localhost");
    if (url.pathname === "/api/recurrences") return Promise.resolve(response());
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
    <MemoryRouter initialEntries={["/recurrences"]}>
      <ThemeProvider>
        <RecurrencesPage />
      </ThemeProvider>
    </MemoryRouter>,
  );
}

function labelsIn(listLabel: string): string[] {
  return within(screen.getByRole("list", { name: listLabel }))
    .getAllByRole("listitem")
    .map((item) => item.querySelector(".yd-recurrence__label")?.textContent ?? "");
}

describe("RecurrencesPage", () => {
  it("states the annual and monthly subscription cost", async () => {
    setupFetch();
    renderPage();
    expect(await screen.findByLabelText(/670,68/)).toBeInTheDocument();
    expect(screen.getByText(/55,89/)).toBeInTheDocument();
  });

  it("lists every detected recurrence, counted or not", async () => {
    setupFetch();
    renderPage();
    await screen.findByText(/NETFLIX/);
    expect(labelsIn(COUNTED_LIST_LABEL).length + labelsIn(EXCLUDED_LIST_LABEL).length).toBe(
      report.recurrences.length,
    );
  });

  it("calls out the missing debits and the price rises separately", async () => {
    setupFetch();
    renderPage();
    expect(await screen.findByText(/1 prélèvement attendu et jamais arrivé/)).toBeInTheDocument();
    expect(screen.getByText(/1 hausse de prix/)).toBeInTheDocument();
  });

  // The sort trap: recurrences arrive on descending un-gated `annual_cents`,
  // so the two biggest figures in this payload are both excluded from the
  // total. A screen that renders the list as sent puts them at the top of a
  // page headed "coût des abonnements".
  it("keeps the excluded recurrences out of the counted list, whatever their rank", async () => {
    setupFetch();
    renderPage();
    await screen.findByText(/NETFLIX/);

    expect(labelsIn(COUNTED_LIST_LABEL)).toEqual([
      "PRELEVEMENT SEPA SALLE DE SPORT",
      "PRELEVEMENT SEPA NETFLIX INTERNATIONAL BV",
    ]);
    expect(labelsIn(EXCLUDED_LIST_LABEL)).toEqual([
      "VIREMENT SEPA RECU SALAIRE",
      "CARTE X1234 FNAC DARTY",
      "PRELEVEMENT ASSURANCE HABITATION",
    ]);
  });

  it("says how many recurrences the total leaves out", async () => {
    setupFetch();
    renderPage();
    expect(await screen.findByText(/3 récurrences détectées n'y sont pas comptées/)).toBeInTheDocument();
  });

  // The accepted cost of the 91-day rule, in French, on the screen.
  it("explains that a subscription started this quarter is listed but not totalled", async () => {
    setupFetch();
    renderPage();
    await screen.findByText(/NETFLIX/);
    const rule = screen.getByText(/91 jours d'historique écoulés/);
    expect(rule).toHaveTextContent(/n'entre dans le total qu'à partir de/);
  });

  it("names the ledger date every status was judged against", async () => {
    setupFetch();
    renderPage();
    // Specific on purpose: the rows name the same date in their own status
    // sentences, which is the point — this asserts the page states the clock
    // once, up front, as well.
    expect(await screen.findByText(/Statuts jugés au 2 mai 2026/)).toBeInTheDocument();
  });

  it("counts the labels whose amount is too scattered to be one price", async () => {
    setupFetch();
    renderPage();
    expect(await screen.findByText(/1 libellé au montant variable/)).toBeInTheDocument();
  });

  // Zero is not the answer here — "not computable yet" is. Printing 0,00 €
  // under "coût des abonnements" says the subscriptions cost nothing.
  it("refuses to print a zero total when nothing cleared the annualisation bar", async () => {
    setupFetch(() => jsonResponse(nothingAnnualisable));
    renderPage();
    expect(await screen.findByText(/Pas encore calculable/)).toBeInTheDocument();
    expect(screen.queryByText(/0,00/)).not.toBeInTheDocument();
    expect(screen.getByText(/Rien d'annualisable/)).toBeInTheDocument();
  });

  it("still lists what it detected when it can annualise none of it", async () => {
    setupFetch(() => jsonResponse(nothingAnnualisable));
    renderPage();
    await screen.findByText(/FNAC DARTY/);
    expect(labelsIn(EXCLUDED_LIST_LABEL)).toHaveLength(2);
    expect(screen.queryByRole("list", { name: COUNTED_LIST_LABEL })).not.toBeInTheDocument();
  });

  it("prints the backend's explanation instead of an unexplained empty list", async () => {
    setupFetch(() => jsonResponse(emptyReport));
    renderPage();
    expect(await screen.findByText(/au moins 3 opérations/)).toBeInTheDocument();
  });

  it("says how many groups were examined and rejected, so the emptiness is legible", async () => {
    setupFetch(() => jsonResponse(emptyReport));
    renderPage();
    expect(await screen.findByText(/22 libellés examinés/)).toBeInTheDocument();
  });

  it("surfaces a failed load in French", async () => {
    setupFetch(() => jsonResponse({ detail: "Base indisponible" }, 500));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Base indisponible");
  });
});
