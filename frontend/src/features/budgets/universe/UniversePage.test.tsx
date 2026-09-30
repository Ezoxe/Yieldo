import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "../../../app/ThemeProvider";
import { formatCents } from "../../../design/theme";
import { abonnementsDetail, fuelDetail, giftsDetail, logementDetail, transportDetail } from "./fixtures";
import { UniversePage } from "./UniversePage";

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const DETAILS: Record<string, unknown> = {
  "30": transportDetail,
  "31": fuelDetail,
  "50": giftsDetail,
  "10": logementDetail,
  "40": abonnementsDetail,
};

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation((input: string) => {
    const url = new URL(String(input), "http://localhost");
    const match = /^\/api\/budgets\/(\d+)\/detail$/.exec(url.pathname);
    if (match) {
      const body = DETAILS[match[1]];
      return Promise.resolve(
        body ? jsonResponse(body) : jsonResponse({ detail: "Catégorie introuvable" }, 404),
      );
    }
    throw new Error(`Unhandled fetch in test: ${url.pathname}`);
  });
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

function renderPage(entry: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <ThemeProvider>
          <Routes>
            <Route path="/budgets/:categoryId" element={<UniversePage />} />
          </Routes>
        </ThemeProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function monthsAsked(): (string | null)[] {
  return fetchMock.mock.calls
    .map(([input]) => new URL(String(input), "http://localhost"))
    .filter((url) => url.pathname.endsWith("/detail"))
    .map((url) => url.searchParams.get("month"));
}

describe("UniversePage", () => {
  it("says what the family cost this month and in an ordinary month, first", async () => {
    renderPage("/budgets/30?mois=2026-09");
    expect(await screen.findByRole("heading", { level: 1, name: "Transport" })).toBeInTheDocument();
    const lead = document.querySelector(".yd-universe__lead")!;
    expect(lead.textContent).toContain(`${formatCents(Math.abs(transportDetail.spent_cents))} en septembre 2026`);
    expect(lead.textContent).toContain(
      `${formatCents(Math.abs(transportDetail.average_cents!))} par mois en moyenne depuis mars 2025`,
    );
  });

  it("draws the car for Transport, and lists every child — the ones the car has no part for too", async () => {
    const { container } = renderPage("/budgets/30?mois=2026-09");
    await screen.findByRole("heading", { level: 1, name: "Transport" });
    expect(container.querySelector(".yd-car")).not.toBeNull();
    const parts = within(screen.getByRole("region", { name: "Postes" }));
    expect(parts.getByRole("link", { name: "Transports en commun" })).toHaveAttribute(
      "href",
      "/budgets/35?mois=2026-09",
    );
    expect(parts.getByRole("link", { name: "Carburant" })).toBeInTheDocument();
  });

  it("puts a child in front of its family's car and lists its siblings", async () => {
    const { container } = renderPage("/budgets/31?mois=2026-09");
    expect(await screen.findByRole("heading", { level: 1, name: "Carburant" })).toBeInTheDocument();
    expect(container.querySelector(".yd-lens--fuel.yd-lens--focused")).not.toBeNull();
    const siblings = within(screen.getByRole("region", { name: "Les autres postes de Transport" }));
    expect(siblings.getByRole("link", { name: "Entretien véhicule" })).toBeInTheDocument();
    expect(siblings.queryByRole("link", { name: "Carburant" })).toBeNull();
  });

  it("draws the house for Logement", async () => {
    const { container } = renderPage("/budgets/10?mois=2026-09");
    expect(await screen.findByRole("heading", { level: 1, name: "Logement" })).toBeInTheDocument();
    expect(container.querySelector(".yd-house")).not.toBeNull();
    expect(container.querySelector(".yd-car")).toBeNull();
  });

  it("draws the living room for Abonnements", async () => {
    const { container } = renderPage("/budgets/40?mois=2026-09");
    expect(await screen.findByRole("heading", { level: 1, name: "Abonnements" })).toBeInTheDocument();
    expect(container.querySelector(".yd-salon")).not.toBeNull();
  });

  it("keeps a category no universe covers, with its figures and without a scene", async () => {
    const { container } = renderPage("/budgets/50?mois=2026-09");
    expect(await screen.findByRole("heading", { level: 1, name: "Cadeaux" })).toBeInTheDocument();
    expect(container.querySelector(".yd-car")).toBeNull();
    expect(screen.getByRole("region", { name: "Ce mois" })).toBeInTheDocument();
  });

  it("prints the backend's refusal as it is", async () => {
    renderPage("/budgets/99");
    expect(await screen.findByRole("alert")).toHaveTextContent("Catégorie introuvable");
  });

  it("says there is no mean yet rather than printing one", async () => {
    DETAILS["30"] = { ...transportDetail, average_cents: null, months_counted: 2, years: [] };
    renderPage("/budgets/30?mois=2026-09");
    await screen.findByRole("heading", { level: 1, name: "Transport" });
    expect(document.querySelector(".yd-universe__lead")!.textContent).toContain(
      "pas encore de moyenne",
    );
    DETAILS["30"] = transportDetail;
  });

  it("moves month by month with the same arrows as Budgets", async () => {
    renderPage("/budgets/30?mois=2026-09");
    await screen.findByRole("heading", { level: 1, name: "Transport" });
    await userEvent.click(screen.getByRole("button", { name: "Mois précédent" }));
    await waitFor(() => expect(monthsAsked()).toContain("2026-08"));
  });
});
