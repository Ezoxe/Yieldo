import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TransactionsPage } from "./TransactionsPage";

const fetchMock = vi.fn();

const account = {
  id: 1, name: "Compte courant", kind: "checking", currency: "EUR",
  opening_balance_cents: 0, opened_on: null, include_in_net_worth: true, archived: false,
};

const categories = [
  { id: 1, parent_id: null, name: "Alimentation", slug: "alimentation",
    kind: "expense", color: "#4fd6a8", icon: "cart", monthly_budget_cents: null },
  { id: 2, parent_id: 1, name: "Courses", slug: "alimentation-courses",
    kind: "expense", color: "#4fd6a8", icon: "cart", monthly_budget_cents: null },
  { id: 3, parent_id: null, name: "Logement", slug: "logement",
    kind: "expense", color: "#7ee2d6", icon: "home", monthly_budget_cents: null },
];

const txCarrefour = {
  id: 10, account_id: 1, date: "2025-03-01", value_date: null, amount_cents: -4732,
  label_raw: "CARREFOUR MARKET CB 01/03", label_clean: "carrefour market",
  category_id: 2, category_source: "builtin", is_transfer: false,
  is_recurring: false, notes: null, tags: [],
};

const txSalaire = {
  id: 11, account_id: 1, date: "2025-03-02", value_date: null, amount_cents: 250000,
  label_raw: "VIR SALAIRE MARS", label_clean: "vir salaire mars",
  category_id: null, category_source: "uncategorized", is_transfer: false,
  is_recurring: false, notes: null, tags: [],
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface FetchOverrides {
  accounts?: () => Response;
  categories?: () => Response;
  transactions?: (offset: number) => Response;
  patch?: (id: number, body: Record<string, unknown>) => Response;
}

function setupFetch(overrides: FetchOverrides = {}) {
  fetchMock.mockImplementation((input: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const url = new URL(typeof input === "string" ? input : String(input), "http://localhost");
    const path = url.pathname;

    if (path === "/api/accounts") {
      return Promise.resolve(overrides.accounts ? overrides.accounts() : jsonResponse([account]));
    }
    if (path === "/api/categories") {
      return Promise.resolve(overrides.categories ? overrides.categories() : jsonResponse(categories));
    }
    if (path === "/api/transactions" && method === "GET") {
      const offset = Number(url.searchParams.get("offset") ?? "0");
      return Promise.resolve(
        overrides.transactions
          ? overrides.transactions(offset)
          : jsonResponse({ items: [txCarrefour, txSalaire], total: 2, limit: 50, offset }),
      );
    }
    const patchMatch = /\/api\/transactions\/(\d+)$/.exec(path);
    if (patchMatch && method === "PATCH") {
      const id = Number(patchMatch[1]);
      const body = init?.body ? JSON.parse(init.body as string) : {};
      return Promise.resolve(overrides.patch ? overrides.patch(id, body) : jsonResponse({ ...txCarrefour, id, category_id: body.category_id, category_source: "manual", learned_rule_id: null, backfilled: 0 }));
    }
    throw new Error(`Unhandled fetch in test: ${method} ${path}`);
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/transactions"]}>
      <TransactionsPage />
    </MemoryRouter>,
  );
}

describe("TransactionsPage", () => {
  it("loads and displays fetched transactions with their raw label", async () => {
    setupFetch();
    renderPage();

    expect(await screen.findByText("CARREFOUR MARKET CB 01/03")).toBeInTheDocument();
    expect(screen.getByText("VIR SALAIRE MARS")).toBeInTheDocument();
  });

  it("surfaces the backend's message when the transaction list fails to load", async () => {
    setupFetch({ transactions: () => jsonResponse({ detail: "Erreur serveur inattendue." }, 500) });
    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Erreur serveur inattendue.");
  });

  it("surfaces the backend's message when reference data fails to load", async () => {
    setupFetch({ accounts: () => jsonResponse({ detail: "Comptes indisponibles." }, 500) });
    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Comptes indisponibles.");
  });

  it("shows an inviting empty state with no silent blank screen", async () => {
    setupFetch({ transactions: () => jsonResponse({ items: [], total: 0, limit: 50, offset: 0 }) });
    renderPage();

    expect(await screen.findByText("Aucune transaction ne correspond à ces filtres.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Importer un relevé" })).toHaveAttribute("href", "/import");
  });

  it("recategorizes without a banner when nothing else was backfilled", async () => {
    setupFetch({
      patch: (id, body) =>
        jsonResponse({ ...txCarrefour, id, category_id: body.category_id, category_source: "manual", learned_rule_id: null, backfilled: 0 }),
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("CARREFOUR MARKET CB 01/03");

    await user.selectOptions(screen.getAllByLabelText("Catégorie")[0], "3");

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/transactions/10"),
      expect.objectContaining({ method: "PATCH" }),
    ));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("announces the learned rule and lets the user undo just this transaction", async () => {
    setupFetch({
      patch: (id, body) =>
        jsonResponse({ ...txCarrefour, id, category_id: body.category_id, category_source: "manual", learned_rule_id: 99, backfilled: 4 }),
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("CARREFOUR MARKET CB 01/03");

    await user.selectOptions(screen.getAllByLabelText("Catégorie")[0], "3");

    const banner = await screen.findByRole("status");
    expect(banner).toHaveTextContent("Règle apprise — 4 autres transactions similaires ont été reclassées.");
    const undoButton = within(banner).getByRole("button", { name: "Annuler" });

    fetchMock.mockClear();
    setupFetch({
      patch: (id, body) =>
        jsonResponse({ ...txCarrefour, id, category_id: body.category_id, category_source: "manual", learned_rule_id: null, backfilled: 0 }),
    });
    await user.click(undoButton);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/transactions/10"),
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ category_id: 2 }) }),
    ));
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  });

  it("explains that undo is unavailable when the transaction had no prior category", async () => {
    setupFetch({
      patch: (id, body) =>
        jsonResponse({ ...txSalaire, id, category_id: body.category_id, category_source: "manual", learned_rule_id: 5, backfilled: 2 }),
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("VIR SALAIRE MARS");

    await user.selectOptions(screen.getAllByLabelText("Catégorie")[1], "1");

    const banner = await screen.findByRole("status");
    expect(banner).toHaveTextContent("Règle apprise — 2 autres transactions similaires ont été reclassées.");
    expect(within(banner).queryByRole("button", { name: "Annuler" })).not.toBeInTheDocument();
    expect(banner).toHaveTextContent("n'avait pas de catégorie avant");
  });

  it("surfaces a failed recategorization instead of failing silently", async () => {
    setupFetch({ patch: () => jsonResponse({ detail: "Catégorie introuvable" }, 404) });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("CARREFOUR MARKET CB 01/03");

    await user.selectOptions(screen.getAllByLabelText("Catégorie")[0], "3");

    expect(await screen.findByRole("alert")).toHaveTextContent("Catégorie introuvable");
  });

  it("loads more transactions on demand, appending to what is already shown", async () => {
    const thirdTx = { ...txCarrefour, id: 12, label_raw: "EDF ELECTRICITE" };
    setupFetch({
      transactions: (offset) =>
        offset === 0
          ? jsonResponse({ items: [txCarrefour, txSalaire], total: 3, limit: 50, offset: 0 })
          : jsonResponse({ items: [thirdTx], total: 3, limit: 50, offset }),
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("CARREFOUR MARKET CB 01/03");

    expect(screen.getByText("2 sur 3 transactions")).toBeInTheDocument();
    const loadMoreButton = screen.getByRole("button", { name: "Charger plus" });

    await user.click(loadMoreButton);

    expect(await screen.findByText("EDF ELECTRICITE")).toBeInTheDocument();
    expect(screen.getByText("3 sur 3 transactions")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Charger plus" })).not.toBeInTheDocument();
  });

  it("shows the uncategorized count once the toggle is switched on", async () => {
    setupFetch({
      transactions: () => jsonResponse({ items: [txSalaire], total: 1, limit: 50, offset: 0 }),
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("VIR SALAIRE MARS");

    await user.click(screen.getByRole("switch", { name: /Non catégorisées uniquement/ }));

    await waitFor(() => expect(screen.getByText("(1)")).toBeInTheDocument());
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("uncategorized_only=true"),
        expect.anything(),
      ),
    );
  });
});
