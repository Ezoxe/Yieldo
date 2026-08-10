import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "../../app/ThemeProvider";
import { OverviewPage } from "./OverviewPage";

// OverviewPage's own responsibility is fetching, period selection, error
// surfacing and empty states -- each chart's rendering is already covered by
// its own dedicated test file against the real echarts instance. Stubbing
// the chart components here also sidesteps a jsdom-only artifact: a period
// change unmounts the loaded charts (back to the skeleton) and remounts them
// once the refetch resolves, and echarts' internal requestAnimationFrame
// ticker can fire against an already-disposed jsdom canvas mid-transition
// (a real browser's canvas does not hit this). Real chart lifecycle
// (init/dispose/animation) is exercised by charts/Chart.test.tsx instead.
vi.mock("../../charts/CashflowChart", () => ({
  CashflowChart: () => <div role="img" aria-label="Flux de trésorerie (stub)" />,
}));
vi.mock("../../charts/CategoryTreemap", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../charts/CategoryTreemap")>();
  return {
    ...actual,
    CategoryTreemap: () => <div role="img" aria-label="Répartition des dépenses (stub)" />,
  };
});
vi.mock("../../charts/SpendingCalendar", () => ({
  SpendingCalendar: () => <div role="img" aria-label="Calendrier des dépenses (stub)" />,
}));
vi.mock("../../charts/WaterfallChart", () => ({
  WaterfallChart: () => <div role="img" aria-label="Cascade (stub)" />,
}));

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
      // Legacy aliases -- framer-motion's own reduced-motion detection
      // (mounted by PeriodSelector's tab-indicator `motion.span`) still
      // calls these instead of the modern EventTarget methods.
      addListener: vi.fn(),
      removeListener: vi.fn(),
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

  it("renders the shared period selector, defaulting to the current month", async () => {
    setupFetch();
    renderPage();

    await screen.findByText("Entrées");
    expect(screen.getByRole("tablist", { name: "Période" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Mois" })).toHaveAttribute("aria-selected", "true");
  });

  it("re-fetches every panel against the new date range when the period preset changes", async () => {
    setupFetch();
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Entrées");

    fetchMock.mockClear();
    await user.click(screen.getByRole("tab", { name: "Année" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/analytics/summary"),
        expect.anything(),
      ),
    );
    const summaryCall = fetchMock.mock.calls.find((call: unknown[]) =>
      String(call[0]).includes("/analytics/summary"),
    );
    expect(summaryCall).toBeDefined();
    const calledUrl = new URL(String(summaryCall?.[0]), "http://localhost");
    const currentYear = new Date().getUTCFullYear();
    expect(calledUrl.searchParams.get("date_from")).toBe(`${currentYear}-01-01`);
  });

  it("carries the currently selected period across when linking to the transactions view", async () => {
    setupFetch();
    renderPage();
    await screen.findByText("Entrées");

    const link = screen.getByRole("link", { name: /transactions de cette période/i });
    const href = link.getAttribute("href") ?? "";
    expect(href).toMatch(/^\/transactions\?/);
    const params = new URL(href, "http://localhost").searchParams;
    expect(params.get("periode")).toBe("month");
    expect(params.get("du")).toBeTruthy();
    expect(params.get("au")).toBeTruthy();
  });
});
