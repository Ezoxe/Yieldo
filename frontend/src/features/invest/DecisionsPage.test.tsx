import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "../../app/ThemeProvider";
import type { InvestDecision } from "../../lib/types";
import { DecisionsPage } from "./DecisionsPage";

const fetchMock = vi.fn();

function decision(id: number, symbol: string, outcome: InvestDecision["outcome"]): InvestDecision {
  return {
    id, run_id: "r", symbol, mode: "paper", provider: "replay", model: "yieldo-regles-1",
    outcome, rule: outcome === "held" ? "hold" : null,
    message: outcome === "held" ? "Le modèle ne propose aucune action." : null,
    reference_price_cents: 10_000, latency_ms: 1,
    created_at: "2026-09-20T10:00:00Z", features: { symbol }, answers: {},
    inputs_hash: "x".repeat(64),
  };
}

// 120 rows: more than one page, so the control has something to do.
const MANY = Array.from({ length: 120 }, (_, index) =>
  decision(index + 1, index % 2 ? "AAPL" : "BTC-EUR", index % 3 ? "held" : "ordered"),
);

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation((input: string) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === "/api/invest/decisions") {
      const outcome = url.searchParams.get("outcome");
      const symbol = url.searchParams.get("symbol");
      let rows = MANY;
      if (outcome) rows = rows.filter((row) => row.outcome === outcome);
      if (symbol) rows = rows.filter((row) => row.symbol === symbol);
      return Promise.resolve(json(rows));
    }
    throw new Error(`Unhandled fetch: ${url.pathname}`);
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
      <MemoryRouter initialEntries={["/invest/decisions"]}>
        <ThemeProvider>
          <DecisionsPage />
        </ThemeProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("DecisionsPage", () => {
  it("draws a page of rows rather than everything it was given", async () => {
    // Sixty cycles over five instruments made a page twelve thousand pixels
    // tall, measured in a browser. A feed is a screenful or two.
    renderPage();
    expect(await screen.findByText(/120 décision\(s\) retenue\(s\)/)).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(50);
  });

  it("says how many it is showing of how many it found", async () => {
    renderPage();
    expect(await screen.findByText(/50 affichée\(s\)/)).toBeInTheDocument();
  });

  it("shows more when asked, and stops offering once there is no more", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/120 décision\(s\)/);

    await user.click(screen.getByRole("button", { name: /Afficher 50 de plus/ }));
    expect(screen.getAllByRole("listitem")).toHaveLength(100);

    await user.click(screen.getByRole("button", { name: /Afficher 20 de plus/ }));
    expect(screen.getAllByRole("listitem")).toHaveLength(120);
    expect(screen.queryByRole("button", { name: /de plus/ })).not.toBeInTheDocument();
  });

  it("goes back to the first page when a filter changes", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/120 décision\(s\)/);
    await user.click(screen.getByRole("button", { name: /Afficher 50 de plus/ }));
    expect(screen.getAllByRole("listitem")).toHaveLength(100);

    await user.selectOptions(screen.getByLabelText("Issue"), "ordered");
    // A filter that kept the previous page depth would show a hundred rows of
    // a forty-row result, or a scroll position from another list.
    await screen.findByText(/40 décision\(s\)/);
    expect(screen.getAllByRole("listitem")).toHaveLength(40);
  });

  it("filters on the outcome, upper-cases the instrument", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/120 décision\(s\)/);
    await user.type(screen.getByLabelText("Instrument"), "aapl");
    await screen.findByText(/60 décision\(s\)/);
    const asked = fetchMock.mock.calls.map(([input]) => String(input));
    expect(asked.some((url) => url.includes("symbol=AAPL"))).toBe(true);
  });
});
