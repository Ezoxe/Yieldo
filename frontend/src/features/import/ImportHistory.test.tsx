import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ImportHistory } from "./ImportHistory";

const fetchMock = vi.fn();

const batches = [
  {
    id: 7,
    account_id: 1,
    filename: "releve-janvier.csv",
    rows_total: 198,
    rows_imported: 197,
    rows_duplicate: 1,
    rows_failed: 0,
    created_at: "2026-08-12T08:29:22Z",
  },
  {
    id: 3,
    account_id: 1,
    filename: "releve-decembre.csv",
    rows_total: 42,
    rows_imported: 40,
    rows_duplicate: 0,
    rows_failed: 2,
    created_at: "2026-01-04T11:02:00Z",
  },
];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface Overrides {
  list?: () => Response;
  remove?: () => Response;
}

function setupFetch(overrides: Overrides = {}) {
  fetchMock.mockImplementation((input: string, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    const method = init?.method ?? "GET";

    if (url === "/api/imports" && method === "GET") {
      return Promise.resolve(overrides.list ? overrides.list() : jsonResponse(batches));
    }
    if (/^\/api\/imports\/\d+$/.test(url) && method === "DELETE") {
      return Promise.resolve(overrides.remove ? overrides.remove() : jsonResponse({ removed: 197 }));
    }
    throw new Error(`Unhandled fetch in test: ${method} ${url}`);
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("ImportHistory", () => {
  it("lists past batches, most recent first, with their four counts", async () => {
    setupFetch();
    render(<ImportHistory />);

    const items = await screen.findAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("releve-janvier.csv");
    expect(items[1]).toHaveTextContent("releve-decembre.csv");

    expect(items[0]).toHaveTextContent("198");
    expect(items[0]).toHaveTextContent("197");
    expect(items[0]).toHaveTextContent("1");
    expect(items[0]).toHaveTextContent("0");
  });

  it("says so plainly when nothing has been imported yet", async () => {
    setupFetch({ list: () => jsonResponse([]) });
    render(<ImportHistory />);

    expect(await screen.findByText(/Aucun import/i)).toBeInTheDocument();
  });

  it("never rolls back on a single click: it asks first, naming the cost", async () => {
    setupFetch();
    const user = userEvent.setup();
    render(<ImportHistory />);
    await screen.findByText("releve-janvier.csv");

    await user.click(screen.getAllByRole("button", { name: /Supprimer cet import/i })[0]);

    const confirmation = await screen.findByRole("alert");
    expect(confirmation).toHaveTextContent("197");
    expect(confirmation).toHaveTextContent(/irréversible/i);
    // Asking is not doing.
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/imports/7",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("backs out of the confirmation without deleting anything", async () => {
    setupFetch();
    const user = userEvent.setup();
    render(<ImportHistory />);
    await screen.findByText("releve-janvier.csv");

    await user.click(screen.getAllByRole("button", { name: /Supprimer cet import/i })[0]);
    await user.click(await screen.findByRole("button", { name: "Annuler" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/imports/7",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("rolls back once confirmed, reports what was removed and refreshes the list", async () => {
    let listed = batches;
    setupFetch({
      list: () => jsonResponse(listed),
      remove: () => {
        listed = batches.slice(1);
        return jsonResponse({ removed: 197 });
      },
    });
    const user = userEvent.setup();
    render(<ImportHistory />);
    await screen.findByText("releve-janvier.csv");

    await user.click(screen.getAllByRole("button", { name: /Supprimer cet import/i })[0]);
    await user.click(await screen.findByRole("button", { name: /Supprimer définitivement/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/imports/7",
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
    // The count reported is the one the server actually removed.
    expect(await screen.findByRole("status")).toHaveTextContent("197");
    await waitFor(() => expect(screen.queryByText("releve-janvier.csv")).not.toBeInTheDocument());
  });

  it("surfaces the backend's own message when a rollback fails", async () => {
    setupFetch({ remove: () => jsonResponse({ detail: "Lot d'import introuvable" }, 404) });
    const user = userEvent.setup();
    render(<ImportHistory />);
    await screen.findByText("releve-janvier.csv");

    await user.click(screen.getAllByRole("button", { name: /Supprimer cet import/i })[0]);
    await user.click(await screen.findByRole("button", { name: /Supprimer définitivement/i }));

    expect(await screen.findByText("Lot d'import introuvable")).toBeInTheDocument();
    // The batch is still on screen: nothing was removed.
    expect(screen.getByText("releve-janvier.csv")).toBeInTheDocument();
  });

  it("surfaces the backend's own message when the list itself fails to load", async () => {
    setupFetch({ list: () => jsonResponse({ detail: "Historique indisponible." }, 500) });
    render(<ImportHistory />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Historique indisponible.");
  });
});
