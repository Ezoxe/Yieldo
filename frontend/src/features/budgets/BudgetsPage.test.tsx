import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "../../app/ThemeProvider";
import { BudgetsPage, monthLabel, shiftMonth } from "./BudgetsPage";

const fetchMock = vi.fn();

const report = {
  month: "2026-01",
  month_start: "2026-01-01",
  month_end: "2026-01-31",
  days_elapsed: 31,
  days_in_month: 31,
  is_current_month: false,
  lines: [
    {
      category_id: 1, name: "Courses", color: "#4fd6a8", is_essential: true,
      budget_cents: 30000, spent_cents: -34500, remaining_cents: -4500,
      consumed_ratio: 1.15, projected_cents: null, status: "over",
    },
    {
      category_id: 2, name: "Carburant", color: "#f4a261", is_essential: true,
      budget_cents: 12000, spent_cents: -6000, remaining_cents: 6000,
      consumed_ratio: 0.5, projected_cents: null, status: "ok",
    },
  ],
  unbudgeted: [
    { category_id: 3, name: "Restaurants", color: "#fb7185", spent_cents: -18000 },
  ],
  total_budget_cents: 42000,
  total_spent_cents: -58500,
  history: { date_from: "2025-01-24", date_to: "2026-01-09", transaction_count: 197 },
};

const emptyReport = {
  ...report, lines: [], unbudgeted: [], total_budget_cents: 0, total_spent_cents: 0,
};

const categories = [
  { id: 1, parent_id: null, name: "Courses", slug: "alimentation-courses", kind: "expense", color: "#4fd6a8", icon: "cart", monthly_budget_cents: 30000, is_essential: true },
  { id: 3, parent_id: null, name: "Restaurants", slug: "alimentation-restaurant", kind: "expense", color: "#fb7185", icon: "cart", monthly_budget_cents: null, is_essential: false },
];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function setupFetch(overrides: { budgets?: () => Response; categories?: () => Response } = {}) {
  fetchMock.mockImplementation((input: string, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : String(input), "http://localhost");
    if (url.pathname === "/api/budgets") {
      return Promise.resolve(overrides.budgets ? overrides.budgets() : jsonResponse(report));
    }
    if (url.pathname === "/api/categories") {
      return Promise.resolve(overrides.categories ? overrides.categories() : jsonResponse(categories));
    }
    if (url.pathname.startsWith("/api/categories/") && init?.method === "PATCH") {
      return Promise.resolve(jsonResponse({ ...categories[0], monthly_budget_cents: 25000 }));
    }
    throw new Error(`Unhandled fetch in test: ${url.pathname}`);
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

function renderPage(entry = "/budgets") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <ThemeProvider>
        <BudgetsPage />
      </ThemeProvider>
    </MemoryRouter>,
  );
}

describe("BudgetsPage", () => {
  it("names the month it is showing, in French", async () => {
    setupFetch();
    renderPage();
    expect(await screen.findByText(/janvier 2026/i)).toBeInTheDocument();
  });

  it("renders one bar per budgeted category", async () => {
    setupFetch();
    renderPage();
    await screen.findByText("Courses");
    expect(screen.getAllByRole("progressbar")).toHaveLength(2);
  });

  it("offers the categories that were spent on with no budget set", async () => {
    setupFetch();
    renderPage();
    expect(await screen.findByText("Restaurants")).toBeInTheDocument();
    expect(screen.getByLabelText(/Budget mensuel pour Restaurants/)).toBeInTheDocument();
  });

  it("sends a budget typed in euros as integer cents", async () => {
    setupFetch();
    renderPage();
    const input = await screen.findByLabelText(/Budget mensuel pour Restaurants/);
    await userEvent.clear(input);
    await userEvent.type(input, "250,50");
    await userEvent.click(screen.getByRole("button", { name: /Enregistrer le budget de Restaurants/ }));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
      expect(patch).toBeDefined();
      expect(JSON.parse(patch![1].body as string)).toEqual({ monthly_budget_cents: 25050 });
    });
  });

  it("refuses an unreadable amount instead of sending a zero", async () => {
    setupFetch();
    renderPage();
    const input = await screen.findByLabelText(/Budget mensuel pour Restaurants/);
    await userEvent.type(input, "abc");
    await userEvent.click(screen.getByRole("button", { name: /Enregistrer le budget de Restaurants/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Montant invalide/);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
  });

  it("diagnoses an empty month rather than showing a blank grid", async () => {
    setupFetch({ budgets: () => jsonResponse(emptyReport) });
    renderPage();
    expect(await screen.findByText(/Aucun budget défini/)).toBeInTheDocument();
  });

  it("moves to the previous month without losing the rest of the screen", async () => {
    setupFetch();
    renderPage();
    await screen.findByText("Courses");
    await userEvent.click(screen.getByRole("button", { name: /Mois précédent/ }));

    await waitFor(() => {
      const asked = fetchMock.mock.calls
        .map(([input]) => new URL(String(input), "http://localhost"))
        .filter((url) => url.pathname === "/api/budgets")
        .map((url) => url.searchParams.get("month"));
      expect(asked).toContain("2025-12");
    });
  });

  // The month the header names, and the month the arrows step from, is the one
  // that was *asked for* -- not the one currently loaded. Reading it off the
  // loaded report meant a second click before the first response landed
  // recomputed from the stale month and asked for the same one twice: the
  // screen simply stopped going back. Seen in a browser, where the header also
  // sat on the old month for the whole of the load.
  it("steps back twice in a row without asking for the same month again", async () => {
    setupFetch();
    renderPage();
    await screen.findByText("Courses");

    const previous = screen.getByRole("button", { name: /Mois précédent/ });
    await userEvent.click(previous);
    await userEvent.click(previous);

    await waitFor(() => {
      const asked = fetchMock.mock.calls
        .map(([input]) => new URL(String(input), "http://localhost"))
        .filter((url) => url.pathname === "/api/budgets")
        .map((url) => url.searchParams.get("month"));
      expect(asked).toContain("2025-11");
    });
  });

  it("names the requested month on the first paint, before any response", async () => {
    setupFetch();
    renderPage("/budgets?mois=2025-09");
    // No report has landed yet, so the header has only the URL to go on — and
    // it must still say which month is coming rather than showing nothing.
    expect(screen.getByText(/septembre 2025/i)).toBeInTheDocument();
    await screen.findByText("Courses");
  });

  it("surfaces a failed load in French instead of an empty screen", async () => {
    setupFetch({ budgets: () => jsonResponse({ detail: "Base indisponible" }, 500) });
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Base indisponible");
  });
});

describe("monthLabel / shiftMonth", () => {
  it("names a month in French from the API's key", () => {
    expect(monthLabel("2026-01")).toBe("janvier 2026");
  });

  it("steps back across a year boundary", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });

  it("steps forward across a year boundary", () => {
    expect(shiftMonth("2025-12", 1)).toBe("2026-01");
  });
});
