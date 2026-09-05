import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Category, PlanLine, PlanPreview } from "../../lib/types";
import { LedgerModeControl } from "./LedgerModeControl";
import { PlanPage } from "./PlanPage";
import { useLedgerMode } from "./useLedgerMode";

const categories: Category[] = [
  { id: 1, parent_id: null, name: "Logement", slug: "logement", kind: "expense",
    color: "#4fd6a8", icon: "home", monthly_budget_cents: null, is_essential: true },
  { id: 2, parent_id: null, name: "Alimentation", slug: "alimentation", kind: "expense",
    color: "#7ee2d6", icon: "cart", monthly_budget_cents: null, is_essential: true },
];

const rentLine: PlanLine = {
  id: 1, label: "Loyer", amount_cents: -92000, kind: "fixed", category_id: 1,
  account_id: null, periodicity: "monthly", day_of_month: 5, start_on: "2026-01-01",
  end_on: null, match_label: "LOYER", active: true, origin: "manual", notes: null,
};

const preview: PlanPreview = {
  date_from: "2026-08-01",
  date_to: "2026-08-31",
  planned: [
    { line_id: 1, on: "2026-08-05", amount_cents: -92000, label: "Loyer",
      category_id: 1, account_id: null },
  ],
  remaining: [],
  planned_total_cents: -92000,
  remaining_total_cents: 0,
};

const fetchMock = vi.fn();

function jsonOf(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

function routeFetch(overrides: Record<string, unknown> = {}) {
  const table: Record<string, unknown> = {
    "/api/plan": [rentLine],
    "/api/categories": categories,
    "/api/plan/preview": preview,
    "/api/plan/mode": { mode: "real" },
    ...overrides,
  };
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "POST" && url.pathname === "/api/plan") {
      return jsonOf({ ...rentLine, id: 99, label: "Forfait" });
    }
    if (method === "POST" && url.pathname === "/api/plan/from-recurrences") {
      return jsonOf({ created: [], skipped: 0 });
    }
    if (method === "PUT" && url.pathname === "/api/plan/mode") {
      const body = JSON.parse(String(init?.body));
      return jsonOf({ mode: body.mode });
    }
    if (method === "DELETE") return { ok: true, status: 204, json: async () => undefined };
    if (method === "PATCH") return jsonOf({ ...rentLine, active: false });
    const key = url.pathname;
    if (key in table) return jsonOf(table[key]);
    return { ok: false, status: 404, clone: () => ({ json: async () => ({ detail: "?" }) }),
             json: async () => ({ detail: "?" }) };
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  useLedgerMode.setState({ mode: "real", loaded: true });
});

function renderPage() {
  render(
    <MemoryRouter>
      <PlanPage />
    </MemoryRouter>,
  );
}

describe("PlanPage", () => {
  it("says in its lead that nothing here touches the ledger", async () => {
    routeFetch();
    renderPage();

    expect(await screen.findByText(/vos relevés ne sont jamais modifiés/i)).toBeInTheDocument();
  });

  it("lists the declared lines with what each one is", async () => {
    routeFetch();
    renderPage();

    expect(await screen.findByText("Loyer")).toBeInTheDocument();
    expect(screen.getByText(/Montant connu · Chaque mois · le 5 · Logement/)).toBeInTheDocument();
  });

  it("diagnoses an empty plan rather than showing a blank panel", async () => {
    routeFetch({ "/api/plan": [] });
    renderPage();

    expect(await screen.findByText("Aucune ligne déclarée")).toBeInTheDocument();
    expect(screen.getByText(/ne changent rien pour l'instant/)).toBeInTheDocument();
  });

  // Spending is negative on the wire; the form asks for a positive amount and
  // a direction, exactly as the hand-entry form does.
  it("sends a declared expense as a negative amount", async () => {
    routeFetch();
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Loyer");

    await user.type(screen.getByLabelText("Libellé"), "Forfait mobile");
    await user.type(screen.getByLabelText("Montant (€)"), "19,99");
    await user.click(screen.getByRole("button", { name: "Ajouter au plan" }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === "POST",
      );
      expect(post).toBeDefined();
      expect(JSON.parse(String((post![1] as RequestInit).body))).toMatchObject({
        label: "Forfait mobile",
        amount_cents: -1999,
        kind: "fixed",
      });
    });
  });

  it("refuses an envelope with no category, and says what an envelope needs", async () => {
    routeFetch();
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Loyer");

    await user.click(screen.getByRole("radio", { name: "Enveloppe" }));
    await user.type(screen.getByLabelText("Libellé"), "Courses");
    await user.type(screen.getByLabelText("Montant (€)"), "400");
    await user.click(screen.getByRole("button", { name: "Ajouter au plan" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/catégorie/i);
  });

  // An envelope is monthly by definition, so the rhythm question disappears
  // rather than offering a choice the backend would refuse.
  it("hides the rhythm and the match label for an envelope", async () => {
    routeFetch();
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Loyer");

    expect(screen.getByLabelText("Rythme")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Enveloppe" }));

    expect(screen.queryByLabelText("Rythme")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Reconnue sur le relevé par/)).not.toBeInTheDocument();
  });

  it("suspends a line rather than only offering to delete it", async () => {
    routeFetch();
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Loyer");

    await user.click(screen.getByRole("button", { name: "Suspendre" }));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === "PATCH",
      );
      expect(patch).toBeDefined();
      expect(JSON.parse(String((patch![1] as RequestInit).body))).toEqual({ active: false });
    });
  });

  it("says plainly when there is no confirmed subscription to take over", async () => {
    routeFetch();
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Loyer");

    await user.click(screen.getByRole("button", { name: /Reprendre mes abonnements/ }));

    expect(await screen.findByRole("status")).toHaveTextContent(/Aucun abonnement confirmé/);
  });

  it("names the total that « Réel complété » would actually add", async () => {
    routeFetch({
      "/api/plan/preview": { ...preview, remaining: preview.planned, remaining_total_cents: -92000 },
    });
    renderPage();

    const panel = await screen.findByText("Ce qui n'est pas encore passé", { exact: false })
      .catch(() => null);
    // The label above the second total names the mode, so the reader is never
    // left guessing which of the three figures they are looking at.
    expect(panel ?? screen.getByText(/Pas encore sur vos relevés/)).toBeInTheDocument();
    expect(screen.getByText(/Exactement ce que « Réel complété » ajoute/)).toBeInTheDocument();
  });
});

describe("LedgerModeControl", () => {
  it("shows the three readings and marks the current one", () => {
    routeFetch();
    render(<LedgerModeControl />);

    const group = screen.getByRole("radiogroup", { name: "Mode de lecture" });
    expect(within(group).getAllByRole("radio").map((node) => node.textContent)).toEqual([
      "Réel", "Estimé", "Réel complété",
    ]);
    expect(within(group).getByRole("radio", { name: "Réel" })).toHaveAttribute(
      "aria-checked", "true");
  });

  it("writes the chosen reading through to the server", async () => {
    routeFetch();
    const user = userEvent.setup();
    render(<LedgerModeControl />);

    await user.click(screen.getByRole("radio", { name: "Réel complété" }));

    await waitFor(() => expect(useLedgerMode.getState().mode).toBe("blended"));
  });

  // Showing the mode a household asked for while the figures are still in the
  // old one would be exactly the lie the control exists to prevent.
  it("stays on the reading the server still holds when the write fails", async () => {
    routeFetch();
    fetchMock.mockImplementation(async () => ({
      ok: false, status: 500,
      clone: () => ({ json: async () => ({ detail: "Indisponible" }) }),
      json: async () => ({ detail: "Indisponible" }),
    }));
    const user = userEvent.setup();
    render(<LedgerModeControl />);

    await user.click(screen.getByRole("radio", { name: "Estimé" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/restent en « Réel »/);
    expect(useLedgerMode.getState().mode).toBe("real");
  });
});
