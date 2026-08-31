import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "../../app/ThemeProvider";
import type { PropertySimulation } from "../../lib/types";
import { PropertySimulator } from "./PropertySimulator";
import {
  CAPPED_REASON,
  PROPERTY_300K,
  PROPERTY_300K_NO_RENT,
  SIMULATOR_CONTEXT,
  jsonResponse,
} from "./fixtures";

// See CreditSimulator.test.tsx: the canvas is pinned by
// charts/AmortizationChart.test.tsx, including the client-side roll-up this
// screen has to perform because `ScheduleOut` publishes no `years`.
vi.mock("../../charts/AmortizationChart", () => ({
  AmortizationChart: ({ years }: { years: unknown[] }) => (
    <div role="img" aria-label={`Amortissement (stub, ${years.length} ans)`} />
  ),
  rollUpScheduleYears: (rows: unknown[]) => rows.slice(0, Math.ceil(rows.length / 12)),
}));

const fetchMock = vi.fn();

function setupFetch(respond: () => Response = () => jsonResponse(PROPERTY_300K_NO_RENT)) {
  fetchMock.mockImplementation((input: string, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : String(input), "http://localhost");
    if (url.pathname === "/api/simulators/context") {
      return Promise.resolve(jsonResponse(SIMULATOR_CONTEXT));
    }
    if (url.pathname === "/api/simulators/immobilier" && (init?.method ?? "GET") === "POST") {
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
      <PropertySimulator />
    </ThemeProvider>,
  );
}

/** The plan's worked example. Every field is already prefilled with it, so this
 *  only presses the button — a form that opens on values nobody chose would be
 *  a different test. */
async function compute(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /Calculer l'achat/ }));
}

/** The same answer with one field of the simulation changed. */
function withSimulation(patch: Partial<PropertySimulation["simulation"]>): PropertySimulation {
  return {
    ...PROPERTY_300K_NO_RENT,
    simulation: { ...PROPERTY_300K_NO_RENT.simulation, ...patch },
  };
}

describe("PropertySimulator — what is really borrowed", () => {
  it("shows the notary fees as part of what is borrowed", async () => {
    // 300 000 € + 22 500 € − 60 000 € = 262 500 €. A reader who sees only
    // "300 000 €" cannot tell where the instalment came from.
    const user = userEvent.setup();
    setupFetch();
    renderIt();
    await compute(user);

    const block = await screen.findByTestId("yd-prop-acquisition");
    expect(block).toHaveTextContent("300 000,00");
    expect(block).toHaveTextContent("22 500,00");
    expect(block).toHaveTextContent("322 500,00");
    expect(block).toHaveTextContent("262 500,00");
  });

  it("breaks the monthly effort into the four things it is made of", async () => {
    const user = userEvent.setup();
    setupFetch();
    renderIt();
    await compute(user);

    const block = await screen.findByTestId("yd-prop-effort");
    expect(block).toHaveTextContent("1 522,39"); // mensualité
    expect(block).toHaveTextContent("78,75"); // assurance
    expect(block).toHaveTextContent("150,00"); // charges
    expect(block).toHaveTextContent("100,00"); // taxe foncière, mensualisée
    expect(screen.getByTestId("yd-prop-effort-total")).toHaveTextContent("1 851,14");
  });

  it("sends integer cents and integer basis points for every field", async () => {
    const user = userEvent.setup();
    setupFetch();
    renderIt();
    await compute(user);

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true),
    );
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      price_cents: 30_000_000,
      down_payment_cents: 6_000_000,
      notary_bps: 750,
      loan_rate_bps: 350,
      loan_months: 240,
      insurance_bps_per_year: 36,
      monthly_charges_cents: 15_000,
      annual_property_tax_cents: 120_000,
      // No rent typed: the comparison fields are ABSENT, never sent as zero.
    });
  });
});

describe("PropertySimulator — the debt ratio", () => {
  it("raises the 35 % alarm and names the rule", async () => {
    const user = userEvent.setup();
    setupFetch(() => jsonResponse(withSimulation({ debt_ratio_bps: 4003, debt_ratio_exceeded: true })));
    renderIt();
    await compute(user);

    const ratio = await screen.findByTestId("yd-prop-ratio");
    expect(ratio).toHaveTextContent("40,03");
    expect(ratio).toHaveTextContent(/HCSF/);
    expect(ratio).toHaveTextContent(/35,00/);
    expect(ratio.className).toContain("yd-prop__ratio--exceeded");
  });

  it("prints the measured ratio the seeded ledger actually produces", async () => {
    // 339,87 %, because the route measures the income itself and the operator's
    // is 471,11 €/month. Never clamped at the threshold: the whole answer is
    // that this purchase is far past it.
    const user = userEvent.setup();
    setupFetch();
    renderIt();
    await compute(user);

    expect(await screen.findByTestId("yd-prop-ratio")).toHaveTextContent("339,87");
  });

  it("says the debt ratio could not be measured rather than showing 0 %", async () => {
    // Branch on the null BEFORE the exceeded flag: `debt_ratio_exceeded` is
    // false both under the threshold and when there is no ratio at all, and
    // cannot tell the two apart.
    const user = userEvent.setup();
    setupFetch(() =>
      jsonResponse({
        ...withSimulation({ debt_ratio_bps: null, debt_ratio_exceeded: false }),
        measured_monthly_income_cents: null,
      }),
    );
    renderIt();
    await compute(user);

    const ratio = await screen.findByTestId("yd-prop-ratio");
    expect(ratio).toHaveTextContent(/pas pu être calculé/);
    expect(ratio).not.toHaveTextContent("0,00 %");
    expect(ratio.className).not.toContain("yd-prop__ratio--exceeded");
  });

  it("shows the income behind the ratio as measured, with its sample size", async () => {
    const user = userEvent.setup();
    setupFetch();
    renderIt();
    await compute(user);

    const ratio = await screen.findByTestId("yd-prop-ratio");
    expect(ratio).toHaveTextContent("471,11");
    expect(ratio).toHaveTextContent(/3 mois/);
    // And it is never an input.
    expect(screen.queryByLabelText(/Revenu/)).not.toBeInTheDocument();
  });
});

describe("PropertySimulator — the apport", () => {
  it("warns when the down payment does not cover the notary fees", async () => {
    const user = userEvent.setup();
    setupFetch(() => jsonResponse(withSimulation({ down_payment_short_cents: 1_250_000 })));
    renderIt();
    await compute(user);

    const warning = await screen.findByTestId("yd-prop-short");
    expect(warning).toHaveTextContent("12 500,00");
    expect(warning).toHaveTextContent(/fonds propres/);
  });

  it("says nothing at all when the apport covers them", async () => {
    const user = userEvent.setup();
    setupFetch();
    renderIt();
    await compute(user);

    await screen.findByTestId("yd-prop-acquisition");
    expect(screen.queryByTestId("yd-prop-short")).not.toBeInTheDocument();
  });
});

describe("PropertySimulator — renting against buying", () => {
  it("prints the rent comparison only when a rent was entered", async () => {
    const user = userEvent.setup();
    setupFetch();
    renderIt();
    await compute(user);

    await screen.findByTestId("yd-prop-acquisition");
    // No empty panel and no zero: a sentence saying what to type instead.
    expect(screen.queryByTestId("yd-prop-comparison")).not.toBeInTheDocument();
    expect(screen.getByTestId("yd-prop-no-comparison")).toHaveTextContent(/loyer/i);
  });

  it("says which side wins without hiding the assumptions behind it", async () => {
    const user = userEvent.setup();
    setupFetch(() => jsonResponse(PROPERTY_300K));
    renderIt();
    await user.click(screen.getByRole("button", { name: /Comparer avec la location/ }));
    await user.type(screen.getByLabelText(/Loyer mensuel/), "1100");
    await compute(user);

    const comparison = await screen.findByTestId("yd-prop-comparison");
    expect(comparison).toHaveTextContent("177 582,08"); // patrimoine acheteur
    expect(comparison).toHaveTextContent("216 287,06"); // patrimoine locataire
    const verdict = screen.getByTestId("yd-prop-verdict");
    expect(verdict).toHaveTextContent(/[Ll]ouer et placer la différence/);
    // Design §10: the three hypotheses in the SAME paragraph as the verdict, so
    // the answer cannot be read without them.
    expect(verdict).toHaveTextContent("1,00"); // revalorisation du bien
    expect(verdict).toHaveTextContent("3,00"); // rendement du placement
    expect(verdict).toHaveTextContent(/120 mois/);
  });

  it("states the comparison horizon cap in the engine's own words", async () => {
    const user = userEvent.setup();
    setupFetch(() =>
      jsonResponse({
        ...PROPERTY_300K,
        rent_comparison: {
          ...PROPERTY_300K.rent_comparison!,
          horizon_months: 240,
          capped_reason: CAPPED_REASON,
        },
      }),
    );
    renderIt();
    await user.click(screen.getByRole("button", { name: /Comparer avec la location/ }));
    await user.type(screen.getByLabelText(/Loyer mensuel/), "1100");
    await compute(user);

    // Verbatim, not paraphrased: the sentence is what explains WHY the cap
    // exists, and a summary of it loses the reason.
    expect(await screen.findByText(CAPPED_REASON)).toBeInTheDocument();
  });

  it("sends the comparison's own four fields only once a rent is typed", async () => {
    const user = userEvent.setup();
    setupFetch(() => jsonResponse(PROPERTY_300K));
    renderIt();
    await user.click(screen.getByRole("button", { name: /Comparer avec la location/ }));
    await user.type(screen.getByLabelText(/Loyer mensuel/), "1100");
    await compute(user);

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true),
    );
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    const body = JSON.parse(String(post?.[1]?.body));
    expect(body.monthly_rent_cents).toBe(110_000);
    expect(body.years).toBe(10);
    expect(body.annual_return_bps).toBe(300);
    expect(body.appreciation_bps_per_year).toBe(100);
  });
});

describe("PropertySimulator — the form and its refusals", () => {
  it("offers ancien, neuf and a free notary rate, and sends the one chosen", async () => {
    const user = userEvent.setup();
    setupFetch();
    renderIt();
    const select = screen.getByLabelText(/Frais de notaire/);
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Ancien (7,50 %)",
      "Neuf (2,50 %)",
      "Autre taux",
    ]);
    await user.selectOptions(select, "250");
    await compute(user);

    await waitFor(() => expect(fetchMock.mock.calls.some(([, i]) => i?.method === "POST")).toBe(true));
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(post?.[1]?.body)).notary_bps).toBe(250);
  });

  it("reveals a free rate field on 'Autre taux' and sends what is typed there", async () => {
    const user = userEvent.setup();
    setupFetch();
    renderIt();
    expect(screen.queryByLabelText(/Taux de frais de notaire/)).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText(/Frais de notaire/), "custom");
    const free = screen.getByLabelText(/Taux de frais de notaire/);
    await user.clear(free);
    await user.type(free, "4,20");
    await compute(user);

    await waitFor(() => expect(fetchMock.mock.calls.some(([, i]) => i?.method === "POST")).toBe(true));
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(post?.[1]?.body)).notary_bps).toBe(420);
  });

  it("keeps the rent comparison collapsed until it is asked for", () => {
    setupFetch();
    renderIt();
    expect(screen.queryByLabelText(/Loyer mensuel/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Comparer avec la location/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("prints the loan's own refusal as content, not as a failure", async () => {
    const user = userEvent.setup();
    const refusal = "La durée d'un crédit doit être comprise entre 1 et 480 mois.";
    setupFetch(() => jsonResponse({ detail: refusal }, 422));
    renderIt();
    await compute(user);

    expect(await screen.findByText(refusal)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("refuses a price of zero in French without asking the server", async () => {
    const user = userEvent.setup();
    setupFetch();
    renderIt();
    const price = screen.getByLabelText(/Prix du bien/);
    await user.clear(price);
    await user.type(price, "0");
    await compute(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(/strictement positif/);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });
});
