import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "../../app/ThemeProvider";
import { ControlRoomPage } from "./ControlRoomPage";

const fetchMock = vi.fn();

const overview = {
  mode: "paper",
  autonomy: "paper",
  armed: false,
  armed_until: null,
  halted: false,
  halted_reason: null,
  currency: "EUR",
  cash_cents: 812_340,
  initial_cash_cents: 1_000_000,
  equity_cents: 1_024_500,
  peak_equity_cents: 1_050_000,
  drawdown_bps: 243,
  unrealised_pnl_cents: 12_400,
  realised_pnl_today_cents: -3_200,
  realised_pnl_total_cents: 24_500,
  orders_today: 3,
  positions: [
    {
      symbol: "BTC-EUR", quantity: "0.010000000000000000", average_price_cents: 2_520_000,
      price_cents: 2_640_000, market_value_cents: 26_400, unrealised_pnl_cents: 1_200,
    },
    {
      symbol: "AAPL", quantity: "3", average_price_cents: 18_500,
      price_cents: null, market_value_cents: null, unrealised_pnl_cents: null,
    },
  ],
  examined: 20, skipped: 6, held: 10, refused: 2, ordered: 2, failed: 0,
  latency_median_ms: 84, latency_worst_ms: 412,
  calibration: {
    observations: 52, brier_bps: 1_180, coin_flip_brier_bps: 2_500,
    verdict: "Le modèle est bien calibré.",
    buckets: [
      { lower_bps: 5_000, upper_bps: 6_000, count: 20, stated_bps: 5_500,
        observed_bps: 5_600, gap_bps: 100 },
    ],
  },
  venue: {
    id: 1, venue: "internal", label: "Bac à sable", mode: "paper",
    price_source: "synthetic", slippage_bps: 10, enabled: true, configured: true,
    requires_credentials: false, sandbox_step: 42, created_at: "2026-09-20T10:00:00Z",
    last_used_at: null, last_check_at: null, last_check_ok: null, last_check_message: null,
  },
};

const decisions = [
  {
    id: 7, run_id: "abc", symbol: "BTC-EUR", mode: "paper", provider: "replay",
    model: "yieldo-regles-1", outcome: "ordered", rule: null,
    message: null, reference_price_cents: 2_640_000, latency_ms: 3,
    created_at: "2026-09-20T10:05:00Z", features: { symbol: "BTC-EUR" }, answers: {},
    inputs_hash: "a".repeat(64),
  },
  {
    id: 6, run_id: "abc", symbol: "AAPL", mode: "paper", provider: "replay",
    model: "yieldo-regles-1", outcome: "refused", rule: "position_ceiling",
    message: "La position sur « AAPL » atteindrait 3 000,00 €, pour un plafond de 2 000,00 €.",
    reference_price_cents: 18_500, latency_ms: 4,
    created_at: "2026-09-20T10:05:01Z", features: { symbol: "AAPL" }, answers: {},
    inputs_hash: "b".repeat(64),
  },
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" },
  });
}

function setupFetch(patch: Partial<typeof overview> = {}, handlers: Record<string, () => Response> = {}) {
  fetchMock.mockImplementation((input: string, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : String(input), "http://localhost");
    const key = `${init?.method ?? "GET"} ${url.pathname}`;
    if (handlers[key]) return Promise.resolve(handlers[key]());
    if (url.pathname === "/api/invest/overview") {
      return Promise.resolve(json({ ...overview, ...patch }));
    }
    if (url.pathname === "/api/invest/decisions") return Promise.resolve(json(decisions));
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

/**
 * The rendered page as one normalised string.
 *
 * French typography puts a narrow no-break space inside every grouped figure
 * and a no-break space before « € » and « % ». Testing Library's own
 * normaliser collapses those, but a figure split across JSX expressions is
 * still several text nodes, so `getByText` on a fragment of one is brittle for
 * reasons that have nothing to do with the screen being right. Reading the
 * whole body once, with every run of whitespace collapsed, asks the question
 * actually worth asking: is this figure on the screen?
 */
function pageText(): string {
  return (document.body.textContent ?? "").replace(/\s+/g, " ");
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/invest"]}>
        <ThemeProvider>
          <ControlRoomPage />
        </ThemeProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Salle de contrôle", () => {
  it("says what mode the pilot is in and what that mode means", async () => {
    setupFetch();
    renderPage();
    expect(await screen.findByRole("heading", { name: "Salle de contrôle" })).toBeInTheDocument();
    expect(screen.getByText(/argent fictif/)).toBeInTheDocument();
  });

  it("reports the capital, the result and the drawdown", async () => {
    setupFetch();
    renderPage();
    await screen.findByText("Capital");
    expect(pageText()).toContain("10 245,00 €");
    expect(pageText()).toContain("2,43 %");
  });

  it("shows the funnel with every stage named", async () => {
    setupFetch();
    renderPage();
    await screen.findByText("Où sont partis les instruments");
    expect(screen.getByText("Refusé par le mandat")).toBeInTheDocument();
    expect(screen.getByText("Ordre transmis")).toBeInTheDocument();
  });

  it("says a position's price is unavailable rather than showing a stale one", async () => {
    setupFetch();
    renderPage();
    await screen.findByText("Les positions");
    expect(screen.getByText("cours indisponible")).toBeInTheDocument();
  });

  it("warns that a live mandate with no arming refuses every order", async () => {
    setupFetch({ autonomy: "live", mode: "live", armed: false });
    renderPage();
    expect(await screen.findByText(/pas armée/)).toBeInTheDocument();
  });

  it("puts the halt in the first screenful and names its reason", async () => {
    setupFetch({ halted: true, halted_reason: "écart de calibration anormal" });
    renderPage();
    await screen.findByRole("heading", { name: "Salle de contrôle" });
    const banner = screen
      .getAllByRole("status")
      .find((element) => element.textContent?.includes("à l'arrêt"));
    expect(banner).toBeDefined();
    expect(banner).toHaveTextContent("écart de calibration anormal");
    expect(screen.getByRole("button", { name: /Relancer/ })).toBeInTheDocument();
  });

  it("refuses to run a halted pipeline rather than letting the button pretend", async () => {
    setupFetch({ halted: true, halted_reason: "stop" });
    renderPage();
    expect(await screen.findByRole("button", { name: /Lancer un tour/ })).toBeDisabled();
  });

  it("asks for a reason before stopping, and sends it", async () => {
    const halt = vi.fn(() => json({ halted: true, raison: "test", arrete_par: "household",
                                    message: "Le pilotage est arrêté." }));
    setupFetch({}, { "POST /api/invest/oversight/halt": halt });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: /Arrêt d'urgence/ }));
    const confirm = screen.getByRole("button", { name: "Arrêter maintenant" });
    // A halt with no reason is a halt nobody can explain afterwards.
    expect(confirm).toBeDisabled();

    await user.type(screen.getByLabelText(/Pourquoi arrêtez-vous/), "latence anormale");
    await user.click(confirm);
    await waitFor(() => expect(halt).toHaveBeenCalled());
  });

  it("prints the backend's own sentence when a run is refused", async () => {
    setupFetch({}, {
      "POST /api/invest/run": () =>
        json({ detail: "Aucun courtier n'est connecté en mode papier. Ouvrez "
                       + "Investissement → Courtiers pour en connecter un." }, 409),
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Lancer un tour" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Courtiers");
  });

  it("summarises a run in the backend's words", async () => {
    setupFetch({}, {
      "POST /api/invest/run": () =>
        json({
          run_id: "r1", mode: "paper", examined: 2, skipped: 0, held: 1, refused: 0,
          ordered: 1, failed: 0,
          summary: "2 instrument(s) examiné(s) : 0 écarté(s) avant le modèle, 1 sans action, "
                   + "0 refusé(s) par le mandat, 1 ordre(s) transmis, 0 en échec.",
          decisions: [],
        }),
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Lancer un tour" }));
    expect(await screen.findByText(/1 ordre\(s\) transmis/)).toBeInTheDocument();
  });

  it("lists the decisions, including the one that produced no order", async () => {
    setupFetch();
    renderPage();
    await screen.findByText("Les décisions, en direct");
    // Scoped to the feed: the positions table names BTC-EUR too, and an
    // ambiguous match would pass for the wrong reason.
    const feed = document.querySelector(".yd-feed") as HTMLElement;
    expect(within(feed).getByText("BTC-EUR")).toBeInTheDocument();
    // The refused one is there too, with the mandate's own sentence.
    expect(within(feed).getByText("Refusé")).toBeInTheDocument();
    expect(feed.textContent?.replace(/\s+/g, " ")).toContain("plafond de 2 000,00 €");
  });

  it("reports the model's latency, which is why a System One model was chosen", async () => {
    setupFetch();
    renderPage();
    await screen.findByText("Où sont partis les instruments");
    expect(pageText()).toContain("84 ms en médiane");
    expect(pageText()).toContain("412 ms au pire");
  });
});
