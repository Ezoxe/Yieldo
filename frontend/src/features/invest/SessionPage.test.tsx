import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "../../app/ThemeProvider";
import type { InvestSession, InvestSessionDetail } from "../../lib/types";
import { SessionPage } from "./SessionPage";

const fetchMock = vi.fn();

const FINISHED: InvestSession = {
  id: 7, mode: "paper", seed: 4_242, steps: 78, interval_minutes: 5, completed_steps: 78,
  status: "finished", stop_requested: false, message: null, provider: "laya",
  model: "laya-typed-decisions", initial_cash_cents: 1_000_000, final_equity_cents: 1_012_500,
  realised_pnl_cents: 9_000, unrealised_pnl_cents: 3_500, max_drawdown_bps: 340, orders: 6,
  decisions: 234, started_at: "2026-09-21T09:00:00Z", finished_at: "2026-09-21T09:11:00Z",
};

const RUNNING: InvestSession = {
  ...FINISHED, id: 8, seed: 99, completed_steps: 20, status: "running", final_equity_cents: null,
  orders: 1, decisions: 60, finished_at: null,
};

const DETAIL: InvestSessionDetail = {
  ...FINISHED,
  points: Array.from({ length: 78 }, (_, i) => ({
    step: i + 1, equity_cents: 1_000_000 + i * 160, cash_cents: 900_000,
    exposure_cents: 100_000 + i * 160, orders: 0,
  })),
  closes: { AAPL: Array.from({ length: 78 }, (_, i) => 3_300 + i) },
  symbols: ["AAPL"],
  decisions: [],
  orders: [],
  report: {
    final_equity_cents: 1_012_500, return_bps: 125, max_drawdown_bps: 340, decisions: 234,
    held: 200, refused: 10, ordered: 20, failed: 4, orders: 6, filled: 6, winning: 4, losing: 2,
    realised_pnl_cents: 9_000, compared: 230, agreement_bps: 6_100, mean_confidence_bps: 1_500,
    mean_act_bps: 9_800, latency_p50_ms: 870, mass_series: { AAPL: [] },
  },
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" },
  });
}

let posts: Array<Record<string, unknown>>;
let list: InvestSession[];

beforeAll(() => {
  // ECharts needs a canvas jsdom does not have; the page is judged on its
  // text and its requests, the charts on their options (SessionCharts.test).
  vi.mock("../../charts/Chart", () => ({
    Chart: ({ ariaLabel }: { ariaLabel: string }) => <div role="img" aria-label={ariaLabel} />,
  }));
});

beforeEach(() => {
  posts = [];
  list = [FINISHED];
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation((input: string, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = init?.method ?? "GET";
    if (url.pathname === "/api/invest/sessions" && method === "GET") {
      return Promise.resolve(json(list));
    }
    if (url.pathname === "/api/invest/sessions" && method === "POST") {
      posts.push(JSON.parse(String(init?.body)));
      return Promise.resolve(json(RUNNING, 202));
    }
    if (url.pathname === "/api/invest/sessions/7") return Promise.resolve(json(DETAIL));
    if (url.pathname === "/api/invest/sessions/8") {
      return Promise.resolve(json({ ...DETAIL, ...RUNNING, points: DETAIL.points.slice(0, 20) }));
    }
    throw new Error(`Unhandled fetch: ${method} ${url.pathname}`);
  });
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
      <MemoryRouter initialEntries={["/invest/journee"]}>
        <ThemeProvider>
          <SessionPage />
        </ThemeProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("La journée", () => {
  it("shows the last day's balance sheet and its charts", async () => {
    renderPage();
    // The report's own figure, not the list row's (which also says +1,25 %).
    expect(await screen.findByText("−3,40 %")).toBeInTheDocument();
    expect(screen.getAllByText("+1,25 %").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/4 gagnants/)).toBeInTheDocument();
    expect(screen.getByText(/2 perdants/)).toBeInTheDocument();
    expect(screen.getByText("61 %")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Capital et liquidités/ })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Cours de AAPL/ })).toBeInTheDocument();
    expect(screen.getByText(/Journée n° 4 242/)).toBeInTheDocument();
  });

  it("starts a day with the chosen cash and an optional seed", async () => {
    renderPage();
    await screen.findByText("−3,40 %");
    await userEvent.clear(screen.getByLabelText(/Montant de départ/));
    await userEvent.type(screen.getByLabelText(/Montant de départ/), "5000");
    await userEvent.type(screen.getByRole("textbox", { name: /^Rejouer la journée n°/ }), "527");
    await userEvent.click(screen.getByRole("button", { name: "Lancer la journée" }));
    expect(posts[0]).toEqual({ steps: 78, seed: 527, cash_cents: 500_000 });
  });

  it("shows the progress of a running day and offers to stop it", async () => {
    list = [RUNNING, FINISHED];
    renderPage();
    const bar = await screen.findByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "20");
    expect(bar).toHaveAttribute("aria-valuemax", "78");
    expect(screen.getByText(/20 pas sur 78/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Arrêter la journée" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lancer la journée" })).toBeDisabled();
  });

  it("lists previous days and prefills a seed to replay one", async () => {
    renderPage();
    await screen.findByText("−3,40 %");
    const previous = screen.getByRole("list", { name: "Journées précédentes" });
    const row = within(previous).getAllByRole("listitem")[0];
    expect(row).toHaveTextContent("4 242");
    expect(row).toHaveTextContent("Laya");
    await userEvent.click(within(row).getByRole("button", { name: /Rejouer/ }));
    expect(screen.getByRole("textbox", { name: /^Rejouer la journée n°/ })).toHaveValue("4242");
  });

  it("offers the day as a labelled training set", async () => {
    // The only path measured to make an encoder decide on prices: teach it.
    renderPage();
    await screen.findByText("−3,40 %");
    const link = screen.getByRole("link", { name: /Exporter pour l'entraînement/ });
    expect(link).toHaveAttribute("href", "/api/invest/sessions/7/entrainement");
    expect(link).toHaveAttribute("download");
  });

  it("explains an empty history rather than drawing nothing", async () => {
    list = [];
    renderPage();
    expect(await screen.findByText(/Aucune journée simulée/)).toBeInTheDocument();
  });
});
