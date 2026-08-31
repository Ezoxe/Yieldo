import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "../../app/ThemeProvider";
import { CreditSimulator } from "./CreditSimulator";
import { CREDIT_100K, jsonResponse } from "./fixtures";

// The real chart mounts ECharts against a canvas jsdom does not have, and its
// animation frame crashes on dispose. What it draws is pinned by
// charts/AmortizationChart.test.tsx; this component's job is deciding what to
// hand it. Same stub DebtsPage.test.tsx uses on DebtPayoffChart.
vi.mock("../../charts/AmortizationChart", () => ({
  AmortizationChart: ({ years }: { years: unknown[] }) => (
    <div role="img" aria-label={`Amortissement (stub, ${years.length} ans)`} />
  ),
}));

const fetchMock = vi.fn();

/** The one endpoint this component talks to, with whatever it should answer. */
function setupFetch(respond: () => Response = () => jsonResponse(CREDIT_100K)) {
  fetchMock.mockImplementation((input: string, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : String(input), "http://localhost");
    if (url.pathname === "/api/simulators/credit" && (init?.method ?? "GET") === "POST") {
      return Promise.resolve(respond());
    }
    throw new Error(`Unhandled fetch in test: ${url.pathname}`);
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
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  });
});

function renderIt() {
  return render(
    <ThemeProvider>
      <CreditSimulator />
    </ThemeProvider>,
  );
}

/** 100 000 € at 3,00 % over 240 months — the plan's own worked example. */
async function askTheWorkedExample(user: ReturnType<typeof userEvent.setup>) {
  await user.clear(screen.getByLabelText(/Capital emprunté/));
  await user.type(screen.getByLabelText(/Capital emprunté/), "100000");
  await user.clear(screen.getByLabelText(/Taux annuel/));
  await user.type(screen.getByLabelText(/Taux annuel/), "3,00");
  await user.clear(screen.getByLabelText(/Durée \(mois\)/));
  await user.type(screen.getByLabelText(/Durée \(mois\)/), "240");
  await user.click(screen.getByRole("button", { name: /Calculer le crédit/ }));
}

describe("CreditSimulator", () => {
  it("answers 100 000 € at 3,00 % over 240 mois with 554,60 € and 33 103,24 €", async () => {
    const user = userEvent.setup();
    setupFetch();
    renderIt();
    await askTheWorkedExample(user);

    // Scoped to each figure: "33 103,24 €" is quoted twice on purpose — once as
    // the interest total and once inside the breakdown of what was repaid — and
    // an unscoped match would pass on either.
    expect(await screen.findByTestId("yd-credit-payment")).toHaveTextContent("554,60");
    expect(screen.getByTestId("yd-credit-interest")).toHaveTextContent("33 103,24");
    expect(screen.getByTestId("yd-credit-total")).toHaveTextContent("133 103,24");
  });

  it("sends integer cents and integer basis points, never floats", async () => {
    const user = userEvent.setup();
    setupFetch();
    renderIt();
    await askTheWorkedExample(user);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body).toEqual({ principal_cents: 10_000_000, annual_rate_bps: 300, months: 240 });
  });

  it("turns the term into years beside the field", async () => {
    const user = userEvent.setup();
    setupFetch();
    renderIt();
    await user.clear(screen.getByLabelText(/Durée \(mois\)/));
    await user.type(screen.getByLabelText(/Durée \(mois\)/), "240");

    expect(screen.getByText("20 ans")).toBeInTheDocument();
  });

  it("prints the term refusal in the engine's own words, as content", async () => {
    const user = userEvent.setup();
    const refusal = "La durée d'un crédit doit être comprise entre 1 et 480 mois.";
    setupFetch(() => jsonResponse({ detail: refusal }, 422));
    renderIt();
    await askTheWorkedExample(user);

    expect(await screen.findByText(refusal)).toBeInTheDocument();
    // A refusal is a deliberate answer to the question asked. Nothing failed.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("prints the unpayable-instalment refusal, and never the term one instead", async () => {
    const user = userEvent.setup();
    // Two DISTINCT causes with two distinct sentences. Phase 2A shipped a
    // refusal naming the wrong cause five separate times.
    const refusal =
      "La mensualité ne couvrirait même pas les intérêts du premier mois : à ce taux et " +
      "sur cette durée, le capital ne serait jamais remboursé.";
    setupFetch(() => jsonResponse({ detail: refusal }, 422));
    renderIt();
    await askTheWorkedExample(user);

    expect(await screen.findByText(refusal)).toBeInTheDocument();
    expect(screen.queryByText(/comprise entre 1 et 480 mois/)).not.toBeInTheDocument();
  });

  it("raises an alert for a genuine failure, not a refusal", async () => {
    const user = userEvent.setup();
    setupFetch(() => jsonResponse({ detail: "Boom" }, 500));
    renderIt();
    await askTheWorkedExample(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(/Le calcul n'a pas abouti/);
  });

  it("refuses an unreadable capital in French, without asking the server", async () => {
    const user = userEvent.setup();
    setupFetch();
    renderIt();
    await user.clear(screen.getByLabelText(/Capital emprunté/));
    await user.type(screen.getByLabelText(/Capital emprunté/), "cent mille");
    await user.click(screen.getByRole("button", { name: /Calculer le crédit/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Montant illisible/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lets the engine judge a duration rather than mirroring its bound", async () => {
    // `schemas/simulators.py` leaves every duration unbounded on purpose so the
    // engine's own sentence is what the user reads. A client-side copy of
    // "1 to 480" would make this request never happen.
    const user = userEvent.setup();
    setupFetch(() => jsonResponse({ detail: "La durée d'un crédit doit être comprise entre 1 et 480 mois." }, 422));
    renderIt();
    await user.clear(screen.getByLabelText(/Durée \(mois\)/));
    await user.type(screen.getByLabelText(/Durée \(mois\)/), "600");
    await user.click(screen.getByRole("button", { name: /Calculer le crédit/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).months).toBe(600);
  });

  it("says the rate is what you typed and not a market rate", async () => {
    const user = userEvent.setup();
    setupFetch();
    renderIt();
    await askTheWorkedExample(user);

    expect(await screen.findByText(/ne va chercher aucun taux/)).toBeInTheDocument();
  });
});

describe("CreditSimulator — the 240-row schedule", () => {
  it("renders no schedule row at all until the table is opened", async () => {
    const user = userEvent.setup();
    setupFetch();
    renderIt();
    await askTheWorkedExample(user);
    await screen.findByText(/554,60/);

    expect(screen.queryByTestId("yd-credit-schedule")).not.toBeInTheDocument();
  });

  it("shows one year at a time, never the whole 240 rows", async () => {
    const user = userEvent.setup();
    setupFetch();
    renderIt();
    await askTheWorkedExample(user);
    await screen.findByText(/554,60/);
    await user.click(screen.getByRole("button", { name: /Tableau d'amortissement/ }));

    const table = await screen.findByTestId("yd-credit-schedule");
    // Twelve instalments and the header. A 240-row table is 240 DOM rows, on a
    // page that also carries a canvas — and nobody reads row 173.
    expect(within(table).getAllByRole("row")).toHaveLength(13);
    // Month 1 is there; month 13 is a year away and is not.
    expect(within(table).getByText("1")).toBeInTheDocument();
    expect(within(table).queryByText("13")).not.toBeInTheDocument();
  });

  it("walks to another year through its own selector", async () => {
    const user = userEvent.setup();
    setupFetch();
    renderIt();
    await askTheWorkedExample(user);
    await screen.findByText(/554,60/);
    await user.click(screen.getByRole("button", { name: /Tableau d'amortissement/ }));
    await user.selectOptions(screen.getByLabelText(/Année affichée/), "2");

    const table = screen.getByTestId("yd-credit-schedule");
    expect(within(table).getByText("13")).toBeInTheDocument();
    expect(within(table).queryByText("1")).not.toBeInTheDocument();
  });
});
