import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "../../app/ThemeProvider";
import { OverviewPage } from "./OverviewPage";

const fetchMock = vi.fn();

const summary = {
  date_from: "2025-03-01",
  date_to: "2025-03-31",
  inflow_cents: 300000,
  outflow_cents: -220000,
  net_cents: 80000,
  transaction_count: 40,
  savings_rate: 0.2667,
  previous: {
    date_from: "2025-02-01",
    date_to: "2025-02-28",
    inflow_cents: 280000,
    outflow_cents: -200000,
    net_cents: 80000,
    transaction_count: 38,
    savings_rate: 0.2857,
  },
  comparison: { delta_cents: 20000, delta_ratio: 0.071 },
};

const series = [
  { key: "2025-03-01", start: "2025-03-01", end: "2025-03-01", inflow_cents: 10000, outflow_cents: -5000, net_cents: 5000, count: 2 },
];

const categoriesBreakdown = [
  { category_id: 1, name: "Logement", color: "#7ee2d6", total_cents: -100000, count: 1, share: 0.45 },
];

const categories = [
  { id: 1, parent_id: null, name: "Logement", slug: "logement", kind: "expense", color: "#7ee2d6", icon: "home", monthly_budget_cents: null },
];

const calendar = [{ date: "2025-03-01", inflow_cents: 0, outflow_cents: -5000, net_cents: -5000, count: 1 }];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

interface Overrides {
  summary?: () => Response;
  series?: () => Response;
  categoriesBreakdown?: () => Response;
  categories?: () => Response;
  calendar?: () => Response;
}

function setupFetch(overrides: Overrides = {}) {
  fetchMock.mockImplementation((input: string) => {
    const url = new URL(typeof input === "string" ? input : String(input), "http://localhost");
    const path = url.pathname;

    if (path === "/api/analytics/summary") {
      return Promise.resolve(overrides.summary ? overrides.summary() : jsonResponse(summary));
    }
    if (path === "/api/analytics/series") {
      return Promise.resolve(overrides.series ? overrides.series() : jsonResponse(series));
    }
    if (path === "/api/analytics/categories") {
      return Promise.resolve(
        overrides.categoriesBreakdown ? overrides.categoriesBreakdown() : jsonResponse(categoriesBreakdown),
      );
    }
    if (path === "/api/analytics/calendar") {
      return Promise.resolve(overrides.calendar ? overrides.calendar() : jsonResponse(calendar));
    }
    if (path === "/api/categories") {
      return Promise.resolve(overrides.categories ? overrides.categories() : jsonResponse(categories));
    }
    throw new Error(`Unhandled fetch in test: ${path}`);
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
    })),
  });
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <ThemeProvider>
        <OverviewPage />
      </ThemeProvider>
    </MemoryRouter>,
  );
}

describe("OverviewPage", () => {
  it("loads and shows the four headline stat tiles", async () => {
    setupFetch();
    renderPage();

    expect(await screen.findByText("Entrées")).toBeInTheDocument();
    expect(screen.getByText("Sorties")).toBeInTheDocument();
    expect(screen.getByText("Solde net")).toBeInTheDocument();
    expect(screen.getByText("Taux d'épargne")).toBeInTheDocument();
  });

  it("shows Donnée indisponible for a null savings rate instead of a fake zero", async () => {
    setupFetch({ summary: () => jsonResponse({ ...summary, savings_rate: null }) });
    renderPage();

    await screen.findByText("Taux d'épargne");
    expect(screen.getByText("Donnée indisponible")).toBeInTheDocument();
  });

  it("surfaces the backend's error when the summary fails to load, instead of failing silently", async () => {
    setupFetch({ summary: () => jsonResponse({ detail: "Résumé indisponible." }, 500) });
    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Résumé indisponible.");
  });

  it("surfaces the backend's error when the cashflow series fails to load", async () => {
    setupFetch({ series: () => jsonResponse({ detail: "Série indisponible." }, 500) });
    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Série indisponible.");
  });

  it("surfaces the backend's error when the category breakdown fails to load", async () => {
    setupFetch({ categoriesBreakdown: () => jsonResponse({ detail: "Catégories indisponibles." }, 500) });
    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Catégories indisponibles.");
  });

  it("surfaces the backend's error when the spending calendar fails to load", async () => {
    setupFetch({ calendar: () => jsonResponse({ detail: "Calendrier indisponible." }, 500) });
    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Calendrier indisponible.");
  });

  it("shows a dashboard-wide empty state pointing at Import when there are no transactions at all", async () => {
    setupFetch({
      summary: () => jsonResponse({ ...summary, transaction_count: 0, inflow_cents: 0, outflow_cents: 0, net_cents: 0 }),
      series: () => jsonResponse([]),
      categoriesBreakdown: () => jsonResponse([]),
      calendar: () => jsonResponse([]),
    });
    renderPage();

    expect(await screen.findByText(/Aucune transaction/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Importer un relevé/i })).toHaveAttribute("href", "/import");
    // The empty state replaces the chart grid rather than sitting above an empty one.
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("renders the cashflow, category and calendar charts once data has loaded", async () => {
    setupFetch();
    renderPage();

    await waitFor(() => expect(screen.getAllByRole("img").length).toBeGreaterThanOrEqual(3));
  });
});
