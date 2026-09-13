import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Category } from "../../lib/types";
import { CategoriesPage, groupByParent, parseBudget } from "./CategoriesPage";

// The tree, never the whole page: every parent name is also an option in the
// "Rattachée à" select beside it.
const tree = () => within(screen.getByRole("list", { name: "Votre arborescence" }));

const categories: Category[] = [
  { id: 1, parent_id: null, name: "Alimentation", slug: "alimentation", kind: "expense",
    color: "#4fd6a8", icon: "cart", monthly_budget_cents: 45_000, is_essential: true },
  { id: 2, parent_id: 1, name: "Courses", slug: "courses", kind: "expense",
    color: "#4fd6a8", icon: "cart", monthly_budget_cents: null, is_essential: false },
  { id: 3, parent_id: null, name: "Loisirs", slug: "loisirs", kind: "expense",
    color: "#7ee2d6", icon: "star", monthly_budget_cents: null, is_essential: false },
];

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation((_input: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method === "GET") return Promise.resolve(jsonResponse(categories));
    return Promise.resolve(jsonResponse(categories[0]));
  });
  vi.stubGlobal("fetch", fetchMock);
});

describe("groupByParent", () => {
  it("puts each child under its parent, in the order given", () => {
    const groups = groupByParent(categories);
    expect(groups.map((group) => group.parent.name)).toEqual(["Alimentation", "Loisirs"]);
    expect(groups[0].children.map((child) => child.name)).toEqual(["Courses"]);
  });

  // A child whose parent is missing exists in the database whether or not the
  // screen can place it; dropping it silently would hide a real row.
  it("surfaces a child whose parent is absent rather than dropping it", () => {
    const orphan: Category = { ...categories[1], id: 9, parent_id: 42, name: "Orpheline" };
    expect(groupByParent([categories[0], orphan]).map((group) => group.parent.name)).toEqual([
      "Alimentation",
      "Orpheline",
    ]);
  });
});

describe("parseBudget", () => {
  it("reads an empty field as no ceiling at all, which is what the column stores", () => {
    expect(parseBudget("")).toBeNull();
    expect(parseBudget("   ")).toBeNull();
  });

  it("reads euros as integer cents, both separators", () => {
    expect(parseBudget("450")).toBe(45_000);
    expect(parseBudget("450,50")).toBe(45_050);
    expect(parseBudget("450.50")).toBe(45_050);
  });

  // undefined is "unreadable", distinct from null's "no ceiling" -- the two
  // must never collapse, or a typo would silently clear a budget.
  it("refuses what it cannot read, distinctly from an empty field", () => {
    expect(parseBudget("douze")).toBeUndefined();
    expect(parseBudget("-12")).toBeUndefined();
    expect(parseBudget("12,345")).toBeUndefined();
  });
});

// jsdom does not lay anything out, so the one rule that keeps the shared gap
// under PageHead is read from the stylesheet on disk, the way contrast.test.ts
// reads tokens.css. The screen root was `display: block` and the first panel
// sat flush against the description — the only screen where it did.
describe("CategoriesPage stylesheet", () => {
  it("makes the screen root a flex column with the shared gap", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const css = readFileSync(path.resolve(here, "./CategoriesPage.css"), "utf8");
    const root = css.match(/\.yd-categories\s*\{([^}]*)\}/);
    expect(root).not.toBeNull();
    expect(root?.[1]).toMatch(/display:\s*flex/);
    expect(root?.[1]).toMatch(/flex-direction:\s*column/);
    expect(root?.[1]).toMatch(/gap:\s*var\(--yd-space-lg\)/);
  });
});

describe("CategoriesPage", () => {
  it("shows a skeleton of the tree while it loads, never an empty panel", () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    render(<CategoriesPage />);
    expect(screen.getByRole("status", { name: "Chargement des catégories" })).toBeInTheDocument();
  });


  it("shows the tree with each ceiling, or says there is none", async () => {
    render(<CategoriesPage />);

    await screen.findByRole("list", { name: "Votre arborescence" });
    expect(tree().getByText("Alimentation")).toBeInTheDocument();
    expect(screen.getByText("450,00 € / mois")).toBeInTheDocument();
    expect(screen.getAllByText("Sans budget").length).toBe(2);
  });

  it("marks a category the household called essential", async () => {
    render(<CategoriesPage />);
    await screen.findByRole("list", { name: "Votre arborescence" });
    expect(screen.getAllByText("essentielle").length).toBe(1);
  });

  it("saves a renamed category onto the row itself", async () => {
    const user = userEvent.setup();
    render(<CategoriesPage />);
    await screen.findByRole("list", { name: "Votre arborescence" });

    const row = tree().getByText("Alimentation").closest("li") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "Modifier" }));
    const field = within(row).getByLabelText("Nom");
    await user.clear(field);
    await user.type(field, "Nourriture");
    await user.click(within(row).getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        (call) => (call[1] as RequestInit | undefined)?.method === "PATCH",
      );
      expect(patch).toBeDefined();
      expect(String(patch?.[0])).toBe("/api/categories/1");
      expect(JSON.parse(String((patch?.[1] as RequestInit).body)).name).toBe("Nourriture");
    });
  });

  it("refuses a budget it cannot read instead of clearing it", async () => {
    const user = userEvent.setup();
    render(<CategoriesPage />);
    await screen.findByRole("list", { name: "Votre arborescence" });

    const row = tree().getByText("Alimentation").closest("li") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "Modifier" }));
    const budget = within(row).getByLabelText("Budget mensuel (€)");
    await user.clear(budget);
    await user.type(budget, "douze");
    await user.click(within(row).getByRole("button", { name: "Enregistrer" }));

    expect(await within(row).findByRole("alert")).toHaveTextContent(/budget/i);
    expect(
      fetchMock.mock.calls.some((call) => (call[1] as RequestInit | undefined)?.method === "PATCH"),
    ).toBe(false);
  });

  it("says what deleting a category does to the operations filed under it", async () => {
    render(<CategoriesPage />);
    await screen.findByRole("list", { name: "Votre arborescence" });
    expect(screen.getByText(/redeviennent non catégorisées/)).toBeInTheDocument();
  });
});
