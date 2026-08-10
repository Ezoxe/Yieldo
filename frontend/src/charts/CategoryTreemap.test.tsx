import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "../app/ThemeProvider";
import type { Category, CategoryBreakdown } from "../lib/types";
import { buildCategoryTreemapItems, CategoryTreemap } from "./CategoryTreemap";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

const categories: Category[] = [
  { id: 1, parent_id: null, name: "Alimentation", slug: "alimentation", kind: "expense", color: "#4fd6a8", icon: "cart", monthly_budget_cents: null },
  { id: 2, parent_id: 1, name: "Courses", slug: "alimentation-courses", kind: "expense", color: "#4fd6a8", icon: "cart", monthly_budget_cents: null },
  { id: 3, parent_id: 1, name: "Restaurants", slug: "alimentation-restaurants", kind: "expense", color: "#4fd6a8", icon: "cart", monthly_budget_cents: null },
  { id: 4, parent_id: null, name: "Logement", slug: "logement", kind: "expense", color: "#7ee2d6", icon: "home", monthly_budget_cents: null },
];

const breakdown: CategoryBreakdown[] = [
  { category_id: 2, name: "Courses", color: "#4fd6a8", total_cents: -30000, count: 10, share: 0.3 },
  { category_id: 3, name: "Restaurants", color: "#4fd6a8", total_cents: -10000, count: 3, share: 0.1 },
  { category_id: 4, name: "Logement", color: "#7ee2d6", total_cents: -60000, count: 1, share: 0.6 },
  { category_id: null, name: "Non catégorisé", color: "", total_cents: -5000, count: 2, share: 0.05 },
];

describe("buildCategoryTreemapItems", () => {
  it("groups leaf categories under their parent as a drillable node", () => {
    const items = buildCategoryTreemapItems(breakdown, categories);
    const alimentation = items.find((item) => item.name === "Alimentation");
    expect(alimentation?.children).toHaveLength(2);
    expect(alimentation?.valueCents).toBe(40000);
  });

  it("leaves a top-level category with no parent as a flat leaf, not a pointless single-child wrapper", () => {
    const items = buildCategoryTreemapItems(breakdown, categories);
    const logement = items.find((item) => item.name === "Logement");
    expect(logement?.children).toBeUndefined();
    expect(logement?.valueCents).toBe(60000);
  });

  it("keeps the uncategorised bucket as its own node without inventing a parent for it", () => {
    const items = buildCategoryTreemapItems(breakdown, categories);
    const uncategorized = items.find((item) => item.name === "Non catégorisé");
    expect(uncategorized).toBeDefined();
    expect(uncategorized?.valueCents).toBe(5000);
  });

  it("always sizes nodes by positive magnitude even though totals are negative", () => {
    const items = buildCategoryTreemapItems(breakdown, categories);
    for (const item of items) expect(item.valueCents).toBeGreaterThan(0);
  });
});

describe("CategoryTreemap", () => {
  it("renders with an accessible label describing the breakdown", () => {
    const items = buildCategoryTreemapItems(breakdown, categories);
    render(
      <ThemeProvider>
        <CategoryTreemap items={items} />
      </ThemeProvider>,
    );
    expect(screen.getByRole("img")).toBeInTheDocument();
  });

  it("shows an inviting empty state instead of an empty grid when nothing was spent", () => {
    render(
      <ThemeProvider>
        <CategoryTreemap items={[]} />
      </ThemeProvider>,
    );
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText(/Aucune dépense/i)).toBeInTheDocument();
  });
});
