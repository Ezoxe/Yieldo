import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "../../app/ThemeProvider";
import { formatCents } from "../../design/theme";
import { SavingsSimulator } from "./SavingsSimulator";
import { SAVINGS_3M, SAVINGS_WITHDRAWAL, jsonResponse } from "./fixtures";

// See CreditSimulator.test.tsx: the canvas is pinned by
// charts/SavingsChart.test.tsx, which is where the stacking that keeps a
// withdrawal below zero is actually asserted.
vi.mock("../../charts/SavingsChart", () => ({
  SavingsChart: ({ projection }: { projection: { months: number } }) => (
    <div role="img" aria-label={`Épargne (stub, ${projection.months} mois)`} />
  ),
}));

const fetchMock = vi.fn();

function setupFetch(respond: () => Response = () => jsonResponse(SAVINGS_3M)) {
  fetchMock.mockImplementation((input: string, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : String(input), "http://localhost");
    if (url.pathname === "/api/simulators/epargne" && (init?.method ?? "GET") === "POST") {
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
      <SavingsSimulator />
    </ThemeProvider>,
  );
}

async function fill(
  user: ReturnType<typeof userEvent.setup>,
  values: { initial: string; monthly: string; rate: string; months: string },
) {
  for (const [label, value] of [
    [/Montant de départ/, values.initial],
    [/Versement mensuel/, values.monthly],
    [/Taux de rendement annuel/, values.rate],
    [/Durée \(mois\)/, values.months],
  ] as const) {
    const input = screen.getByLabelText(label);
    await user.clear(input);
    await user.type(input, value);
  }
  await user.click(screen.getByRole("button", { name: /Calculer l'épargne/ }));
}

describe("SavingsSimulator", () => {
  it("answers 0 € et 100 € par mois à 12,00 % sur 3 mois avec 303,01 €", async () => {
    const user = userEvent.setup();
    setupFetch();
    renderIt();
    await fill(user, { initial: "0", monthly: "100", rate: "12,00", months: "3" });

    expect(await screen.findByTestId("yd-savings-final")).toHaveTextContent("303,01");
    expect(screen.getByTestId("yd-savings-contributed")).toHaveTextContent("300,00");
    expect(screen.getByTestId("yd-savings-interest")).toHaveTextContent("3,01");
  });

  it("labels the monthly field so a withdrawal is an option, not a trick", async () => {
    setupFetch();
    renderIt();
    expect(screen.getByLabelText(/négatif pour un retrait/)).toBeInTheDocument();
  });

  it("sends a negative contribution as a negative integer, never its magnitude", async () => {
    const user = userEvent.setup();
    setupFetch(() => jsonResponse(SAVINGS_WITHDRAWAL));
    renderIt();
    await fill(user, { initial: "1000", monthly: "-746,19", rate: "3,00", months: "6" });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      initial_cents: 100_000,
      monthly_cents: -74_619,
      annual_rate_bps: 300,
      months: 6,
    });
  });

  it("says the final balance is below zero rather than showing its magnitude", async () => {
    const user = userEvent.setup();
    setupFetch(() => jsonResponse(SAVINGS_WITHDRAWAL));
    renderIt();
    await fill(user, { initial: "1000", monthly: "-746,19", rate: "3,00", months: "6" });

    // The typographic minus `formatCents` emits, on the figure itself — not a
    // magnitude with the sign quietly dropped.
    // Read off `textContent` rather than through `toHaveTextContent`, which
    // normalises the narrow no-break space `formatCents` emits and would then
    // never match its own output.
    const final = await screen.findByTestId("yd-savings-final");
    expect(final.textContent).toContain(formatCents(-347_400, { signed: true }));
    expect(screen.getByText(/Ce plan épuise l'épargne/)).toBeInTheDocument();
  });

  it("prints the projection's own term refusal, as content and not an alert", async () => {
    const user = userEvent.setup();
    const refusal = "La durée d'une projection doit être comprise entre 1 et 600 mois.";
    setupFetch(() => jsonResponse({ detail: refusal }, 422));
    renderIt();
    await fill(user, { initial: "0", monthly: "100", rate: "3,00", months: "700" });

    expect(await screen.findByText(refusal)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("states plainly that the rate is an assumption and no market is consulted", async () => {
    const user = userEvent.setup();
    setupFetch();
    renderIt();
    await fill(user, { initial: "0", monthly: "100", rate: "12,00", months: "3" });

    const note = await screen.findByTestId("yd-savings-assumption");
    expect(note).toHaveTextContent(/hypothèse/i);
    expect(note).toHaveTextContent(/ne va chercher aucun taux/);
    expect(note).toHaveTextContent(/conseiller financier/);
  });

  it("refuses an unreadable rate in French without asking the server", async () => {
    const user = userEvent.setup();
    setupFetch();
    renderIt();
    const rate = screen.getByLabelText(/Taux de rendement annuel/);
    await user.clear(rate);
    await user.type(rate, "douze");
    await user.click(screen.getByRole("button", { name: /Calculer l'épargne/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Taux illisible/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
