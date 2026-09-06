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
  occurrences: 9,
  first_on: "2025-09-10",
  last_on: "2026-05-10",
  median_interval_days: 30,
  amount_cents: -1599,
  amount_spread_cents: 0,
  annual_cents: -19188,
  observed_span_days: 242,
  annualisable: true,
  expected_next_on: "2026-06-09",
  status: "active",
  confidence: "confirmed",
  price_change: {
    previous_cents: -1349,
    current_cents: -1599,
    changed_on: "2026-01-10",
    ratio: 0.1853,
  },
};

// Every date below is anchored so the whole payload is one the backend could
// actually emit against `ledger_last_on` = 2026-05-20, which is also the
// `today` the route hands the engine. `missing` needs the ledger past
// `expected_next_on` + grace (6 days on a 30-day rhythm); `ended` needs it past
// `last_on` + two intervals + grace. A fixture that ignores that renders prose
// the operator can never see.
const gym: Recurrence = {
  ...netflix,
  label: "PRELEVEMENT SEPA SALLE DE SPORT",
  label_key: "salle",
  category_name: "Sport",
  occurrences: 8,
  last_on: "2026-04-08",
  observed_span_days: 210,
  expected_next_on: "2026-05-08",
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

/** The same burst, seen from a ledger that ran on for four months after it. */
const staleBurst: Recurrence = { ...burst, status: "ended" };

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
  occurrences: 12,
  first_on: "2024-07-10",
  last_on: "2025-06-10",
  observed_span_days: 335,
  expected_next_on: "2025-07-10",
  status: "ended",
  price_change: null,
};

// The order the backend actually sends: descending |annual_cents|, gate
// ignored. salary 3 000 000 > burst 836 576 > gym 47 880 > netflix 19 188 >
// oldFee 12 000.
const report: RecurrenceReport = {
  recurrences: [salary, staleBurst, gym, netflix, oldFee],
  annual_subscription_cents: -67068,
  monthly_subscription_cents: -5589,
  analysed_groups: 25,
  rejected_thin: 14,
  rejected_irregular: 6,
  notice: null,
  missing_count: 1,
  price_change_count: 1,
  ledger_last_on: "2026-05-20",
};

/**
 * One annualisable row, and it is a salary. The state the old gate got wrong:
 * `some(annualisable)` is true, the engine's summing set is empty, and
 * `annual_subscription_cents` is 0. The engine sends **no notice** here — it
 * only writes one when nothing at all is annualisable — so the zero would have
 * arrived on screen with nothing to explain it.
 */
const incomeOnly: RecurrenceReport = {
  ...report,
  recurrences: [salary, staleBurst],
  annual_subscription_cents: 0,
  monthly_subscription_cents: 0,
  notice: null,
  missing_count: 0,
  price_change_count: 0,
};

/** The other way in: annualisable expenses exist, and every one has gone quiet. */
const allEnded: RecurrenceReport = {
  ...report,
  recurrences: [oldFee, staleBurst],
  annual_subscription_cents: 0,
  monthly_subscription_cents: 0,
  notice: null,
  missing_count: 0,
  price_change_count: 0,
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
    // Scoped, and not "depuis le début de l'historique": `find_price_change`
    // runs on the analysed run only, which the engine cuts at the last hole, so
    // a change sitting before a lapse was never examined.
    expect(screen.getByText(/1 hausse de prix sur la période analysée/)).toBeInTheDocument();
  });

  // The sort trap: recurrences arrive on descending un-gated `annual_cents`,
  // so the two biggest figures in this payload are both excluded from the
  // total. A screen that renders the list as sent puts them at the top of a
  // page headed with what these recurrences cost.
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
    expect(await screen.findByText(/Statuts jugés au 20 mai 2026/)).toBeInTheDocument();
  });

  // Two slips this caption used to carry: the list also holds income rows,
  // where nothing was "prélevé", and `annual_cents` *is* calculated for every
  // row — it is simply not vouched for, so it is not what the list is ordered
  // on and not what is displayed.
  it("captions the excluded list without claiming more than it can", async () => {
    setupFetch();
    renderPage();
    await screen.findByText(/NETFLIX/);
    const caption = screen.getByText(/Classés par montant de l'opération/);
    expect(caption).toHaveTextContent(/n'est pas retenu/);
    expect(screen.queryByText(/Classés par montant prélevé/)).not.toBeInTheDocument();
  });

  it("counts the labels whose amount is too scattered to be one price", async () => {
    setupFetch();
    renderPage();
    expect(await screen.findByText(/1 libellé au montant variable/)).toBeInTheDocument();
  });

  // Zero is not the answer here — "not computable yet" is. Printing 0,00 €
  // under a cost heading says the recurring charges cost nothing.
  it("refuses to print a zero total when nothing cleared the annualisation bar", async () => {
    setupFetch(() => jsonResponse(nothingAnnualisable));
    renderPage();
    expect(await screen.findByText(/Pas encore calculable/)).toBeInTheDocument();
    expect(screen.queryByText(/0,00/)).not.toBeInTheDocument();
    expect(screen.getByText(/Rien d'annualisable/)).toBeInTheDocument();
    // The other register would be wrong here: nothing has been watched long
    // enough to be an abonnement en cours or anything else.
    expect(screen.queryByText(/Aucun abonnement en cours/)).not.toBeInTheDocument();
  });

  // The gate has to be the set the figure is summed over — live annualisable
  // *expenses* — and not "something in the payload is annualisable". One
  // recurring salary past the 91-day bar is enough to satisfy the wider test
  // while the total stays empty, and the screen would print 0,00 € under a
  // heading that says subscriptions cost this much a year.
  it("refuses a zero total when the only annualisable recurrence is income", async () => {
    setupFetch(() => jsonResponse(incomeOnly));
    renderPage();
    expect(await screen.findByText(/Aucun abonnement en cours dans ce total/)).toBeInTheDocument();
    expect(screen.queryByText(/par an, soit/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Pas encore calculable/)).not.toBeInTheDocument();
  });

  // The engine writes its notice only when *nothing* is annualisable, so in
  // this state it sends none and the screen owes the reader the reason itself.
  it("says why the total is empty when the engine sends no notice", async () => {
    setupFetch(() => jsonResponse(incomeOnly));
    renderPage();
    expect(
      await screen.findByText(/aucune n'entre dans le total des abonnements/),
    ).toBeInTheDocument();
  });

  it("refuses a zero total when every annualisable expense has stopped", async () => {
    setupFetch(() => jsonResponse(allEnded));
    renderPage();
    expect(await screen.findByText(/Aucun abonnement en cours dans ce total/)).toBeInTheDocument();
    expect(screen.queryByText(/par an, soit/)).not.toBeInTheDocument();
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
