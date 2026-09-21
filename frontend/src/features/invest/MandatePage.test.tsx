import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "../../app/ThemeProvider";
import { ARM_PHRASE, MandatePage } from "./MandatePage";

const fetchMock = vi.fn();

const policy = {
  max_position_cents: 200_000, max_exposure_cents: 1_000_000,
  max_order_notional_cents: 200_000, max_daily_loss_cents: 50_000,
  min_cash_buffer_cents: 0, min_order_notional_cents: 1_000,
  max_drawdown_bps: 2_000, max_orders_per_day: 20,
  allowed_symbols: ["AAPL", "BTC-EUR"],
  allow_short: false, allow_leverage: false, allow_limit_orders: true,
  minimum_conviction: 6, minimum_probability_bps: 5_500,
  max_volatility_bps: 1_500, full_conviction_share_bps: 10_000,
  autonomy: "live" as const,
  armed_until: null, armed: false,
  halted: false, halted_reason: null, halted_at: null, halted_by: null,
  orders_today: 0, realised_pnl_today_cents: 0,
  declared_rules: [
    "Le modèle ne choisit jamais une taille de position : il donne un sens, une conviction "
    + "et une probabilité ; la taille est calculée par Yieldo.",
    "Une réponse hors du type attendu est écartée, jamais corrigée.",
  ],
  updated_at: "2026-09-20T10:00:00Z",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" },
  });
}

function setupFetch(patch: Partial<typeof policy> = {}, handlers: Record<string, () => Response> = {}) {
  fetchMock.mockImplementation((input: string, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : String(input), "http://localhost");
    const key = `${init?.method ?? "GET"} ${url.pathname}`;
    if (handlers[key]) return Promise.resolve(handlers[key]());
    if (url.pathname === "/api/invest/policy") {
      return Promise.resolve(json({ ...policy, ...patch }));
    }
    throw new Error(`Unhandled fetch in test: ${key}`);
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false, media: query,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(),
    })),
  });
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/invest/mandat"]}>
        <ThemeProvider>
          <MandatePage />
        </ThemeProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("la phrase d'armement", () => {
  /**
   * The drift test that matters most on this screen: two spellings of the
   * confirmation phrase is a confirmation nobody can pass, and the failure
   * would only show up the first time someone tried to go live with real
   * money. Read off the Python source, like `design/contrast.test.ts` reads
   * `tokens.css`.
   */
  it("est exactement celle que le backend exige", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(
      path.resolve(here, "../../../..", "backend", "app", "api", "invest_policy.py"),
      "utf8",
    );
    const match = source.match(/^ARM_PHRASE = "(.+)"$/m);
    expect(match, "ARM_PHRASE introuvable dans invest_policy.py").not.toBeNull();
    expect(ARM_PHRASE).toBe(match![1]);
  });

  it("n'a pas d'accent, pour être reproductible sur n'importe quel clavier", () => {
    expect(ARM_PHRASE).toBe(ARM_PHRASE.normalize("NFD").replace(/[̀-ͯ]/g, ""));
  });
});

describe("MandatePage", () => {
  it("shows the limits the way they were stored", async () => {
    setupFetch();
    renderPage();
    expect(await screen.findByDisplayValue("AAPL, BTC-EUR")).toBeInTheDocument();
    expect(screen.getByLabelText(/Plafond par position/)).toHaveValue("2000.00");
    expect(screen.getByLabelText(/Repli maximal/)).toHaveValue("20");
  });

  it("publishes the rules the model cannot get round", async () => {
    setupFetch();
    renderPage();
    expect(await screen.findByText(/jamais une taille de position/)).toBeInTheDocument();
    expect(screen.getByText(/écartée, jamais corrigée/)).toBeInTheDocument();
  });

  it("says plainly that an empty whitelist authorises nothing", async () => {
    setupFetch();
    renderPage();
    await screen.findByDisplayValue("AAPL, BTC-EUR");
    expect(screen.getByText(/liste vide n'autorise rien/)).toBeInTheDocument();
  });

  it("keeps the arming locked until the phrase is typed exactly", async () => {
    setupFetch();
    const user = userEvent.setup();
    renderPage();

    const button = await screen.findByRole("button", { name: /Armer pour/ });
    expect(button).toBeDisabled();

    const field = screen.getByLabelText(new RegExp(ARM_PHRASE.slice(0, 12)));
    await user.type(field, "je confirme");
    expect(button).toBeDisabled();

    await user.clear(field);
    await user.type(field, ARM_PHRASE);
    expect(button).toBeEnabled();
  });

  it("refuses to arm while the pipeline is halted, even with the phrase typed", async () => {
    setupFetch({ halted: true, halted_reason: "arrêt demandé par la supervision" });
    const user = userEvent.setup();
    renderPage();

    const field = await screen.findByLabelText(new RegExp(ARM_PHRASE.slice(0, 12)));
    await user.type(field, ARM_PHRASE);
    expect(screen.getByRole("button", { name: /Armer pour/ })).toBeDisabled();
    expect(screen.getByText(/arrêt demandé par la supervision/)).toBeInTheDocument();
  });

  it("offers to disarm, and says how long is left, once armed", async () => {
    const until = new Date(Date.now() + 25 * 60_000).toISOString();
    setupFetch({ armed: true, armed_until: until });
    renderPage();
    expect(await screen.findByText(/il reste environ 2[45] minute/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Désarmer maintenant" })).toBeInTheDocument();
  });

  it("sends the limits as cents and the rates as basis points", async () => {
    const put = vi.fn(() => json(policy));
    setupFetch({}, { "PUT /api/invest/policy": put });
    const user = userEvent.setup();
    renderPage();

    await screen.findByDisplayValue("AAPL, BTC-EUR");
    await user.click(screen.getByRole("button", { name: "Enregistrer le mandat" }));
    await waitFor(() => expect(put).toHaveBeenCalled());

    // The PUT, not whatever refetch followed it.
    const call = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "PUT",
    );
    const body = JSON.parse((call![1] as RequestInit).body as string);
    expect(body.max_position_cents).toBe(200_000);
    expect(body.max_drawdown_bps).toBe(2_000);
    expect(body.minimum_probability_bps).toBe(5_500);
    expect(body.allowed_symbols).toEqual(["AAPL", "BTC-EUR"]);
  });
});
