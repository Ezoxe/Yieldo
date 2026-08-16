import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "../../app/ThemeProvider";
import { formatCents } from "../../design/theme";
import { coveredRangeLabel, cumulativeNetCents, OverviewPage } from "./OverviewPage";

// getByText compares against the DOM's *normalized* text content but does not
// normalize the string it is given, and formatCents uses narrow/no-break
// spaces. Collapsing the expected value keeps the assertion honest without
// hand-typing invisible Unicode.
function normalized(value: string): string {
  return value.replace(/\s+/g, " ");
}

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
  { key: "2025-03-02", start: "2025-03-02", end: "2025-03-02", inflow_cents: 4000, outflow_cents: -9000, net_cents: -5000, count: 3 },
  { key: "2025-03-03", start: "2025-03-03", end: "2025-03-03", inflow_cents: 90000, outflow_cents: -10000, net_cents: 80000, count: 5 },
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

/** The full span signature of every bento cell, in document order. */
function cellSpans(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>(".yd-bento__cell")).map((cell) =>
    (["base", "md", "lg"] as const)
      .map((key) => cell.style.getPropertyValue(`--yd-cell-span-${key}`))
      .concat(cell.style.getPropertyValue("--yd-cell-rows"))
      .join("/"),
  );
}

describe("coveredRangeLabel", () => {
  const range = (from: string, to: string) =>
    coveredRangeLabel({ ...summary, date_from: from, date_to: to } as never);

  it("writes the first of the month as 1er, the way French does", () => {
    expect(range("2025-03-01", "2025-03-31")).toBe("Du 1er mars 2025 au 31 mars 2025");
  });

  it("leaves every other day a bare numeral", () => {
    expect(range("2025-01-24", "2026-01-09")).toBe("Du 24 janvier 2025 au 9 janvier 2026");
  });

  it("reads the dates in UTC, so a date never slips a day on a western timezone", () => {
    // Parsed as UTC midnight: read in local time west of Greenwich this would
    // render as the 31st of the previous month.
    expect(range("2025-12-01", "2025-12-01")).toBe("Du 1er décembre 2025 au 1er décembre 2025");
  });
});

describe("cumulativeNetCents", () => {
  const bucket = (net_cents: number) => ({
    key: "k",
    start: "2025-03-01",
    end: "2025-03-01",
    inflow_cents: 0,
    outflow_cents: 0,
    net_cents,
    count: 0,
  });

  it("runs the balance forward, so the last point is the period's closing net", () => {
    expect(cumulativeNetCents([bucket(1000), bucket(-400), bucket(250)])).toEqual([1000, 600, 850]);
  });

  it("stays in integer cents — no float ever touches a monetary value", () => {
    const points = cumulativeNetCents([bucket(1), bucket(-3), bucket(7)]);
    expect(points.every(Number.isInteger)).toBe(true);
    expect(points).toEqual([1, -2, 5]);
  });

  it("has no points at all for an empty series", () => {
    expect(cumulativeNetCents([])).toEqual([]);
  });
});

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

  it("gives the net balance the hero cell — strictly the largest area on the grid", async () => {
    setupFetch();
    const { container } = renderPage();
    await screen.findByText("Entrées");

    const hero = container.querySelector<HTMLElement>(".yd-hero");
    expect(hero, "no hero cell on the dashboard").not.toBeNull();
    // Full width: nothing on the grid may be wider, so the hero's height is
    // the only thing that has to hold for it to be the biggest rectangle.
    expect(hero).toHaveClass("yd-bento__cell");
    expect(hero?.style.getPropertyValue("--yd-cell-span-lg")).toBe("12");
    expect(hero?.style.getPropertyValue("--yd-cell-rows")).toBe("2");

    // Hierarchy is area, and "largest" has to mean STRICTLY larger than every
    // other cell. Asserting that the maximum equals the hero's own area is
    // satisfied by a tie -- which is precisely how the calendar and the
    // cash-flow chart once drew level with it without a single test failing.
    //
    // jsdom has no layout engine, so this compares the areas the spans declare
    // at lg. The claim that actually matters is rendered pixels, measured in a
    // browser at 1440 in both themes and recorded in task-3-report.md.
    const areaOf = (cell: HTMLElement) =>
      Number(cell.style.getPropertyValue("--yd-cell-span-lg")) *
      Number(cell.style.getPropertyValue("--yd-cell-rows"));
    const others = Array.from(container.querySelectorAll<HTMLElement>(".yd-bento__cell"))
      .filter((cell) => cell !== hero)
      .map(areaOf);

    expect(others.length).toBeGreaterThan(0);
    expect(areaOf(hero as HTMLElement)).toBeGreaterThan(Math.max(...others));
  });

  it("draws the period's cumulative net as a trend under the hero figure", async () => {
    setupFetch();
    const { container } = renderPage();
    await screen.findByText("Entrées");

    expect(container.querySelector(".yd-hero__spark")).not.toBeNull();
    expect(screen.getByText("Solde cumulé sur la période")).toBeInTheDocument();
  });

  it("says why the trend is missing rather than leaving an empty box", async () => {
    setupFetch({ series: () => jsonResponse({ detail: "Série indisponible." }, 500) });
    const { container } = renderPage();
    await screen.findByRole("alert");

    expect(container.querySelector(".yd-hero__spark")).toBeNull();
    expect(screen.getByText(/Pas assez de données pour tracer une tendance/)).toBeInTheDocument();
  });

  it("states the net figure, its comparison delta and the period it covers in the hero", async () => {
    setupFetch();
    renderPage();
    await screen.findByText("Entrées");

    const hero = screen.getByRole("status", { name: formatCents(80000, { signed: true }) });
    expect(hero).toBeInTheDocument();
    expect(screen.getByText(normalized(formatCents(20000, { signed: true })))).toBeInTheDocument();
    // The range comes from the summary the backend actually answered with,
    // never from the requested bounds -- the two differ on the "Tout" preset.
    expect(screen.getByText(/1er mars 2025 au 31 mars 2025/)).toBeInTheDocument();
  });

  it("says so rather than printing a zero when the net balance is unavailable", async () => {
    setupFetch({ summary: () => jsonResponse({ detail: "Résumé indisponible." }, 500) });
    const { container } = renderPage();
    await screen.findByRole("alert");

    expect(container.querySelector(".yd-hero")).toBeNull();
  });

  it("lays the loading skeletons on the same cells, at the same spans, as the loaded content", async () => {
    setupFetch();
    const { container } = renderPage();

    const whileLoading = cellSpans(container);
    expect(whileLoading.length).toBeGreaterThan(0);

    await screen.findByText("Entrées");
    // Identical cell-for-cell: anything else and the grid reflows the moment
    // the data lands, which is the jump this layout exists to avoid.
    expect(cellSpans(container)).toEqual(whileLoading);
  });

  it("keeps the error banner above the grid instead of inside it", async () => {
    setupFetch({ series: () => jsonResponse({ detail: "Série indisponible." }, 500) });
    const { container } = renderPage();
    const alert = await screen.findByRole("alert");

    const grid = container.querySelector(".yd-bento");
    expect(grid).not.toBeNull();
    expect(alert.closest(".yd-bento")).toBeNull();
    expect(
      alert.compareDocumentPosition(grid as Node) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("places the empty state on the grid rather than beside it", async () => {
    setupFetch({
      summary: () => jsonResponse({ ...summary, transaction_count: 0, inflow_cents: 0, outflow_cents: 0, net_cents: 0 }),
      series: () => jsonResponse([]),
      categoriesBreakdown: () => jsonResponse([]),
      calendar: () => jsonResponse([]),
    });
    const { container } = renderPage();
    await screen.findByText(/Aucune transaction/i);

    const empty = container.querySelector(".yd-overview__empty");
    expect(empty).toHaveClass("yd-bento__cell");
    expect(empty?.closest(".yd-bento")).not.toBeNull();
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
