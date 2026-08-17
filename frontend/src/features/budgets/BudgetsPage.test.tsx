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
    { category_id: 4, name: "Énergie", color: "#3b82f6", spent_cents: -9000 },
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

function setupFetch(
  overrides: {
    budgets?: () => Response | Promise<Response>;
    categories?: () => Response;
    patch?: () => Response;
  } = {},
) {
  fetchMock.mockImplementation((input: string, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : String(input), "http://localhost");
    if (url.pathname === "/api/budgets") {
      return Promise.resolve(overrides.budgets ? overrides.budgets() : jsonResponse(report));
    }
    if (url.pathname === "/api/categories") {
      return Promise.resolve(overrides.categories ? overrides.categories() : jsonResponse(categories));
    }
    if (url.pathname.startsWith("/api/categories/") && init?.method === "PATCH") {
      return Promise.resolve(
        overrides.patch
          ? overrides.patch()
          : jsonResponse({ ...categories[0], monthly_budget_cents: 25000 }),
      );
    }
    throw new Error(`Unhandled fetch in test: ${url.pathname}`);
  });
}

function budgetMonthsAsked(): (string | null)[] {
  return fetchMock.mock.calls
    .map(([input]) => new URL(String(input), "http://localhost"))
    .filter((url) => url.pathname === "/api/budgets")
    .map((url) => url.searchParams.get("month"));
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

  // At 375 the cells stack, so a page-level alert for a field-level failure
  // appears several screens above the field: the operator clicks "Définir",
  // sees the button re-enable, and nothing else changes.
  it("states an unreadable amount at the field that caused it", async () => {
    setupFetch();
    renderPage();
    const input = await screen.findByLabelText(/Budget mensuel pour Restaurants/);
    await userEvent.type(input, "abc");
    await userEvent.click(screen.getByRole("button", { name: /Enregistrer le budget de Restaurants/ }));

    const alert = await screen.findByRole("alert");
    expect(input.closest("li")).toContainElement(alert);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(/Montant invalide/);
  });

  it("states a rejected save at the field too, verbatim from the backend", async () => {
    setupFetch({ patch: () => jsonResponse({ detail: "Budget mensuel trop élevé." }, 422) });
    renderPage();
    const input = await screen.findByLabelText(/Budget mensuel pour Restaurants/);
    await userEvent.type(input, "150");
    await userEvent.click(screen.getByRole("button", { name: /Enregistrer le budget de Restaurants/ }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Budget mensuel trop élevé.");
    expect(input.closest("li")).toContainElement(alert);
  });

  // A save re-asks for the month already on screen. Blanking the grid for it
  // unmounts every other BudgetInput and throws away what has been typed into
  // them -- and this is the screen's core repeated interaction.
  it("keeps what is typed in the other fields when one budget is saved", async () => {
    setupFetch();
    renderPage();
    const restaurants = await screen.findByLabelText(/Budget mensuel pour Restaurants/);
    await userEvent.type(restaurants, "150");
    await userEvent.type(screen.getByLabelText(/Budget mensuel pour Énergie/), "120");
    await userEvent.click(screen.getByRole("button", { name: /Enregistrer le budget de Restaurants/ }));

    await waitFor(() => expect(budgetMonthsAsked()).toHaveLength(2));
    expect(screen.getByLabelText(/Budget mensuel pour Énergie/)).toHaveValue("120");
  });

  it("does not blank the grid to skeletons while a save reloads", async () => {
    let release: (response: Response) => void = () => {};
    let call = 0;
    setupFetch({
      budgets: () => {
        call += 1;
        if (call === 1) return jsonResponse(report);
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      },
    });
    renderPage();
    await screen.findByText("Courses");
    await userEvent.type(await screen.findByLabelText(/Budget mensuel pour Restaurants/), "150");
    await userEvent.click(screen.getByRole("button", { name: /Enregistrer le budget de Restaurants/ }));

    // The reload is held open here: with the skeleton branch taken, "Courses"
    // and every input would be gone from the document by now.
    await waitFor(() => expect(budgetMonthsAsked()).toHaveLength(2));
    expect(screen.getByText("Courses")).toBeInTheDocument();
    expect(screen.getByLabelText(/Budget mensuel pour Énergie/)).toBeInTheDocument();

    release(jsonResponse(report));
    await waitFor(() => expect(screen.getByText("Courses")).toBeInTheDocument());
  });

  // The other half of the same rule: a month change *is* a navigation, and the
  // skeleton is how the screen says the figures on it are about to be replaced.
  it("still shows the skeleton on a month change", async () => {
    let release: (response: Response) => void = () => {};
    let call = 0;
    setupFetch({
      budgets: () => {
        call += 1;
        if (call === 1) return jsonResponse(report);
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      },
    });
    renderPage();
    await screen.findByText("Courses");
    await userEvent.click(screen.getByRole("button", { name: /Mois précédent/ }));

    const loading = await screen.findByRole("status");
    expect(loading).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText("Courses")).not.toBeInTheDocument();

    release(jsonResponse(report));
    await screen.findByText("Courses");
  });

  // `SPAN.unbudgeted` is `{ base: 1, md: 6 }`: the "Sans budget" cell is only
  // to the right of this one from 1200px up. Two of the three required widths
  // stack it underneath, where "à droite" sends the reader the wrong way.
  it("points at the other panel by name rather than by a position it only has at 1200px", async () => {
    setupFetch({
      budgets: () => jsonResponse({ ...report, lines: [], total_budget_cents: 0 }),
    });
    renderPage();
    const none = await screen.findByText(/Aucun budget défini\./);
    expect(none).toHaveTextContent(/Sans budget/);
    expect(none).not.toHaveTextContent(/à droite/);
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

    await waitFor(() => expect(budgetMonthsAsked()).toContain("2025-12"));
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

    await waitFor(() => expect(budgetMonthsAsked()).toContain("2025-11"));
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
