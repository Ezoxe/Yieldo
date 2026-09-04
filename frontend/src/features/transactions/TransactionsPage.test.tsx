import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { activeFilterLabels, filteredEmptyDetail, TransactionsPage } from "./TransactionsPage";

describe("activeFilterLabels", () => {
  const none = { search: "", accountName: null, categoryName: null, uncategorizedOnly: false };

  it("names nothing when nothing is filtering", () => {
    expect(activeFilterLabels(none)).toEqual([]);
  });

  it("names each filter the way the reader set it", () => {
    expect(
      activeFilterLabels({
        search: "netflix",
        accountName: "Compte courant",
        categoryName: "Alimentation",
        uncategorizedOnly: true,
      }),
    ).toEqual([
      "la recherche « netflix »",
      "la catégorie « Alimentation »",
      "le compte « Compte courant »",
      "« Non catégorisées uniquement »",
    ]);
  });
});

describe("filteredEmptyDetail", () => {
  it("states what the period holds even when no filter can be named", () => {
    expect(filteredEmptyDetail(4, [])).toBe("Cette période contient 4 transactions.");
  });

  it("agrees in number, on both the count and the filter list", () => {
    expect(filteredEmptyDetail(1, ["la recherche « x »"])).toBe(
      "Cette période contient 1 transaction. Filtre actif : la recherche « x ».",
    );
    expect(filteredEmptyDetail(197, ["la recherche « x »", "le compte « y »"])).toBe(
      "Cette période contient 197 transactions. Filtres actifs : la recherche « x », le compte « y ».",
    );
  });
});

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

// The operator's own ledger: 197 transactions, none of them inside whatever
// window the screen happens to be showing.
const history = { date_from: "2025-01-24", date_to: "2026-01-09", transaction_count: 197 };

function emptyPage(span: typeof history | null, periodTotal: number) {
  return { items: [], total: 0, limit: 50, offset: 0, period_total: periodTotal, history: span };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface FetchOverrides {
  accounts?: () => Response;
  categories?: () => Response;
  transactions?: (offset: number, url: URL) => Response;
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
          ? overrides.transactions(offset, url)
          : jsonResponse({
              items: [txCarrefour, txSalaire], total: 2, limit: 50, offset,
              period_total: 2, history,
            }),
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

describe("TransactionsPage — the grid", () => {
  /** Columns spanned at lg, times rows spanned: the cell's area on the grid. */
  function areaOf(cell: HTMLElement): number {
    return (
      Number(cell.style.getPropertyValue("--yd-cell-span-lg")) *
      Number(cell.style.getPropertyValue("--yd-cell-rows"))
    );
  }

  it("gives the list strictly the largest cell — it is the screen's reason to exist", async () => {
    setupFetch();
    const { container } = renderPage();
    await screen.findByText("CARREFOUR MARKET CB 01/03");

    const list = container.querySelector<HTMLElement>(".yd-transactions__list");
    expect(list, "no list cell on the transactions grid").not.toBeNull();
    expect(list).toHaveClass("yd-bento__cell");

    // Strictly larger than every sibling: a tie is how the dashboard's hero
    // silently stopped being its biggest cell in task 3. jsdom has no layout,
    // so this compares declared areas; the rendered claim is measured in a
    // browser and recorded in task-4-report.md.
    const others = Array.from(container.querySelectorAll<HTMLElement>(".yd-bento__cell")).filter(
      (cell) => cell !== list,
    );
    expect(others.length).toBeGreaterThan(0);
    for (const cell of others) {
      expect(areaOf(list as HTMLElement)).toBeGreaterThan(areaOf(cell));
    }
  });

  // A transaction list is a table: aligned columns, one row per line, scanned
  // down a column rather than read card by card.
  it("keeps the rows in a table with named columns", async () => {
    setupFetch();
    renderPage();
    await screen.findByText("CARREFOUR MARKET CB 01/03");

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Date",
      "Libellé",
      "Catégorie",
      "Montant",
    ]);
  });

  // A statement is read day by day. The headings are real table structure —
  // `<th scope="rowgroup">` — so a screen reader announces them as heading the
  // rows beneath rather than as another column.
  it("cuts the rows into days, and says how many each holds", async () => {
    setupFetch();
    renderPage();
    await screen.findByText("CARREFOUR MARKET CB 01/03");

    const headings = screen.getAllByRole("rowheader").map((th) => th.textContent);
    expect(headings.length).toBeGreaterThan(0);
    expect(headings[0]).toMatch(/^\d{2} \w+ \d{4} · \d+ OPÉRATIONS?$/);
  });
});

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

  // Three ways a list comes back empty, and the reader is owed a different
  // sentence for each: nothing imported, nothing in this period, nothing
  // matching the filters.

  it("offers the import when the user has no transactions at all", async () => {
    setupFetch({ transactions: () => jsonResponse(emptyPage(null, 0)) });
    renderPage();

    expect(await screen.findByText(/Aucune donnée/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Importer un relevé" })).toHaveAttribute("href", "/import");
  });

  it("says where the data is, and widens to it, when only the period is empty", async () => {
    setupFetch({ transactions: () => jsonResponse(emptyPage(history, 0)) });
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText(/Aucune transaction sur cette période/i)).toBeInTheDocument();
    expect(screen.getByText(/197 opérations/)).toHaveTextContent("24 janvier 2025");

    await user.click(screen.getByRole("button", { name: /Afficher toute la période/i }));

    await waitFor(() => {
      const asked = fetchMock.mock.calls
        .map(([input]) => String(input))
        .filter((url) => url.startsWith("/api/transactions?"));
      expect(asked[asked.length - 1]).toContain("date_from=2025-01-24");
      expect(asked[asked.length - 1]).toContain("date_to=2026-01-09");
    });
  });

  it("names the filter that is hiding the period's transactions, and clears it", async () => {
    setupFetch({
      transactions: (offset, url) =>
        url.searchParams.get("search")
          ? jsonResponse(emptyPage(history, 4))
          : jsonResponse({
              items: [txCarrefour, txSalaire], total: 2, limit: 50, offset,
              period_total: 4, history,
            }),
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("CARREFOUR MARKET CB 01/03");

    await user.type(screen.getByRole("searchbox"), "introuvable");
    await screen.findByText(/Aucune transaction ne correspond à ces filtres/i);
    expect(screen.getByText(/introuvable/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Effacer les filtres/i }));

    expect(await screen.findByText("CARREFOUR MARKET CB 01/03")).toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toHaveValue("");
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

  it("sends null when Non catégorisé is chosen and the row shows as uncategorized", async () => {
    setupFetch({
      patch: (id, body) =>
        jsonResponse({ ...txCarrefour, id, category_id: body.category_id, category_source: "uncategorized", learned_rule_id: null, backfilled: 0 }),
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("CARREFOUR MARKET CB 01/03");

    const select = screen.getAllByLabelText("Catégorie")[0] as HTMLSelectElement;
    await user.selectOptions(select, "");

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/transactions/10"),
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ category_id: null }) }),
    ));
    await waitFor(() => expect(select.value).toBe(""));
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

  // Reachable as soon as the learned rule matched exactly one other row, which
  // is the common case on a small ledger. The hint under Annuler used to read
  // "les 1 transactions reclassées automatiquement".
  it("agrees in number when the rule reclassified a single other transaction", async () => {
    setupFetch({
      patch: (id, body) =>
        jsonResponse({ ...txCarrefour, id, category_id: body.category_id, category_source: "manual", learned_rule_id: 99, backfilled: 1 }),
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("CARREFOUR MARKET CB 01/03");

    await user.selectOptions(screen.getAllByLabelText("Catégorie")[0], "3");

    const banner = await screen.findByRole("status");
    expect(banner).toHaveTextContent("Règle apprise — 1 autre transaction similaire a été reclassée.");
    expect(banner).toHaveTextContent(
      "la transaction reclassée automatiquement ne peut pas être annulée individuellement",
    );
    expect(banner.textContent).not.toMatch(/1 transactions/);
  });

  it("reports the undo's own backfill instead of silently discarding it", async () => {
    setupFetch({
      patch: (id, body) =>
        jsonResponse({ ...txCarrefour, id, category_id: body.category_id, category_source: "manual", learned_rule_id: 99, backfilled: 4 }),
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("CARREFOUR MARKET CB 01/03");

    await user.selectOptions(screen.getAllByLabelText("Catégorie")[0], "3");
    const correctionBanner = await screen.findByRole("status");
    const undoButton = within(correctionBanner).getByRole("button", { name: "Annuler" });

    // The undo is itself a category change, so the backend can run its own
    // learn-and-backfill on it (see patch_transaction in
    // backend/app/api/transactions.py) -- distinct from the 4 backfilled by
    // the original correction above.
    fetchMock.mockClear();
    setupFetch({
      patch: (id, body) =>
        jsonResponse({ ...txCarrefour, id, category_id: body.category_id, category_source: "manual", learned_rule_id: 77, backfilled: 3 }),
    });
    await user.click(undoButton);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/transactions/10"),
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ category_id: 2 }) }),
    ));

    const undoBanner = await screen.findByRole("status");
    expect(undoBanner).toHaveTextContent("3 autres transactions similaires");
    // Informational only -- chaining into another Annuler risks an endless
    // learn/backfill ping-pong on the same rule (see the module doc comment
    // in TransactionsPage.tsx).
    expect(within(undoBanner).queryByRole("button", { name: "Annuler" })).not.toBeInTheDocument();
  });

  it("clears the notice once the undo itself has nothing further to report", async () => {
    setupFetch({
      patch: (id, body) =>
        jsonResponse({ ...txCarrefour, id, category_id: body.category_id, category_source: "manual", learned_rule_id: 99, backfilled: 4 }),
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("CARREFOUR MARKET CB 01/03");

    await user.selectOptions(screen.getAllByLabelText("Catégorie")[0], "3");
    const correctionBanner = await screen.findByRole("status");
    const undoButton = within(correctionBanner).getByRole("button", { name: "Annuler" });

    fetchMock.mockClear();
    setupFetch({
      patch: (id, body) =>
        jsonResponse({ ...txCarrefour, id, category_id: body.category_id, category_source: "manual", learned_rule_id: null, backfilled: 0 }),
    });
    await user.click(undoButton);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/transactions/10"),
      expect.objectContaining({ method: "PATCH" }),
    ));
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  });

  it("surfaces a failed undo instead of failing silently", async () => {
    setupFetch({
      patch: (id, body) =>
        jsonResponse({ ...txCarrefour, id, category_id: body.category_id, category_source: "manual", learned_rule_id: 99, backfilled: 4 }),
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("CARREFOUR MARKET CB 01/03");

    await user.selectOptions(screen.getAllByLabelText("Catégorie")[0], "3");
    const correctionBanner = await screen.findByRole("status");
    const undoButton = within(correctionBanner).getByRole("button", { name: "Annuler" });

    fetchMock.mockClear();
    setupFetch({ patch: () => jsonResponse({ detail: "Impossible d'annuler cette modification." }, 409) });
    await user.click(undoButton);

    expect(await screen.findByRole("alert")).toHaveTextContent("Impossible d'annuler cette modification.");
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
