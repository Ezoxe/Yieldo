import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "../../app/ThemeProvider";
import type { InvestDecisionModel, InvestModelCheck } from "../../lib/types";
import { ModelPage } from "./ModelPage";

const fetchMock = vi.fn();

const UNSET: InvestDecisionModel = {
  provider: "local", endpoint_url: null, model_name: null, timeout_ms: 2_000,
  configured: false, has_key: false, updated_at: null,
};

const LAYA_CHECK: InvestModelCheck = {
  valid: true,
  message: "Le modèle (laya-typed-decisions) a répondu « ne rien faire » en 245 ms, dans le type attendu.",
  latency_ms: 245,
  choice: "ne rien faire",
  mass_bps: { acheter: 3_497, vendre: 2_907, "ne rien faire": 3_596 },
  act_bps: 10_000,
  health: {
    status: "ok", checkpoint: "laya-typed-decisions", device: "cpu", threads: 10,
    context_tokens: 1024, warmup_ms: 129, predictions: 4,
    latency_p50_ms: 245, latency_p95_ms: 310, laya_version: "0.3.4", torch_version: "2.14.0+cpu",
  },
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" },
  });
}

let puts: Array<Record<string, unknown>>;

beforeEach(() => {
  puts = [];
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation((input: string, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === "/api/invest/model" && (init?.method ?? "GET") === "GET") {
      return Promise.resolve(json(UNSET));
    }
    if (url.pathname === "/api/invest/model" && init?.method === "PUT") {
      puts.push(JSON.parse(String(init.body)));
      return Promise.resolve(json(LAYA_CHECK));
    }
    throw new Error(`Unhandled fetch: ${init?.method ?? "GET"} ${url.pathname}`);
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
      <MemoryRouter initialEntries={["/invest/modele"]}>
        <ThemeProvider>
          <ModelPage />
        </ThemeProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Modèle de décision — Laya", () => {
  it("offers Laya as a fourth provider, with an address and no model name", async () => {
    renderPage();
    const laya = await screen.findByRole("radio", { name: /Laya \(auto-hébergé\)/ });
    await userEvent.click(laya);
    expect(screen.getByPlaceholderText("http://192.168.1.172:8100")).toBeInTheDocument();
    // The server knows its own checkpoint; the health card says which.
    expect(screen.queryByLabelText(/Nom du modèle/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Clé/)).toBeInTheDocument();
  });

  it("saves the address and shows the health card and the test answer's mass", async () => {
    renderPage();
    await userEvent.click(await screen.findByRole("radio", { name: /Laya/ }));
    await userEvent.type(
      screen.getByPlaceholderText("http://192.168.1.172:8100"), "http://192.168.1.172:8100",
    );
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer et interroger" }));

    expect(await screen.findByRole("status")).toHaveTextContent("laya-typed-decisions");
    expect(puts[0]).toMatchObject({ provider: "laya", endpoint_url: "http://192.168.1.172:8100" });

    const card = screen.getByRole("group", { name: "Carte de santé du serveur" });
    expect(within(card).getByText("laya-typed-decisions")).toBeInTheDocument();
    expect(card).toHaveTextContent("cpu");
    expect(card).toHaveTextContent("10");
    expect(card).toHaveTextContent("245 ms");
    expect(card).toHaveTextContent("310 ms");
    expect(card).toHaveTextContent("1 024");

    const bars = screen.getByRole("list", { name: "Répartition de la masse de probabilité" });
    expect(within(bars).getAllByRole("listitem")).toHaveLength(3);
    expect(within(bars).getByText("ne rien faire").closest("li")).toHaveAttribute("aria-current", "true");
    expect(screen.getByText(/agir/)).toHaveTextContent("100 %");
  });
});
