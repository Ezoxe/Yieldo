import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GlobalSearch } from "./GlobalSearch";

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    clone() {
      return this as unknown as Response;
    },
  } as unknown as Response;
}

const netflix = {
  kind: "transaction", id: 7, label: "PRLV NETFLIX.COM", detail: "Loisirs",
  amount_cents: -1349, date: "2026-03-05", route: "/transactions",
};

function results(groups: { kind: string; label: string; items: unknown[] }[]) {
  return { query: "netflix", groups };
}

const EMPTY_GROUPS = [
  { kind: "transaction", label: "Transactions", items: [] },
  { kind: "account", label: "Comptes", items: [] },
  { kind: "category", label: "Catégories", items: [] },
  { kind: "recurrence", label: "Récurrences", items: [] },
  { kind: "goal", label: "Objectifs", items: [] },
  { kind: "debt", label: "Dettes", items: [] },
];

function Here() {
  return <p>chemin {useLocation().pathname}</p>;
}

function renderSearch() {
  return render(
    <MemoryRouter initialEntries={["/budgets"]}>
      <GlobalSearch />
      <Routes>
        <Route path="*" element={<Here />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /Rechercher/ }));
  return screen.getByRole("searchbox", { name: "Rechercher partout" });
}

describe("GlobalSearch", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse(results(EMPTY_GROUPS)))));
  });

  // The trigger is an icon alone below 900px. Its name is never the drawing.
  it("names itself in words whatever it is showing", () => {
    renderSearch();
    expect(screen.getByRole("button", { name: /Rechercher/ })).toBeInTheDocument();
  });

  it("opens on the keyboard shortcut and closes on Escape", async () => {
    const user = userEvent.setup();
    renderSearch();

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.keyboard("{Control>}k{/Control}");
    expect(screen.getByRole("dialog", { name: "Recherche" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("finds a screen without asking the server", async () => {
    const user = userEvent.setup();
    renderSearch();
    const box = await open(user);

    await user.type(box, "import");

    expect(await screen.findByRole("link", { name: /Import/ })).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/search"),
      expect.anything(),
    );
  });

  it("finds a screen by a word the sidebar does not print", async () => {
    const user = userEvent.setup();
    renderSearch();
    const box = await open(user);

    await user.type(box, "abonnements");

    expect(await screen.findByRole("link", { name: /Récurrences/ })).toBeInTheDocument();
  });

  it("finds data once the typing settles, and shows what it costs", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse(results([
      { kind: "transaction", label: "Transactions", items: [netflix] },
      ...EMPTY_GROUPS.slice(1),
    ])))));
    const user = userEvent.setup();
    renderSearch();
    const box = await open(user);

    await user.type(box, "netflix");

    expect(await screen.findByText("PRLV NETFLIX.COM")).toBeInTheDocument();
    expect(screen.getByText(/13,49/)).toBeInTheDocument();
  });

  it("goes where a result points, and closes behind it", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse(results([
      { kind: "transaction", label: "Transactions", items: [netflix] },
      ...EMPTY_GROUPS.slice(1),
    ])))));
    const user = userEvent.setup();
    renderSearch();
    const box = await open(user);
    await user.type(box, "netflix");

    await user.click(await screen.findByRole("link", { name: /PRLV NETFLIX.COM/ }));

    await waitFor(() =>
      expect(screen.getByText("chemin /transactions")).toBeInTheDocument());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("says what it looked for when it found nothing", async () => {
    const user = userEvent.setup();
    renderSearch();
    const box = await open(user);

    await user.type(box, "zzzzz");

    expect(await screen.findByText(/zzzzz/)).toBeInTheDocument();
  });

  // No fallback value standing in for real data: a failed search says so.
  it("says the ledger could not be searched, and still offers the screens", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("hors ligne"))));
    const user = userEvent.setup();
    renderSearch();
    const box = await open(user);

    await user.type(box, "import");

    expect(await screen.findByRole("alert")).toHaveTextContent(/recherche/i);
    expect(screen.getByRole("link", { name: /Import/ })).toBeInTheDocument();
  });
});
