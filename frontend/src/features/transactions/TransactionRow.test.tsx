import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TransactionRow } from "./TransactionRow";

const categories = [
  { id: 1, parent_id: null, name: "Alimentation", slug: "alimentation",
    kind: "expense", color: "#4fd6a8", icon: "cart", monthly_budget_cents: null },
  { id: 2, parent_id: 1, name: "Courses", slug: "alimentation-courses",
    kind: "expense", color: "#4fd6a8", icon: "cart", monthly_budget_cents: null },
];

const transaction = {
  id: 10, account_id: 1, date: "2025-03-01", value_date: null, amount_cents: -4732,
  label_raw: "CARREFOUR MARKET CB 01/03", label_clean: "carrefour market",
  category_id: 2, category_source: "builtin", is_transfer: false,
  is_recurring: false, notes: null, tags: [],
};

describe("TransactionRow", () => {
  it("shows a debit in French formatting", () => {
    render(<TransactionRow transaction={transaction} categories={categories}
                           onRecategorize={vi.fn()} />);
    expect(screen.getByText("−47,32 €")).toBeInTheDocument();
  });

  it("shows the raw label so the user recognizes the line on their statement", () => {
    render(<TransactionRow transaction={transaction} categories={categories}
                           onRecategorize={vi.fn()} />);
    expect(screen.getByText("CARREFOUR MARKET CB 01/03")).toBeInTheDocument();
  });

  it("marks where the category came from", () => {
    render(<TransactionRow transaction={transaction} categories={categories}
                           onRecategorize={vi.fn()} />);
    expect(screen.getByTitle("Catégorie déduite d'une règle intégrée")).toBeInTheDocument();
  });

  it("labels an uncategorized transaction explicitly", () => {
    render(<TransactionRow
      transaction={{ ...transaction, category_id: null, category_source: "uncategorized" }}
      categories={categories} onRecategorize={vi.fn()} />);
    expect(screen.getByText("Non catégorisé")).toBeInTheDocument();
  });

  it("reports the chosen category when the user recategorizes", async () => {
    const onRecategorize = vi.fn();
    render(<TransactionRow transaction={transaction} categories={categories}
                           onRecategorize={onRecategorize} />);
    await userEvent.selectOptions(screen.getByLabelText("Catégorie"), "1");
    expect(onRecategorize).toHaveBeenCalledWith(10, 1);
  });

  it("renders a credit with the positive tone", () => {
    render(<TransactionRow transaction={{ ...transaction, amount_cents: 245000 }}
                           categories={categories} onRecategorize={vi.fn()} />);
    expect(screen.getByText("2 450,00 €")).toHaveClass("yd-amount--positive");
  });
});
